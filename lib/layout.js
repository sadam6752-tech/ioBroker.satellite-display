'use strict';

// The tile layout from the settings: the same rules as the firmware (docs/TILES.md of the satellite firmware),
// checked here so that a wrong row is reported in the log of the adapter and not only on the satellite.

const PAGES = 4;
const SLOTS = 8;

/** Cells (columns, rows) of each size */
const SIZES = { s: [1, 1], q: [1, 2], w: [2, 1], l: [2, 2] };

/** The sizes each type comes in */
const TYPES = {
    value: ['s', 'q', 'w', 'l'],
    gauge: ['q', 'l'],
    bar: ['s', 'q', 'w', 'l'],
    chart: ['s', 'w', 'l'],
    switch: ['s', 'q', 'w'],
    dimmer: ['w', 'l'],
    button: ['s', 'q', 'w'],
    thermostat: ['q', 'l'],
};

/** The types that can turn red at a threshold (they show a number) */
const ALERT_TYPES = ['value', 'gauge', 'bar', 'chart', 'thermostat'];

/** Step of the - / + buttons of a thermostat when none is set */
const DEFAULT_STEP = 0.5;

/** Icons the firmware has (components/tiles/tiles.cpp of the satellite firmware) */
const ICONS = [
    'lightbulb',
    'lamp',
    'ceiling-light',
    'power-plug',
    'power',
    'fan',
    'radiator',
    'thermometer',
    'water-percent',
    'flash',
    'solar-power',
    'battery',
    'window-closed',
    'window-open',
    'door',
    'garage',
    'blinds',
    'lock',
    'lock-open',
    'bell',
    'television',
    'movie',
    'music',
    'speaker',
    'coffee',
    'washing-machine',
    'dishwasher',
    'car',
    'home',
    'bed',
    'sofa',
    'shower',
    'weather-sunny',
    'weather-night',
    'alarm',
    'play',
    'pause',
    'stop',
    'check',
    'close',
];

/**
 * @typedef {object} SatelliteConfig
 * @property {string} id - Object id part (from the name)
 * @property {string} name - Name as entered
 * @property {string} host - IP address or host name
 * @property {number} port - Native API port
 * @property {string} encryptionKey - API encryption key, empty without encryption
 * @property {string} pinHash - SHA-256 of "satellite-display:" + PIN (hex), empty = no screen lock
 * @property {number} pinLength - Number of digits of the PIN, 0 without a lock
 */

/**
 * @typedef {object} Tile
 * @property {string} satellite - Id of the satellite
 * @property {number} row - Row of the settings table (1 = first), for messages
 * @property {number} page - Page 1..4
 * @property {number} slot - Slot 0..7 on the page
 * @property {number} gridCol - Column 0..1 of the top left cell
 * @property {number} gridRow - Row 0..3 of the top left cell
 * @property {string} size - s, q, w or l
 * @property {string} type - value, gauge, bar, chart, switch, dimmer, button or thermostat
 * @property {string} state - Bound state (the current temperature of a thermostat)
 * @property {string} state2 - On/off state of a dimmer (optional), target temperature of a thermostat
 * @property {string} state3 - Heating relay of a thermostat (optional)
 * @property {number} step - Step of the - / + buttons of a thermostat
 * @property {string} label - Name on the tile, empty = name of the object
 * @property {string} unit - Unit, empty = unit of the object
 * @property {string} icon - Icon name or empty
 * @property {number | null} decimals - Decimals, null = default
 * @property {number | null} min - Scale start, null = from the object
 * @property {number | null} max - Scale end, null = from the object
 * @property {number | null} alertBelow - The tile turns red below this value, null = never
 * @property {number | null} alertAbove - The tile turns red above this value, null = never
 * @property {number | null} color - Main colour of the tile 0xRRGGBB, null = the default of the settings
 * @property {number | null} background - Background 0xRRGGBB, null = the theme
 * @property {string} bgState - State that switches the background (or holds a colour "#RRGGBB"), empty = none
 * @property {number | null} bgColor - Background while bgState is on, null = none
 * @property {boolean} iconOnly - The icon replaces the name
 * @property {boolean} showToggle - A switch shows its toggle (else the whole tile is the switch)
 */

/** Prefix of the PIN before it is hashed; the firmware hashes the typed PIN the same way */
const PIN_PREFIX = 'satellite-display:';

