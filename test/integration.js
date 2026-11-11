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
                        satellites: [{ enabled: true, name: 'Test Room', host: '192.0.2.1', port: 6053, encryptionKey: '' }],
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

                const connected = await harness.states.getStateAsync('satellite-display.0.satellites.test_room.connected');
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
    },
});
