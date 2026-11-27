'use strict';

// The satellites and tablets in the Device Manager of ioBroker (@iobroker/dm-utils): a card per display with its
// connection, the controls it has (screen lock, brightness, volume), "send the tiles again" and, for a tablet, its link
// with the QR code and "new link". The settings stay in the tables of the settings; this view only shows and acts.

const { DeviceManagement } = require('@iobroker/dm-utils');
const { normalizeTiles } = require('./layout');
const { DM_TEXTS } = require('./dm-texts');
const { NAMES } = require('./names');

/**
 * @typedef {import('./layout').SatelliteConfig} SatelliteConfig
 * @typedef {import('@iobroker/dm-utils').ActionContext} ActionContext
 * @typedef {import('@iobroker/dm-utils').ConfigItemAny} ConfigItemAny
 * @typedef {import('@iobroker/dm-utils').ConfigItemPanel} ConfigItemPanel
 * @typedef {import('@iobroker/dm-utils').DeviceInfo<string>} DeviceInfo
 * @typedef {import('@iobroker/dm-utils').DeviceControl<string>} DeviceControl
 * @typedef {import('@iobroker/dm-utils').DeviceAction<string>} DeviceAction
 * @typedef {import('@iobroker/dm-utils').DeviceDetails<string>} DeviceDetails
 * @typedef {import('@iobroker/dm-utils').DeviceLoadContext<string>} DeviceLoadContext
 * @typedef {import('@iobroker/dm-utils').DeviceRefreshResponse<string>} DeviceRefreshResponse
 * @typedef {import('@iobroker/dm-utils').InstanceDetails} InstanceDetails
 * @typedef {import('@iobroker/dm-utils').ControlState} ControlState
 * @typedef {{name: string, url: string}} TabletUrl
 * @typedef {import('./satellite').FirmwareState & {connected: boolean, lastError?: string}} FirmwareInfo
 */

/** How the progress of a firmware update is followed (changed by the tests) */
const FIRMWARE_WATCH = { pollMs: 1000, timeoutMs: 10 * 60_000, idleMs: 90_000 };

/**
 * @param {ioBroker.Translated} texts - A text in every language
 * @param {string} [reason] - A line of the log of the satellite, the same in every language
 * @returns {ioBroker.Translated} The texts with the reason on a line of its own
 */
function withReason(texts, reason) {
    if (!reason) {
        return texts;
    }
    return /** @type {ioBroker.Translated} */ (
        Object.fromEntries(Object.entries(texts).map(([lang, text]) => [lang, `${text}\n${reason}`]))
    );
}

/**
 * @param {ioBroker.Translated} texts - A text in every language with %1, %2
 * @param {...string} values - What goes in
 * @returns {ioBroker.Translated} The texts filled in
 */
function fill(texts, ...values) {
    return /** @type {ioBroker.Translated} */ (
        Object.fromEntries(
            Object.entries(texts).map(([lang, text]) => [
                lang,
                values.reduce((t, v, i) => t.split(`%${i + 1}`).join(v), text),
            ]),
        )
    );
}

/**
 * @typedef {object} DisplayHost - What the adapter (main.js) offers to this view
 * @property {string} namespace - e.g. satellite-display.0
 * @property {(ms: number) => Promise<void>} delay - Waits (a timer of the adapter, cleared when it stops)
 * @property {Map<string, SatelliteConfig>} satellites - The running displays
 * @property {object | null} tabletServer - The web server of the tablets, null while it does not run
 * @property {{tiles?: unknown}} config - Settings of the instance
 * @property {(sat: SatelliteConfig) => string} baseOf - Id of the device of a display below the namespace
 * @property {() => Promise<TabletUrl[]>} tabletLinks - The links of the tablets
 * @property {(sat: SatelliteConfig) => Promise<TabletUrl | undefined>} renewTabletKey - New link for a tablet
 * @property {(id: string) => Promise<ioBroker.Object | null | undefined>} getObjectAsync - Object of the instance
 * @property {(id: string, state: ioBroker.SettableState) => Promise<unknown>} setStateAsync - Writes a state
 * @property {(id: string, state: ioBroker.SettableState) => Promise<unknown>} setForeignStateAsync - Writes a state
 * @property {(id: string) => Promise<ioBroker.State | null | undefined>} getForeignStateAsync - Reads a state
 * @property {(sat: SatelliteConfig) => FirmwareInfo | null} firmwareOf - The firmware update of a satellite, null
 *   when its firmware has no update entity
 * @property {(sat: SatelliteConfig) => boolean} installFirmware - Starts the installation of the offered firmware
 * @property {(sat: SatelliteConfig) => Promise<string | undefined>} assistantVolumeOf - The volume state (0…1) of
 *   the player of a voice satellite in ioBroker.assistant, found by its address
 * @property {() => Promise<{url: string, minutes: number} | null>} openPairing - A one-time link to pair a tablet,
 *   null while the web app does not run
 */

