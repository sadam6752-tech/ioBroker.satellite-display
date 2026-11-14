'use strict';

// One tablet with the web app (www/): the same actions as a satellite (tile_set, tile_value ...), as JSON over a
// WebSocket that the tablet opens to the adapter. A browser cannot speak the ESPHome Native API nor take a
// connection, so the direction is the other way round than with a satellite; for main.js both look the same.
//
// To the tablet:   {type: 'config', name, grid: {cols, rows, pages}}   after its hello
//                  {type: 'action', name: 'tile_value', data: {page, slot, value}}
// From the tablet: {type: 'hello', version}
//                  {type: 'input', page, slot, input, value}            a touch, as the event tile_input
//                  {type: 'lock', locked, failed}                       its screen lock, as the event screen_lock

const { EventEmitter } = require('node:events');
const { TILE_ACTIONS } = require('./satellite');

/** The actions the web app has: those of the satellite firmware 2.1, without the player and the brightness */
const TABLET_ACTIONS = [
    ...TILE_ACTIONS,
    'tile_setpoint',
    'tile_color',
    'tile_background',
    'tile_toggle',
    'lock_config',
    'lock_set',
    // only the web app: the title of a page in its bar
    'page_title',
];

/** A message of the tablet longer than this is dropped */
const MAX_MESSAGE = 4096;

/** What a touch may say (lib/satellite.js TileInput) */
const INPUTS = ['switch', 'level', 'press', 'setpoint'];

/**
 * @typedef {object} TabletSocket - The part of a WebSocket of the ws package this module uses
 * @property {number} readyState - 1 = open
 * @property {(data: string) => void} send - Sends text
 * @property {(code?: number, reason?: string) => void} close - Closes
 * @property {(event: string, listener: (...args: unknown[]) => void) => void} on - Adds a listener
 */

/**
 * @param {unknown} raw - Received data
 * @returns {Record<string, unknown> | null} The message, null when it is no JSON object or too long
 */
function parseMessage(raw) {
    const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw ?? '');
    if (!text || text.length > MAX_MESSAGE) {
        return null;
    }
    try {
        const msg = JSON.parse(text);
        return msg && typeof msg === 'object' && !Array.isArray(msg) ? msg : null;
    } catch {
        return null;
    }
}

/**
 * @param {Record<string, unknown>} msg - Message of the tablet
 * @param {{pages: number, slots: number}} grid - Its grid
 * @returns {import('./satellite').TileInput | null} The touch, null when it is none
 */
function parseInput(msg, grid) {
    const page = Number(msg.page);
    const slot = Number(msg.slot);
    const value = Number(msg.value);
    const input = String(msg.input ?? '');
    if (
        !Number.isInteger(page) ||
        page < 1 ||
        page > grid.pages ||
        !Number.isInteger(slot) ||
        slot < 0 ||
        slot >= grid.slots ||
        !INPUTS.includes(input) ||
        !Number.isFinite(value)
    ) {
        return null;
    }
    return { page, slot, input, value };
}

/**
 * Events as SatelliteLink: `ready` (the web app said hello), `disconnected`, `input` (a touch), `lock` (its screen
 * lock).
 */
class TabletLink extends EventEmitter {
    /**
     * @param {object} options - Options
     * @param {string} options.name - Name of the tablet
     * @param {import('./layout').Grid} options.grid - Its grid
     */
    constructor({ name, grid }) {
        super();
        this.name = name;
        this.grid = grid;
        this.ready = false;
        this.stopped = false;
        /** @type {TabletSocket | null} */
        this.socket = null;
    }

    /** Nothing to dial: the tablet comes to the adapter. */
    start() {
        this.stopped = false;
    }

    /**
     * The key of the tablet was replaced: its connection ends with the code of an unknown key, so the web app says
     * that its link is out of date (lib/tablet-server.js UNKNOWN_KEY).
     */
    revoke() {
        const socket = this.socket;
        this.socket = null;
        this._lost();
        if (socket) {
            try {
                socket.close(4001, 'unknown key');
            } catch {
                // already closed
            }
        }
    }

    /** Closes the connection of the tablet. */
    stop() {
        this.stopped = true;
        const socket = this.socket;
        this.socket = null;
        this.ready = false;
        if (socket) {
            try {
                socket.close(1001, 'adapter stops');
            } catch {
                // already closed
            }
        }
    }

    /**
     * A WebSocket of this tablet came in (its access key is checked). A new one replaces the old one: the same
     * tablet after a reload, or after it woke up.
     *
     * @param {TabletSocket} socket - The connection
     */
    attach(socket) {
        if (this.stopped) {
            socket.close(1001, 'adapter stops');
            return;
        }
        const old = this.socket;
        this.socket = socket;
        if (old) {
            try {
                old.close(4000, 'replaced by a new connection');
            } catch {
                // already closed
            }
        }
        this._lost();
        socket.on('message', raw => this._onMessage(socket, raw));
        socket.on('close', () => {
            if (this.socket === socket) {
                this.socket = null;
                this._lost();
            }
        });
        // a socket error ends in close
        socket.on('error', () => undefined);
    }

    /**
     * @param {TabletSocket} socket - The connection it came on
     * @param {unknown} raw - The data
     */
    _onMessage(socket, raw) {
        if (socket !== this.socket) {
            return;
        }
        const msg = parseMessage(raw);
        if (!msg) {
            return;
        }
        if (msg.type === 'hello') {
            this._send({
                type: 'config',
                name: this.name,
                grid: { cols: this.grid.cols, rows: this.grid.rows, pages: this.grid.pages },
            });
            // a second hello on the same connection (the app started again) gets the layout again
            this.ready = true;
            this.emit('ready');
        } else if (msg.type === 'input' && this.ready) {
            const input = parseInput(msg, this.grid);
            if (input) {
                this.emit('input', input);
            }
        } else if (msg.type === 'lock' && this.ready) {
            const failed = Number(msg.failed);
            this.emit('lock', {
                locked: msg.locked === true,
                failed: Number.isInteger(failed) && failed > 0 ? failed : 0,
            });
        }
    }

    /** The connection is gone; the tablet connects again by itself. */
    _lost() {
        if (this.ready) {
            this.ready = false;
            this.emit('disconnected');
        }
    }

    /**
     * @param {Record<string, unknown>} msg - Message
     * @returns {boolean} Sent
     */
    _send(msg) {
        const socket = this.socket;
        if (!socket || socket.readyState !== 1) {
            return false;
        }
        try {
            socket.send(JSON.stringify(msg));
            return true;
        } catch {
            return false;
        }
    }

    /**
     * @param {string} name - Action
     * @returns {boolean} True when the web app has it
     */
    has(name) {
        return TABLET_ACTIONS.includes(name);
    }

    /**
     * Calls an action of the web app.
     *
     * @param {string} name - Action, e.g. tile_value
     * @param {Record<string, unknown>} data - Arguments by name
     * @returns {boolean} False when not connected or unknown
     */
    call(name, data) {
        if (!this.ready || !this.has(name)) {
            return false;
        }
        return this._send({ type: 'action', name, data });
    }
}

module.exports = { TabletLink, TABLET_ACTIONS, parseMessage, parseInput, MAX_MESSAGE };
