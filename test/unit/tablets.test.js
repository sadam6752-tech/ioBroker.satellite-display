'use strict';

// Tablets with the web app (PWA, off by default): their grid in the settings, the commands of the AI agents on it,
// the connection (TabletLink) and the web server (TabletServer) over a real socket.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const WebSocket = require('ws');
const {
    normalizeDisplays,
    normalizeTablets,
    normalizeSatellites,
    normalizeTiles,
    TABLET_DEFAULT,
} = require('../../lib/layout');
const { runCommand } = require('../../lib/commands');
const { TabletLink, parseInput, TABLET_ACTIONS } = require('../../lib/tablet');
const { TabletServer, fileOf, redirectOf } = require('../../lib/tablet-server');
const { decideTls } = require('../../lib/tls');

const SATS = [{ enabled: true, name: 'Gast', host: '192.168.1.246' }];
const TABLETS = [{ enabled: true, name: 'Flur', cols: 4, rows: 3, pages: 2 }];

describe('tablets: settings', () => {
    it('are left out while the PWA is off, whatever the table holds', () => {
        const displays = normalizeDisplays({ satellites: SATS, tablets: TABLETS }, []);
        assert.deepEqual(
            displays.map(d => d.kind),
            ['satellite'],
        );
        assert.deepEqual(
            normalizeDisplays({ satellites: SATS, tablets: TABLETS, pwaEnabled: false }, []).map(d => d.id),
            ['gast'],
        );
    });

    it('come with their grid when the PWA is on; a satellite keeps 2 x 4 on 4 pages', () => {
        const displays = normalizeDisplays({ satellites: SATS, tablets: TABLETS, pwaEnabled: true }, []);
        assert.deepEqual(
            displays.map(d => [d.kind, d.id, d.grid]),
            [
                ['satellite', 'gast', { cols: 2, rows: 4, pages: 4, slots: 8 }],
                ['tablet', 'flur', { cols: 4, rows: 3, pages: 2, slots: 12 }],
            ],
        );
    });

    it('report a name taken by a satellite, a missing name and a grid out of range', () => {
        const problems = [];
        const tablets = normalizeTablets(
            [
                { name: 'gast' },
                { name: '' },
                { name: 'Küche', cols: 12, rows: 0, pages: 2.5 },
                { enabled: false, name: 'Off' },
            ],
            normalizeSatellites(SATS, []),
            problems,
        );
        assert.deepEqual(
            tablets.map(t => [t.name, t.grid.cols, t.grid.rows, t.grid.pages]),
            [['Küche', TABLET_DEFAULT.cols, TABLET_DEFAULT.rows, TABLET_DEFAULT.pages]],
        );
        assert.equal(problems.length, 5, problems.join('\n'));
        assert.match(problems[0], /already used by a satellite/);
        assert.match(problems[1], /a name is needed/);
    });

    it('take tiles up to the edge of their own grid', () => {
        const displays = normalizeDisplays({ satellites: SATS, tablets: TABLETS, pwaEnabled: true }, []);
        const problems = [];
        const tiles = normalizeTiles(
            [
                { satellite: 'Flur', page: 2, col: 3, row: 2, size: 's', type: 'value', state: 'a.0.x' },
                { satellite: 'Flur', page: 1, col: 2, row: 1, size: 'l', type: 'value', state: 'a.0.y' },
                { satellite: 'Flur', page: 3, col: 0, row: 0, size: 's', type: 'value', state: 'a.0.z' },
                { satellite: 'Flur', page: 1, col: 3, row: 2, size: 'w', type: 'value', state: 'a.0.w' },
                { satellite: 'Gast', page: 1, col: 2, row: 0, size: 's', type: 'value', state: 'a.0.v' },
            ],
            displays,
            problems,
        );
        assert.deepEqual(
            tiles.map(t => [t.satellite, t.page, t.gridCol, t.gridRow]),
            [
                ['flur', 2, 3, 2],
                ['flur', 1, 2, 1],
            ],
        );
        assert.match(problems[0], /Tile 3: the page must be 1 to 2/);
        assert.match(problems[1], /Tile 4: does not fit the grid/);
        assert.match(problems[2], /Tile 5: does not fit the grid/);
    });

    it('a switch with an icon keeps its toggle on a tablet, not on a satellite (unless the editor says)', () => {
        const displays = normalizeDisplays({ satellites: SATS, tablets: TABLETS, pwaEnabled: true }, []);
        const row = {
            page: 1,
            col: 0,
            row: 0,
            size: 's',
            type: 'switch',
            state: 'a.0.x',
            icon: 'lightbulb',
            label: 'Licht',
        };
        const tiles = normalizeTiles(
            [
                { ...row, satellite: 'Gast' },
                { ...row, satellite: 'Flur' },
                { ...row, satellite: 'Flur', col: 1, hideToggle: true },
            ],
            displays,
            [],
        );
        assert.deepEqual(
            tiles.map(t => t.showToggle),
            [false, true, false],
        );
    });

    it('take every type in every size, a satellite only the sizes of its firmware', () => {
        const displays = normalizeDisplays({ satellites: SATS, tablets: TABLETS, pwaEnabled: true }, []);
        const problems = [];
        const tiles = normalizeTiles(
            [
                { satellite: 'Flur', page: 1, col: 0, row: 0, size: 'q', type: 'chart', state: 'a.0.x' },
                { satellite: 'Flur', page: 1, col: 1, row: 0, size: 's', type: 'gauge', state: 'a.0.x' },
                { satellite: 'Flur', page: 1, col: 2, row: 0, size: 's', type: 'dimmer', state: 'a.0.x' },
                { satellite: 'Gast', page: 1, col: 0, row: 0, size: 'q', type: 'chart', state: 'a.0.x' },
            ],
            displays,
            problems,
        );
        assert.deepEqual(
            tiles.map(t => [t.satellite, t.type, t.size]),
            [
                ['flur', 'chart', 'q'],
                ['flur', 'gauge', 's'],
                ['flur', 'dimmer', 's'],
            ],
        );
        assert.match(problems[0], /Tile 4: a chart tile comes in the sizes s, w, l/);
    });

    it('hold as many tiles a page as they have cells', () => {
        const displays = normalizeDisplays(
            { satellites: [], tablets: [{ name: 'Mini', cols: 1, rows: 2, pages: 1 }], pwaEnabled: true },
            [],
        );
        const problems = [];
        const tiles = normalizeTiles(
            [0, 1].map(row => ({ satellite: 'Mini', page: 1, col: 0, row, size: 's', type: 'value', state: 'a.0.x' })),
            displays,
            problems,
        );
        assert.deepEqual(
            tiles.map(t => t.slot),
            [0, 1],
        );
        assert.deepEqual(problems, []);
    });
});

