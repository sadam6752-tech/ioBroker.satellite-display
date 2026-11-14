'use strict';

// The web server of the tablets: the files of the web app (www/) and one WebSocket (/ws) per tablet. It runs only
// while "Tablets with the web app" is switched on. Built after ioBroker.time-tracker (src/lib/web/server.ts,
// stream.ts) and ioBroker.e-invoices (src/lib/tls.ts):
// - a browser cannot set headers on a WebSocket, so the access key comes in the query (?key=...);
// - a tablet that does not answer the protocol ping is dropped;
// - a failed listen() is reported and does not stop the adapter.

const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const { WebSocketServer } = require('ws');

/** Protocol ping to every tablet; one without a pong since the last one is dropped */
const PING_MS = 30_000;
/** Close code for a key no tablet has: the web app tells the user that its link is out of date */
const UNKNOWN_KEY = 4001;
/** Largest message a tablet may send (ws: maxPayload) */
const MAX_PAYLOAD = 16 * 1024;

/** Types of the files of the web app */
const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
};

/** The page of a tablet: /t/<access key>/ (the web app below it, so that its manifest and start page carry the key) */
const TABLET_PATH = /^\/t\/[^/]+(\/.*)?$/;

/**
 * The file of the web app a request path names, or null when it is none (outside www/, unknown type). A tablet
 * loads the app below /t/<access key>/: iOS saves a page to the home screen with the start URL of its manifest and
 * drops the query, so a key in the query (?key=) got lost (2026-11-14); in the path it stays.
 *
 * @param {string} root - Absolute path of www/
 * @param {string} urlPath - Path of the request, e.g. "/", "/app.js" or "/t/<key>/app.js"
 * @returns {string | null} Absolute file path
 */
function fileOf(root, urlPath) {
    let rel;
    try {
        rel = decodeURIComponent(String(urlPath || '/').split('?')[0]);
    } catch {
        return null;
    }
    if (rel.includes('\0')) {
        return null;
    }
    const tablet = TABLET_PATH.exec(rel);
    if (tablet) {
        rel = tablet[1] || '/';
    }
    if (rel === '/' || rel === '') {
        rel = '/index.html';
    }
    const file = path.resolve(root, `.${path.posix.normalize(rel)}`);
    if (!file.startsWith(root + path.sep) || !TYPES[path.extname(file).toLowerCase()]) {
        return null;
    }
    return file;
}

/**
 * @typedef {object} Timers - Timers of the adapter (they end with it)
 * @property {(cb: () => void, ms: number) => unknown} setInterval - adapter.setInterval
 * @property {(handle: unknown) => void} clearInterval - adapter.clearInterval
 */

/**
 * Links of the older form go to the page of the tablet: /?key=<key> → /t/<key>/, and /t/<key> → /t/<key>/ (the
 * files of the app are named relative to the page).
 *
 * @param {string} url - URL of the request
 * @returns {string | null} Where to go, null to serve the request as it is
 */
function redirectOf(url) {
    let parsed;
    try {
        parsed = new URL(url, 'http://tablet');
    } catch {
        return null;
    }
    const key = parsed.searchParams.get('key');
    if ((parsed.pathname === '/' || parsed.pathname === '/index.html') && key) {
        return `/t/${encodeURIComponent(key)}/`;
    }
    if (/^\/t\/[^/]+$/.test(parsed.pathname)) {
        return `${parsed.pathname}/`;
    }
    return null;
}

/** The web server of the tablets: files of the web app and their WebSockets. */
class TabletServer {
    /**
     * @param {object} options - Options
     * @param {string} options.root - Absolute path of www/
     * @param {(key: string) => {attach: (socket: import('ws').WebSocket) => void} | null} options.linkOf - The tablet of an access key,
     *   null when the key is wrong
     * @param {Timers} options.timers - Timers of the adapter
     * @param {{debug: (msg: string) => void, info: (msg: string) => void}} options.log - Log of the adapter
     */
    constructor({ root, linkOf, timers, log }) {
        this.root = path.resolve(root);
        this.linkOf = linkOf;
        this.timers = timers;
        this.log = log;
        /** @type {http.Server | https.Server | null} */
        this.server = null;
        /** @type {WebSocketServer | null} */
        this.wss = null;
        /** @type {unknown} */
        this.pinger = null;
        /** @type {WeakSet<object>} sockets that answered the last ping */
        this.alive = new WeakSet();
    }

