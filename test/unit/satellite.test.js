'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { SatelliteLink, TILE_ACTIONS, ARG, convertArg, parseTileInput } = require('../../lib/satellite');

/** Arguments of the firmware's actions (base/display.yaml of the satellite firmware 2.0.0) */
const FIRMWARE_ACTIONS = {
    start_va: [],
    tile_set: [
        ['page', ARG.INT],
        ['slot', ARG.INT],
        ['col', ARG.INT],
        ['row', ARG.INT],
        ['size', ARG.STRING],
        ['type', ARG.STRING],
        ['label', ARG.STRING],
        ['unit', ARG.STRING],
        ['icon', ARG.STRING],
        ['decimals', ARG.INT],
        ['min', ARG.FLOAT],
        ['max', ARG.FLOAT],
    ],
    tile_value: [
        ['page', ARG.INT],
        ['slot', ARG.INT],
        ['value', ARG.FLOAT],
    ],
    tile_text: [
        ['page', ARG.INT],
        ['slot', ARG.INT],
        ['value', ARG.STRING],
    ],
    tile_state: [
        ['page', ARG.INT],
        ['slot', ARG.INT],
        ['on', ARG.BOOL],
    ],
    tile_history: [
        ['page', ARG.INT],
        ['slot', ARG.INT],
        ['points', ARG.FLOAT_ARRAY],
    ],
    tile_clear: [['page', ARG.INT]],
};

/** A stand-in for the Connection of @2colors/esphome-native-api */
class FakeConnection extends EventEmitter {
    /** @param {any} options - Options */
    constructor(options) {
        super();
        FakeConnection.last = this;
        this.options = options;
        this.reconnect = options.reconnect;
        /** @type {any[]} */
        this.executed = [];
        /** @type {any[]} */
        this.sent = [];
        this.actions = FIRMWARE_ACTIONS;
        this.disconnected = false;
    }

    connect() {}

    disconnect() {
        this.disconnected = true;
    }

    async listEntitiesService() {
        let key = 100;
        return [
            { component: 'Switch', entity: { name: 'Mute', key: 1 } },
            ...Object.entries(this.actions).map(([name, args]) => ({
                component: 'Services',
                entity: { name, key: key++, argsList: args.map(([n, type]) => ({ name: n, type })) },
            })),
        ];
    }

    /** @param {any} msg - Message */
    sendMessage(msg) {
        this.sent.push(msg);
    }

    /** @param {any} req - Request */
    executeServiceService(req) {
        this.executed.push(req);
    }
}
/** @type {FakeConnection} */
FakeConnection.last = /** @type {any} */ (null);

const pb = { SubscribeHomeassistantServicesRequest: class SubscribeHomeassistantServicesRequest {} };

/** @returns {SatelliteLink} A started link on a fake connection */
function startLink() {
    const link = new SatelliteLink({ host: '10.0.0.5', port: 6053, encryptionKey: '', clientInfo: 'test', Connection: FakeConnection, pb });
    link.start();
    return link;
}

/** @param {SatelliteLink} link - Link @returns {Promise<string>} The first event of the link */
const nextEvent = link =>
    new Promise(resolve => {
        for (const name of ['ready', 'incompatible', 'problem']) {
            link.once(name, () => resolve(name));
        }
    });