describe('tablets: page titles', () => {
    const { pageTitlesOf } = require('../../lib/layout');
    const displays = normalizeDisplays({ satellites: SATS, tablets: TABLETS, pwaEnabled: true }, []);
    const ctx = pageTitles => ({
        satellites: SATS,
        tablets: TABLETS,
        pwaEnabled: true,
        tiles: [],
        pageTitles,
        stateExists: async () => true,
    });

    it('a tablet has its titles, cut and within its pages; a satellite has none', () => {
        const all = { flur: { 1: ' Heizung ', 2: 'x'.repeat(40), 3: 'beyond the pages' }, gast: { 1: 'Licht' } };
        assert.deepEqual(pageTitlesOf(all, displays[1]), { 1: 'Heizung', 2: 'x'.repeat(32) });
        assert.deepEqual(pageTitlesOf(all, displays[0]), {});
        assert.deepEqual(pageTitlesOf(undefined, displays[1]), {});
    });

    it('setPageTitle sets and removes a title; getTiles lists them', async () => {
        const set = await runCommand(
            'setPageTitle',
            { satellite: 'Flur', page: 2, title: 'Licht' },
            ctx({ flur: { 1: 'Heizung' } }),
        );
        assert.deepEqual(set.answer, { ok: true, satellite: 'Flur', page: 2, title: 'Licht' });
        assert.deepEqual(set.pageTitles, { flur: { 1: 'Heizung', 2: 'Licht' } });
        const removed = await runCommand(
            'setPageTitle',
            { satellite: 'Flur', page: 1, title: '' },
            ctx(set.pageTitles),
        );
        assert.deepEqual(removed.pageTitles, { flur: { 2: 'Licht' } });
        const list = await runCommand('getTiles', {}, ctx(removed.pageTitles));
        assert.deepEqual(list.answer.pageTitles, { Flur: { 2: 'Licht' } });
    });

    it('setPageTitle refuses a satellite and a page out of range', async () => {
        assert.match(
            String(
                (await runCommand('setPageTitle', { satellite: 'Gast', page: 1, title: 'x' }, ctx({}))).answer.error,
            ),
            /satellite/,
        );
        assert.match(
            String(
                (await runCommand('setPageTitle', { satellite: 'Flur', page: 3, title: 'x' }, ctx({}))).answer.error,
            ),
            /1 to 2/,
        );
    });

    it('the web app takes page_title', () => {
        assert.ok(new TabletLink({ name: 'Flur', grid: { cols: 1, rows: 1, pages: 1, slots: 1 } }).has('page_title'));
    });
});

