'use strict';

// The firmware update of a satellite: the update entity over the Native API (lib/satellite.js) and the card action
// "Update the firmware" in the Device Manager (lib/device-management.js).

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const messages = require('@2colors/esphome-native-api/lib/utils/messages');
const PlaintextFrameHelper = require('@2colors/esphome-native-api/lib/utils/plaintextFrameHelper');
const {
    SatelliteLink,
    TILE_ACTIONS,
    UPDATE_MESSAGES,
    parseFirmwareState,
    parseUpdateLogLine,
    registerUpdateMessages,
    skipUnknownMessages,
} = require('../../lib/satellite');
const { SatelliteDeviceManagement, cardOf, detailsOf, fill, FIRMWARE_WATCH } = require('../../lib/device-management');
const { DM_TEXTS } = require('../../lib/dm-texts');

describe('firmware update: protocol', () => {
    before(() => registerUpdateMessages(messages));

    it('teaches the library the update messages (ids 116-118 of api.proto)', () => {
        for (const [id, type] of Object.entries(UPDATE_MESSAGES)) {
            assert.equal(messages.id_to_type[id], type);
            assert.equal(String(/** @type {any} */ (messages.pb)[type].id), id);
        }
        // a second call changes nothing
        registerUpdateMessages(messages);
        assert.equal(messages.id_to_type[117], 'UpdateStateResponse');
    });

    it('reads the state of the update entity from the wire', () => {
        const pb = /** @type {any} */ (messages.pb);
        const msg = new pb.UpdateStateResponse();
        msg.setKey(4711);
        msg.setCurrentVersion('2.6.2-test2');
        msg.setLatestVersion('2.6.2');
        const body = Buffer.from(msg.serializeBinary());
        const helper = new PlaintextFrameHelper('127.0.0.1', 1);
        helper.end = () => undefined;
        skipUnknownMessages(helper);
        /** @type {any[]} */
        const got = [];
        helper.on('message', m => got.push(m));
        helper.onData(Buffer.concat([Buffer.from([0, body.length, 117]), body]));
        helper.destroy();
        assert.equal(got.length, 1);
        assert.equal(got[0].constructor.type, 'UpdateStateResponse');
        assert.deepEqual(parseFirmwareState(got[0].toObject()), {
            version: '2.6.2-test2',
            latest: '2.6.2',
            available: true,
            inProgress: false,
            progress: null,
            releaseUrl: '',
        });
    });

    it('writes the update command with its id', () => {
        const pb = /** @type {any} */ (messages.pb);
        const msg = new pb.UpdateCommandRequest();
        msg.setKey(1);
        msg.setCommand(1);
        const helper = new PlaintextFrameHelper('127.0.0.1', 1);
        const frame = helper.serialize(msg);
        helper.destroy();
        assert.equal(frame[2], 118);
    });

    it('parses the states: up to date, running with progress, none yet', () => {
        assert.equal(parseFirmwareState({ currentVersion: '2.6.2', latestVersion: '2.6.2' })?.available, false);
        assert.equal(parseFirmwareState({ currentVersion: '2.6.2', latestVersion: '' })?.available, false);
        assert.deepEqual(
            parseFirmwareState({
                currentVersion: '2.6.1',
                latestVersion: '2.6.2',
                inProgress: true,
                hasProgress: true,
                progress: 42.6,
            }),
            { version: '2.6.1', latest: '2.6.2', available: true, inProgress: true, progress: 43, releaseUrl: '' },
        );
        assert.equal(parseFirmwareState({ missingState: true }), null);
        assert.equal(parseFirmwareState(null), null);
    });
});

/** A connection whose satellite has the tile actions and, when asked, an update entity */
class FakeConnection extends EventEmitter {
    /** @param {any} options - Options */
    constructor(options) {
        super();
        FakeConnection.last = this;
        this.reconnect = options.reconnect;
        /** @type {any[]} */
        this.sent = [];
    }
    connect() {}
    disconnect() {}
    async listEntitiesService() {
        // the library leaves the update entity out of its list; it comes as a message while listing
        if (FakeConnection.withUpdate) {
            this.emit('message.ListEntitiesUpdateResponse', { objectId: 'firmware', key: 77, name: 'Firmware' });
        }
        return TILE_ACTIONS.map((name, i) => ({ component: 'Services', entity: { name, key: i + 1, argsList: [] } }));
    }
    /** @param {any} msg - Message */
    sendMessage(msg) {
        this.sent.push(msg);
    }
}
/** @type {FakeConnection} */
FakeConnection.last = /** @type {any} */ (null);
FakeConnection.withUpdate = true;

