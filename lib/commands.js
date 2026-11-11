'use strict';

// The commands that change the tiles (sendTo), e.g. from an AI agent such as ioBroker.pi-agent. Each answer is short
// JSON for a model: `ok` with what happened, or `error` with `ask` - what to ask the user - and the facts it needs.

const { PAGES, SIZES, TYPES, ICONS, numberOrNull } = require('./layout');
const {
    satelliteNames,
    findSatellite,
    fits,
    findPlace,
    freeCells,
    describeTiles,
    problemsOf,
    defaultSize,
    countOnPage,
} = require('./editing');

/** The commands this file answers */
const EDIT_COMMANDS = ['help', 'getTiles', 'addTile', 'updateTile', 'moveTile', 'removeTile'];

/** Fields a command may set on a tile */
const FIELDS = [
    'type',
    'size',
    'state',
    'state2',
    'state3',
    'label',
    'unit',
    'icon',
    'iconOnly',
    'hideToggle',
    'decimals',
    'min',
    'max',
    'step',
    'alertBelow',
    'alertAbove',
    'color',
    'background',
    'bgState',
    'bgColor',
    'enabled',
];

const HELP = `ioBroker.satellite-display: tile pages on the touch displays of ESPHome satellites and panels.
Each satellite has pages 1-4; a page is a grid of 2 columns (col 0-1) x 4 rows (row 0-3), at most 8 tiles.
Sizes: s = 1x1 (small, "narrow"), q = 1x2 (square, tall), w = 2x1 (wide), l = 2x2 (large).
Kinds and their sizes: ${Object.entries(TYPES)
    .map(([k, s]) => `${k} (${s.join(', ')})`)
    .join('; ')}.
- value, gauge, bar, chart: show a state. switch: on/off of a state, a touch toggles it. button: writes true.
- dimmer: state = level 0-100 (or the range of the object), state2 = its on/off (optional).
- thermostat: state = current temperature, state2 = target temperature (required), state3 = heating relay (optional).
Icons: ${ICONS.join(', ')}.
Name and unit come from the object of the state when label/unit are left out.

Commands (sendTo satellite-display.0):
- getTiles {satellite?}: satellites, their tiles (id, page, col, row, size, type, state, label, icon) and free cells.
- addTile {satellite, type, state, size?, icon?, label?, unit?, state2?, state3?, page?, col?, row?, iconOnly?}:
  without page/col/row the tile goes to the first free place. Answers the place it took.
- updateTile {id, ...fields}: change a tile (id from getTiles).
- moveTile {id, page, col?, row?}: move a tile; without col/row to the first free cell of that page.
- removeTile {id}: remove a tile.
A change is saved in the settings and shown on the display at once (the adapter restarts, a few seconds;
a command without an answer in that time: send it again a few seconds later).

How to talk to the user:
- Find the state first (search the objects), e.g. the switch of the light in the living room.
- The satellite comes only from the user's current request. If it names none and there is more than one
  satellite, ask which one, also when an earlier tile of this conversation went to one: never reuse that.
  Leave "satellite" out rather than guess; the answer then lists them.
- If the answer is "no room", tell the user which pages are full and ask what to remove or where to put it.
- "Narrow" or "small" means size s; pick an icon that fits the device (ceiling-light, lightbulb, lamp for lights).
- Tell the user where the tile went (satellite, page, place).`;

/**
 * A command on the tile list.
 *
 * @param {string} command - Command
 * @param {Record<string, unknown>} msg - Its message
 * @param {object} ctx - What the commands need
 * @param {Record<string, unknown>[]} ctx.satellites - Rows of native.satellites
 * @param {Record<string, unknown>[]} ctx.tiles - Rows of native.tiles (current, also unsaved changes of commands)
 * @param {(id: string) => Promise<boolean>} ctx.stateExists - Whether a state object exists
 * @returns {Promise<{answer: Record<string, unknown> | string, tiles?: Record<string, unknown>[]}>} The answer, and
 *   the new tile list when it changed
 */