    /**
     * Starts listening.
     *
     * @param {object} options - Where
     * @param {number} options.port - TCP port
     * @param {string} options.bind - Address, e.g. 0.0.0.0
     * @param {import('./tls').TlsOptions} [options.tls] - Certificate; without it plain HTTP
     * @returns {Promise<{address: string, port: number}>} The address really bound
     */
    start({ port, bind, tls }) {
        const onRequest = (/** @type {http.IncomingMessage} */ req, /** @type {http.ServerResponse} */ res) =>
            this.onRequest(req, res);
        const server = tls
            ? https.createServer({ key: tls.key, cert: tls.cert, ca: tls.ca }, onRequest)
            : http.createServer(onRequest);
        const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });
        server.on('upgrade', (req, socket, head) => this.onUpgrade(req, socket, head));
        this.server = server;
        this.wss = wss;
        return new Promise((resolve, reject) => {
            const fail = (/** @type {Error} */ e) => {
                this.server = null;
                this.wss = null;
                wss.close();
                reject(e);
            };
            server.once('error', fail);
            server.listen(port, bind || undefined, () => {
                server.off('error', fail);
                // a later error (a client that breaks off a TLS handshake) must not stop the adapter
                server.on('error', e => this.log.debug(`Tablet server: ${e.message}`));
                server.on('clientError', (e, socket) => socket.destroy());
                this.pinger = this.timers.setInterval(() => this.ping(), PING_MS);
                const address = server.address();
                resolve(
                    address && typeof address === 'object'
                        ? { address: address.address, port: address.port }
                        : { address: bind, port },
                );
            });
        });
    }

    /** Pings every tablet; one that did not answer the last ping is dropped (it connects again when awake). */
    ping() {
        for (const ws of this.wss?.clients ?? []) {
            if (!this.alive.has(ws)) {
                ws.terminate();
                continue;
            }
            this.alive.delete(ws);
            try {
                ws.ping();
            } catch {
                ws.terminate();
            }
        }
    }

    /**
     * The files of the web app: GET and HEAD only, nothing outside www/.
     *
     * @param {http.IncomingMessage} req - Request
     * @param {http.ServerResponse} res - Response
     */
    onRequest(req, res) {
        const headers = {
            'X-Content-Type-Options': 'nosniff',
            'Referrer-Policy': 'no-referrer',
            'X-Frame-Options': 'DENY',
        };
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.writeHead(405, { ...headers, Allow: 'GET, HEAD' });
            res.end();
            return;
        }
        const url = String(req.url || '/');
        const where = redirectOf(url);
        if (where) {
            res.writeHead(302, { ...headers, Location: where, 'Cache-Control': 'no-store' });
            res.end();
            return;
        }
        const file = fileOf(this.root, url);
        if (!file) {
            res.writeHead(404, headers);
            res.end();
            return;
        }
        fs.readFile(file, (err, data) => {
            if (err) {
                res.writeHead(404, headers);
                res.end();
                return;
            }
            res.writeHead(200, {
                ...headers,
                'Content-Type': TYPES[path.extname(file).toLowerCase()],
                'Content-Length': data.length,
                // the app updates with the adapter; the service worker keeps it for offline
                'Cache-Control': 'no-cache',
            });
            res.end(req.method === 'HEAD' ? undefined : data);
        });
    }

    /**
     * The WebSocket of a tablet: /ws?key=<access key>.
     *
     * @param {http.IncomingMessage} req - Upgrade request
     * @param {import('node:stream').Duplex} socket - Its socket
     * @param {Buffer} head - First data
     */
    onUpgrade(req, socket, head) {
        let url;
        try {
            url = new URL(String(req.url || '/'), 'http://tablet');
        } catch {
            socket.destroy();
            return;
        }
        if (url.pathname !== '/ws' || !this.wss) {
            socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
            socket.destroy();
            return;
        }
        const link = this.linkOf(url.searchParams.get('key') || '');
        if (!link) {
            // a browser does not see the status of a refused WebSocket: it is taken and closed at once with a code of
            // its own, so the web app can say that its link is out of date (the tablet was removed or got a new key)
            this.log.debug(`Tablet server: a connection from ${req.socket.remoteAddress} with an unknown key`);
            this.wss.handleUpgrade(req, socket, head, ws => ws.close(UNKNOWN_KEY, 'unknown key'));
            return;
        }
        this.wss.handleUpgrade(req, socket, head, ws => {
            this.alive.add(ws);
            ws.on('pong', () => this.alive.add(ws));
            link.attach(ws);
        });
    }

    /** Closes every connection and the server. */
    stop() {
        if (this.pinger) {
            this.timers.clearInterval(this.pinger);
            this.pinger = null;
        }
        for (const ws of this.wss?.clients ?? []) {
            ws.terminate();
        }
        this.wss?.close();
        this.wss = null;
        if (this.server) {
            this.server.close();
            this.server.closeAllConnections?.();
            this.server = null;
        }
    }
}

module.exports = { TabletServer, fileOf, redirectOf, PING_MS, MAX_PAYLOAD, UNKNOWN_KEY };