describe('tablets: commands of the AI agents', () => {
    const ctx = (tiles = []) => ({
        satellites: SATS,
        tablets: TABLETS,
        pwaEnabled: true,
        tiles,
        stateExists: async () => true,
    });

    it('getTiles names the grid of every display', async () => {
        const { answer } = await runCommand('getTiles', {}, ctx());
        assert.deepEqual(answer.satellites, ['Gast', 'Flur']);
        assert.deepEqual(answer.grids, {
            Gast: { kind: 'satellite', cols: 2, rows: 4, pages: 4 },
            Flur: { kind: 'tablet', cols: 4, rows: 3, pages: 2 },
        });
        assert.equal(answer.freeCells.Flur[1].length, 12);
        assert.deepEqual(Object.keys(answer.freeCells.Flur), ['1', '2']);
    });

    it('addTile places a tile in the columns a satellite does not have', async () => {
        const rows = [];
        for (let col = 0; col < 3; col++) {
            rows.push({ satellite: 'Flur', page: 1, col, row: 0, size: 's', type: 'value', state: 'a.0.x' });
        }
        const { answer, tiles } = await runCommand(
            'addTile',
            { satellite: 'flur', type: 'switch', state: 'a.0.lamp' },
            ctx(rows),
        );
        assert.equal(answer.ok, true, JSON.stringify(answer));
        assert.deepEqual([answer.added.page, answer.added.col, answer.added.row], [1, 3, 0]);
        assert.equal(tiles?.at(-1)?.satellite, 'Flur');
    });

    it('addTile answers "no room" when every page of the tablet is full', async () => {
        const rows = [];
        for (const page of [1, 2]) {
            for (let row = 0; row < 3; row++) {
                for (let col = 0; col < 4; col++) {
                    rows.push({ satellite: 'Flur', page, col, row, size: 's', type: 'value', state: 'a.0.x' });
                }
            }
        }
        const { answer, tiles } = await runCommand(
            'addTile',
            { satellite: 'Flur', type: 'value', state: 'a.0.y' },
            ctx(rows),
        );
        assert.match(String(answer.error), /no room/);
        assert.deepEqual(answer.tilesPerPage, { 1: 12, 2: 12 });
        assert.equal(tiles, undefined);
    });

    it('a tablet is unknown to the commands while the PWA is off', async () => {
        const { answer } = await runCommand(
            'addTile',
            { satellite: 'Flur', type: 'value', state: 'a.0.y' },
            { ...ctx(), pwaEnabled: false },
        );
        assert.match(String(answer.error), /no satellite "Flur"/);
    });

    it('moveTile of a tile whose display is off says so', async () => {
        const rows = [{ satellite: 'Flur', page: 1, col: 0, row: 0, size: 's', type: 'value', state: 'a.0.x' }];
        const { answer } = await runCommand('moveTile', { id: 1, page: 2 }, { ...ctx(rows), pwaEnabled: false });
        assert.match(String(answer.error), /not an enabled display/);
    });
});