/**
 * Builds the card of a display, without the handlers (those are added by the class).
 *
 * @param {SatelliteConfig} sat - Satellite or tablet
 * @param {object} has - What it has
 * @param {string} has.ns - Namespace of the instance, e.g. satellite-display.0
 * @param {string} has.base - Id of its device below the namespace, e.g. satellites.kitchen
 * @param {boolean} has.brightness - The state brightness exists
 * @param {boolean} has.volume - The state media.volume exists
 * @param {string} [has.playerVolume] - Without media.volume: the volume state (0…1) of the player of a voice
 *   satellite in ioBroker.assistant, shown as 0…100 % (the handlers of the class scale it)
 * @param {boolean} has.webApp - The web app of the tablets runs (a tablet has a link)
 * @param {boolean} [has.firmware] - The states firmware.* exist (the firmware has an update entity)
 * @param {string} [has.firmwareVersion] - Installed firmware, shown after the kind of display (an admin without the
 *   update field of the card shows it too)
 * @returns {DeviceInfo & {controls: DeviceControl[], actions: DeviceAction[]}} Card without handlers
 */
function cardOf(sat, has) {
    const tablet = sat.kind === 'tablet';
    const id = (/** @type {string} */ s) => `${has.ns}.${has.base}.${s}`;
    /** @type {DeviceControl[]} */
    const controls = [];
    if (sat.pinHash) {
        controls.push({ id: 'locked', type: 'switch', stateId: id('locked'), label: DM_TEXTS.locked });
    }
    if (has.brightness) {
        controls.push({
            id: 'brightness',
            type: 'slider',
            stateId: id('brightness'),
            label: DM_TEXTS.brightness,
            min: 0,
            max: 100,
            step: 5,
            unit: '%',
        });
    }
    if (has.volume || (!tablet && has.playerVolume)) {
        controls.push({
            id: 'volume',
            type: 'slider',
            stateId: has.volume ? id('media.volume') : has.playerVolume,
            label: DM_TEXTS.volume,
            min: 0,
            max: 100,
            step: 5,
            unit: '%',
        });
    }
    /** @type {DeviceAction[]} */
    const actions = [{ id: 'resend', icon: 'refresh', description: NAMES.resend }];
    if (!tablet && has.firmware) {
        // the id "update" is also what the update indicator of the card calls (ACTIONS.UPDATE of dm-utils)
        actions.push({ id: 'update', icon: 'update', description: DM_TEXTS.firmwareUpdate });
    }
    if (tablet && has.webApp) {
        actions.push({ id: 'showLink', icon: 'qrcode', description: DM_TEXTS.showLink });
        actions.push({
            id: 'newLink',
            icon: 'unpairDevice',
            description: DM_TEXTS.newLink,
            confirmation: DM_TEXTS.newLinkConfirm,
        });
    }
    /** @type {Partial<DeviceInfo>} */
    const update =
        !tablet && has.firmware
            ? {
                  update: {
                      available: { stateId: id('firmware.available') },
                      version: { stateId: id('firmware.version') },
                      newVersion: { stateId: id('firmware.latest') },
                  },
              }
            : {};
    return {
        id: has.base,
        name: sat.name,
        identifier: tablet ? undefined : `${sat.host}:${sat.port}`,
        ...update,
        model: tablet
            ? DM_TEXTS.tabletModel
            : has.firmwareVersion
              ? fill(
                    /** @type {ioBroker.Translated} */ (
                        Object.fromEntries(Object.entries(DM_TEXTS.satelliteModel).map(([l, t]) => [l, `${t} · %1`]))
                    ),
                    has.firmwareVersion,
                )
              : DM_TEXTS.satelliteModel,
        status: { connection: { stateId: id('connected'), mapping: { true: 'connected', false: 'disconnected' } } },
        group: tablet
            ? { key: 'tablets', name: DM_TEXTS.tabletsGroup }
            : { key: 'satellites', name: DM_TEXTS.satellitesGroup },
        controls,
        actions,
        hasDetails: true,
    };
}