const fakePb = {
    SubscribeHomeassistantServicesRequest: class SubscribeHomeassistantServicesRequest {},
    SubscribeStatesRequest: class SubscribeStatesRequest {},
    UpdateCommandRequest: class UpdateCommandRequest {
        /** @param {number} k - Key */
        setKey(k) {
            this.key = k;
        }
        /** @param {number} c - Command */
        setCommand(c) {
            this.command = c;
        }
    },
    SubscribeLogsRequest: class SubscribeLogsRequest {
        /** @param {number} l - Level */
        setLevel(l) {
            this.level = l;
        }
    },
    LogLevel: { LOG_LEVEL_NONE: 0, LOG_LEVEL_INFO: 3 },
};

/** @returns {Promise<SatelliteLink>} A link that is ready */
async function readyLink() {
    const link = new SatelliteLink({
        host: '10.0.0.5',
        port: 6053,
        encryptionKey: '',
        clientInfo: 'test',
        Connection: FakeConnection,
        pb: fakePb,
    });
    link.start();
    const ready = new Promise(resolve => link.once('ready', resolve));
    FakeConnection.last.emit('authorized');
    await ready;
    return link;
}

describe('firmware update: satellite link', () => {
    afterEach(() => {
        FakeConnection.withUpdate = true;
    });

    it('finds the update entity, subscribes the states and passes on its state', async () => {
        const link = await readyLink();
        const conn = FakeConnection.last;
        assert.equal(link.firmwareKey, 77);
        assert.ok(conn.sent.some(m => m instanceof fakePb.SubscribeStatesRequest));
        /** @type {any[]} */
        const seen = [];
        link.on('firmware', f => seen.push(f));
        // another entity's state and the one of the firmware
        conn.emit('message.UpdateStateResponse', { key: 5, currentVersion: 'x', latestVersion: 'y' });
        conn.emit('message.UpdateStateResponse', { key: 77, currentVersion: '2.6.1', latestVersion: '2.6.2' });
        assert.equal(seen.length, 1);
        assert.equal(seen[0].available, true);
        assert.equal(link.firmware?.latest, '2.6.2');
    });

    it('sends update and check to the entity', async () => {
        const link = await readyLink();
        assert.equal(link.firmwareCommand('update'), true);
        assert.equal(link.firmwareCommand('check'), true);
        const cmds = FakeConnection.last.sent.filter(m => m instanceof fakePb.UpdateCommandRequest);
        assert.deepEqual(
            cmds.map(c => [c.key, c.command]),
            [
                [77, 1],
                [77, 2],
            ],
        );
    });

    it('reads the log of the satellite while it installs, and ends it when the update failed', async () => {
        const link = await readyLink();
        link.updateLogGraceMs = 5;
        const conn = FakeConnection.last;
        /** @type {any[]} */
        const lines = [];
        link.on('firmwareLog', l => lines.push(l));
        // before the update: no subscription, a log line is ignored
        conn.emit('message.SubscribeLogsResponse', { message: '[E][http_request.ota:1]: old' });
        assert.equal(link.firmwareCommand('update'), true);
        const levels = () => conn.sent.filter(m => m instanceof fakePb.SubscribeLogsRequest).map(m => m.level);
        assert.deepEqual(levels(), [3]);
        conn.emit('message.UpdateStateResponse', {
            key: 77,
            currentVersion: '2.6.1',
            latestVersion: '2.6.2',
            inProgress: true,
        });
        conn.emit('message.SubscribeLogsResponse', {
            message: '\x1b[0;32m[I][http_request.ota:041]: Starting update\x1b[0m',
        });
        conn.emit('message.SubscribeLogsResponse', { message: '[D][sensor:100]: noise' });
        conn.emit('message.SubscribeLogsResponse', {
            message: '[E][http_request.ota:099]: HTTP Request failed; Error: -1',
        });
        conn.emit('message.UpdateStateResponse', { key: 77, currentVersion: '2.6.1', latestVersion: '2.6.2' });
        await new Promise(r => setTimeout(r, 30));
        assert.deepEqual(lines, [
            { level: 'info', text: '[http_request.ota] Starting update' },
            { level: 'error', text: '[http_request.ota] HTTP Request failed; Error: -1' },
        ]);
        // the update is over: the log is switched off again
        assert.deepEqual(levels(), [3, 0]);
        assert.equal(link.updateLog, false);
    });

    it('a check does not subscribe the log', async () => {
        const link = await readyLink();
        link.firmwareCommand('check');
        assert.ok(!FakeConnection.last.sent.some(m => m instanceof fakePb.SubscribeLogsRequest));
    });

    it('takes only the lines about the update from the log', () => {
        assert.deepEqual(parseUpdateLogLine('[W][ota:12]: Low memory'), { level: 'warn', text: '[ota] Low memory' });
        assert.deepEqual(parseUpdateLogLine('[I][app:301]: Rebooting safely'), {
            level: 'info',
            text: '[app] Rebooting safely',
        });
        assert.equal(parseUpdateLogLine('[I][app:100]: Running'), null);
        assert.equal(parseUpdateLogLine('[D][http_request.ota:170]: Progress: 6.5%'), null);
        assert.equal(parseUpdateLogLine('[E][wifi:1]: lost'), null);
        assert.equal(parseUpdateLogLine(undefined), null);
    });

    it('a firmware without the entity: no state subscription, no commands', async () => {
        FakeConnection.withUpdate = false;
        const link = await readyLink();
        assert.equal(link.firmwareKey, null);
        assert.ok(!FakeConnection.last.sent.some(m => m instanceof fakePb.SubscribeStatesRequest));
        assert.equal(link.firmwareCommand('update'), false);
    });
});

