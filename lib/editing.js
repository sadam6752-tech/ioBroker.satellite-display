'use strict';

// Changes of the tile list by commands (sendTo addTile, moveTile ...), e.g. from an AI agent: where a tile fits, what
// is free, and whether a changed list is still valid. Pure functions on the rows of native.tiles, the same rules as
// the editor of the admin (src-admin/src/layout.ts) and lib/layout.js.

const { PAGES, SLOTS, SIZES, TYPES, idOf, normalizeSatellites, normalizeTiles } = require('./layout');

/** Columns and rows of a page */
const COLS = 2;
const ROWS = 4;

/**
 * @typedef {Record<string, unknown>} Row - One row of native.tiles
 */

/**
 * The enabled satellites by name.
 *
 * @param {Record<string, unknown>[]} satRows - Rows of native.satellites
 * @returns {string[]} Their names
 */
function satelliteNames(satRows) {
    return normalizeSatellites(satRows, []).map(s => s.name);
}

/**
 * @param {Record<string, unknown>[]} satRows - Rows of native.satellites
 * @param {unknown} name - Name the user gave
 * @returns {string | null} The name as configured, null when there is no such enabled satellite
 */
function findSatellite(satRows, name) {
    const wanted = idOf(String(name ?? ''));
    if (!String(name ?? '').trim()) {
        return null;
    }
    return satelliteNames(satRows).find(n => idOf(n) === wanted) ?? null;
}

/**
 * @param {Row} r - Row
 * @param {string} satName - Satellite
 * @param {number} page - Page
 * @returns {boolean} The row is an enabled tile on that page
 */
function onPage(r, satName, page) {
    return r.enabled !== false && idOf(String(r.satellite ?? '')) === idOf(satName) && Number(r.page) === page;
}

/**
 * @param {Row} r - Row
 * @returns {[number, number] | null} Its cells (columns, rows), null for an unknown size
 */
function cellsOf(r) {
    return SIZES[String(r.size)] ?? null;
}

/**
 * True when a tile of this size fits at this cell of the page, without covering another enabled tile.
 *
 * @param {Row[]} rows - All rows
 * @param {string} satName - Satellite
 * @param {number} page - Page 1..4
 * @param {string} size - s, q, w or l
 * @param {number} col - Column of the top left cell
 * @param {number} row - Row of the top left cell
 * @param {number[]} [skip] - Indexes of rows that do not count (the one that moves)
 * @returns {boolean} It fits
 */
function fits(rows, satName, page, size, col, row, skip = []) {
    const [cols, rs] = SIZES[size] ?? [0, 0];
    if (!cols || col < 0 || row < 0 || col + cols > COLS || row + rs > ROWS) {
        return false;
    }
    return !rows.some((r, i) => {
        const c = cellsOf(r);
        if (skip.includes(i) || !c || !onPage(r, satName, page)) {
            return false;
        }
        const oc = Number(r.col) || 0;
        const or = Number(r.row) || 0;
        return col < oc + c[0] && oc < col + cols && row < or + c[1] && or < row + rs;
    });
}

/**
 * @param {Row[]} rows - All rows
 * @param {string} satName - Satellite
 * @param {number} page - Page
 * @param {number[]} [skip] - Rows that do not count
 * @returns {number} Enabled tiles on the page
 */
function countOnPage(rows, satName, page, skip = []) {
    return rows.filter((r, i) => !skip.includes(i) && onPage(r, satName, page)).length;
}

/**
 * The first place for a tile of this size: on the given page, else on the first page with room.
 *
 * @param {Row[]} rows - All rows
 * @param {string} satName - Satellite
 * @param {string} size - Size
 * @param {number | null} [page] - Only this page
 * @param {number[]} [skip] - Rows that do not count
 * @returns {{page: number, col: number, row: number} | null} The place, null when there is none
 */
function findPlace(rows, satName, size, page = null, skip = []) {
    const pages = page ? [page] : Array.from({ length: PAGES }, (_v, i) => i + 1);
    for (const p of pages) {
        if (countOnPage(rows, satName, p, skip) >= SLOTS) {
            continue;
        }
        for (let row = 0; row < ROWS; row++) {
            for (let col = 0; col < COLS; col++) {
                if (fits(rows, satName, p, size, col, row, skip)) {
                    return { page: p, col, row };
                }
            }
        }
    }
    return null;
}

/**
 * Free single cells of every page of a satellite, as "col,row" (0-based).
 *
 * @param {Row[]} rows - All rows
 * @param {string} satName - Satellite
 * @returns {Record<number, string[]>} Page → free cells
 */
function freeCells(rows, satName) {
    /** @type {Record<number, string[]>} */
    const free = {};
    for (let p = 1; p <= PAGES; p++) {
        free[p] = [];
        if (countOnPage(rows, satName, p) >= SLOTS) {
            continue;
        }
        for (let row = 0; row < ROWS; row++) {
            for (let col = 0; col < COLS; col++) {
                if (fits(rows, satName, p, 's', col, row)) {
                    free[p].push(`${col},${row}`);
                }
            }
        }
    }
    return free;
}

/**
 * The tiles as a command answer: id = position in the list, 1-based (it changes when a tile is removed).
 *
 * @param {Row[]} rows - All rows
 * @param {string | null} satName - Only this satellite
 * @returns {Record<string, unknown>[]} Tiles
 */
function describeTiles(rows, satName) {
    return rows
        .map((r, i) => ({ r, id: i + 1 }))
        .filter(({ r }) => !satName || idOf(String(r.satellite ?? '')) === idOf(satName))
        .map(({ r, id }) => {
            /** @type {Record<string, unknown>} */
            const t = {
                id,
                satellite: r.satellite,
                page: r.page,
                col: r.col,
                row: r.row,
                size: r.size,
                type: r.type,
                state: r.state,
            };
            for (const key of ['state2', 'state3', 'label', 'unit', 'icon']) {
                if (r[key]) {
                    t[key] = r[key];
                }
            }
            if (r.enabled === false) {
                t.enabled = false;
            }
            return t;
        });
}

/**
 * What is wrong with one row in the list (the same check as at the start of the adapter).
 *
 * @param {Row[]} rows - All rows
 * @param {number} index - Index of the row
 * @param {Record<string, unknown>[]} satRows - Rows of native.satellites
 * @returns {string[]} Problems of that row, without the "Tile N:" prefix
 */
function problemsOf(rows, index, satRows) {
    /** @type {string[]} */
    const problems = [];
    normalizeTiles(rows, normalizeSatellites(satRows, []), problems);
    const prefix = `Tile ${index + 1}: `;
    return problems.filter(p => p.startsWith(prefix)).map(p => p.slice(prefix.length));
}

/**
 * The size a tile gets when the request names none: the smallest its type comes in.
 *
 * @param {string} type - Type
 * @returns {string} Size
 */
function defaultSize(type) {
    const sizes = TYPES[type] ?? [];
    return ['s', 'q', 'w', 'l'].find(s => sizes.includes(s)) ?? 's';
}

module.exports = {
    COLS,
    ROWS,
    satelliteNames,
    findSatellite,
    fits,
    findPlace,
    freeCells,
    describeTiles,
    problemsOf,
    defaultSize,
    countOnPage,
};