/**
 * The form below a card: address, grid, tiles, and for a tablet its link with the QR code.
 *
 * @param {SatelliteConfig} sat - Satellite or tablet
 * @param {object} info - What to show
 * @param {number} info.tiles - Number of its tiles
 * @param {string} [info.url] - Link of a tablet
 * @param {{version: string, latest: string} | null} [info.firmware] - Firmware of a satellite with an update entity
 * @returns {{schema: ConfigItemPanel, data: Record<string, unknown>}} JSON config schema and its data
 */
function detailsOf(sat, info) {
    /** @type {Record<string, ConfigItemAny>} */
    const items = {};
    if (sat.kind !== 'tablet') {
        items._address = { type: 'staticInfo', label: DM_TEXTS.address, data: `${sat.host}:${sat.port}`, sm: 12 };
    }
    if (info.firmware?.version) {
        items._firmware = { type: 'staticInfo', label: DM_TEXTS.firmware, data: info.firmware.version, sm: 12 };
    }
    if (info.firmware?.latest && info.firmware.latest !== info.firmware.version) {
        items._firmwareOffered = {
            type: 'staticInfo',
            label: DM_TEXTS.firmwareOffered,
            data: info.firmware.latest,
            sm: 12,
        };
    }
    items._grid = {
        type: 'staticInfo',
        label: DM_TEXTS.grid,
        data: `${sat.grid.cols} × ${sat.grid.rows}, ${sat.grid.pages}`,
        sm: 12,
    };
    items._tiles = { type: 'staticInfo', label: DM_TEXTS.tiles, data: info.tiles, sm: 12 };
    if (info.url) {
        Object.assign(items, linkItems('', info.url));
    }
    return { schema: { type: 'panel', items }, data: {} };
}

/**
 * The link of a tablet as text to copy and as a QR code.
 *
 * @param {string} prefix - Prefix of the item names (several tablets in one form)
 * @param {string} url - Its link
 * @returns {Record<string, ConfigItemAny>} Items of a JSON config panel
 */
function linkItems(prefix, url) {
    return {
        [`_${prefix}url`]: { type: 'staticInfo', label: DM_TEXTS.link, data: url, copyToClipboard: true, sm: 12 },
        [`_${prefix}qr`]: { type: 'qrCode', data: url, size: 200, sm: 12 },
    };
}

/** The displays of the instance in the Device Manager; dm-utils answers the dm:* messages through it. */
class SatelliteDeviceManagement extends DeviceManagement {
    /**
     * @param {DisplayHost & import('@iobroker/adapter-core').AdapterInstance} adapter - The adapter (main.js)
     */
    constructor(adapter) {
        super(adapter);
        /** @type {DisplayHost} */
        this.app = adapter;
    }

    /**
     * @returns {InstanceDetails} Instance information with the actions "Pair a tablet" while the web app runs and
     *   "Links of the tablets" when there is a tablet
     */
    getInstanceInfo() {
        const info = /** @type {InstanceDetails} */ (super.getInstanceInfo());
        /** @type {import('@iobroker/dm-utils').InstanceAction[]} */
        const actions = [];
        if (this.app.tabletServer) {
            actions.push({
                id: 'pairTablet',
                icon: 'add',
                title: DM_TEXTS.pairTablet,
                handler: context => this.showPairing(context),
            });
        }
        if ([...this.app.satellites.values()].some(s => s.kind === 'tablet')) {
            actions.push({
                id: 'tabletLinks',
                icon: 'qrcode',
                title: DM_TEXTS.tabletLinks,
                handler: context => this.showAllLinks(context),
            });
        }
        if (actions.length) {
            info.actions = actions;
        }
        return info;
    }

    /**
     * Instance action: the QR code of a one-time pairing link. The tablet that scans it enters itself in the settings,
     * which restarts the instance; the list shows it afterwards.
     *
     * @param {ActionContext} context - Action context of dm-utils
     * @returns {Promise<{refresh: boolean}>} The list is loaded again: a tablet may have paired meanwhile
     */
    async showPairing(context) {
        const pairing = await this.app.openPairing();
        if (!pairing) {
            await context.showMessage(DM_TEXTS.noServer);
            return { refresh: false };
        }
        /** @type {ioBroker.Translated} */
        const hint = /** @type {ioBroker.Translated} */ (
            Object.fromEntries(
                Object.entries(DM_TEXTS.pairHint).map(([lang, text]) => [
                    lang,
                    text.replace('%s', String(pairing.minutes)),
                ]),
            )
        );
        await context.showForm(
            {
                type: 'panel',
                items: { _hint: { type: 'staticText', text: hint, sm: 12 }, ...linkItems('', pairing.url) },
            },
            { title: DM_TEXTS.pairTablet, buttons: ['close'] },
        );
        return { refresh: true };
    }