/** @type {any} */
const kitchen = {
    kind: 'satellite',
    id: 'kitchen',
    name: 'Kitchen',
    host: '192.168.1.20',
    port: 6053,
    encryptionKey: '',
    grid: { cols: 2, rows: 4, pages: 4, slots: 8 },
    pinHash: '',
    pinLength: 0,
};

/**
 * @param {any[]} sequence - What firmwareOf answers, one after the other (the last one stays)
 * @param {boolean} [starts] - installFirmware succeeds
 * @returns {{dm: SatelliteDeviceManagement, app: any}} Device management on a fake adapter
 */
function setup(sequence, starts = true) {
    let i = 0;
    const app = {
        namespace: 'satellite-display.0',
        log: { warn() {}, info() {}, debug() {}, error() {} },
        on() {},
        config: { tiles: [] },
        satellites: new Map([['kitchen', kitchen]]),
        tabletServer: null,
        baseOf: () => 'satellites.kitchen',
        getObjectAsync: async () => ({}),
        installs: 0,
        delay: (/** @type {number} */ ms) => new Promise(resolve => globalThis.setTimeout(resolve, ms)),
        firmwareOf: () => sequence[Math.min(i++, sequence.length - 1)],
        installFirmware: () => {
            app.installs++;
            return starts;
        },
    };
    return { dm: new SatelliteDeviceManagement(/** @type {any} */ (app)), app };
}

/**
 * @param {boolean} [confirm] - The answer to the question
 * @returns {any} An action context that records what the user sees
 */
function context(confirm = true) {
    const ctx = {
        /** @type {any[]} */
        messages: [],
        /** @type {any[]} */
        confirmations: [],
        /** @type {any[]} */
        progress: [],
        closed: false,
        showMessage: async (/** @type {any} */ t) => void ctx.messages.push(t),
        showConfirmation: async (/** @type {any} */ t) => {
            ctx.confirmations.push(t);
            return confirm;
        },
        openProgress: async (/** @type {any} */ title, /** @type {any} */ options) => {
            ctx.progress.push({ title, ...options });
            return {
                update: async (/** @type {any} */ u) => void ctx.progress.push(u),
                close: async () => {
                    ctx.closed = true;
                },
            };
        },
    };
    return ctx;
}

const fw = (/** @type {any} */ over) => ({
    version: '2.6.1',
    latest: '2.6.2',
    available: true,
    inProgress: false,
    progress: null,
    releaseUrl: '',
    connected: true,
    ...over,
});

