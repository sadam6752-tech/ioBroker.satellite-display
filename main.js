'use strict';

/*
 * ioBroker.satellite-display: the tile pages of the touch display of ESPHome voice satellites
 * (Waveshare ESP32-S3-AUDIO firmware 2.0.0+). The layout and the values of ioBroker states go to the
 * satellite over the ESPHome Native API, a touch on a tile switches the bound state.
 */

const utils = require('@iobroker/adapter-core');
const { SatelliteLink, OPTIONAL_ACTIONS } = require('./lib/satellite');
const { normalizeSatellites, normalizeTiles, idOf } = require('./lib/layout');
const { NAMES } = require('./lib/names');
const {
    toNumber,
    isOn,
    textOf,
    stateText,
    levelPercent,
    levelValue,
    switchValue,
    setpointValue,
    alertColor,
    tileArgs,
} = require('./lib/values');

/** After a touch the tile shows the real state again after this time (when the device did not follow) */
const RESYNC_MS = 3000;
/** Points of a chart from the history adapter */
const CHART_POINTS = 60;
/** A preview from the editor ends by itself after this time */
const PREVIEW_MS = 10 * 60_000;

/**
 * @typedef {import('./lib/layout').Tile} Tile
 * @typedef {import('./lib/layout').SatelliteConfig} SatelliteConfig
 */

/**
 * @typedef {object} Bound
 * @property {Tile} tile - The tile
 * @property {Record<string, string | number>} args - Its tile_set arguments
 * @property {Partial<ioBroker.StateCommon>} common - Common part of the object of its state
 * @property {Partial<ioBroker.StateCommon>} common2 - Common part of the object of the second state (on/off of a
 *   dimmer, target temperature of a thermostat)
 * @property {number} lastLevel - Last level above 0 of a dimmer (switched on again with it)
 * @property {number} lastColor - Colour last sent with tile_color, -1 = none since tile_set
 */