/** A stand-in for a WebSocket of the ws package */
class FakeSocket extends EventEmitter {
    constructor() {
        super();
        this.readyState = 1;
        /** @type {any[]} */
        this.sent = [];
        /** @type {[number | undefined, string | undefined] | null} */
        this.closed = null;
    }
    /** @param {string} data - Text */
    send(data) {
        this.sent.push(JSON.parse(data));
    }
    /**
     * @param {number} [code] - Code
     * @param {string} [reason] - Reason
     */
    close(code, reason) {
        this.closed = [code, reason];
        this.readyState = 3;
        this.emit('close');
    }
    /** @param {object} msg - Message of the web app */
    say(msg) {
        this.emit('message', Buffer.from(JSON.stringify(msg)));
    }
}

describe('tablets: TabletLink', () => {
    const grid = { cols: 4, rows: 3, pages: 2, slots: 12 };

    it('is ready after the hello of the web app and sends it the grid first', () => {
        const link = new TabletLink({ name: 'Flur', grid });
        const events = [];
        link.on('ready', () => events.push('ready'));
        const socket = new FakeSocket();
        link.attach(socket);
        assert.equal(link.call('tile_clear', { page: 0 }), false, 'nothing before the hello');
        socket.say({ type: 'hello', version: '1' });
        assert.deepEqual(events, ['ready']);
        assert.deepEqual(socket.sent[0], { type: 'config', name: 'Flur', grid: { cols: 4, rows: 3, pages: 2 } });
        assert.equal(link.call('tile_value', { page: 1, slot: 2, value: 21.5 }), true);
        assert.deepEqual(socket.sent[1], {
            type: 'action',
            name: 'tile_value',
            data: { page: 1, slot: 2, value: 21.5 },
        });
    });

    it('has the tile actions of the firmware, not the player and the brightness', () => {
        const link = new TabletLink({ name: 'Flur', grid });
        for (const name of [
            'tile_set',
            'tile_setpoint',
            'tile_color',
            'tile_background',
            'tile_toggle',
            'lock_config',
        ]) {
            assert.ok(link.has(name), name);
        }
        for (const name of ['media_play', 'display_brightness']) {
            assert.ok(!link.has(name), name);
        }
        assert.ok(TABLET_ACTIONS.includes('lock_set'));
    });

    it('passes on touches and the screen lock, checked against its grid', () => {
        const link = new TabletLink({ name: 'Flur', grid });
        const inputs = [];
        const locks = [];
        link.on('input', i => inputs.push(i));
        link.on('lock', l => locks.push(l));
        const socket = new FakeSocket();
        link.attach(socket);
        socket.say({ type: 'input', page: 1, slot: 0, input: 'switch', value: 1 });
        assert.deepEqual(inputs, [], 'no touch before the hello');
        socket.say({ type: 'hello' });
        socket.say({ type: 'input', page: 1, slot: 11, input: 'switch', value: 1 });
        socket.say({ type: 'input', page: 2, slot: 12, input: 'switch', value: 1 });
        socket.say({ type: 'input', page: 3, slot: 0, input: 'switch', value: 1 });
        socket.say({ type: 'input', page: 1, slot: 0, input: 'format', value: 1 });
        socket.say({ type: 'lock', locked: true, failed: 2 });
        socket.emit('message', Buffer.from('not json'));
        socket.emit('message', Buffer.from(JSON.stringify({ type: 'input', pad: 'x'.repeat(5000) })));
        assert.deepEqual(inputs, [{ page: 1, slot: 11, input: 'switch', value: 1 }]);
        assert.deepEqual(locks, [{ locked: true, failed: 2 }]);
    });

    it('a new connection of the same tablet replaces the old one', () => {
        const link = new TabletLink({ name: 'Flur', grid });
        const events = [];
        link.on('ready', () => events.push('ready'));
        link.on('disconnected', () => events.push('disconnected'));
        const first = new FakeSocket();
        link.attach(first);
        first.say({ type: 'hello' });
        const second = new FakeSocket();
        link.attach(second);
        assert.deepEqual(first.closed, [4000, 'replaced by a new connection']);
        first.say({ type: 'hello' });
        assert.deepEqual(events, ['ready', 'disconnected'], 'the old socket says nothing any more');
        second.say({ type: 'hello' });
        second.close();
        assert.deepEqual(events, ['ready', 'disconnected', 'ready', 'disconnected']);
        assert.equal(link.ready, false);
    });

    it('revoke ends the connection with the code of an unknown key', () => {
        const link = new TabletLink({ name: 'Flur', grid });
        const events = [];
        link.on('disconnected', () => events.push('disconnected'));
        const socket = new FakeSocket();
        link.attach(socket);
        socket.say({ type: 'hello' });
        link.revoke();
        assert.deepEqual(socket.closed, [4001, 'unknown key']);
        assert.deepEqual(events, ['disconnected']);
        assert.equal(link.ready, false);
    });

    it('stop closes the connection and refuses new ones', () => {
        const link = new TabletLink({ name: 'Flur', grid });
        const socket = new FakeSocket();
        link.attach(socket);
        link.stop();
        assert.deepEqual(socket.closed, [1001, 'adapter stops']);
        const late = new FakeSocket();
        link.attach(late);
        assert.deepEqual(late.closed, [1001, 'adapter stops']);
    });

    it('parseInput takes the four kinds of touch only', () => {
        assert.deepEqual(parseInput({ page: 1, slot: 0, input: 'setpoint', value: 21.5 }, grid), {
            page: 1,
            slot: 0,
            input: 'setpoint',
            value: 21.5,
        });
        assert.equal(parseInput({ page: '1', slot: 0, input: 'press', value: 'x' }, grid), null);
    });
});