describe('firmware update: Device Manager', () => {
    const saved = { ...FIRMWARE_WATCH };
    beforeEach(() => Object.assign(FIRMWARE_WATCH, { pollMs: 1, timeoutMs: 2000, idleMs: 30 }));
    after(() => Object.assign(FIRMWARE_WATCH, saved));

    it('the card of a satellite with the update entity: update indicator from the states, an action', () => {
        const card = cardOf(kitchen, {
            ns: 'satellite-display.0',
            base: 'satellites.kitchen',
            brightness: false,
            volume: false,
            webApp: false,
            firmware: true,
        });
        assert.deepEqual(card.update, {
            available: { stateId: 'satellite-display.0.satellites.kitchen.firmware.available' },
            version: { stateId: 'satellite-display.0.satellites.kitchen.firmware.version' },
            newVersion: { stateId: 'satellite-display.0.satellites.kitchen.firmware.latest' },
        });
        assert.ok(card.actions.some(a => a.id === 'update'));
        assert.deepEqual(card.controls, []);
        const versioned = cardOf(kitchen, {
            ns: 'satellite-display.0',
            base: 'satellites.kitchen',
            brightness: false,
            volume: false,
            webApp: false,
            firmware: true,
            firmwareVersion: '2.6.2',
        });
        assert.equal(/** @type {any} */ (versioned.model).en, 'ESPHome voice satellite · 2.6.2');
        const without = cardOf(kitchen, {
            ns: 'satellite-display.0',
            base: 'satellites.kitchen',
            brightness: false,
            volume: false,
            webApp: false,
        });
        assert.equal(without.update, undefined);
        assert.ok(!without.actions.some(a => a.id === 'update'));
    });

    it('details: the installed and the offered version', () => {
        const items = /** @type {any} */ (
            detailsOf(kitchen, { tiles: 0, firmware: { version: '2.6.1', latest: '2.6.2' } }).schema.items
        );
        assert.equal(items._firmware.data, '2.6.1');
        assert.equal(items._firmwareOffered.data, '2.6.2');
        const same = /** @type {any} */ (
            detailsOf(kitchen, { tiles: 0, firmware: { version: '2.6.2', latest: '2.6.2' } }).schema.items
        );
        assert.equal(same._firmwareOffered, undefined);
    });

    it('fills the versions into every language', () => {
        const t = fill(DM_TEXTS.firmwareConfirm, '2.6.1', '2.6.2');
        assert.equal(Object.keys(t).length, 11);
        for (const text of Object.values(t)) {
            assert.ok(text.includes('2.6.1') && text.includes('2.6.2') && !text.includes('%'), text);
        }
    });

    it('up to date or unknown: a message, nothing is started', async () => {
        let { dm, app } = setup([fw({ latest: '2.6.1', available: false })]);
        let ctx = context();
        await dm.onAction(kitchen, 'update', ctx);
        assert.deepEqual(ctx.messages, [fill(DM_TEXTS.firmwareUpToDate, '2.6.1')]);
        assert.equal(app.installs, 0);
        ({ dm, app } = setup([null]));
        ctx = context();
        await dm.onAction(kitchen, 'update', ctx);
        assert.deepEqual(ctx.messages, [DM_TEXTS.firmwareUnknown]);
        assert.equal(app.installs, 0);
    });

    it('asks first; "no" starts nothing', async () => {
        const { dm, app } = setup([fw()]);
        const ctx = context(false);
        await dm.onAction(kitchen, 'update', ctx);
        assert.deepEqual(ctx.confirmations, [fill(DM_TEXTS.firmwareConfirm, '2.6.1', '2.6.2')]);
        assert.equal(app.installs, 0);
        assert.deepEqual(ctx.progress, []);
    });

    it('installs, shows the progress and the restart, and reports the new version', async () => {
        const { dm, app } = setup([
            fw(), // asked
            fw({ inProgress: true, progress: 40 }),
            fw({ inProgress: true, progress: 90 }),
            fw({ connected: false }),
            fw({ connected: false }),
            fw({ version: '2.6.2', available: false }),
        ]);
        const ctx = context();
        await dm.onAction(kitchen, 'update', ctx);
        assert.equal(app.installs, 1);
        assert.equal(ctx.progress[0].title, 'Kitchen: 2.6.1 → 2.6.2');
        assert.ok(ctx.progress.some(p => p.value === 40));
        assert.ok(ctx.progress.some(p => p.value === 90));
        assert.ok(ctx.progress.some(p => p.label === DM_TEXTS.firmwareRestarting));
        assert.equal(ctx.closed, true);
        assert.deepEqual(ctx.messages, [fill(DM_TEXTS.firmwareDone, '2.6.2')]);
    });

    it('a satellite that stays on the old version reports the failure', async () => {
        const { dm } = setup([fw(), fw({ inProgress: true }), fw()]);
        const ctx = context();
        await dm.onAction(kitchen, 'update', ctx);
        assert.deepEqual(ctx.messages, [fill(DM_TEXTS.firmwareFailed, '2.6.1')]);
        assert.equal(ctx.closed, true);
    });

    it('names the error of the log of the satellite at once', async () => {
        const { dm } = setup([fw(), fw({ lastError: '[http_request.ota] HTTP Request failed' })]);
        const ctx = context();
        await dm.onAction(kitchen, 'update', ctx);
        const msg = ctx.messages[0];
        assert.ok(msg.en.startsWith(fill(DM_TEXTS.firmwareFailed, '2.6.1').en));
        assert.ok(msg.ru.endsWith('\n[http_request.ota] HTTP Request failed'));
    });

    it('an install that cannot start says so', async () => {
        const { dm } = setup([fw()], false);
        const ctx = context();
        await dm.onAction(kitchen, 'update', ctx);
        assert.deepEqual(ctx.messages, [DM_TEXTS.firmwareNotStarted]);
        assert.deepEqual(ctx.progress, []);
    });
});