class SatelliteDisplay extends utils.Adapter {
    /**
     * @param {Partial<utils.AdapterOptions>} [options] - Adapter options
     */
    constructor(options = {}) {
        super({ ...options, name: 'satellite-display' });
        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('message', this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));
        /** @type {Map<string, SatelliteLink>} */
        this.links = new Map();
        /** @type {Map<string, SatelliteConfig>} */
        this.satellites = new Map();
        /** @type {Bound[]} */
        this.bound = [];
        /** @type {Map<string, Bound[]>} state id → tiles that show it */
        this.byState = new Map();
        /** @type {Set<ioBroker.Timeout | undefined>} */
        this.timers = new Set();
        this.lang = 'en';
        this.stopping = false;
        /** @type {Set<string>} read-only states already reported */
        this.readOnlyWarned = new Set();
        /** @type {Set<string>} satellites already told that their firmware is too old for a tile */
        this.oldFirmwareWarned = new Set();
        /** @type {Map<string, {bound: Bound[], timer: ioBroker.Timeout | undefined}>} satellite id → tiles of the editor */
        this.previews = new Map();
    }

    async onReady() {
        await this.setState('info.connection', { val: false, ack: true });
        try {
            const sys = await this.getForeignObjectAsync('system.config');
            this.lang = sys?.common?.language || 'en';
        } catch {
            // English
        }

        /** @type {string[]} */
        const problems = [];
        const satellites = normalizeSatellites(this.config.satellites, problems);
        const tiles = normalizeTiles(this.config.tiles, satellites, problems);
        for (const p of problems) {
            this.log.warn(p);
        }
        if (!satellites.length) {
            this.log.warn('No satellite configured: add one in the settings');
            return;
        }

        await this.createObjects(satellites);
        await this.bindTiles(tiles);
        await this.subscribeStatesAsync('satellites.*.resend');

        for (const sat of satellites) {
            this.satellites.set(sat.id, sat);
            const count = tiles.filter(t => t.satellite === sat.id).length;
            this.log.info(`${sat.name} (${sat.host}): ${count} tile${count === 1 ? '' : 's'}`);
            const link = new SatelliteLink({
                host: sat.host,
                port: sat.port,
                encryptionKey: sat.encryptionKey,
                clientInfo: `ioBroker.satellite-display ${this.namespace}`,
            });
            link.on('ready', () => void this.onSatelliteReady(sat));
            link.on('disconnected', () => void this.onSatelliteLost(sat));
            link.on('incompatible', missing =>
                this.log.warn(
                    `${sat.name}: the firmware has no ${missing.join(', ')} - tile pages need the satellite firmware 2.0.0 or newer`,
                ),
            );
            link.on('problem', message => this.log.info(`${sat.name} (${sat.host}): ${message}`));
            link.on('input', input => void this.onInput(sat, input));
            this.links.set(sat.id, link);
            try {
                link.start();
            } catch (e) {
                this.log.error(`${sat.name}: cannot connect: ${e.message}`);
            }
        }
    }

    /**
     * Creates the objects of the satellites and removes those of satellites no longer configured.
     *
     * @param {SatelliteConfig[]} satellites - Enabled satellites
     */
    async createObjects(satellites) {
        await this.extendObject('satellites', { type: 'folder', common: { name: NAMES.satellites }, native: {} });
        for (const sat of satellites) {
            const base = `satellites.${sat.id}`;
            await this.extendObject(base, { type: 'device', common: { name: sat.name }, native: { host: sat.host } });
            await this.extendObject(`${base}.connected`, {
                type: 'state',
                common: {
                    name: NAMES.connected,
                    type: 'boolean',
                    role: 'indicator.connected',
                    read: true,
                    write: false,
                    def: false,
                },
                native: {},
            });
            await this.extendObject(`${base}.lastTouch`, {
                type: 'state',
                common: { name: NAMES.lastTouch, type: 'string', role: 'json', read: true, write: false, def: '' },
                native: {},
            });
            await this.extendObject(`${base}.resend`, {
                type: 'state',
                common: { name: NAMES.resend, type: 'boolean', role: 'button', read: false, write: true, def: false },
                native: {},
            });
            await this.setState(`${base}.connected`, { val: false, ack: true });
        }
        const keep = new Set(satellites.map(s => `${this.namespace}.satellites.${s.id}`));
        const devices = await this.getDevicesAsync();
        for (const dev of devices) {
            if (dev._id.startsWith(`${this.namespace}.satellites.`) && !keep.has(dev._id)) {
                await this.delObjectAsync(dev._id, { recursive: true });
            }
        }
    }

    /**
     * Reads the objects of the bound states and subscribes them.
     *
     * @param {Tile[]} tiles - Tiles from the settings
     */
    async bindTiles(tiles) {
        this.bound = await this.boundOf(tiles, true);
        for (const b of this.bound) {
            for (const id of [b.tile.state, b.tile.state2, b.tile.state3].filter(Boolean)) {
                const list = this.byState.get(id) || [];
                list.push(b);
                this.byState.set(id, list);
            }
        }
        for (const id of this.byState.keys()) {
            await this.subscribeForeignStatesAsync(id);
        }
    }

    /**
     * The tiles with the objects of their states.
     *
     * @param {Tile[]} tiles - Tiles
     * @param {boolean} warn - Warn about states that do not exist
     * @returns {Promise<Bound[]>} The tiles, ready to send
     */
    async boundOf(tiles, warn) {
        /** @type {Bound[]} */
        const result = [];
        /** @type {Map<string, ioBroker.Object | null>} */
        const objects = new Map();
        const objectOf = async id => {
            if (!objects.has(id)) {
                let obj = null;
                try {
                    obj = await this.getForeignObjectAsync(id);
                } catch {
                    // reported below
                }
                if (!obj && warn) {
                    this.log.warn(`State ${id} does not exist`);
                }
                objects.set(id, /** @type {ioBroker.Object | null} */ (obj ?? null));
            }
            return objects.get(id) ?? null;
        };
        for (const tile of tiles) {
            const obj = await objectOf(tile.state);
            const obj2 = tile.state2 ? await objectOf(tile.state2) : null;
            if (tile.state3) {
                await objectOf(tile.state3);
            }
            /** @type {Bound} */
            const b = {
                tile,
                args: tileArgs(tile, obj, this.lang, obj2),
                common: /** @type {Partial<ioBroker.StateCommon>} */ (obj?.common || {}),
                common2: /** @type {Partial<ioBroker.StateCommon>} */ (obj2?.common || {}),
                lastLevel: 100,
                lastColor: -1,
            };
            result.push(b);
        }
        return result;
    }

    /**
     * The tiles a satellite shows now: those of a preview from the editor, else those of the settings.
     *
     * @param {string} satId - Id of the satellite
     * @returns {Bound[]} Its tiles
     */
    shownOn(satId) {
        return this.previews.get(satId)?.bound ?? this.bound.filter(b => b.tile.satellite === satId);
    }

    /**
     * Messages of the tile editor: `preview` shows unsaved tiles on a satellite, `previewEnd` brings back the saved ones.
     *
     * @param {ioBroker.Message} obj - Message
     */
    async onMessage(obj) {
        if (!obj || typeof obj !== 'object' || !obj.command) {
            return;
        }
        const msg = /** @type {{satellite?: unknown, tiles?: unknown}} */ (obj.message || {});
        const reply = (/** @type {Record<string, unknown>} */ answer) => {
            if (obj.callback) {
                this.sendTo(obj.from, obj.command, answer, obj.callback);
            }
        };
        const sat = this.satellites.get(idOf(String(msg.satellite || '')));
        if (obj.command !== 'preview' && obj.command !== 'previewEnd') {
            return;
        }
        if (!sat) {
            reply({ error: 'satellite not in the saved settings' });
            return;
        }
        const link = this.links.get(sat.id);
        if (obj.command === 'previewEnd') {
            await this.endPreview(sat);
            reply({ ok: true });
            return;
        }
        /** @type {string[]} */
        const problems = [];
        const rows = /** @type {Record<string, unknown>[]} */ (Array.isArray(msg.tiles) ? msg.tiles : []);
        const tiles = normalizeTiles(rows, [sat], problems);
        const bound = await this.boundOf(tiles, false);
        const old = this.previews.get(sat.id);
        if (old) {
            this.clearTimeout(old.timer);
            this.timers.delete(old.timer);
        }
        const timer = this.setTimeout(() => {
            this.timers.delete(timer);
            void this.endPreview(sat);
        }, PREVIEW_MS);
        this.timers.add(timer);
        this.previews.set(sat.id, { bound, timer });
        this.log.info(`${sat.name}: preview of ${bound.length} tiles from the editor`);
        if (link?.ready) {
            await this.sendLayout(sat);
        }
        reply({ ok: true, tiles: bound.length, problems, connected: !!link?.ready });
    }

    /**
     * Ends the preview of a satellite: it shows the saved tiles again.
     *
     * @param {SatelliteConfig} sat - Satellite
     */
    async endPreview(sat) {
        const preview = this.previews.get(sat.id);
        if (!preview) {
            return;
        }
        this.clearTimeout(preview.timer);
        this.timers.delete(preview.timer);
        this.previews.delete(sat.id);
        this.log.info(`${sat.name}: preview ended, the saved tiles again`);
        if (this.links.get(sat.id)?.ready && !this.stopping) {
            await this.sendLayout(sat);
        }
    }

    /** @param {SatelliteConfig} sat - The satellite that connected */
    async onSatelliteReady(sat) {
        this.log.info(`${sat.name} (${sat.host}) connected`);
        await this.sendLayout(sat);
        await this.setState(`satellites.${sat.id}.connected`, { val: true, ack: true });
        await this.updateConnection();
    }

    /** @param {SatelliteConfig} sat - The satellite that was lost */
    async onSatelliteLost(sat) {
        this.log.info(`${sat.name} (${sat.host}) disconnected, connecting again`);
        await this.setState(`satellites.${sat.id}.connected`, { val: false, ack: true });
        await this.updateConnection();
    }

    async updateConnection() {
        const all = [...this.links.values()];
        const ok = all.length > 0 && all.every(l => l.ready);
        await this.setState('info.connection', { val: ok, ack: true });
    }

    /**
     * Sends the whole layout and the current values: after every (re)connect, the satellite keeps nothing.
     *
     * @param {SatelliteConfig} sat - Satellite
     */
    async sendLayout(sat) {
        const link = this.links.get(sat.id);
        if (!link) {
            return;
        }
        link.call('tile_clear', { page: 0 });
        const mine = this.shownOn(sat.id).filter(b => this.supported(sat, link, b));
        for (const b of mine) {
            link.call('tile_set', b.args);
            // tile_set starts with the colours of the theme
            b.lastColor = -1;
        }
        for (const b of mine) {
            await this.pushAll(b);
            if (b.tile.type === 'chart') {
                await this.pushHistory(b);
            }
        }
    }

    /**
     * A thermostat needs the action tile_setpoint of a newer firmware; without it the tile is left out.
     *
     * @param {SatelliteConfig} sat - Satellite
     * @param {SatelliteLink} link - Its connection
     * @param {Bound} b - Tile
     * @returns {boolean} True when the firmware can show the tile
     */
    supported(sat, link, b) {
        if (b.tile.type !== 'thermostat' || link.has('tile_setpoint')) {
            return true;
        }
        const key = `${sat.id}/tile_setpoint`;
        if (!this.oldFirmwareWarned.has(key)) {
            this.oldFirmwareWarned.add(key);
            this.log.warn(
                `${sat.name}: a thermostat tile needs the satellite firmware ${OPTIONAL_ACTIONS.tile_setpoint} or newer, it is left out`,
            );
        }
        return false;
    }

    /**
     * Sends the current values of a tile.
     *
     * @param {Bound} b - Tile
     */
    async pushAll(b) {
        if (b.tile.type === 'button') {
            return;
        }
        try {
            const state = await this.getForeignStateAsync(b.tile.state);
            this.push(b, b.tile.state, state?.val);
            for (const id of [b.tile.state2, b.tile.state3].filter(Boolean)) {
                const other = await this.getForeignStateAsync(id);
                this.push(b, id, other?.val);
            }
        } catch (e) {
            this.log.debug(`Reading ${b.tile.state} failed: ${e.message}`);
        }
    }

    /**
     * Sends one value of a tile.
     *
     * @param {Bound} b - Tile
     * @param {string} id - Which of its states changed
     * @param {unknown} val - New value
     */
    push(b, id, val) {
        const link = this.links.get(b.tile.satellite);
        if (!link?.ready) {
            return;
        }
        const { page, slot } = b.tile;
        switch (b.tile.type) {
            case 'value': {
                const mapped = stateText(val, b.common, this.lang);
                const n = typeof val === 'boolean' || mapped !== null ? null : toNumber(val);
                if (mapped !== null) {
                    link.call('tile_text', { page, slot, value: mapped });
                } else if (n !== null) {
                    link.call('tile_value', { page, slot, value: n });
                    this.sendColor(link, b, n);
                } else if (val !== null && val !== undefined) {
                    link.call('tile_text', { page, slot, value: textOf(val, this.lang) });
                }
                break;
            }
            case 'gauge':
            case 'bar':
            case 'chart': {
                const n = toNumber(val);
                if (n !== null) {
                    link.call('tile_value', { page, slot, value: n });
                    this.sendColor(link, b, n);
                }
                break;
            }
            case 'switch':
                link.call('tile_state', { page, slot, on: isOn(val) });
                break;
            case 'dimmer':
                if (id === b.tile.state) {
                    const percent = levelPercent(val, b.common);
                    if (percent !== null) {
                        if (percent > 0) {
                            b.lastLevel = percent;
                        }
                        link.call('tile_value', { page, slot, value: Math.round(percent) });
                        if (!b.tile.state2) {
                            link.call('tile_state', { page, slot, on: percent > 0 });
                        }
                    }
                } else {
                    link.call('tile_state', { page, slot, on: isOn(val) });
                }
                break;
            case 'thermostat':
                // one state can be bound twice (e.g. the target as the current value too): send each meaning
                if (id === b.tile.state) {
                    const n = toNumber(val);
                    if (n !== null) {
                        link.call('tile_value', { page, slot, value: n });
                        this.sendColor(link, b, n);
                    }
                }
                if (id === b.tile.state2 && link.has('tile_setpoint')) {
                    const n = toNumber(val);
                    if (n !== null) {
                        link.call('tile_setpoint', { page, slot, value: n, step: b.tile.step });
                    }
                }
                if (id === b.tile.state3) {
                    link.call('tile_state', { page, slot, on: isOn(val) });
                }
                break;
            default:
                break;
        }
    }

    /**
     * Red beyond a threshold of the tile, the colours of the theme else; sent only when it changes. A firmware
     * without tile_color (before 2.0.3) gets none.
     *
     * @param {SatelliteLink} link - Connection of the satellite
     * @param {Bound} b - Tile
     * @param {number} value - Its value
     */
    sendColor(link, b, value) {
        if ((b.tile.alertBelow === null && b.tile.alertAbove === null) || !link.has('tile_color')) {
            return;
        }
        const color = alertColor(value, b.tile);
        if (color !== b.lastColor) {
            b.lastColor = color;
            link.call('tile_color', { page: b.tile.page, slot: b.tile.slot, color });
        }
    }

    /**
     * The history of a chart from the history adapter in the settings (history, sql, influxdb).
     *
     * @param {Bound} b - Chart tile
     */
    async pushHistory(b) {
        const instance = String(this.config.historyInstance || '').trim();
        const hours = Number(this.config.chartHours) > 0 ? Number(this.config.chartHours) : 24;
        if (!instance) {
            return;
        }
        const end = Date.now();
        try {
            const answer = await this.withTimeout(
                this.sendToAsync(instance, 'getHistory', {
                    id: b.tile.state,
                    options: {
                        start: end - hours * 3600_000,
                        end,
                        aggregate: 'average',
                        count: CHART_POINTS,
                        ignoreNull: true,
                        removeBorderValues: true,
                    },
                }),
                10_000,
            );
            const rows = /** @type {{result?: {val?: unknown}[]} | undefined} */ (answer)?.result;
            const points = (Array.isArray(rows) ? rows : [])
                .map(r => toNumber(r?.val))
                .filter(v => v !== null)
                .slice(-CHART_POINTS);
            if (points.length >= 2) {
                this.links
                    .get(b.tile.satellite)
                    ?.call('tile_history', { page: b.tile.page, slot: b.tile.slot, points });
                // the last value after the history, so that the line ends with it
                await this.pushAll(b);
            }
        } catch (e) {
            this.log.debug(`History of ${b.tile.state} from ${instance}: ${e.message}`);
        }
    }

    /**
     * @template T
     * @param {Promise<T>} promise - Call
     * @param {number} ms - Limit
     * @returns {Promise<T>} The result, or a rejection after the limit
     */
    withTimeout(promise, ms) {
        return new Promise((resolve, reject) => {
            const timer = this.setTimeout(() => {
                this.timers.delete(timer);
                reject(new Error('no answer'));
            }, ms);
            this.timers.add(timer);
            promise.then(
                v => {
                    this.clearTimeout(timer);
                    this.timers.delete(timer);
                    resolve(v);
                },
                e => {
                    this.clearTimeout(timer);
                    this.timers.delete(timer);
                    reject(e);
                },
            );
        });
    }

    /**
     * A touch on a tile: switch the bound state.
     *
     * @param {SatelliteConfig} sat - Satellite
     * @param {import('./lib/satellite').TileInput} input - The touch
     */
    async onInput(sat, input) {
        const b = this.shownOn(sat.id).find(x => x.tile.page === input.page && x.tile.slot === input.slot);
        await this.setState(`satellites.${sat.id}.lastTouch`, {
            val: JSON.stringify({ ...input, ts: Date.now() }),
            ack: true,
        });
        if (!b) {
            this.log.debug(`${sat.name}: touch on an unknown tile ${input.page}/${input.slot}`);
            return;
        }
        const { tile } = b;
        /** @type {{id: string, val: ioBroker.StateValue, common: Partial<ioBroker.StateCommon>} | null} */
        let target = null;
        if (tile.type === 'switch' && input.input === 'switch') {
            target = { id: tile.state, val: switchValue(input.value > 0, b.common), common: b.common };
        } else if (tile.type === 'dimmer' && input.input === 'switch') {
            if (tile.state2) {
                target = { id: tile.state2, val: switchValue(input.value > 0, b.common2), common: b.common2 };
            } else {
                const percent = input.value > 0 ? b.lastLevel || 100 : 0;
                target = { id: tile.state, val: levelValue(percent, b.common), common: b.common };
            }
        } else if (tile.type === 'dimmer' && input.input === 'level') {
            if (input.value > 0) {
                b.lastLevel = input.value;
            }
            target = { id: tile.state, val: levelValue(input.value, b.common), common: b.common };
        } else if (tile.type === 'thermostat' && input.input === 'setpoint') {
            target = { id: tile.state2, val: setpointValue(input.value, tile.step, b.common2), common: b.common2 };
        } else if (tile.type === 'button' && input.input === 'press') {
            target = { id: tile.state, val: b.common.type === 'number' ? 1 : true, common: b.common };
        }
        if (!target) {
            return;
        }
        if (target.common.write === false) {
            // a state that cannot be switched: say so once, the tile shows the real state again below
            if (!this.readOnlyWarned.has(target.id)) {
                this.readOnlyWarned.add(target.id);
                this.log.warn(`${sat.name}: ${target.id} is read-only, a touch on its tile does not switch it`);
            }
        } else {
            try {
                await this.setForeignStateAsync(target.id, target.val, false);
                this.log.debug(`${sat.name}: ${tile.type} ${target.id} ← ${JSON.stringify(target.val)}`);
            } catch (e) {
                this.log.warn(`${sat.name}: writing ${target.id} failed: ${e.message}`);
            }
        }
        // the tile changed at once on the screen; when the device does not follow, show the real state again
        const timer = this.setTimeout(() => {
            this.timers.delete(timer);
            void this.pushAll(b);
        }, RESYNC_MS);
        this.timers.add(timer);
    }

    /**
     * @param {string} id - State id
     * @param {ioBroker.State | null | undefined} state - New state
     */
    async onStateChange(id, state) {
        if (!state || this.stopping) {
            return;
        }
        if (id.startsWith(`${this.namespace}.satellites.`) && id.endsWith('.resend')) {
            if (!state.ack && state.val) {
                const sat = this.satellites.get(id.split('.')[3]);
                if (sat && this.links.get(sat.id)?.ready) {
                    await this.sendLayout(sat);
                }
                await this.setState(id, { val: false, ack: true });
            }
            return;
        }
        for (const b of this.byState.get(id) || []) {
            // during a preview the slots of the satellite belong to the tiles of the editor
            if (!this.previews.has(b.tile.satellite)) {
                this.push(b, id, state.val);
            }
        }
    }

    /**
     * @param {() => void} callback - Done
     */
    onUnload(callback) {
        this.stopping = true;
        try {
            for (const timer of this.timers) {
                this.clearTimeout(timer);
            }
            this.timers.clear();
            for (const link of this.links.values()) {
                link.stop();
            }
            this.links.clear();
            void this.setState('info.connection', { val: false, ack: true });
        } catch (e) {
            this.log.error(`unload: ${e.message}`);
        } finally {
            callback();
        }
    }
}

if (require.main !== module) {
    /**
     * @param {Partial<utils.AdapterOptions>} [options] - Adapter options
     */
    module.exports = options => new SatelliteDisplay(options);
} else {
    new SatelliteDisplay();
}
