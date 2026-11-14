'use strict';

/*
 * ioBroker.satellite-display: the tile pages of the touch display of ESPHome voice satellites
 * (Waveshare ESP32-S3-AUDIO firmware 2.0.0+). The layout and the values of ioBroker states go to the
 * satellite over the ESPHome Native API, a touch on a tile switches the bound state.
 * Optional (off by default): tablets show the same tiles in a web app (www/) served by the adapter itself.
 */

const crypto = require('node:crypto');
const path = require('node:path');
const utils = require('@iobroker/adapter-core');
const { SatelliteLink, OPTIONAL_ACTIONS } = require('./lib/satellite');
const { TabletLink } = require('./lib/tablet');
const { TabletServer } = require('./lib/tablet-server');
const { decideTls } = require('./lib/tls');
const { checkTcpPort, registerTcpPort } = require('./lib/used-resources');
const { normalizeDisplays, normalizeTiles, idOf, colorOf, pageTitlesOf } = require('./lib/layout');
const { findRenames, renameTiles, renamePageTitles } = require('./lib/renames');
const { NAMES } = require('./lib/names');
const { EDIT_COMMANDS, runCommand } = require('./lib/commands');
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
    backgroundOf,
    tileArgs,
    mediaStateOf,
    showsChange,
} = require('./lib/values');

