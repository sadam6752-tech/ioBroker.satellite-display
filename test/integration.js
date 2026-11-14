'use strict';

const path = require('node:path');
const assert = require('node:assert/strict');
const { tests } = require('@iobroker/testing');

// Starts a real js-controller with this adapter and checks that it starts and keeps running.
// Without a satellite the adapter stays idle and logs why, which is the expected state of the default test.
tests.integration(path.join(__dirname, '..'), {
    defineAdditionalTests({ suite }) {
        suite('with a satellite that cannot be reached', getHarness => {
            it('creates the states of the satellite and keeps running', async function () {
                this.timeout(60_000);
                const harness = getHarness();
                await harness.changeAdapterConfig('satellite-display', {
                    native: {
                        // TEST-NET-1 (RFC 5737): never answers
                        satellites: [
                            { enabled: true, name: 'Test Room', host: '192.0.2.1', port: 6053, encryptionKey: '' },
                        ],
                        tiles: [
                            {
                                enabled: true,
                                satellite: 'Test Room',
                                page: 1,
                                col: 0,
                                row: 0,
                                size: 'q',
                                type: 'value',
                                state: 'system.adapter.satellite-display.0.alive',
                            },
                        ],
                    },
                });
                await harness.startAdapterAndWait();
                await new Promise(resolve => setTimeout(resolve, 3000));

                const connected = await harness.states.getStateAsync(
                    'satellite-display.0.satellites.test_room.connected',
                );
                assert.equal(connected?.val, false);
                const resend = await harness.objects.getObjectAsync('satellite-display.0.satellites.test_room.resend');
                assert.equal(resend?.common?.role, 'button');
                const info = await harness.states.getStateAsync('satellite-display.0.info.connection');
                assert.equal(info?.val, false);
                assert.ok(harness.isAdapterRunning(), 'the adapter stopped');

                // the preview of the tile editor: a satellite of the saved settings answers, another one not
                const ask = (command, message) =>
                    new Promise((resolve, reject) => {
                        const timer = setTimeout(() => reject(new Error(`no answer to ${command}`)), 20_000);
                        harness.sendTo('satellite-display.0', command, message, answer => {
                            clearTimeout(timer);
                            resolve(answer);
                        });
                    });
                const tile = {
                    enabled: true,
                    satellite: 'Test Room',
                    page: 2,
                    col: 0,
                    row: 0,
                    size: 's',
                    type: 'value',
                    state: 'system.adapter.satellite-display.0.alive',
                };
                const shown = await ask('preview', { satellite: 'Test Room', tiles: [tile, { ...tile, size: 'x' }] });
                assert.equal(shown.ok, true, JSON.stringify(shown));
                assert.equal(shown.tiles, 1);
                assert.equal(shown.connected, false);
                assert.equal(shown.problems.length, 1);
                const unknown = await ask('preview', { satellite: 'Keller', tiles: [tile] });
                assert.ok(unknown.error, JSON.stringify(unknown));
                const ended = await ask('previewEnd', { satellite: 'Test Room' });
                assert.equal(ended.ok, true);

                // the commands for an AI agent: a real sendTo through js-controller
                const help = await ask('help', {});
                assert.match(String(help.help), /addTile/);
                const list = await ask('getTiles', {});
                assert.deepEqual(list.satellites, ['Test Room']);
                assert.equal(list.tiles.length, 1);
                const added = await ask('addTile', {
                    type: 'switch',
                    size: 's',
                    state: 'system.adapter.satellite-display.0.alive',
                    icon: 'lightbulb',
                });
                assert.equal(added.ok, true, JSON.stringify(added));
                assert.deepEqual([added.added.page, added.added.col, added.added.row], [1, 1, 0]);
            });
        });

        suite('with a tablet (the web app switched on)', getHarness => {
            it('serves the web app, lets the tablet in with its key and sends it the tiles', async function () {
                this.timeout(60_000);
                const WebSocket = require('ws');
                const harness = getHarness();
                // a free port of this machine for the web app
                const port = await new Promise(resolve => {
                    const s = require('node:net').createServer();
                    s.listen(0, '127.0.0.1', () => {
                        const p = s.address().port;
                        s.close(() => resolve(p));
                    });
                });
                await harness.changeAdapterConfig('satellite-display', {
                    native: {
                        satellites: [],
                        pwaEnabled: true,
                        pwaPort: port,
                        pwaBind: '127.0.0.1',
                        secure: false,
                        tablets: [{ enabled: true, name: 'Hall', cols: 4, rows: 3, pages: 2 }],
                        pageTitles: { hall: { 1: 'Licht' } },
                        tiles: [
                            {
                                enabled: true,
                                satellite: 'Hall',
                                page: 1,
                                col: 3,
                                row: 2,
                                size: 's',
                                type: 'value',
                                state: 'system.adapter.satellite-display.0.alive',
                            },
                        ],
                    },
                });
                await harness.startAdapterAndWait();
                await new Promise(resolve => setTimeout(resolve, 3000));

                const device = await harness.objects.getObjectAsync('satellite-display.0.tablets.hall');
                const key = device?.native?.key;
                assert.ok(typeof key === 'string' && key.length >= 32, 'the tablet has an access key');
                const info = await harness.states.getStateAsync('satellite-display.0.info.connection');
                assert.equal(info?.val, true, 'with tablets only, the running web server is the connection');

                const page = await fetch(`http://127.0.0.1:${port}/`);
                assert.equal(page.status, 200);
                assert.match(await page.text(), /<title>Tiles<\/title>/);

                const ask = (command, message) =>
                    new Promise((resolve, reject) => {
                        const timer = setTimeout(() => reject(new Error(`no answer to ${command}`)), 20_000);
                        harness.sendTo('satellite-display.0', command, message, answer => {
                            clearTimeout(timer);
                            resolve(answer);
                        });
                    });
                const links = await ask('tabletLinks', {});
                assert.match(String(links.result), new RegExp(`^Hall: http://127\\.0\\.0\\.1:${port}/t/`));
                assert.deepEqual(
                    links.links.map(l => l.url),
                    [`http://127.0.0.1:${port}/t/${encodeURIComponent(key)}/`],
                );
                const grids = await ask('getTiles', {});
                assert.deepEqual(grids.grids, { Hall: { kind: 'tablet', cols: 4, rows: 3, pages: 2 } });

                // the tablet: hello, then the grid, the layout and the value of its tile
                const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?key=${encodeURIComponent(key)}`);
                const got = [];
                ws.on('message', data => got.push(JSON.parse(String(data))));
                await new Promise((resolve, reject) => {
                    ws.once('open', resolve);
                    ws.once('error', reject);
                });
                ws.send(JSON.stringify({ type: 'hello', version: 'test' }));
                await new Promise(resolve => setTimeout(resolve, 2000));
                assert.deepEqual(got[0], { type: 'config', name: 'Hall', grid: { cols: 4, rows: 3, pages: 2 } });
                const names = got.filter(m => m.type === 'action').map(m => m.name);
                assert.deepEqual(
                    names.slice(0, 4),
                    ['lock_config', 'tile_clear', 'page_title', 'page_title'],
                    names.join(),
                );
                assert.deepEqual(
                    got.filter(m => m.name === 'page_title').map(m => m.data),
                    [
                        { page: 1, title: 'Licht' },
                        { page: 2, title: '' },
                    ],
                );
                const set = got.find(m => m.name === 'tile_set');
                assert.deepEqual([set.data.col, set.data.row, set.data.size], [3, 2, 's']);
                assert.ok(names.includes('tile_text') || names.includes('tile_value'), names.join());
                const connected = await harness.states.getStateAsync('satellite-display.0.tablets.hall.connected');
                assert.equal(connected?.val, true);
                // a new link: the object keeps the new key, the connected tablet is told that its link is out of date
                const closed = new Promise(resolve => ws.once('close', code => resolve(code)));
                const renewed = await ask('tabletNewKey', { tablet: 'Hall' });
                const newKey = (await harness.objects.getObjectAsync('satellite-display.0.tablets.hall'))?.native?.key;
                assert.ok(newKey && newKey !== key, 'a new key');
                assert.equal(renewed.link?.url, `http://127.0.0.1:${port}/t/${encodeURIComponent(newKey)}/`);
                assert.equal(await closed, 4001);
                assert.ok((await ask('tabletNewKey', { tablet: 'Nobody' })).error);
            });
        });

        suite('with a tablet renamed in the settings', getHarness => {
            it('keeps the access key of the tablet and moves its tiles to the new name', async function () {
                this.timeout(60_000);
                const harness = getHarness();
                const key = 'k'.repeat(40);
                // the device as an earlier start created it, under the old name
                await harness.objects.setObjectAsync('satellite-display.0.tablets', {
                    type: 'folder',
                    common: { name: 'Tablets' },
                    native: {},
                });
                await harness.objects.setObjectAsync('satellite-display.0.tablets.hall', {
                    type: 'device',
                    common: { name: 'Hall' },
                    native: { key },
                });
                await harness.changeAdapterConfig('satellite-display', {
                    native: {
                        satellites: [],
                        pwaEnabled: true,
                        pwaPort: 0,
                        pwaBind: '127.0.0.1',
                        tablets: [{ enabled: true, name: 'Halle', cols: 4, rows: 3, pages: 2 }],
                        tiles: [
                            {
                                enabled: true,
                                satellite: 'Hall',
                                page: 1,
                                col: 0,
                                row: 0,
                                size: 's',
                                type: 'value',
                                state: 'system.adapter.satellite-display.0.alive',
                            },
                        ],
                    },
                });
                await harness.startAdapterAndWait();
                let saved = null;
                for (let i = 0; i < 40 && saved?.native?.tiles?.[0]?.satellite !== 'Halle'; i++) {
                    await new Promise(resolve => setTimeout(resolve, 250));
                    saved = await harness.objects.getObjectAsync('system.adapter.satellite-display.0');
                }
                assert.equal(saved?.native?.tiles?.[0]?.satellite, 'Halle', 'the tile follows the rename');
                const renamed = await harness.objects.getObjectAsync('satellite-display.0.tablets.halle');
                assert.equal(renamed?.native?.key, key, 'the renamed tablet keeps its access key');
                assert.equal(await harness.objects.getObjectAsync('satellite-display.0.tablets.hall'), null);
            });
        });
    },
});