/**
 * The screen lock of a satellite row: the hash of its PIN, or none when the lock is off or the PIN is no 4-6 digits.
 * The PIN itself does not leave ioBroker.
 *
 * @param {Record<string, unknown>} row - Row of the satellites table
 * @param {number} i - Its index, for messages
 * @param {string[]} problems - Collects what is wrong
 * @returns {{pinHash: string, pinLength: number}} The lock
 */
function lockOf(row, i, problems) {
    if (row.lockEnabled !== true) {
        return { pinHash: '', pinLength: 0 };
    }
    const pin = String(row.pin ?? '').trim();
    if (!/^\d{4,6}$/.test(pin)) {
        problems.push(`Satellite ${i + 1}: the PIN must have 4 to 6 digits, the screen lock stays off`);
        return { pinHash: '', pinLength: 0 };
    }
    const hash = require('node:crypto')
        .createHash('sha256')
        .update(PIN_PREFIX + pin, 'utf8')
        .digest('hex');
    return { pinHash: hash, pinLength: pin.length };
}

/**
 * @param {unknown} value - Colour of the settings, "#RRGGBB" (or "#RGB"), empty = none
 * @returns {number | null} The colour 0xRRGGBB, null when empty or no colour
 */
function colorOf(value) {
    const text = String(value ?? '').trim();
    let m = /^#?([0-9a-f]{6})$/i.exec(text);
    if (m) {
        return parseInt(m[1], 16);
    }
    m = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(text);
    if (m) {
        return parseInt(m[1] + m[1] + m[2] + m[2] + m[3] + m[3], 16);
    }
    return null;
}

/**
 * Whether a switch shows its toggle: as set in the editor, else without it on a small or wide switch with an icon
 * and a name (the tile is the switch) and with it otherwise.
 *
 * @param {Record<string, unknown>} row - Row of the tiles table
 * @param {string} type - Type of the tile
 * @param {string} size - Its size
 * @param {boolean} hasIcon - It has a known icon
 * @returns {boolean} True when the toggle is shown
 */
function showToggleOf(row, type, size, hasIcon) {
    if (type !== 'switch') {
        return true;
    }
    if (typeof row.hideToggle === 'boolean') {
        return !row.hideToggle;
    }
    return !((size === 's' || size === 'w') && hasIcon && row.iconOnly !== true);
}

/**
 * @param {string} name - Name as entered
 * @returns {string} Part of an object id
 */