async function runCommand(command, msg, ctx) {
    const names = satelliteNames(ctx.satellites);
    const rows = ctx.tiles.map(r => ({ ...r }));

    if (command === 'help') {
        return { answer: HELP };
    }

    /**
     * The satellite of the message; with only one configured it may be left out.
     *
     * @returns {{name?: string, error?: Record<string, unknown>}} Name or error
     */
    const satelliteOf = () => {
        if (!names.length) {
            return { error: { error: 'no satellite configured', ask: 'Tell the user to add a satellite first.' } };
        }
        const given = String(msg.satellite ?? '').trim();
        if (!given) {
            if (names.length === 1) {
                return { name: names[0] };
            }
            return {
                error: {
                    error: 'which satellite?',
                    ask: 'Ask the user which satellite to use.',
                    satellites: names,
                },
            };
        }
        const name = findSatellite(ctx.satellites, given);
        if (!name) {
            return {
                error: {
                    error: `no satellite "${given}"`,
                    ask: 'Ask the user which of these satellites is meant.',
                    satellites: names,
                },
            };
        }
        return { name };
    };

    /**
     * Pages with the number of their tiles, for "no room" answers.
     *
     * @param {string} name - Satellite
     * @returns {Record<number, number>} Page → tiles
     */
    const pageCounts = name => {
        /** @type {Record<number, number>} */
        const counts = {};
        for (let p = 1; p <= PAGES; p++) {
            counts[p] = countOnPage(rows, name, p);
        }
        return counts;
    };

    if (command === 'getTiles') {
        const given = String(msg.satellite ?? '').trim();
        const name = given ? findSatellite(ctx.satellites, given) : null;
        if (given && !name) {
            return { answer: { error: `no satellite "${given}"`, satellites: names } };
        }
        const shown = name ? [name] : names;
        /** @type {Record<string, unknown>} */
        const free = {};
        for (const n of shown) {
            free[n] = freeCells(rows, n);
        }
        return { answer: { satellites: names, tiles: describeTiles(rows, name), freeCells: free } };
    }

    /**
     * The fields of the message that a tile takes, cleaned.
     *
     * @returns {{fields: Record<string, unknown>, error?: Record<string, unknown>}} Fields or error
     */
    const fieldsOf = () => {
        /** @type {Record<string, unknown>} */
        const fields = {};
        for (const key of FIELDS) {
            if (msg[key] !== undefined && msg[key] !== null) {
                fields[key] = typeof msg[key] === 'string' ? String(msg[key]).trim() : msg[key];
            }
        }
        if (typeof fields.icon === 'string') {
            fields.icon = fields.icon.replace(/^mdi:/, '');
            if (fields.icon && !ICONS.includes(String(fields.icon))) {
                return { fields, error: { error: `no icon "${fields.icon}"`, icons: ICONS } };
            }
        }
        if (fields.type !== undefined && !TYPES[String(fields.type)]) {
            return { fields, error: { error: `unknown type "${fields.type}"`, types: Object.keys(TYPES) } };
        }
        if (fields.size !== undefined && !SIZES[String(fields.size)]) {
            return { fields, error: { error: `unknown size "${fields.size}"`, sizes: Object.keys(SIZES) } };
        }
        return { fields };
    };

    /**
     * Checks the states of a tile.
     *
     * @param {Record<string, unknown>} tile - Row
     * @returns {Promise<Record<string, unknown> | null>} Error, or null
     */
    const checkStates = async tile => {
        for (const key of ['state', 'state2', 'state3', 'bgState']) {
            const id = String(tile[key] ?? '').trim();
            if (id && !(await ctx.stateExists(id))) {
                return { error: `the state "${id}" does not exist`, ask: 'Search the objects for the right state.' };
            }
        }
        return null;
    };

    /**
     * The final check of the changed list.
     *
     * @param {number} index - Changed row
     * @returns {Record<string, unknown> | null} Error, or null
     */
    const validate = index => {
        const problems = problemsOf(rows, index, ctx.satellites);
        return problems.length ? { error: problems.join('; ') } : null;
    };

    if (command === 'addTile') {
        const sat = satelliteOf();
        if (sat.error) {
            return { answer: sat.error };
        }
        const name = /** @type {string} */ (sat.name);
        const { fields, error } = fieldsOf();
        if (error) {
            return { answer: error };
        }
        if (!fields.type) {
            return { answer: { error: 'type missing', types: Object.keys(TYPES) } };
        }
        if (!fields.state) {
            return { answer: { error: 'state missing', ask: 'Search the objects for the state the tile shows.' } };
        }
        const type = String(fields.type);
        const size = String(fields.size ?? defaultSize(type));
        if (!TYPES[type].includes(size)) {
            return { answer: { error: `a ${type} tile comes in the sizes ${TYPES[type].join(', ')}, not ${size}` } };
        }
        if (type === 'thermostat' && !fields.state2) {
            return { answer: { error: 'a thermostat needs state2, the state of the target temperature' } };
        }
        const statesError = await checkStates(fields);
        if (statesError) {
            return { answer: statesError };
        }
        const page = numberOrNull(msg.page);
        const col = numberOrNull(msg.col);
        const row = numberOrNull(msg.row);
        let place;
        if (col !== null && row !== null) {
            const p = page ?? 1;
            if (!fits(rows, name, p, size, col, row) || countOnPage(rows, name, p) >= 8) {
                return {
                    answer: {
                        error: `no room for a ${size} tile at col ${col}, row ${row} of page ${p}`,
                        ask: 'Tell the user and ask where else to put it, or what to remove.',
                        freeCells: freeCells(rows, name),
                    },
                };
            }
            place = { page: p, col, row };
        } else {
            place = findPlace(rows, name, size, page);
        }
        if (!place) {
            return {
                answer: {
                    error: page
                        ? `no room for a ${size} tile on page ${page}`
                        : `no room for a ${size} tile on any page`,
                    ask: 'Tell the user which pages are full and ask what to remove, or try a smaller size.',
                    tilesPerPage: pageCounts(name),
                    freeCells: freeCells(rows, name),
                },
            };
        }
        rows.push({ enabled: true, satellite: name, ...fields, type, size, ...place });
        const invalid = validate(rows.length - 1);
        if (invalid) {
            return { answer: invalid };
        }
        return {
            answer: {
                ok: true,
                added: describeTiles(rows, null)[rows.length - 1],
                note: 'Next tile: ask the user which satellite unless the request names it.',
            },
            tiles: rows,
        };
    }

    // the commands on one tile
    const id = numberOrNull(msg.id);
    const index = id === null ? -1 : id - 1;
    if (!rows[index]) {
        return { answer: { error: `no tile with id ${msg.id}`, ask: 'Call getTiles to see the ids.' } };
    }
    const tile = rows[index];
    const name = String(tile.satellite ?? '');

    if (command === 'removeTile') {
        const removed = describeTiles(rows, null)[index];
        rows.splice(index, 1);
        return { answer: { ok: true, removed, note: 'the ids of the tiles after it went down by one' }, tiles: rows };
    }

    if (command === 'moveTile' || command === 'updateTile') {
        const { fields, error } = fieldsOf();
        if (error) {
            return { answer: error };
        }
        const merged = { ...tile, ...fields };
        const type = String(merged.type);
        const size = String(merged.size);
        if (!TYPES[type]?.includes(size)) {
            return { answer: { error: `a ${type} tile comes in the sizes ${(TYPES[type] ?? []).join(', ')}` } };
        }
        const statesError = await checkStates(fields);
        if (statesError) {
            return { answer: statesError };
        }
        const page = numberOrNull(msg.page) ?? numberOrNull(tile.page) ?? 1;
        let col = numberOrNull(msg.col);
        let row = numberOrNull(msg.row);
        const moving = command === 'moveTile' || msg.page !== undefined || col !== null || row !== null;
        if (moving && (col === null || row === null)) {
            const place = findPlace(rows, name, size, page, [index]);
            if (!place) {
                return {
                    answer: {
                        error: `no room on page ${page}`,
                        ask: 'Tell the user and ask for another page or what to remove.',
                        freeCells: freeCells(rows, name),
                    },
                };
            }
            ({ col, row } = place);
        }
        const target = {
            page,
            col: col ?? numberOrNull(tile.col) ?? 0,
            row: row ?? numberOrNull(tile.row) ?? 0,
        };
        if (!fits(rows, name, target.page, size, target.col, target.row, [index])) {
            return {
                answer: {
                    error: `the tile does not fit at col ${target.col}, row ${target.row} of page ${target.page}`,
                    ask: 'Ask the user where else to put it.',
                    freeCells: freeCells(rows, name),
                },
            };
        }
        rows[index] = { ...merged, ...target };
        const invalid = validate(index);
        if (invalid) {
            return { answer: invalid };
        }
        return { answer: { ok: true, tile: describeTiles(rows, null)[index] }, tiles: rows };
    }

    return { answer: { error: `unknown command "${command}"`, commands: EDIT_COMMANDS } };
}

module.exports = { EDIT_COMMANDS, HELP, runCommand };
