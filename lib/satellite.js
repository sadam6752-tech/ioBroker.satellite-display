'use strict';

// One satellite over the ESPHome Native API: the actions tile_* and the event esphome.tile_input.
// The voice stays with ioBroker.assistant: this connection never subscribes to the voice assistant.

const { EventEmitter } = require('node:events');

/** The actions the firmware 2.0.0 brings (docs/TILES.md of the satellite firmware) */
const TILE_ACTIONS = ['tile_set', 'tile_value', 'tile_text', 'tile_state', 'tile_history', 'tile_clear'];
/** Actions of newer firmware; without them the tiles that need them are left out */
const OPTIONAL_ACTIONS = { tile_setpoint: '2.0.1', lock_config: '2.1.0', tile_item: '2.4.0' };

/**
 * Messages of an update entity (api.proto of ESPHome): the protocol library 1.3.7 has their classes but not their
 * ids, so it would skip them. registerUpdateMessages adds the ids.
 */
const UPDATE_MESSAGES = { 116: 'ListEntitiesUpdateResponse', 117: 'UpdateStateResponse', 118: 'UpdateCommandRequest' };

/** Commands of an update entity (UpdateCommand of api.proto) */
const UPDATE_COMMAND = { update: 1, check: 2 };

/** Milliseconds the log stays subscribed after a failed update, for its last lines */
const UPDATE_LOG_GRACE_MS = 3000;

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
 * Teaches the protocol library the messages of an update entity (the firmware update of the satellite). An id the
 * library already uses for another message stays as it is.
 *
 * @param {{pb: Record<string, {type?: string, id?: string}>, id_to_type: Record<string, string>, type_to_id?: Record<string, string>}} messages
 *   - The module utils/messages of the library
 */
function registerUpdateMessages(messages) {
    for (const [id, type] of Object.entries(UPDATE_MESSAGES)) {
        const cls = messages.pb[type];
        if (!cls || (messages.id_to_type[id] && messages.id_to_type[id] !== type)) {
            continue;
        }
        messages.id_to_type[id] = type;
        if (messages.type_to_id) {
            messages.type_to_id[type] = id;
        }
        cls.type = type;
        cls.id = id;
    }
}

/**
 * @typedef {object} FirmwareState - The firmware update entity of a satellite
 * @property {string} version - Installed version
 * @property {string} latest - Version offered on the release pages, empty before the first check
 * @property {boolean} available - latest is there and differs from version
 * @property {boolean} inProgress - The satellite installs an update now
 * @property {number | null} progress - Percent of the installation, null when the firmware does not report it
 * @property {string} releaseUrl - Page of the release, may be empty
 */

/**
 * @param {Record<string, unknown> | null | undefined} msg - UpdateStateResponse as an object
 * @returns {FirmwareState | null} The state, null when the entity has none yet
 */
function parseFirmwareState(msg) {
    if (!msg || msg.missingState) {
        return null;
    }
    const version = String(msg.currentVersion ?? '');
    const latest = String(msg.latestVersion ?? '');
    const progress = Number(msg.progress);
    return {
        version,
        latest,
        available: !!latest && latest !== version,
        inProgress: !!msg.inProgress,
        progress:
            msg.hasProgress && Number.isFinite(progress) ? Math.max(0, Math.min(100, Math.round(progress))) : null,
        releaseUrl: String(msg.releaseUrl ?? ''),
    };
}

/**
 * @typedef {object} UpdateLogLine - A line of the log of the satellite about its firmware update
 * @property {'error' | 'warn' | 'info'} level - Its level
 * @property {string} text - `[tag] message`, without colours
 */

/**
 * @param {unknown} message - One log line of the satellite, e.g. `\x1b[0;31m[E][http_request.ota:123]: HTTP 404\x1b[0m`
 * @returns {UpdateLogLine | null} The line when it is about the update (download, flashing, restart), else null
 */
