'use strict';

// One satellite over the ESPHome Native API: the actions tile_* and the event esphome.tile_input.
// The voice stays with ioBroker.assistant: this connection never subscribes to the voice assistant.

const { EventEmitter } = require('node:events');

/** The actions the firmware 2.0.0 brings (docs/TILES.md of the satellite firmware) */
const TILE_ACTIONS = ['tile_set', 'tile_value', 'tile_text', 'tile_state', 'tile_history', 'tile_clear'];
/** Actions of newer firmware; without them the tiles that need them are left out */
const OPTIONAL_ACTIONS = { tile_setpoint: '2.0.1', lock_config: '2.1.0' };

/** Argument types of ESPHome actions (ServiceArgType of api.proto) */
const ARG = { BOOL: 0, INT: 1, FLOAT: 2, STRING: 3, BOOL_ARRAY: 4, INT_ARRAY: 5, FLOAT_ARRAY: 6, STRING_ARRAY: 7 };

/**
 * @typedef {object} FrameHelper - The part of a frame helper of the protocol library that is patched here
 * @property {(id: number, bytes: Uint8Array) => object} buildMessage - Decodes one received message
 */

/**
 * @typedef {object} ActionRequest - HomeassistantActionRequest of the protocol library, as an object
 * @property {string} [service] - Name of the service or event
 * @property {{key: string, value: string}[]} [dataList] - Its data
 * @property {boolean} [isEvent] - An event, not a service call
 */

/**
 * @typedef {object} ServiceArg - Argument of a user service (API action) of the satellite
 * @property {string} name - Its name
 * @property {number} type - Its type (protocol enum)
 */

/**
 * @typedef {object} ListedEntity - One entry of listEntitiesService
 * @property {string} component - Kind of the entity, `Services` for an API action
 * @property {{key: number, name: string, argsList?: ServiceArg[]}} entity - Its definition
 */

/**
 * @typedef {object} EspConnection - The part of a Connection of the protocol library this module uses
 * @property {FrameHelper} [frameHelper] - Decoder of the received data
 * @property {boolean} reconnect - Reconnects by itself while true
 * @property {(event: string, listener: (arg: ?) => void) => void} on - Adds a listener
 * @property {() => void} removeAllListeners - Removes all listeners
 * @property {() => void} connect - Connects
 * @property {() => void} disconnect - Disconnects
 * @property {() => Promise<ListedEntity[]>} listEntitiesService - Lists the entities and the user services
 * @property {(message: object) => void} sendMessage - Sends a protocol message
 * @property {(data: {key: number, args: object[]}) => void} executeServiceService - Calls a user service
 */

/**
 * @typedef {new (options: object) => EspConnection} ConnectionClass
 */

/**
 * @typedef {object} TileInput
 * @property {number} page - Page 1..4
 * @property {number} slot - Slot 0..7
 * @property {string} input - switch, level or press
 * @property {number} value - 1/0, 0..100 or 1
 */

/**
 * @param {number} type - ServiceArgType
 * @param {unknown} value - Value given by the caller
 * @returns {unknown} Value of that type
 */
function convertArg(type, value) {
    switch (type) {
        case ARG.BOOL:
            return !!value;
        case ARG.INT:
            return Math.round(Number(value) || 0);
        case ARG.FLOAT: {
            const n = Number(value);
            return Number.isFinite(n) ? n : 0;
        }
        case ARG.STRING:
            return value === null || value === undefined ? '' : String(value);
        case ARG.FLOAT_ARRAY:
            return (Array.isArray(value) ? value : []).map(Number).filter(Number.isFinite);
        case ARG.INT_ARRAY:
            return (Array.isArray(value) ? value : []).map(v => Math.round(Number(v) || 0));
        case ARG.BOOL_ARRAY:
            return (Array.isArray(value) ? value : []).map(v => !!v);
        case ARG.STRING_ARRAY:
            return (Array.isArray(value) ? value : []).map(String);
        default:
            return value;
    }
}