describe('satellite link', () => {
    it('becomes ready when the firmware has the tile actions, and subscribes the events', async () => {
        const link = startLink();
        const conn = FakeConnection.last;
        assert.equal(conn.options.host, '10.0.0.5');
        assert.equal(conn.options.reconnect, true);
        const event = nextEvent(link);
        conn.emit('authorized');
        assert.equal(await event, 'ready');
        assert.equal(link.ready, true);
        assert.ok(conn.sent[0] instanceof pb.SubscribeHomeassistantServicesRequest);
        for (const name of TILE_ACTIONS) {
            assert.ok(link.actions.has(name), name);
        }
    });

    it('reports a firmware without the tile actions', async () => {
        const link = new SatelliteLink({
            host: 'x',
            port: 6053,
            encryptionKey: '',
            clientInfo: 'test',
            Connection: class extends FakeConnection {
                /** @param {any} o - Options */
                constructor(o) {
                    super(o);
                    this.actions = { start_va: [] };
                }
            },
            pb,
        });
        link.start();
        let missing = [];
        link.on('incompatible', m => (missing = m));
        const event = nextEvent(link);
        FakeConnection.last.emit('authorized');
        assert.equal(await event, 'incompatible');
        assert.deepEqual(missing, TILE_ACTIONS);
        assert.equal(link.ready, false);
        assert.equal(link.call('tile_clear', { page: 0 }), false);
    });

    it('sends the arguments in the order and the types of the firmware', async () => {
        const link = startLink();
        const conn = FakeConnection.last;
        const event = nextEvent(link);
        conn.emit('authorized');
        await event;
        assert.equal(
            link.call('tile_set', {
                max: '30',
                min: 10,
                decimals: 1.4,
                icon: '',
                unit: '°C',
                label: 'Bad',
                type: 'gauge',
                size: 'q',
                row: 0,
                col: 1,
                slot: 2,
                page: 1,
            }),
            true,
        );
        const req = conn.executed[0];
        assert.equal(req.key, link.actions.get('tile_set')?.key);
        assert.deepEqual(
            req.args.map(a => a.value),
            [1, 2, 1, 0, 'q', 'gauge', 'Bad', '°C', '', 1, 10, 30],
        );
        link.call('tile_history', { page: 1, slot: 0, points: [1, '2', 'x', 3] });
        assert.deepEqual(conn.executed[1].args[2].value, [1, 2, 3]);
        link.call('tile_state', { page: 1, slot: 0, on: 1 });
        assert.equal(conn.executed[2].args[2].value, true);
    });

    it('passes on a touch and ignores other Home Assistant calls', async () => {
        const link = startLink();
        const conn = FakeConnection.last;
        /** @type {any[]} */
        const inputs = [];
        link.on('input', i => inputs.push(i));
        conn.emit('message.HomeassistantActionRequest', {
            service: 'esphome.tile_input',
            isEvent: true,
            dataList: [
                { key: 'page', value: '2' },
                { key: 'slot', value: '1' },
                { key: 'input', value: 'level' },
                { key: 'value', value: '53' },
            ],
        });
        conn.emit('message.HomeassistantActionRequest', { service: 'esphome.stt_text', isEvent: true, dataList: [] });
        conn.emit('message.HomeassistantActionRequest', { service: 'esphome.tile_input', isEvent: false, dataList: [] });
        assert.deepEqual(inputs, [{ page: 2, slot: 1, input: 'level', value: 53 }]);
    });

    it('reports a lost connection once and a repeated problem only once', async () => {
        const link = startLink();
        const conn = FakeConnection.last;
        const event = nextEvent(link);
        conn.emit('authorized');
        await event;
        let lost = 0;
        /** @type {string[]} */
        const problems = [];
        link.on('disconnected', () => lost++);
        link.on('problem', p => problems.push(p));
        conn.emit('disconnected');
        conn.emit('unauthorized');
        conn.emit('error', new Error('connect ECONNREFUSED'));
        conn.emit('error', new Error('connect ECONNREFUSED'));
        assert.equal(lost, 1);
        assert.deepEqual(problems, ['connect ECONNREFUSED']);
        assert.equal(link.call('tile_clear', { page: 0 }), false);
    });

    it('stops for good: no reconnect, a late socket error does no harm', () => {
        const link = startLink();
        const conn = FakeConnection.last;
        link.stop();
        assert.equal(conn.reconnect, false);
        assert.equal(conn.disconnected, true);
        conn.emit('error', new Error('late'));
        assert.equal(link.conn, null);
    });

    it('converts single arguments', () => {
        assert.equal(convertArg(ARG.INT, '3.6'), 4);
        assert.equal(convertArg(ARG.FLOAT, 'x'), 0);
        assert.equal(convertArg(ARG.STRING, null), '');
        assert.equal(convertArg(ARG.BOOL, 0), false);
        assert.equal(parseTileInput({ service: 'esphome.tile_input', isEvent: true, dataList: [{ key: 'page', value: 'x' }] }), null);
    });
});

describe('protocol library workaround', () => {
    const PlaintextFrameHelper = require('@2colors/esphome-native-api/lib/utils/plaintextFrameHelper');
    const { skipUnknownMessages } = require('../../lib/satellite');

    /**
     * @param {number} id - Message type
     * @param {number[]} body - Message bytes
     * @returns {Buffer} One plaintext frame (0x00, length, type, body)
     */
    const frame = (id, body) => Buffer.from([0, body.length, id, ...body]);

    /**
     * @param {boolean} patched - With the workaround
     * @returns {{types: string[], errors: string[]}} What the frame helper reported for one chunk
     */
    function feed(patched) {
        const helper = new PlaintextFrameHelper('127.0.0.1', 1);
        helper.end = () => undefined; // no socket in this test
        if (patched) {
            skipUnknownMessages(helper);
        }
        /** @type {string[]} */
        const types = [];
        /** @type {string[]} */
        const errors = [];
        helper.on('message', m => types.push(m.constructor.type));
        helper.on('error', e => errors.push(e.message));
        // an event entity (107, unknown to the library), then "list entities done" (19)
        helper.onData(Buffer.concat([frame(107, [0x0a, 0x01, 0x41]), frame(19, [])]));
        helper.destroy();
        return { types, errors };
    }

    it('skips a message type the library does not know and reads the next one', () => {
        const { types, errors } = feed(true);
        assert.deepEqual(types, ['UnknownMessage', 'ListEntitiesDoneResponse']);
        assert.deepEqual(errors, []);
    });

    it('without the workaround the next message is lost (proof that it is needed)', () => {
        const { types, errors } = feed(false);
        assert.ok(!types.includes('ListEntitiesDoneResponse'));
        assert.ok(errors.length > 0);
    });
});