function parseUpdateLogLine(message) {
    // eslint-disable-next-line no-control-regex
    const plain = String(message ?? '').replace(/\x1b\[[0-9;]*m/g, '');
    const m = /^\[([EWICDV])\]\[([^\]:]+)(?::\d+)?\]:\s*([\s\S]*)$/.exec(plain.trim());
    if (!m) {
        return null;
    }
    const [, lvl, tag, text] = m;
    const about = /^(http_request|ota|update|safe_mode)/.test(tag) || (tag === 'app' && /reboot/i.test(text));
    if (!about || !['E', 'W', 'I'].includes(lvl)) {
        return null;
    }
    return { level: lvl === 'E' ? 'error' : lvl === 'W' ? 'warn' : 'info', text: `[${tag}] ${text.trim()}` };
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
 * @returns {{state: string, volume: number | null} | null} What the player of the display does, null for any other call
 */
function parseMediaState(msg) {
    if (!msg || !msg.isEvent || msg.service !== 'esphome.media_state') {
        return null;
    }
    /** @type {Record<string, string>} */
    const data = {};
    for (const entry of msg.dataList || []) {
        data[entry.key] = entry.value;
    }
    const volume = Number(data.volume);
    return { state: String(data.state || 'idle'), volume: Number.isFinite(volume) ? volume : null };
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
 * firmware older than 2.0.0), `input` ({@link TileInput}), `firmware` ({@link FirmwareState} of the update entity
 * of the firmware), `firmwareLog` ({@link UpdateLogLine} while it installs an update), `problem` (message for the log).
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
        if (!pb) {
            registerUpdateMessages(require('@2colors/esphome-native-api/lib/utils/messages'));
        }
        this.pb = pb || require('@2colors/esphome-native-api/lib/utils/messages').pb;
        /** Key of the update entity "Firmware" of the satellite, null when its firmware has none */
        /** @type {number | null} */
        this.firmwareKey = null;
        /** The last state of that entity */
        /** @type {FirmwareState | null} */
        this.firmware = null;
        /** The log of the satellite is subscribed for an update it installs */
        this.updateLog = false;
        /** Milliseconds the log stays after a failed update (changed by the tests) */
        this.updateLogGraceMs = UPDATE_LOG_GRACE_MS;
        /** @type {ReturnType<typeof setTimeout> | undefined} ends that subscription once the update is over */
        this.updateLogTimer = undefined;
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
        // the library leaves update entities out of listEntitiesService: they are read here while it lists
        conn.on('message.ListEntitiesUpdateResponse', entity => {
            if (typeof entity?.key === 'number' && (this.firmwareKey === null || entity.objectId === 'firmware')) {
                this.firmwareKey = entity.key;
            }
        });
        conn.on('message.UpdateStateResponse', msg => {
            if (this.firmwareKey === null || msg?.key !== this.firmwareKey) {
                return;
            }
            const firmware = parseFirmwareState(msg);
            if (firmware) {
                this.firmware = firmware;
                this.emit('firmware', firmware);
                if (this.updateLog) {
                    // installing: keep the log; not (any more) and still here: the update failed, the log ends
                    clearTimeout(this.updateLogTimer);
                    this.updateLogTimer = firmware.inProgress
                        ? undefined
                        : setTimeout(() => this._endUpdateLog(), this.updateLogGraceMs);
                }
            }
        });
        conn.on('message.SubscribeLogsResponse', msg => {
            const line = this.updateLog ? parseUpdateLogLine(msg?.message) : null;
            if (line) {
                this.emit('firmwareLog', line);
            }
        });
        conn.on('message.HomeassistantActionRequest', msg => {
            const input = parseTileInput(msg);
            if (input) {
                this.emit('input', input);
            }
            const lock = parseLockState(msg);
            if (lock) {
                this.emit('lock', lock);
            }
            const media = parseMediaState(msg);
            if (media) {
                this.emit('media', media);
            }
        });
        conn.connect();
    }

    /** Ends the connection for good. */
    stop() {
        this.stopped = true;
        this.ready = false;
        clearTimeout(this.updateLogTimer);
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
            this.firmwareKey = null;
            this.firmware = null;
            // a new connection has no log subscription (after the restart of an update)
            this.updateLog = false;
            clearTimeout(this.updateLogTimer);
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
            if (this.firmwareKey !== null && this.pb.SubscribeStatesRequest) {
                // the states of the entities: among them the one of the firmware update entity
                this.conn.sendMessage(new this.pb.SubscribeStatesRequest());
            }
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
     * Tells the firmware update entity of the satellite to look for a new version or to install it. The satellite
     * loads the firmware from its release pages itself and restarts.
     *
     * @param {'update' | 'check'} command - What to do
     * @returns {boolean} False when not connected or the firmware has no update entity
     */
    firmwareCommand(command) {
        if (!this.ready || !this.conn || this.firmwareKey === null || !this.pb.UpdateCommandRequest) {
            return false;
        }
        try {
            if (command === 'update') {
                // what the satellite writes about the download and the flashing: the reason when it fails
                this._logLevel(this.pb.LogLevel?.LOG_LEVEL_INFO);
                this.updateLog = true;
            }
            const msg = new this.pb.UpdateCommandRequest();
            msg.setKey(this.firmwareKey);
            msg.setCommand(UPDATE_COMMAND[command]);
            this.conn.sendMessage(msg);
            return true;
        } catch (e) {
            this._problem(`firmware ${command} failed: ${e.message}`);
            return false;
        }
    }

    /** The update is over without a restart (it failed): the satellite stops sending its log. */
    _endUpdateLog() {
        this.updateLogTimer = undefined;
        if (this.updateLog) {
            this.updateLog = false;
            this._logLevel(this.pb.LogLevel?.LOG_LEVEL_NONE);
        }
    }

    /**
     * Subscribes the log of the satellite at this level; NONE ends it (the API has no other way to unsubscribe).
     *
     * @param {number | undefined} level - LogLevel of api.proto
     */
    _logLevel(level) {
        if (level === undefined || !this.conn || !this.pb.SubscribeLogsRequest) {
            return;
        }
        try {
            const req = new this.pb.SubscribeLogsRequest();
            req.setLevel(level);
            this.conn.sendMessage(req);
        } catch (e) {
            this._problem(`log subscription failed: ${e.message}`);
        }
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
    parseMediaState,
    parseFirmwareState,
    parseUpdateLogLine,
    registerUpdateMessages,
    UPDATE_MESSAGES,
    skipUnknownMessages,
    UnknownMessage,
};
