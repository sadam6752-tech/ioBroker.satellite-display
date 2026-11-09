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
    bar: ['q', 'w', 'l'],
    chart: ['w', 'l'],
    switch: ['s', 'q', 'w'],
    dimmer: ['w', 'l'],
    button: ['s', 'q', 'w'],
};

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
 * @property {string} type - value, gauge, bar, chart, switch, dimmer or button
 * @property {string} state - Bound state
 * @property {string} state2 - On/off state of a dimmer (optional)
 * @property {string} label - Name on the tile, empty = name of the object
 * @property {string} unit - Unit, empty = unit of the object
 * @property {string} icon - Icon name or empty
 * @property {number | null} decimals - Decimals, null = default
 * @property {number | null} min - Scale start, null = from the object
 * @property {number | null} max - Scale end, null = from the object
 */

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
            state2: type === 'dimmer' ? String(row.state2 || '').trim() : '',
            label: String(row.label || '').trim(),
            unit: String(row.unit || '').trim(),
            icon,
            decimals: decimals === null ? null : Math.max(0, Math.min(3, Math.round(decimals))),
            min: numberOrNull(row.min),
            max: numberOrNull(row.max),
        });
    }
    return result;
}

module.exports = { PAGES, SLOTS, SIZES, TYPES, ICONS, idOf, numberOrNull, normalizeSatellites, normalizeTiles };