    /**
     * @param {DeviceLoadContext} context - Load context of dm-utils
     */
    async loadDevices(context) {
        const displays = [...this.app.satellites.values()].sort(
            (a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name),
        );
        context.setTotalDevices(displays.length);
        for (const sat of displays) {
            const base = this.app.baseOf(sat);
            const exists = async (/** @type {string} */ s) => !!(await this.app.getObjectAsync(`${base}.${s}`));
            const volume = await exists('media.volume');
            // a voice satellite: its player belongs to ioBroker.assistant, the slider writes its volume (0…1)
            const playerVolume = !volume && sat.kind !== 'tablet' ? await this.app.assistantVolumeOf(sat) : undefined;
            const card = cardOf(sat, {
                ns: this.app.namespace,
                base,
                brightness: await exists('brightness'),
                volume,
                playerVolume,
                webApp: !!this.app.tabletServer,
                firmware: sat.kind !== 'tablet' && (await exists('firmware.version')),
                firmwareVersion: sat.kind === 'tablet' ? undefined : this.app.firmwareOf(sat)?.version || undefined,
            });
            for (const control of card.controls) {
                const stateId = String(control.stateId);
                const scale = stateId === playerVolume ? 100 : 1;
                control.handler = (_d, _c, val) => this.write(stateId, val, scale);
                control.getStateHandler = () => this.read(stateId, scale);
            }
            for (const action of card.actions) {
                Object.assign(action, {
                    handler: (/** @type {string} */ _d, /** @type {ActionContext} */ ctx) =>
                        this.onAction(sat, action.id, ctx),
                });
            }
            context.addDevice(card);
        }
    }

    /**
     * @param {string} deviceId - Id of the card (satellites.kitchen)
     * @returns {Promise<DeviceDetails | {error: string}>} The form below the card
     */
    async getDeviceDetails(deviceId) {
        const sat = [...this.app.satellites.values()].find(s => this.app.baseOf(s) === deviceId);
        if (!sat) {
            return { error: `unknown display ${deviceId}` };
        }
        const tiles = normalizeTiles(
            /** @type {Record<string, unknown>[]} */ (this.app.config.tiles),
            [...this.app.satellites.values()],
            [],
        ).filter(t => t.satellite === sat.id).length;
        const url = sat.kind === 'tablet' ? await this.urlOf(sat) : undefined;
        const firmware = sat.kind === 'tablet' ? null : this.app.firmwareOf(sat);
        return { id: deviceId, ...detailsOf(sat, { tiles, url, firmware }) };
    }

    /**
     * @param {SatelliteConfig} sat - A tablet
     * @returns {Promise<string | undefined>} Its link, when the web app runs
     */
    async urlOf(sat) {
        if (!this.app.tabletServer) {
            return undefined;
        }
        return (await this.app.tabletLinks()).find(l => l.name === sat.name)?.url;
    }

    /**
     * @param {SatelliteConfig} sat - The display of the card
     * @param {string} actionId - resend, update, showLink or newLink
     * @param {ActionContext} context - Action context of dm-utils
     * @returns {Promise<DeviceRefreshResponse>} Nothing to reload
     */
    async onAction(sat, actionId, context) {
        if (actionId === 'resend') {
            await this.app.setStateAsync(`${this.app.baseOf(sat)}.resend`, { val: true, ack: false });
            return { refresh: 'none' };
        }
        if (actionId === 'update') {
            await this.updateFirmware(sat, context);
            return { refresh: 'none' };
        }
        if (!this.app.tabletServer) {
            await context.showMessage(DM_TEXTS.noServer);
            return { refresh: 'none' };
        }
        const url = actionId === 'newLink' ? (await this.app.renewTabletKey(sat))?.url : await this.urlOf(sat);
        if (url) {
            await context.showForm(
                { type: 'panel', items: linkItems('', url) },
                { title: sat.name, buttons: ['close'] },
            );
        }
        return { refresh: 'none' };
    }