/** Stands for a message the protocol library does not know */
class UnknownMessage {
    /** @returns {object} Nothing to read */
    toObject() {
        return {};
    }
}
UnknownMessage.type = 'UnknownMessage';

/**
 * The protocol library throws on a message type it does not know (an event entity of ESPHome, id 107, in
 * version 1.3.7): the rest of the received data is dropped and the connection is closed, so the list of actions
 * stays incomplete. Such a message is skipped instead; every known message is read as before.
 *
 * @param {FrameHelper | undefined} frameHelper - The frame helper of a connection (plaintext or noise)
 */
function skipUnknownMessages(frameHelper) {
    if (!frameHelper || typeof frameHelper.buildMessage !== 'function') {
        return;
    }
    const build = frameHelper.buildMessage.bind(frameHelper);
    const { pb, id_to_type } = require('@2colors/esphome-native-api/lib/utils/messages');
    frameHelper.buildMessage = (/** @type {number} */ id, /** @type {Uint8Array} */ bytes) => {
        const type = id_to_type[id];
        if (!type || !pb[type]) {
            return new UnknownMessage();
        }
        return build(id, bytes);
    };
}

/**
 * @param {ActionRequest | null | undefined} msg - HomeassistantActionRequest as an object
 * @returns {{locked: boolean, failed: number} | null} The screen lock, null for any other call
 */
function parseLockState(msg) {
    if (!msg || !msg.isEvent || msg.service !== 'esphome.screen_lock') {
        return null;
    }
    /** @type {Record<string, string>} */
    const data = {};
    for (const entry of msg.dataList || []) {
        data[entry.key] = entry.value;
    }
    const failed = Number(data.failed);
    return { locked: data.locked === '1', failed: Number.isFinite(failed) ? failed : 0 };
}

/**
 * @param {ActionRequest | null | undefined} msg - HomeassistantActionRequest as an object
 * @returns {TileInput | null} The touch, null for any other call
 */
function parseTileInput(msg) {
    if (!msg || !msg.isEvent || msg.service !== 'esphome.tile_input') {
        return null;
    }
    /** @type {Record<string, string>} */
    const data = {};
    for (const entry of msg.dataList || []) {
        data[entry.key] = entry.value;
    }
    const page = Number(data.page);
    const slot = Number(data.slot);
    const value = Number(data.value);
    if (!Number.isInteger(page) || !Number.isInteger(slot) || !data.input || !Number.isFinite(value)) {
        return null;
    }
    return { page, slot, input: data.input, value };
}

/**
 * Events: `ready` (connected, the tile actions are there), `disconnected`, `incompatible` (no tile actions:
 * firmware older than 2.0.0), `input` ({@link TileInput}), `problem` (message for the log).
 */
class SatelliteLink extends EventEmitter {
    /**
     * @param {object} options - Options
     * @param {string} options.host - IP address or host name
     * @param {number} options.port - Native API port
     * @param {string} options.encryptionKey - API encryption key, empty without
     * @param {string} options.clientInfo - Name of this client on the satellite
     * @param {ConnectionClass} [options.Connection] - Connection class (for tests); default the one of the ESPHome API package
     * @param {Record<string, new () => object>} [options.pb] - Protocol messages (for tests)
     */
    constructor({ host, port, encryptionKey, clientInfo, Connection, pb }) {
        super();
        this.host = host;
        this.port = port;
        this.encryptionKey = encryptionKey;
        this.clientInfo = clientInfo;
        this.Connection =
            Connection ||
            /** @type {ConnectionClass} */ (/** @type {unknown} */ (require('@2colors/esphome-native-api').Connection));
        this.pb = pb || require('@2colors/esphome-native-api/lib/utils/messages').pb;
        /** @type {EspConnection | null} */
        this.conn = null;
        /** @type {Map<string, {key: number, args: {name: string, type: number}[]}>} */
        this.actions = new Map();
        this.ready = false;
        this.stopped = false;
        /** The last connection problem (repeated ones are not reported again) */
        this.lastProblem = '';
    }