/** After a touch the tile shows the real state again after this time (when the device did not follow) */
const RESYNC_MS = 3000;
/** Points of a chart from the history adapter */
const CHART_POINTS = 60;
/** A preview from the editor ends by itself after this time */
const PREVIEW_MS = 10 * 60_000;
/** Port of the web app of the tablets when the settings name none */
const DEFAULT_PWA_PORT = 8094;

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
 * @property {number} lastColor - Colour last sent with tile_color (0 = the theme, as after tile_set)
 * @property {number} lastBackground - Background last sent with tile_background (0 = the theme)
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
        /** @type {Map<string, SatelliteLink | TabletLink>} */
        this.links = new Map();
        /** @type {TabletServer | null} the web server of the tablets, while it runs */
        this.tabletServer = null;
        /** @type {Map<string, string>} access key → id of the tablet */
        this.tabletKeys = new Map();
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
        /** @type {Map<string, {bound: Bound[], timer: ioBroker.Timeout | undefined, pageTitles?: unknown}>} satellite id → tiles (and page titles) of the editor */
        this.previews = new Map();
        /** @type {Record<string, unknown>[] | undefined} tiles changed by commands, saved a moment later */
        this.pendingTiles = undefined;
        /** @type {Record<string, unknown> | undefined} page titles changed by commands, saved with the tiles */
        this.pendingPageTitles = undefined;
        /** @type {ioBroker.Timeout | undefined} */
        this.saveTimer = undefined;
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
        const displays = normalizeDisplays(this.config, problems);
        if (await this.followRenames(displays)) {
            return; // the tiles follow a rename: the settings are saved and the instance starts again
        }
        const tiles = normalizeTiles(this.config.tiles, displays, problems);
        for (const p of problems) {
            this.log.warn(p);
        }
        if (!displays.length) {
            this.log.warn('No satellite configured: add one in the settings');
            await this.removeTabletObjects();
            return;
        }

        await this.createObjects(displays);
        await this.bindTiles(tiles);
        for (const folder of ['satellites', 'tablets']) {
            await this.subscribeStatesAsync(`${folder}.*.resend`);
            await this.subscribeStatesAsync(`${folder}.*.locked`);
        }
        await this.subscribeStatesAsync('satellites.*.brightness');
        await this.subscribeStatesAsync('satellites.*.media.*');

        for (const sat of displays) {
            this.satellites.set(sat.id, sat);
            const count = tiles.filter(t => t.satellite === sat.id).length;
            this.log.info(`${this.labelOf(sat)}: ${count} tile${count === 1 ? '' : 's'}`);
            const link = sat.kind === 'tablet' ? this.tabletLinkOf(sat) : this.satelliteLinkOf(sat);
            link.on('ready', () => void this.onSatelliteReady(sat));
            link.on('disconnected', () => void this.onSatelliteLost(sat));
            link.on('input', input => void this.onInput(sat, input));
            link.on('lock', lock => void this.onLockState(sat, lock));
            this.links.set(sat.id, link);
            try {
                link.start();
            } catch (e) {
                this.log.error(`${sat.name}: cannot connect: ${e.message}`);
            }
        }
        if (this.config.pwaEnabled === true) {
            await this.startTabletServer(displays.filter(d => d.kind === 'tablet'));
        }
        await this.updateConnection();
    }

    /**
     * @param {SatelliteConfig} sat - A satellite
     * @returns {SatelliteLink} Its connection over the ESPHome Native API, with the events only a satellite has
     */
    satelliteLinkOf(sat) {
        const link = new SatelliteLink({
            host: sat.host,
            port: sat.port,
            encryptionKey: sat.encryptionKey,
            clientInfo: `ioBroker.satellite-display ${this.namespace}`,
        });
        link.on('incompatible', missing =>
            this.log.warn(
                `${sat.name}: the firmware has no ${missing.join(', ')} - tile pages need the satellite firmware 2.0.0 or newer`,
            ),
        );
        link.on('problem', message => this.log.info(`${this.labelOf(sat)}: ${message}`));
        link.on('media', media => void this.onMediaState(sat, media));
        return link;
    }

    /**
     * @param {SatelliteConfig} sat - A tablet
     * @returns {TabletLink} Its connection: the web app comes to the adapter
     */
    tabletLinkOf(sat) {
        return new TabletLink({ name: sat.name, grid: sat.grid });
    }

    /**
     * @param {SatelliteConfig} sat - Satellite or tablet
     * @returns {string} Its name for the log, with the address of a satellite
     */
    labelOf(sat) {
        return sat.host ? `${sat.name} (${sat.host})` : `${sat.name} (tablet)`;
    }

    /**
     * @param {SatelliteConfig} sat - Satellite or tablet
     * @returns {string} Id of its device object below the namespace, e.g. satellites.kitchen or tablets.hall
     */
    baseOf(sat) {
        return `${sat.kind === 'tablet' ? 'tablets' : 'satellites'}.${sat.id}`;
    }

    /**
     * @param {string} id - State id
     * @returns {boolean} The state belongs to a device of this instance (satellites.* or tablets.*)
     */
    isDisplayState(id) {
        return id.startsWith(`${this.namespace}.satellites.`) || id.startsWith(`${this.namespace}.tablets.`);
    }

    /**
     * A satellite or tablet renamed in the settings stays the same device (lib/renames.js): a tablet keeps its access
     * key, so its link still works, and the tiles of the old name go to the new one.
     *
     * @param {SatelliteConfig[]} displays - Displays of the settings
     * @returns {Promise<boolean>} True when the tiles changed: they are saved and the instance restarts
     */
    async followRenames(displays) {
        /** @type {import('./lib/renames').OldDevice[]} */
        const devices = [];
        for (const dev of await this.getDevicesAsync()) {
            const parts = dev._id.split('.');
            if (parts.length === 4 && (parts[2] === 'satellites' || parts[2] === 'tablets')) {
                devices.push({
                    kind: parts[2] === 'tablets' ? 'tablet' : 'satellite',
                    id: parts[3],
                    name: typeof dev.common?.name === 'string' ? dev.common.name : '',
                });
            }
        }
        const renames = findRenames(devices, displays);
        for (const r of renames) {
            const folder = r.kind === 'tablet' ? 'tablets' : 'satellites';
            this.log.info(
                `${r.from} was renamed to ${r.to}: ${r.kind === 'tablet' ? 'its link stays valid, ' : ''}its tiles go along`,
            );
            if (r.kind === 'tablet') {
                const key = (await this.getObjectAsync(`${folder}.${r.fromId}`))?.native?.key;
                if (typeof key === 'string' && key) {
                    await this.extendObject(`${folder}.${r.toId}`, {
                        type: 'device',
                        common: { name: r.to },
                        native: { key },
                    });
                }
            }
            await this.delObjectAsync(`${folder}.${r.fromId}`, { recursive: true });
        }
        const { tiles, changed } = renameTiles(/** @type {Record<string, unknown>[]} */ (this.config.tiles), renames);
        const titles = renamePageTitles(this.config.pageTitles, renames);
        if (!changed && !titles.changed) {
            return false;
        }
        this.log.info(
            `${changed} tile(s)${titles.changed ? ' and the page titles' : ''} moved to the new name; the settings are saved and the instance starts again`,
        );
        this.pendingTiles = tiles;
        this.pendingPageTitles = titles.pageTitles;
        await this.saveTiles();
        return true;
    }

    /** The PWA is off or no tablet is left: the objects of the tablets go, with their access keys. */
    async removeTabletObjects() {
        if (await this.getObjectAsync('tablets')) {
            await this.delObjectAsync('tablets', { recursive: true });
        }
    }

    /**
     * Starts the web server of the tablets, when there is a tablet and the certificate (with HTTPS) is there.
     * Port and address go to the used resources registry of js-controller 8 (doc/used-resources.md).
     *
     * @param {SatelliteConfig[]} tablets - Enabled tablets
     */
    async startTabletServer(tablets) {
        if (!tablets.length) {
            this.log.warn('Tablets with the web app are on, but no tablet is entered: the web server stays off');
            return;
        }
        const decision = await decideTls(this.config, (pub, priv, chained) =>
            this.getCertificatesAsync(pub, priv, chained),
        );
        if (decision.mode === 'unavailable') {
            this.log.error(`The web app of the tablets stays off: ${decision.reason}`);
            return;
        }
        const n = Number(this.config.pwaPort);
        const port = Number.isInteger(n) && n > 0 && n < 65536 ? n : DEFAULT_PWA_PORT;
        const bind = String(this.config.pwaBind || '').trim() || '0.0.0.0';
        // asked before listening, but not waited for: the host may take up to 5 s to answer, and its answer only
        // names the instance that holds the port when listening fails (it is a hint, not a permission)
        const held = checkTcpPort(this, port, bind, 'Web app of the tablets');
        const server = new TabletServer({
            root: path.join(__dirname, 'www'),
            linkOf: key => this.tabletOfKey(key),
            timers: {
                setInterval: (cb, ms) => (this.stopping ? undefined : this.setInterval(cb, ms)),
                clearInterval: handle => this.clearInterval(/** @type {ioBroker.Interval} */ (handle)),
            },
            log: this.log,
        });
        try {
            const address = await server.start({
                port,
                bind,
                tls: decision.mode === 'https' ? decision.tls : undefined,
            });
            if (this.stopping) {
                server.stop();
                return;
            }
            this.tabletServer = server;
            this.log.info(
                `Web app of the tablets on ${decision.mode}://${address.address}:${address.port}/ - the links with the access keys: settings, tab Tablets`,
            );
            await this.updateConnection();
            void registerTcpPort(this, address.port, address.address);
        } catch (e) {
            const instances = await held;
            this.log.error(
                `The web app of the tablets cannot listen on ${bind}:${port}: ${e.message}${
                    instances.length ? ` (the port is used by ${instances.join(', ')})` : ''
                } - choose another port in the settings, tab Tablets`,
            );
        }
    }

    /**
     * @param {string} key - Access key from the link of a tablet
     * @returns {TabletLink | null} Its tablet, null when the key is wrong
     */
    tabletOfKey(key) {
        const given = crypto.createHash('sha256').update(String(key)).digest();
        let found = null;
        // compared in constant time, all of them, so the time does not tell how much of a key was right
        for (const [k, id] of this.tabletKeys) {
            if (crypto.timingSafeEqual(given, crypto.createHash('sha256').update(k).digest())) {
                found = id;
            }
        }
        const link = found ? this.links.get(found) : undefined;
        return link instanceof TabletLink ? link : null;
    }

    /**
     * The links of the tablets for the settings: address of this host, port, access key.
     *
     * @returns {Promise<{name: string, url: string}[]>} One link a tablet
     */
    async tabletLinks() {
        const scheme = this.config.secure === true ? 'https' : 'http';
        const bind = String(this.config.pwaBind || '').trim();
        const host = bind && bind !== '0.0.0.0' && bind !== '::' ? bind : await this.lanAddress();
        const n = Number(this.config.pwaPort);
        const port = Number.isInteger(n) && n > 0 && n < 65536 ? n : DEFAULT_PWA_PORT;
        const links = [];
        for (const [key, id] of this.tabletKeys) {
            const sat = this.satellites.get(id);
            if (sat) {
                links.push({
                    name: sat.name,
                    url: `${scheme}://${host.includes(':') ? `[${host}]` : host}:${port}/t/${encodeURIComponent(key)}/`,
                });
            }
        }
        return links;
    }

    /**
     * A new access key for a tablet (its link got into wrong hands, or the tablet is given away): the old link stops
     * working at once, a tablet still connected with it is told that its link is out of date.
     *
     * @param {SatelliteConfig} sat - The tablet
     * @returns {Promise<{name: string, url: string} | undefined>} Its new link
     */
    async renewTabletKey(sat) {
        for (const [key, id] of this.tabletKeys) {
            if (id === sat.id) {
                this.tabletKeys.delete(key);
            }
        }
        const key = crypto.randomBytes(24).toString('base64url');
        await this.extendObject(this.baseOf(sat), { native: { key } });
        this.tabletKeys.set(key, sat.id);
        const link = this.links.get(sat.id);
        if (link instanceof TabletLink) {
            link.revoke();
        }
        this.log.info(`${sat.name}: new link for the tablet, the old one no longer works`);
        return (await this.tabletLinks()).find(l => l.name === sat.name);
    }

    /** @returns {Promise<string>} The first IPv4 address of this host in the LAN, else its name */
    async lanAddress() {
        const obj = await this.getForeignObjectAsync(`system.host.${this.host}`).catch(() => null);
        const native =
            /** @type {{hardware?: {networkInterfaces?: Record<string, {family?: string | number, internal?: boolean, address?: string}[]>}}} */ (
                obj?.native ?? {}
            );
        for (const list of Object.values(native.hardware?.networkInterfaces ?? {})) {
            for (const a of Array.isArray(list) ? list : []) {
                if ((a.family === 'IPv4' || a.family === 4) && !a.internal && a.address) {
                    return a.address;
                }
            }
        }
        return String(this.host || 'localhost');
    }

    /**
     * Creates the objects of the satellites and tablets and removes those no longer configured.
     *
     * @param {SatelliteConfig[]} satellites - Enabled satellites and tablets
     */
    async createObjects(satellites) {
        await this.extendObject('satellites', { type: 'folder', common: { name: NAMES.satellites }, native: {} });
        if (satellites.some(s => s.kind === 'tablet')) {
            await this.extendObject('tablets', { type: 'folder', common: { name: NAMES.tablets }, native: {} });
        } else {
            await this.removeTabletObjects();
        }
        this.tabletKeys.clear();
        for (const sat of satellites) {
            const base = this.baseOf(sat);
            if (sat.kind === 'tablet') {
                // the access key of the tablet stays with its object; a new tablet gets a new one
                const old = await this.getObjectAsync(base);
                const oldKey = old?.native?.key;
                const key =
                    typeof oldKey === 'string' && oldKey.length >= 32
                        ? oldKey
                        : crypto.randomBytes(24).toString('base64url');
                await this.extendObject(base, { type: 'device', common: { name: sat.name }, native: { key } });
                this.tabletKeys.set(key, sat.id);
            } else {
                await this.extendObject(base, {
                    type: 'device',
                    common: { name: sat.name },
                    native: { host: sat.host },
                });
            }
            await this.extendObject(`${base}.connected`, {
                type: 'state',
                common: {
                    name: NAMES.connected,
                    type: 'boolean',
                    // indicator.connected belongs to info.connection of an instance only
                    role: 'indicator.reachable',
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
            if (sat.pinHash) {
                await this.extendObject(`${base}.locked`, {
                    type: 'state',
                    common: { name: NAMES.locked, type: 'boolean', role: 'switch', read: true, write: true, def: true },
                    native: {},
                });
                await this.extendObject(`${base}.failedPins`, {
                    type: 'state',
                    common: { name: NAMES.failedPins, type: 'number', role: 'value', read: true, write: false, def: 0 },
                    native: {},
                });
            } else {
                // the lock is off: its states go
                for (const s of ['locked', 'failedPins']) {
                    if (await this.getObjectAsync(`${base}.${s}`)) {
                        await this.delObjectAsync(`${base}.${s}`);
                    }
                }
            }
        }
        const keep = new Set(satellites.map(s => `${this.namespace}.${this.baseOf(s)}`));
        const devices = await this.getDevicesAsync();
        for (const dev of devices) {
            if (this.isDisplayState(dev._id) && !keep.has(dev._id)) {
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
            for (const id of [...new Set([b.tile.state, b.tile.state2, b.tile.state3, b.tile.bgState])].filter(
                Boolean,
            )) {
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
                lastColor: 0,
                lastBackground: 0,
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
        const msg = /** @type {{satellite?: unknown, tiles?: unknown, pageTitles?: unknown}} */ (obj.message || {});
        const reply = (/** @type {Record<string, unknown>} */ answer) => {
            if (obj.callback) {
                this.sendTo(obj.from, obj.command, answer, obj.callback);
            }
        };
        if (EDIT_COMMANDS.includes(obj.command)) {
            await this.onEditCommand(obj.command, /** @type {Record<string, unknown>} */ (obj.message || {}), reply);
            return;
        }
        if (obj.command === 'tabletLinks') {
            if (!this.tabletServer) {
                reply({
                    error: 'The web app of the tablets does not run: switch it on, enter a tablet and save (or see the log)',
                });
                return;
            }
            const links = await this.tabletLinks();
            // links for the QR codes of the settings, result as text for a plain sendTo
            reply({ links, result: links.map(l => `${l.name}: ${l.url}`).join('\n') });
            return;
        }
        if (obj.command === 'tabletNewKey') {
            const name = String(/** @type {{tablet?: unknown}} */ (obj.message || {}).tablet ?? '');
            const tablet = this.satellites.get(idOf(name));
            if (!this.tabletServer || tablet?.kind !== 'tablet') {
                reply({ error: `no tablet "${name}" with a running web app` });
                return;
            }
            reply({ link: await this.renewTabletKey(tablet) });
            return;
        }

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
        // the page titles of the editor (not saved yet) come along; without them the saved ones
        this.previews.set(sat.id, { bound, timer, pageTitles: msg.pageTitles });
        this.log.info(`${sat.name}: preview of ${bound.length} tiles from the editor`);
        if (link?.ready) {
            await this.sendLayout(sat);
        }
        reply({ ok: true, tiles: bound.length, problems, connected: !!link?.ready });
    }

    /**
     * A command on the tile list (help, getTiles, addTile, updateTile, moveTile, removeTile), e.g. from an AI agent.
     * A change is answered first and then saved in the settings of the instance, which restarts it and shows it.
     *
     * @param {string} command - Command
     * @param {Record<string, unknown>} msg - Message
     * @param {(answer: Record<string, unknown>) => void} reply - Answer
     */
    async onEditCommand(command, msg, reply) {
        /** @type {{answer: Record<string, unknown> | string, tiles?: Record<string, unknown>[], pageTitles?: Record<string, unknown>}} */
        let result;
        try {
            result = await runCommand(command, msg, {
                satellites: /** @type {Record<string, unknown>[]} */ (this.config.satellites || []),
                tablets: /** @type {Record<string, unknown>[]} */ (this.config.tablets || []),
                pwaEnabled: this.config.pwaEnabled === true,
                // changes of earlier commands that wait for the restart count too
                tiles: this.pendingTiles ?? /** @type {Record<string, unknown>[]} */ (this.config.tiles || []),
                pageTitles: this.pendingPageTitles ?? this.config.pageTitles ?? {},
                stateExists: async id => !!(await this.getForeignObjectAsync(id).catch(() => null)),
            });
        } catch (e) {
            reply({ error: e.message });
            return;
        }
        reply(typeof result.answer === 'string' ? { help: result.answer } : result.answer);
        if (result.tiles) {
            this.log.info(`Tiles changed by the command ${command}: ${JSON.stringify(result.answer).slice(0, 200)}`);
            this.pendingTiles = result.tiles;
            this.scheduleTileSave();
        }
        if (result.pageTitles) {
            this.log.info(
                `Page title changed by the command ${command}: ${JSON.stringify(result.answer).slice(0, 200)}`,
            );
            this.pendingPageTitles = result.pageTitles;
            this.scheduleTileSave();
        }
    }

    /** Saves the changed tiles in the settings a moment later (several commands in a row: one restart). */
    scheduleTileSave() {
        if (this.saveTimer) {
            this.clearTimeout(this.saveTimer);
            this.timers.delete(this.saveTimer);
        }
        const timer = this.setTimeout(() => {
            this.timers.delete(timer);
            this.saveTimer = undefined;
            void this.saveTiles();
        }, 1500);
        this.saveTimer = timer;
        this.timers.add(timer);
    }

    async saveTiles() {
        const tiles = this.pendingTiles;
        const pageTitles = this.pendingPageTitles;
        if (!tiles && !pageTitles) {
            return;
        }
        const id = `system.adapter.${this.namespace}`;
        const obj = await this.getForeignObjectAsync(id);
        if (!obj) {
            return;
        }
        obj.native = { ...obj.native, ...(tiles ? { tiles } : {}), ...(pageTitles ? { pageTitles } : {}) };
        // the whole object: extendForeignObject would merge the old list into the new one; the instance restarts
        await this.setForeignObjectAsync(id, obj);
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
        this.log.info(`${this.labelOf(sat)} connected`);
        this.sendLock(sat);
        await this.setupBrightness(sat);
        await this.setupMedia(sat);
        await this.sendLayout(sat);
        await this.setState(`${this.baseOf(sat)}.connected`, { val: true, ack: true });
        await this.updateConnection();
    }

    /**
     * The screen lock to the satellite: on or off, the hash of the PIN, when it locks again. The satellite keeps it
     * in its flash, so it is sent after every connect (also "off", to end a lock set before).
     *
     * @param {SatelliteConfig} sat - Satellite
     */
    sendLock(sat) {
        const link = this.links.get(sat.id);
        if (!link) {
            return;
        }
        if (!link.has('lock_config')) {
            if (sat.pinHash) {
                this.log.warn(
                    `${sat.name}: the screen lock needs the satellite firmware ${OPTIONAL_ACTIONS.lock_config} or newer`,
                );
            }
            return;
        }
        const mode = [0, 1, 2].includes(Number(this.config.relockMode)) ? Number(this.config.relockMode) : 0;
        const minutes = Math.min(1440, Math.max(1, Math.round(Number(this.config.relockMinutes) || 5)));
        link.call('lock_config', {
            enabled: !!sat.pinHash,
            pin_hash: sat.pinHash,
            length: sat.pinLength,
            mode,
            minutes,
        });
    }

    /**
     * A display whose firmware takes its brightness from ioBroker (the tile panel) gets the state
     * satellites.<name>.brightness; after a connect it gets the value of the state again.
     *
     * @param {SatelliteConfig} sat - Satellite
     */
    async setupBrightness(sat) {
        const link = this.links.get(sat.id);
        if (!link?.has('display_brightness')) {
            return;
        }
        const id = `${this.baseOf(sat)}.brightness`;
        await this.extendObject(id, {
            type: 'state',
            common: {
                name: NAMES.brightness,
                type: 'number',
                role: 'level.dimmer',
                unit: '%',
                min: 0,
                max: 100,
                read: true,
                write: true,
            },
            native: {},
        });
        const state = await this.getStateAsync(id);
        if (state && state.val !== null && state.val !== undefined) {
            this.sendBrightness(sat, state.val);
        }
    }

    /**
     * A display with a player of its own (the tile panel with an I2S amplifier) gets satellites.<name>.media.*:
     * url plays a stream (e.g. from an AirPlay receiver), volume, stop, and state reports what it does.
     *
     * @param {SatelliteConfig} sat - Satellite
     */
    async setupMedia(sat) {
        if (!this.links.get(sat.id)?.has('media_play')) {
            return;
        }
        const base = `${this.baseOf(sat)}.media`;
        await this.extendObject(base, { type: 'channel', common: { name: NAMES.media }, native: {} });
        /** @type {Record<string, Partial<ioBroker.StateCommon>>} */
        const states = {
            url: { name: NAMES.mediaUrl, type: 'string', role: 'media.url', read: true, write: true, def: '' },
            volume: {
                name: NAMES.mediaVolume,
                type: 'number',
                role: 'level.volume',
                unit: '%',
                min: 0,
                max: 100,
                read: true,
                write: true,
            },
            title: { name: NAMES.mediaTitle, type: 'string', role: 'media.title', read: true, write: true, def: '' },
            stop: { name: NAMES.mediaStop, type: 'boolean', role: 'button.stop', read: false, write: true, def: false },
            state: {
                name: NAMES.mediaState,
                type: 'string',
                role: 'media.state',
                read: true,
                write: false,
                states: { play: 'play', pause: 'pause', stop: 'stop' },
                def: 'stop',
            },
        };
        for (const [key, common] of Object.entries(states)) {
            await this.extendObject(`${base}.${key}`, {
                type: 'state',
                common: /** @type {ioBroker.StateCommon} */ (common),
                native: {},
            });
        }
    }

    /**
     * What the player of a display does.
     *
     * @param {SatelliteConfig} sat - Satellite
     * @param {{state: string, volume: number | null}} media - Its state
     */
    async onMediaState(sat, media) {
        const base = `${this.baseOf(sat)}.media`;
        await this.setState(`${base}.state`, { val: mediaStateOf(media.state), ack: true });
        if (media.volume !== null) {
            await this.setState(`${base}.volume`, { val: media.volume, ack: true });
        }
    }

    /**
     * A write to satellites.<name>.media.*: play, stop, volume.
     *
     * @param {string} id - State id
     * @param {ioBroker.State} state - New state
     */
    async onMediaCommand(id, state) {
        const parts = id.split('.');
        const sat = this.satellites.get(parts[3]);
        const link = sat ? this.links.get(sat.id) : undefined;
        if (!sat || !link?.ready || !link.has('media_play')) {
            this.log.info(`${sat?.name ?? id}: the player cannot be used now (not connected or no player)`);
            return;
        }
        const key = parts[5];
        if (key === 'url') {
            const url = String(state.val ?? '').trim();
            // only a URL plays; anything else (empty, "stop" as other players of ioBroker take it) stops
            if (/^https?:\/\//i.test(url)) {
                link.call('media_play', { url });
                this.log.debug(`${sat.name}: plays ${url}`);
            } else {
                link.call('media_stop', {});
            }
            await this.setState(id, { val: url, ack: true });
        } else if (key === 'title') {
            const title = String(state.val ?? '').slice(0, 48);
            if (link.has('media_title')) {
                link.call('media_title', { title });
            }
            await this.setState(id, { val: title, ack: true });
        } else if (key === 'stop' && state.val) {
            link.call('media_stop', {});
            await this.setState(id, { val: false, ack: true });
        } else if (key === 'volume') {
            const n = toNumber(state.val);
            if (n !== null) {
                link.call('media_volume', { volume: Math.max(0, Math.min(100, Math.round(n))) });
            }
        }
    }

    /**
     * @param {SatelliteConfig} sat - Satellite
     * @param {ioBroker.StateValue} val - Brightness 0..100, 0 = dark
     * @returns {number | null} The brightness sent, null when not
     */
    sendBrightness(sat, val) {
        const link = this.links.get(sat.id);
        const n = toNumber(val);
        if (n === null || !link?.ready || !link.has('display_brightness')) {
            return null;
        }
        const brightness = Math.max(0, Math.min(100, Math.round(n)));
        link.call('display_brightness', { brightness });
        return brightness;
    }

    /**
     * The screen lock of a satellite changed, or a PIN was wrong.
     *
     * @param {SatelliteConfig} sat - Satellite
     * @param {{locked: boolean, failed: number}} lock - Its state
     */
    async onLockState(sat, lock) {
        if (!sat.pinHash) {
            return;
        }
        const base = this.baseOf(sat);
        await this.setState(`${base}.locked`, { val: lock.locked, ack: true });
        await this.setState(`${base}.failedPins`, { val: lock.failed, ack: true });
        if (lock.failed > 0 && lock.locked) {
            this.log.warn(`${sat.name}: wrong PIN on the display (${lock.failed} in a row)`);
        }
    }

    /** @param {SatelliteConfig} sat - The satellite that was lost */
    async onSatelliteLost(sat) {
        this.log.info(
            sat.kind === 'tablet'
                ? `${this.labelOf(sat)} disconnected, it connects again when it is awake`
                : `${this.labelOf(sat)} disconnected, connecting again`,
        );
        await this.setState(`${this.baseOf(sat)}.connected`, { val: false, ack: true });
        await this.updateConnection();
    }

    /**
     * Connected: every satellite is. A tablet that sleeps (iOS closes the connection with the screen) does not
     * count; with tablets only, the web server running is.
     */
    async updateConnection() {
        const satellites = [...this.satellites.values()].filter(s => s.kind === 'satellite');
        const ok = satellites.length ? satellites.every(s => this.links.get(s.id)?.ready) : this.tabletServer !== null;
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
        if (link.has('page_title')) {
            // the title of every page, also an empty one (it clears a title set before)
            const preview = this.previews.get(sat.id);
            const titles = pageTitlesOf(preview?.pageTitles ?? this.config.pageTitles, sat);
            for (let page = 1; page <= sat.grid.pages; page++) {
                link.call('page_title', { page, title: titles[page] ?? '' });
            }
        }
        const mine = this.shownOn(sat.id).filter(b => this.supported(sat, link, b));

        for (const b of mine) {
            link.call('tile_set', b.args);
            // tile_set starts with the colours of the theme
            b.lastColor = 0;
            b.lastBackground = 0;
            this.sendColor(link, b, null);
            this.sendBackground(link, b, null);
            if (b.tile.type === 'switch' && link.has('tile_toggle')) {
                link.call('tile_toggle', { page: b.tile.page, slot: b.tile.slot, show: b.tile.showToggle });
            }
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
     * @param {SatelliteLink | TabletLink} link - Its connection
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
            for (const id of [b.tile.state2, b.tile.state3, b.tile.bgState].filter(Boolean)) {
                if (id === b.tile.state) {
                    continue;
                }
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
        if (id === b.tile.bgState) {
            this.sendBackground(link, b, val);
            if (id !== b.tile.state && id !== b.tile.state2 && id !== b.tile.state3) {
                return;
            }
        }
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
     * @param {SatelliteLink | TabletLink} link - Connection of the satellite
     * @param {Bound} b - Tile
     * @param {number | null} value - Its value, null = no value (only the colour of the tile)
     */
    sendColor(link, b, value) {
        if (!link.has('tile_color')) {
            return;
        }
        // red beyond a threshold, else the colour of the tile, else the default of the settings, else the theme
        const alert = value === null ? 0 : alertColor(value, b.tile);
        const color = alert || (b.tile.color ?? colorOf(this.config.accentColor) ?? 0);
        if (color !== b.lastColor) {
            b.lastColor = color;
            link.call('tile_color', { page: b.tile.page, slot: b.tile.slot, color });
        }
    }

    /**
     * The background of a tile: from its background state, else its own colour, else the theme. Sent only when it
     * changes; a firmware without tile_background (before 2.0.4) gets none.
     *
     * @param {SatelliteLink | TabletLink} link - Connection of the satellite
     * @param {Bound} b - Tile
     * @param {unknown} val - Value of the background state, null when not known yet
     */
    sendBackground(link, b, val) {
        if (!link.has('tile_background')) {
            return;
        }
        const background = backgroundOf(b.tile.bgState ? val : null, b.tile, colorOf);
        if (background !== b.lastBackground) {
            b.lastBackground = background;
            link.call('tile_background', { page: b.tile.page, slot: b.tile.slot, color: background });
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
        await this.setState(`${this.baseOf(sat)}.lastTouch`, {
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
        if (id.startsWith(`${this.namespace}.satellites.`) && id.split('.')[4] === 'media') {
            if (!state.ack) {
                await this.onMediaCommand(id, state);
            }
            return;
        }
        if (id.startsWith(`${this.namespace}.satellites.`) && id.endsWith('.brightness')) {
            if (!state.ack) {
                const sat = this.satellites.get(id.split('.')[3]);
                const sent = sat ? this.sendBrightness(sat, state.val) : null;
                if (sent !== null) {
                    await this.setState(id, { val: sent, ack: true });
                } else {
                    this.log.info(`${sat?.name ?? id}: the brightness cannot be set now (not connected)`);
                }
            }
            return;
        }
        if (this.isDisplayState(id) && id.endsWith('.locked')) {
            if (!state.ack) {
                // lock or unlock from ioBroker; the satellite answers with its state
                const sat = this.satellites.get(id.split('.')[3]);
                const link = sat ? this.links.get(sat.id) : undefined;
                if (sat?.pinHash && link?.ready && link.has('lock_set')) {
                    link.call('lock_set', { locked: !!state.val });
                } else {
                    this.log.info(`${sat?.name ?? id}: the screen lock cannot be switched now (off or not connected)`);
                }
            }
            return;
        }
        if (this.isDisplayState(id) && id.endsWith('.resend')) {
            if (!state.ack && state.val) {
                const sat = this.satellites.get(id.split('.')[3]);
                if (sat && this.links.get(sat.id)?.ready) {
                    await this.sendLayout(sat);
                }
                await this.setState(id, { val: false, ack: true });
            }
            return;
        }
        if (!showsChange(id, state)) {
            return; // a command the device has not confirmed yet
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
            this.tabletServer?.stop();
            this.tabletServer = null;

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