describe('tablets: TabletServer', () => {
    /** @type {string} */
    let root;
    /** @type {TabletServer} */
    let server;
    /** @type {TabletLink} */
    let link;
    /** @type {number} */
    let port;
    const intervals = new Set();
    const timers = {
        setInterval: (cb, ms) => {
            const h = setInterval(cb, ms);
            intervals.add(h);
            return h;
        },
        clearInterval: h => {
            clearInterval(h);
            intervals.delete(h);
        },
    };

    beforeEach(async () => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'satdisplay-www-'));
        fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>Tiles</title>');
        fs.writeFileSync(path.join(root, 'app.js'), 'console.log(1);');
        fs.writeFileSync(path.join(root, 'secret.txt'), 'no');
        fs.writeFileSync(path.join(os.tmpdir(), 'outside.html'), 'outside');
        link = new TabletLink({ name: 'Flur', grid: { cols: 4, rows: 3, pages: 2, slots: 12 } });
        server = new TabletServer({
            root,
            linkOf: key => (key === 'right-key' ? link : null),
            timers,
            log: { debug: () => undefined, info: () => undefined },
        });
        ({ port } = await server.start({ port: 0, bind: '127.0.0.1' }));
    });

    afterEach(() => {
        server.stop();
        link.stop();
        assert.equal(intervals.size, 0, 'the ping interval ends with the server');
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('serves the files of the web app, the page at /', async () => {
        const page = await fetch(`http://127.0.0.1:${port}/`);
        assert.equal(page.status, 200);
        assert.match(page.headers.get('content-type') || '', /text\/html/);
        assert.equal(await page.text(), '<!doctype html><title>Tiles</title>');
        const js = await fetch(`http://127.0.0.1:${port}/app.js?v=2`);
        assert.match(js.headers.get('content-type') || '', /javascript/);
        assert.equal(js.headers.get('x-content-type-options'), 'nosniff');
    });

    it('serves the app below /t/<key>/ and sends older links there', async () => {
        const page = await fetch(`http://127.0.0.1:${port}/t/right-key/`);
        assert.equal(page.status, 200);
        assert.match(await page.text(), /<title>Tiles<\/title>/);
        assert.equal((await fetch(`http://127.0.0.1:${port}/t/right-key/app.js`)).status, 200);
        const old = await fetch(`http://127.0.0.1:${port}/?key=right-key`, { redirect: 'manual' });
        assert.equal(old.status, 302);
        assert.equal(old.headers.get('location'), '/t/right-key/');
        const bare = await fetch(`http://127.0.0.1:${port}/t/right-key`, { redirect: 'manual' });
        assert.equal(bare.headers.get('location'), '/t/right-key/');
        assert.equal(redirectOf('/app.js'), null);
        assert.equal(redirectOf('/t/a/app.js'), null);
        // climbing up below a key ends at the top of www/ too
        assert.ok(String(fileOf(root, '/t/a/../../outside.html')).startsWith(path.resolve(root) + path.sep));
    });

    it('serves nothing outside www/, no unknown types and no other methods', async () => {
        for (const p of ['/secret.txt', '/../outside.html', '/%2e%2e/outside.html', '/missing.js']) {
            assert.equal((await fetch(`http://127.0.0.1:${port}${p}`)).status, 404, p);
        }
        assert.equal((await fetch(`http://127.0.0.1:${port}/`, { method: 'POST' })).status, 405);
        // a path that climbs up ends at the top of www/, never above it
        assert.ok(String(fileOf(root, '/..%2f..%2fetc/passwd.html')).startsWith(path.resolve(root) + path.sep));
        assert.equal(fileOf(root, '/a%00.html'), null);
    });

    it('lets a tablet in with its key only', async () => {
        // a wrong key: taken and closed at once with 4001, which the web app shows as "link out of date"
        const refused = new WebSocket(`ws://127.0.0.1:${port}/ws?key=wrong`);
        const code = await new Promise(resolve => {
            refused.on('close', c => resolve(c));
            refused.on('error', () => resolve('error'));
        });
        assert.equal(code, 4001);
        const other = new WebSocket(`ws://127.0.0.1:${port}/elsewhere?key=right-key`);
        const status = await new Promise(resolve => {
            other.on('unexpected-response', (_req, res) => resolve(res.statusCode));
            other.on('error', () => resolve('error'));
        });
        assert.equal(status, 404);

        const ready = new Promise(resolve => link.once('ready', resolve));
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?key=right-key`);
        const first = new Promise(resolve => ws.once('message', data => resolve(JSON.parse(String(data)))));
        await new Promise(resolve => ws.once('open', resolve));
        ws.send(JSON.stringify({ type: 'hello', version: 'test' }));
        await ready;
        assert.deepEqual(await first, { type: 'config', name: 'Flur', grid: { cols: 4, rows: 3, pages: 2 } });

        const touch = new Promise(resolve => link.once('input', resolve));
        ws.send(JSON.stringify({ type: 'input', page: 1, slot: 3, input: 'press', value: 1 }));
        assert.deepEqual(await touch, { page: 1, slot: 3, input: 'press', value: 1 });

        const lost = new Promise(resolve => link.once('disconnected', resolve));
        ws.close();
        await lost;
    });

    it('a second server on the same port fails with an error and does not throw', async () => {
        const other = new TabletServer({
            root,
            linkOf: () => null,
            timers,
            log: { debug: () => undefined, info: () => undefined },
        });
        await assert.rejects(other.start({ port, bind: '127.0.0.1' }), /EADDRINUSE/);
        other.stop();
    });
});

describe('tablets: HTTPS', () => {
    it('plain HTTP while HTTPS is off', async () => {
        assert.deepEqual(await decideTls({ secure: false }, async () => assert.fail('no certificate needed')), {
            mode: 'http',
        });
    });

    it('stays off without a chosen or a loadable certificate, never falls back to HTTP', async () => {
        const none = await decideTls({ secure: true, certPublic: '', certPrivate: '' }, async () => [{}]);
        assert.equal(none.mode, 'unavailable');
        const missing = await decideTls({ secure: true, certPublic: 'pub', certPrivate: 'priv' }, async () => [{}]);
        assert.equal(missing.mode, 'unavailable');
        assert.match(missing.mode === 'unavailable' ? missing.reason : '', /not in the certificate collection/);
        const failing = await decideTls({ secure: true, certPublic: 'pub', certPrivate: 'priv' }, async () => {
            throw new Error('no such object');
        });
        assert.match(failing.mode === 'unavailable' ? failing.reason : '', /no such object/);
    });

    it('takes key, certificate and chain of the collection', async () => {
        /** @type {unknown[]} */
        let asked = [];
        const decision = await decideTls(
            { secure: true, certPublic: 'defaultPublic', certPrivate: 'defaultPrivate', certChained: 'chain' },
            async (...names) => {
                asked = names;
                return [{ key: 'KEY', cert: 'CERT', ca: 'CA' }, {}];
            },
        );
        assert.deepEqual(asked, ['defaultPublic', 'defaultPrivate', 'chain']);
        assert.deepEqual(decision, { mode: 'https', tls: { key: 'KEY', cert: 'CERT', ca: 'CA' } });
    });
});