    /** Connects; reconnects by itself after a loss. */
    start() {
        const conn = new this.Connection({
            host: this.host,
            port: this.port,
            encryptionKey: this.encryptionKey,
            clientInfo: this.clientInfo,
            reconnect: true,
            reconnectInterval: 10_000,
        });
        this.conn = conn;
        skipUnknownMessages(conn.frameHelper);
        conn.on('authorized', () => void this._onAuthorized());
        conn.on('disconnected', () => this._lost());
        conn.on('unauthorized', () => this._lost());
        conn.on('error', e => this._problem(e?.message || String(e)));
        conn.on('message.HomeassistantActionRequest', msg => {
            const input = parseTileInput(msg);
            if (input) {
                this.emit('input', input);
            }
            const lock = parseLockState(msg);
            if (lock) {
                this.emit('lock', lock);
            }
        });
        conn.connect();
    }

    /** Ends the connection for good. */
    stop() {
        this.stopped = true;
        this.ready = false;
        if (this.conn) {
            this.conn.reconnect = false;
            try {
                this.conn.disconnect();
            } catch {
                // already closed
            }
            this.conn.removeAllListeners();
            // a late socket error must not become an unhandled 'error' event
            this.conn.on('error', () => undefined);
            this.conn = null;
        }
    }

    /** Lists the actions, subscribes the touches, then reports ready. */
    async _onAuthorized() {
        if (this.stopped || !this.conn) {
            return;
        }
        try {
            const list = await this.conn.listEntitiesService();
            this.actions.clear();
            for (const { component, entity } of list) {
                if (component === 'Services') {
                    this.actions.set(entity.name, {
                        key: entity.key,
                        args: (entity.argsList || []).map(a => ({ name: a.name, type: a.type })),
                    });
                }
            }
            const missing = TILE_ACTIONS.filter(name => !this.actions.has(name));
            if (missing.length) {
                this.ready = false;
                this.emit('incompatible', missing);
                return;
            }
            // the touches come as Home Assistant events
            this.conn.sendMessage(new this.pb.SubscribeHomeassistantServicesRequest());
            this.lastProblem = '';
            this.ready = true;
            this.emit('ready');
        } catch (e) {
            this._problem(`listing the actions failed: ${e.message}`);
        }
    }

    /** The connection is gone (the library connects again by itself). */
    _lost() {
        if (this.ready) {
            this.ready = false;
            this.emit('disconnected');
        }
    }

    /** @param {string} message - What went wrong */
    _problem(message) {
        if (message !== this.lastProblem) {
            this.lastProblem = message;
            this.emit('problem', message);
        }
    }

    /**
     * @param {string} name - Action
     * @returns {boolean} True when the firmware of the satellite has it
     */
    has(name) {
        return this.actions.has(name);
    }

    /**
     * Calls an action of the satellite.
     *
     * @param {string} name - Action, e.g. tile_value
     * @param {Record<string, unknown>} data - Arguments by name
     * @returns {boolean} False when not connected
     */
    call(name, data) {
        const action = this.actions.get(name);
        if (!this.ready || !this.conn || !action) {
            return false;
        }
        try {
            this.conn.executeServiceService({
                key: action.key,
                args: action.args.map(a => ({ type: a.type, value: convertArg(a.type, data[a.name]) })),
            });
            return true;
        } catch (e) {
            this._problem(`${name} failed: ${e.message}`);
            return false;
        }
    }
}

module.exports = {
    SatelliteLink,
    TILE_ACTIONS,
    OPTIONAL_ACTIONS,
    ARG,
    convertArg,
    parseTileInput,
    parseLockState,
    skipUnknownMessages,
    UnknownMessage,
};
