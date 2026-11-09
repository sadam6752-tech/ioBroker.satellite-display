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
            });
        });
    },
});