function idOf(name) {
    return (
        String(name || '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_-]+/g, '_')
            .replace(/^_+|_+$/g, '') || 'satellite'
    );
}

/**
 * @param {unknown} value - Number field of the settings (may be empty)
 * @returns {number | null} The number, null when empty or not a number
 */
function numberOrNull(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

/**
 * @param {Record<string, unknown>[]} rows - Rows of the satellites table
 * @param {string[]} problems - Collects what is wrong
 * @returns {SatelliteConfig[]} The enabled satellites
 */
function normalizeSatellites(rows, problems) {
    /** @type {SatelliteConfig[]} */
    const result = [];
    const seen = new Set();
    for (const [i, row] of (Array.isArray(rows) ? rows : []).entries()) {
        if (!row || row.enabled === false) {
            continue;
        }
        const name = String(row.name || '').trim();
        const host = String(row.host || '').trim();
        if (!name || !host) {
            problems.push(`Satellite ${i + 1}: a name and an IP address are needed`);
            continue;
        }
        const id = idOf(name);
        if (seen.has(id)) {
            problems.push(`Satellite ${i + 1}: the name "${name}" is used twice`);
            continue;
        }
        seen.add(id);
        const port = numberOrNull(row.port);
        result.push({
            id,
            name,
            host,
            port: port && port > 0 && port < 65536 ? port : 6053,
            encryptionKey: String(row.encryptionKey || '').trim(),
            ...lockOf(row, i, problems),
        });
    }
    return result;
}

/**
 * Checks the tile rows and gives each tile its slot (in the order of the table, per satellite and page).
 *
 * @param {Record<string, unknown>[]} rows - Rows of the tiles table
 * @param {SatelliteConfig[]} satellites - Enabled satellites
 * @param {string[]} problems - Collects what is wrong
 * @returns {Tile[]} The tiles that fit
 */
function normalizeTiles(rows, satellites, problems) {
    /** @type {Tile[]} */
    const result = [];
    for (const [i, row] of (Array.isArray(rows) ? rows : []).entries()) {
        if (!row || row.enabled === false) {
            continue;
        }
        const where = `Tile ${i + 1}`;
        const satName = String(row.satellite || '').trim();
        const sat = satellites.find(s => s.id === idOf(satName));
        if (!sat) {
            problems.push(`${where}: no enabled satellite "${satName}"`);
            continue;
        }
        const page = numberOrNull(row.page);
        const gridCol = numberOrNull(row.col) ?? 0;
        const gridRow = numberOrNull(row.row) ?? 0;
        const size = String(row.size || '');
        const type = String(row.type || '');
        if (!page || page < 1 || page > PAGES || !Number.isInteger(page)) {
            problems.push(`${where}: the page must be 1 to ${PAGES}`);
            continue;
        }
        if (!TYPES[type]) {
            problems.push(`${where}: unknown type "${type}"`);
            continue;
        }
        if (!SIZES[size] || !TYPES[type].includes(size)) {
            problems.push(`${where}: a ${type} tile comes in the sizes ${TYPES[type].join(', ')}, not "${size}"`);
            continue;
        }
        const [cols, rowsUsed] = SIZES[size];
        if (gridCol < 0 || gridRow < 0 || gridCol + cols > 2 || gridRow + rowsUsed > 4) {
            problems.push(`${where}: does not fit the grid at column ${gridCol + 1}, row ${gridRow + 1}`);
            continue;
        }
        const samePage = result.filter(t => t.satellite === sat.id && t.page === page);
        const covered = samePage.find(t => {
            const [oc, or] = SIZES[t.size];
            return (
                gridCol < t.gridCol + oc &&
                t.gridCol < gridCol + cols &&
                gridRow < t.gridRow + or &&
                t.gridRow < gridRow + rowsUsed
            );
        });
        if (covered) {
            problems.push(`${where}: covers tile ${covered.row} on page ${page} of ${sat.name}`);
            continue;
        }
        if (samePage.length >= SLOTS) {
            problems.push(`${where}: page ${page} of ${sat.name} already has ${SLOTS} tiles`);
            continue;
        }
        const state = String(row.state || '').trim();
        if (!state) {
            problems.push(`${where}: no state chosen`);
            continue;
        }
        const state2 = type === 'dimmer' || type === 'thermostat' ? String(row.state2 || '').trim() : '';
        if (type === 'thermostat' && !state2) {
            problems.push(`${where}: a thermostat needs the state of its target temperature`);
            continue;
        }
        const step = numberOrNull(row.step);
        let icon = String(row.icon || '').trim();
        if (icon.startsWith('mdi:')) {
            icon = icon.slice(4);
        }
        if (icon && !ICONS.includes(icon)) {
            problems.push(`${where}: the firmware has no icon "${icon}", the tile shows none`);
            icon = '';
        }
        const decimals = numberOrNull(row.decimals);
        result.push({
            satellite: sat.id,
            row: i + 1,
            page,
            slot: samePage.length,
            gridCol,
            gridRow,
            size,
            type,
            state,
            state2,
            state3: type === 'thermostat' ? String(row.state3 || '').trim() : '',
            step: step !== null && step > 0 ? step : DEFAULT_STEP,
            label: String(row.label || '').trim(),
            unit: String(row.unit || '').trim(),
            icon,
            decimals: decimals === null ? null : Math.max(0, Math.min(3, Math.round(decimals))),
            min: numberOrNull(row.min),
            max: numberOrNull(row.max),
            alertBelow: ALERT_TYPES.includes(type) ? numberOrNull(row.alertBelow) : null,
            alertAbove: ALERT_TYPES.includes(type) ? numberOrNull(row.alertAbove) : null,
            color: colorOf(row.color),
            background: colorOf(row.background),
            bgState: String(row.bgState || '').trim(),
            bgColor: colorOf(row.bgColor),
            iconOnly: !!icon && type !== 'button' && row.iconOnly === true,
            showToggle: showToggleOf(row, type, size, !!icon),
        });
    }
    return result;
}

module.exports = {
    PAGES,
    SLOTS,
    SIZES,
    TYPES,
    ICONS,
    DEFAULT_STEP,
    ALERT_TYPES,
    colorOf,
    lockOf,
    PIN_PREFIX,
    idOf,
    numberOrNull,
    normalizeSatellites,
    normalizeTiles,
};