    /**
     * Card action "Update the firmware" (also the update indicator of the card): asks, starts the installation on the
     * satellite and shows its progress until the satellite is back with the new version.
     *
     * @param {SatelliteConfig} sat - Satellite
     * @param {ActionContext} context - Action context of dm-utils
     */
    async updateFirmware(sat, context) {
        const before = this.app.firmwareOf(sat);
        if (!before?.connected) {
            await context.showMessage(DM_TEXTS.firmwareUnknown);
            return;
        }
        if (!before.available) {
            await context.showMessage(fill(DM_TEXTS.firmwareUpToDate, before.version));
            return;
        }
        const target = before.latest;
        if (!(await context.showConfirmation(fill(DM_TEXTS.firmwareConfirm, before.version, target)))) {
            return;
        }
        if (!this.app.installFirmware(sat)) {
            await context.showMessage(DM_TEXTS.firmwareNotStarted);
            return;
        }
        const progress = await context.openProgress(`${sat.name}: ${before.version} → ${target}`, {
            indeterminate: true,
            label: DM_TEXTS.firmwareInstalling,
        });
        const start = Date.now();
        // the last time the satellite showed that it works on the update (installing or away for the restart)
        let busy = start;
        /** @type {ioBroker.Translated | null} */
        let result = null;
        while (!result) {
            await this.app.delay(FIRMWARE_WATCH.pollMs);
            const now = this.app.firmwareOf(sat);
            if (now?.connected && now.version === target) {
                result = fill(DM_TEXTS.firmwareDone, target);
            } else if (Date.now() - start > FIRMWARE_WATCH.timeoutMs) {
                result = DM_TEXTS.firmwareTimeout;
            } else if (!now?.connected) {
                busy = Date.now();
                await progress.update({ indeterminate: true, label: DM_TEXTS.firmwareRestarting });
            } else if (now.inProgress) {
                busy = Date.now();
                await progress.update(
                    now.progress === null
                        ? { indeterminate: true, label: DM_TEXTS.firmwareInstalling }
                        : { indeterminate: false, value: now.progress, label: DM_TEXTS.firmwareInstalling },
                );
            } else if (now.lastError || Date.now() - busy > FIRMWARE_WATCH.idleMs) {
                // connected, not installing, still the old version: the satellite gave up; its log says why
                result = withReason(fill(DM_TEXTS.firmwareFailed, now.version), now.lastError);
            }
        }
        await progress.close();
        await context.showMessage(result);
    }

    /**
     * Instance action: the links of all tablets with their QR codes in one dialog.
     *
     * @param {ActionContext} context - Action context of dm-utils
     * @returns {Promise<{refresh: boolean}>} Nothing to reload
     */
    async showAllLinks(context) {
        if (!this.app.tabletServer) {
            await context.showMessage(DM_TEXTS.noServer);
            return { refresh: false };
        }
        /** @type {Record<string, ConfigItemAny>} */
        const items = {};
        (await this.app.tabletLinks()).forEach((l, i) => {
            items[`_h${i}`] = { type: 'header', text: l.name, size: 4, sm: 12 };
            Object.assign(items, linkItems(`t${i}_`, l.url));
        });
        await context.showForm({ type: 'panel', items }, { title: DM_TEXTS.tabletLinks, buttons: ['close'] });
        return { refresh: false };
    }

    /**
     * A control of a card was used: the state is written as a command, the adapter does the rest.
     *
     * @param {string} id - Full state id
     * @param {ControlState} val - New value
     * @param {number} [scale] - The control shows the state times this (100: a volume 0…1 as 0…100 %)
     * @returns {Promise<ioBroker.State>} The state afterwards, as the control shows it
     */
    async write(id, val, scale = 1) {
        const value = scale !== 1 && typeof val === 'number' ? Math.round(val) / scale : val;
        await this.app.setForeignStateAsync(id, { val: value, ack: false });
        return this.read(id, scale);
    }

    /**
     * @param {string} id - Full state id
     * @param {number} [scale] - The control shows the state times this
     * @returns {Promise<ioBroker.State>} The state as the control shows it, or an empty one
     */
    async read(id, scale = 1) {
        const now = Date.now();
        const state = (await this.app.getForeignStateAsync(id)) ?? {
            val: null,
            ack: true,
            ts: now,
            lc: now,
            from: '',
            q: 0,
        };
        if (scale !== 1 && typeof state.val === 'number') {
            return { ...state, val: Math.round(state.val * scale) };
        }
        return state;
    }
}

module.exports = { SatelliteDeviceManagement, cardOf, detailsOf, fill, FIRMWARE_WATCH };
