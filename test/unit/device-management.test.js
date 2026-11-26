'use strict';

// The satellites and tablets in the Device Manager (lib/device-management.js): cards, controls, actions.

const assert = require('node:assert/strict');
const { SatelliteDeviceManagement, cardOf, detailsOf } = require('../../lib/device-management');

const grid = { cols: 2, rows: 4, pages: 4, slots: 8 };
/** @type {any} */
const kitchen = {
    kind: 'satellite',
    id: 'kitchen',
    name: 'Kitchen',
    host: '192.168.1.20',
    port: 6053,
    encryptionKey: '',
    grid,
    pinHash: 'abc',
    pinLength: 4,
};
/** @type {any} */
const hall = {
    kind: 'tablet',
    id: 'hall',
    name: 'Hall',
    host: '',
    port: 0,
    encryptionKey: '',
    grid: { cols: 4, rows: 3, pages: 2, slots: 12 },
    pinHash: '',
    pinLength: 0,
};

/**
 * @param {Partial<Record<string, any>>} [over] - Overrides
 */
function fakeAdapter(over = {}) {
    const written = [];
    const app = {
        namespace: 'satellite-display.0',
        log: { warn() {}, info() {}, debug() {}, error() {} },
        on() {},
        config: { tiles: [] },
        satellites: new Map([
            ['kitchen', kitchen],
            ['hall', hall],
        ]),
        tabletServer: {},
        written,
        baseOf: (/** @type {any} */ s) => `${s.kind === 'tablet' ? 'tablets' : 'satellites'}.${s.id}`,
        getObjectAsync: async (/** @type {string} */ id) => (id === 'satellites.kitchen.brightness' ? {} : null),
        tabletLinks: async () => [{ name: 'Hall', url: 'https://10.0.0.2:8094/t/KEY/' }],
        renewTabletKey: async () => ({ name: 'Hall', url: 'https://10.0.0.2:8094/t/NEW/' }),
        setStateAsync: async (/** @type {string} */ id, /** @type {any} */ st) => written.push([id, st]),
        setForeignStateAsync: async (/** @type {string} */ id, /** @type {any} */ st) => written.push([id, st]),
        getForeignStateAsync: async () => ({ val: true, ack: true }),
        firmwareOf: () => null,
        installFirmware: () => false,
        assistantVolumeOf: async () => undefined,
        ...over,
    };
    return app;
}

/**
 * @param {SatelliteDeviceManagement} dm - Device management
 * @returns {Promise<any[]>} Cards
 */
async function cards(dm) {
    const list = [];
    await /** @type {any} */ (dm).loadDevices({
        setTotalDevices() {},
        addDevice: (/** @type {any} */ d) => list.push(d),
    });
    return list;
}

describe('device manager', () => {
    it('a satellite: connection from its state, lock and brightness as controls, no link actions', () => {
        const card = cardOf(kitchen, {
            ns: 'satellite-display.0',
            base: 'satellites.kitchen',
            brightness: true,
            volume: false,
            webApp: true,
        });
        assert.equal(card.id, 'satellites.kitchen');
        assert.equal(card.identifier, '192.168.1.20:6053');
        assert.deepEqual(card.status.connection, {
            stateId: 'satellite-display.0.satellites.kitchen.connected',
            mapping: { true: 'connected', false: 'disconnected' },
        });
        assert.deepEqual(
            card.controls.map((/** @type {any} */ c) => [c.id, c.stateId]),
            [
                ['locked', 'satellite-display.0.satellites.kitchen.locked'],
                ['brightness', 'satellite-display.0.satellites.kitchen.brightness'],
            ],
        );
        assert.deepEqual(
            card.actions.map((/** @type {any} */ a) => a.id),
            ['resend'],
        );
    });

    it('a tablet: link and new link only while the web app runs', () => {
        const has = { ns: 'satellite-display.0', base: 'tablets.hall', brightness: false, volume: false };
        assert.deepEqual(
            cardOf(hall, { ...has, webApp: true }).actions.map((/** @type {any} */ a) => a.id),
            ['resend', 'showLink', 'newLink'],
        );
        assert.deepEqual(
            cardOf(hall, { ...has, webApp: false }).actions.map((/** @type {any} */ a) => a.id),
            ['resend'],
        );
        assert.equal(cardOf(hall, { ...has, webApp: true }).controls.length, 0);
        assert.ok(cardOf(hall, { ...has, webApp: true }).actions[2].confirmation, 'a new link asks first');
    });

    it('details: address of a satellite, QR code of a tablet', () => {
        const sat = detailsOf(kitchen, { tiles: 3 });
        assert.equal(sat.schema.items._address.data, '192.168.1.20:6053');
        assert.equal(sat.schema.items._tiles.data, 3);
        assert.equal(sat.schema.items._qr, undefined);
        const tab = detailsOf(hall, { tiles: 0, url: 'https://x/t/K/' });
        assert.equal(tab.schema.items._address, undefined);
        assert.equal(tab.schema.items._qr.data, 'https://x/t/K/');
        assert.equal(tab.schema.items._grid.data, '4 × 3, 2');
    });

    it('loads the displays sorted, with handlers that write the states as commands', async () => {
        const app = fakeAdapter();
        const dm = new SatelliteDeviceManagement(app);
        const list = await cards(dm);
        assert.deepEqual(
            list.map(c => c.id),
            ['satellites.kitchen', 'tablets.hall'],
        );
        const brightness = list[0].controls.find((/** @type {any} */ c) => c.id === 'brightness');
        await brightness.handler('satellites.kitchen', 'brightness', 40, {});
        assert.deepEqual(app.written.at(-1), [
            'satellite-display.0.satellites.kitchen.brightness',
            { val: 40, ack: false },
        ]);
        const resend = list[0].actions.find((/** @type {any} */ a) => a.id === 'resend');
        assert.deepEqual(await resend.handler('satellites.kitchen', {}), { refresh: 'none' });
        assert.deepEqual(app.written.at(-1), ['satellites.kitchen.resend', { val: true, ack: false }]);
    });

    it('a voice satellite: the volume slider writes the player of ioBroker.assistant, 0…100 % as 0…1', async () => {
        const player = 'assistant.0.satellites.Kitchen.controls.media_player.volume';
        const app = fakeAdapter({
            assistantVolumeOf: async (/** @type {any} */ s) => (s.kind === 'satellite' ? player : undefined),
            getForeignStateAsync: async () => ({ val: 0.45, ack: true, ts: 1 }),
        });
        const dm = new SatelliteDeviceManagement(app);
        const list = await cards(dm);
        const volume = list[0].controls.find((/** @type {any} */ c) => c.id === 'volume');
        assert.equal(volume.stateId, player);
        assert.equal(volume.max, 100);
        assert.equal((await volume.getStateHandler()).val, 45);
        const shown = await volume.handler('satellites.kitchen', 'volume', 60, {});
        assert.deepEqual(app.written.at(-1), [player, { val: 0.6, ack: false }]);
        assert.equal(shown.val, 45); // what the state says afterwards (the fake does not change)
        // the brightness of the same card is not scaled
        const brightness = list[0].controls.find((/** @type {any} */ c) => c.id === 'brightness');
        await brightness.handler('satellites.kitchen', 'brightness', 40, {});
        assert.deepEqual(app.written.at(-1), [
            'satellite-display.0.satellites.kitchen.brightness',
            { val: 40, ack: false },
        ]);
        // a tablet has no player of the assistant
        assert.ok(!list[1].controls.some((/** @type {any} */ c) => c.id === 'volume'));
    });

    it('a display with its own player keeps its volume state, the assistant is not asked', async () => {
        let asked = 0;
        const app = fakeAdapter({
            getObjectAsync: async (/** @type {string} */ id) => (id === 'satellites.kitchen.media.volume' ? {} : null),
            assistantVolumeOf: async () => {
                asked++;
                return 'assistant.0.x.volume';
            },
        });
        const list = await cards(new SatelliteDeviceManagement(app));
        const volume = list[0].controls.find((/** @type {any} */ c) => c.id === 'volume');
        assert.equal(volume.stateId, 'satellite-display.0.satellites.kitchen.media.volume');
        assert.equal(asked, 0);
    });

    it('link of a tablet: a dialog with the QR code; a new link shows the new one', async () => {
        const app = fakeAdapter();
        const dm = new SatelliteDeviceManagement(app);
        const list = await cards(dm);
        /** @type {any[]} */
        const forms = [];
        const ctx = { showForm: async (/** @type {any} */ schema) => forms.push(schema), showMessage: async () => {} };
        const tablet = list[1];
        await tablet.actions.find((/** @type {any} */ a) => a.id === 'showLink').handler('tablets.hall', ctx);
        await tablet.actions.find((/** @type {any} */ a) => a.id === 'newLink').handler('tablets.hall', ctx);
        assert.equal(forms[0].items._qr.data, 'https://10.0.0.2:8094/t/KEY/');
        assert.equal(forms[1].items._qr.data, 'https://10.0.0.2:8094/t/NEW/');
    });

    it('the instance actions: pairing while the web app runs, the links only when there is a tablet', async () => {
        const dm = new SatelliteDeviceManagement(fakeAdapter());
        const info = /** @type {any} */ (dm).getInstanceInfo();
        assert.equal(info.apiVersion, 'v3');
        assert.deepEqual(
            info.actions.map((/** @type {any} */ a) => a.id),
            ['pairTablet', 'tabletLinks'],
        );
        const noTablet = new SatelliteDeviceManagement(fakeAdapter({ satellites: new Map([['kitchen', kitchen]]) }));
        assert.deepEqual(
            /** @type {any} */ (noTablet).getInstanceInfo().actions.map((/** @type {any} */ a) => a.id),
            ['pairTablet'],
        );
        const none = new SatelliteDeviceManagement(
            fakeAdapter({ satellites: new Map([['kitchen', kitchen]]), tabletServer: null }),
        );
        assert.equal(/** @type {any} */ (none).getInstanceInfo().actions, undefined);
    });

    it('"Pair a tablet" shows the one-time link as a QR code, with its minutes in the hint', async () => {
        const dm = new SatelliteDeviceManagement(
            fakeAdapter({ openPairing: async () => ({ url: 'http://10.0.0.2:8094/pair/CODE', minutes: 10 }) }),
        );
        /** @type {any[]} */
        const forms = [];
        const result = await /** @type {any} */ (dm).showPairing({
            showForm: async (/** @type {any} */ schema, /** @type {any} */ options) => forms.push({ schema, options }),
        });
        assert.deepEqual(result, { refresh: true });
        const items = forms[0].schema.items;
        assert.equal(items._qr.data, 'http://10.0.0.2:8094/pair/CODE');
        assert.match(items._hint.text.de, /10 Minuten/);
        assert.doesNotMatch(items._hint.text.en, /%s/);
        assert.equal(forms[0].options.title.en, 'Pair a tablet');

        /** @type {any[]} */
        const messages = [];
        const off = new SatelliteDeviceManagement(fakeAdapter({ openPairing: async () => null }));
        await /** @type {any} */ (off).showPairing({ showMessage: async (/** @type {any} */ m) => messages.push(m) });
        assert.match(messages[0].en, /does not run/);
    });
});
