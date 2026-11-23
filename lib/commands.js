'use strict';

// The commands that change the tiles (sendTo), e.g. from an AI agent such as ioBroker.pi-agent. Each answer is short
// JSON for a model: `ok` with what happened, or `error` with `ask` - what to ask the user - and the facts it needs.

const {
    SIZES,
    TYPES,
    ICONS,
    numberOrNull,
    normalizeDisplays,
    sizesOf,
    pageTitlesOf,
    TITLE_MAX,
    TABLET_TYPES,
} = require('./layout');
const {
    findDisplay,
    fits,
    pageFull,
    findPlace,
    freeCells,
    describeTiles,
    problemsOf,
    defaultSize,
    countOnPage,
} = require('./editing');

/** The commands this file answers */
const EDIT_COMMANDS = ['help', 'getTiles', 'addTile', 'updateTile', 'moveTile', 'removeTile', 'setPageTitle'];

/**
 * The commands for an agent with what they do, in the shape of the `help` answer of js-controller PR #3638 (as
 * telegram 6.5.0 answers it): `write: true` changes the tiles. The other messages of the adapter (preview, previewEnd,
 * tabletLinks, tabletPairCode, tabletNewKey) belong to its admin pages and are left out on purpose.
 */
const COMMANDS = [
    { command: 'help', write: false },
    { command: 'getTiles', write: false },
    { command: 'addTile', write: true },
    { command: 'updateTile', write: true },
    { command: 'moveTile', write: true },
    { command: 'removeTile', write: true },
    { command: 'setPageTitle', write: true },
];

/** Fields a command may set on a tile */
const FIELDS = [
    'type',
    'size',
    'state',
    'state2',
    'state3',
    'state4',
    'state5',
    'url',
    'nmea',
    'seamarks',
    'hours',
    'interval',
    'title',
    'label2',
    'label3',
    'label4',
    'unit2',
    'unit3',
    'unit4',
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

const HELP = `ioBroker.satellite-display: tile pages on the touch displays of ESPHome satellites and panels, and on
tablets (the web app of the adapter). "satellite" names any of these displays.
Each display has its own grid, getTiles lists it (grids): a satellite has pages 1-4 of 2 columns (col 0-1) x 4 rows
(row 0-3), at most 8 tiles a page; a tablet has the columns, rows and pages set for it.
Sizes: s = 1x1 (small, "narrow"), q = 1x2 (square, tall), w = 2x1 (wide), l = 2x2 (large), f = the whole page
(2x4 on a satellite: a thermostat only, satellite firmware 2.6.0; 4x3 on a tablet); on a satellite also t = 1x4
(one column over the whole page, row 0: a thermostat only, firmware 2.6.2); on a tablet also x = 3x2.
Kinds and their sizes on a satellite: ${Object.entries(TYPES)
    .map(([k, s]) => `${k} (${s.join(', ')})`)
    .join('; ')}. On a tablet every kind comes in every size.
- value, gauge, bar, chart: show a state. switch: on/off of a state, a touch toggles it. button: writes true.
- dimmer: state = level 0-100 (or the range of the object), state2 = its on/off (optional).
- thermostat: state = current temperature, state2 = target temperature (required), state3 = heating relay (optional).
  A tall thermostat (t) needs the satellite firmware 2.6.2, the whole page (f) 2.6.0.
- group: up to 4 values in one tile, e.g. the temperatures of three rooms: rows state, state2, state3, state4
  with their names label, label2, label3, label4 and units unit, unit2 ... (from the objects when left out);
  title = an optional heading. Tall sizes list the rows, flat ones put them side by side.
- level: a tank, state = fill level (e.g. %), state2 = the amount (e.g. litres, optional, unit2).
- battery: a battery symbol, state = charge in %, state2 = power (optional, charging when positive),
  state3 = charging on/off (optional, wins over the power).
- status: on/off of a state shown by its icon (lit while on) and a text; read-only, no touch.
  These four need the satellite firmware 2.4.0 (a tablet always has them).
Only on a tablet (a satellite cannot draw them):
- map: OpenStreetMap with the boat, its track and course. state = latitude, state2 = longitude (both required),
  state3 = course or heading in degrees, state4 = speed in knots (optional); nmea = an instance of ioBroker.nmea
  (e.g. nmea.0) for the AIS targets and the anchor circle; seamarks = true for the seamarks of OpenSeaMap;
  hours = length of the track (24); url = other tile servers ({z}/{x}/{y}). Best in size l, x or f.
- flow: the energy flow. state = solar power (W), state2 = battery power (W, positive = charging),
  state3 = grid or shore power (W, positive = taken), state4 = consumption (W, optional: computed),
  state5 = battery charge (%); label..label4 = other names for the four, title = heading.
- trend: a chart with axes over hours or days from the history adapter of the settings; up to 4 series
  state..state4 with label/unit like a group; hours = the period it opens with (24); the tablet switches it.
- camera: the picture of a camera. url = an http(s) picture (refreshed every interval seconds, default 5) or an
  MJPEG stream (interval = 0); or state = a state holding such an address. The address stays in ioBroker.
Icons: ${ICONS.join(', ')}.
Name and unit come from the object of the state when label/unit are left out.

Commands (sendTo satellite-display.0):
- getTiles {satellite?}: displays, their grids, their tiles (id, page, col, row, size, type, state, label, icon)
  and free cells.
- addTile {satellite, type, state, size?, icon?, label?, unit?, state2?, state3?, state4?, state5?, title?,
  label2-4?, unit2-4?, decimals?, min?, max?, alertBelow?, alertAbove?, color?, url?, nmea?, seamarks?, hours?,
  interval?, page?, col?, row?, iconOnly?}:
  without page/col/row the tile goes to the first free place. Answers the place it took.
- updateTile {id, ...fields}: change a tile (id from getTiles).
- moveTile {id, page, col?, row?}: move a tile; without col/row to the first free cell of that page.
- removeTile {id}: remove a tile.
- setPageTitle {satellite, page, title}: the title of a page of a tablet (e.g. "Heizung"), shown in its bar next to
  the name of the tablet; an empty title removes it. Satellites show no page titles.
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
 * @param {Record<string, unknown>[]} [ctx.tablets] - Rows of native.tablets
 * @param {boolean} [ctx.pwaEnabled] - The tablets are switched on
 * @param {Record<string, unknown>[]} ctx.tiles - Rows of native.tiles (current, also unsaved changes of commands)
 * @param {Record<string, unknown>} [ctx.pageTitles] - native.pageTitles (current, also unsaved changes)
 * @param {(id: string) => Promise<boolean>} ctx.stateExists - Whether a state object exists
 * @returns {Promise<{answer: Record<string, unknown> | string, tiles?: Record<string, unknown>[], pageTitles?:
 *   Record<string, unknown>}>} The answer, and the new tile list or page titles when they changed
 */
async function runCommand(command, msg, ctx) {
    const displays = normalizeDisplays(
        { satellites: ctx.satellites, tablets: ctx.tablets, pwaEnabled: ctx.pwaEnabled },
        [],
    );
    const names = displays.map(d => d.name);
    const rows = ctx.tiles.map(r => ({ ...r }));

    if (command === 'help') {
        return { answer: { help: HELP, commands: COMMANDS } };
    }

    /**
     * The display of the message; with only one configured it may be left out.
     *
     * @returns {{display?: import('./layout').SatelliteConfig, error?: Record<string, unknown>}} Display or error
     */
    const satelliteOf = () => {
        if (!names.length) {
            return { error: { error: 'no satellite configured', ask: 'Tell the user to add a satellite first.' } };
        }
        const given = String(msg.satellite ?? '').trim();
        if (!given) {
            if (displays.length === 1) {
                return { display: displays[0] };
            }
            return {
                error: {
                    error: 'which satellite?',
                    ask: 'Ask the user which satellite to use.',
                    satellites: names,
                },
            };
        }
        const display = findDisplay(displays, given);
        if (!display) {
            return {
                error: {
                    error: `no satellite "${given}"`,
                    ask: 'Ask the user which of these satellites is meant.',
                    satellites: names,
                },
            };
        }
        return { display };
    };

    /**
     * Pages with the number of their tiles, for "no room" answers.
     *
     * @param {import('./layout').SatelliteConfig} display - Display
     * @returns {Record<number, number>} Page → tiles
     */
    const pageCounts = display => {
        /** @type {Record<number, number>} */
        const counts = {};
        for (let p = 1; p <= display.grid.pages; p++) {
            counts[p] = countOnPage(rows, display, p);
        }
        return counts;
    };

    if (command === 'getTiles') {
        const given = String(msg.satellite ?? '').trim();
        const display = given ? findDisplay(displays, given) : null;
        if (given && !display) {
            return { answer: { error: `no satellite "${given}"`, satellites: names } };
        }
        const shown = display ? [display] : displays;
        /** @type {Record<string, unknown>} */
        const free = {};
        /** @type {Record<string, unknown>} */
        const grids = {};
        /** @type {Record<string, unknown>} */
        const titles = {};
        for (const d of shown) {
            free[d.name] = freeCells(rows, d);
            grids[d.name] = { kind: d.kind, cols: d.grid.cols, rows: d.grid.rows, pages: d.grid.pages };
            const t = pageTitlesOf(ctx.pageTitles, d);
            if (Object.keys(t).length) {
                titles[d.name] = t;
            }
        }
        return {
            answer: {
                satellites: names,
                grids,
                ...(Object.keys(titles).length ? { pageTitles: titles } : {}),
                tiles: describeTiles(rows, display),
                freeCells: free,
            },
        };
    }

    if (command === 'setPageTitle') {
        const sat = satelliteOf();
        if (sat.error) {
            return { answer: sat.error };
        }
        const display = /** @type {import('./layout').SatelliteConfig} */ (sat.display);
        if (display.kind !== 'tablet') {
            return {
                answer: {
                    error: `${display.name} is a satellite: its display shows no page titles`,
                    ask: 'Tell the user that only tablets show page titles.',
                },
            };
        }
        const page = numberOrNull(msg.page);
        if (page === null || !Number.isInteger(page) || page < 1 || page > display.grid.pages) {
            return { answer: { error: `the page must be 1 to ${display.grid.pages}` } };
        }
        const title = String(msg.title ?? '')
            .trim()
            .slice(0, TITLE_MAX);
        const all = { ...(ctx.pageTitles && typeof ctx.pageTitles === 'object' ? ctx.pageTitles : {}) };
        const mine = { ...Object(all[display.id]) };
        if (title) {
            mine[page] = title;
        } else {
            delete mine[page];
        }
        all[display.id] = mine;
        return { answer: { ok: true, satellite: display.name, page, title }, pageTitles: all };
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
        for (const key of ['state', 'state2', 'state3', 'state4', 'state5', 'bgState']) {
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
        const problems = problemsOf(rows, index, displays);
        return problems.length ? { error: problems.join('; ') } : null;
    };

    if (command === 'addTile') {
        const sat = satelliteOf();
        if (sat.error) {
            return { answer: sat.error };
        }
        const display = /** @type {import('./layout').SatelliteConfig} */ (sat.display);
        const { fields, error } = fieldsOf();
        if (error) {
            return { answer: error };
        }
        if (!fields.type) {
            return { answer: { error: 'type missing', types: Object.keys(TYPES) } };
        }
        const type = String(fields.type);
        if (!fields.state && !(type === 'camera' && fields.url)) {
            return { answer: { error: 'state missing', ask: 'Search the objects for the state the tile shows.' } };
        }
        if (TABLET_TYPES.includes(type) && display.kind !== 'tablet') {
            return { answer: { error: `a ${type} tile is drawn by tablets only, ${display.name} is a satellite` } };
        }
        if (type === 'map' && !fields.state2) {
            return { answer: { error: 'a map needs state = latitude and state2 = longitude' } };
        }
        const size = String(fields.size ?? defaultSize(type));
        const sizes = sizesOf(type, display.kind);
        if (!sizes.includes(size)) {
            return { answer: { error: `a ${type} tile comes in the sizes ${sizes.join(', ')}, not ${size}` } };
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
            if (!fits(rows, display, p, size, col, row) || pageFull(rows, display, p)) {
                return {
                    answer: {
                        error: `no room for a ${size} tile at col ${col}, row ${row} of page ${p}`,
                        ask: 'Tell the user and ask where else to put it, or what to remove.',
                        freeCells: freeCells(rows, display),
                    },
                };
            }
            place = { page: p, col, row };
        } else {
            place = findPlace(rows, display, size, page);
        }
        if (!place) {
            return {
                answer: {
                    error: page
                        ? `no room for a ${size} tile on page ${page}`
                        : `no room for a ${size} tile on any page`,
                    ask: 'Tell the user which pages are full and ask what to remove, or try a smaller size.',
                    tilesPerPage: pageCounts(display),
                    freeCells: freeCells(rows, display),
                },
            };
        }
        rows.push({ enabled: true, satellite: display.name, ...fields, type, size, ...place });
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

    if (command === 'removeTile') {
        const removed = describeTiles(rows, null)[index];
        rows.splice(index, 1);
        return { answer: { ok: true, removed, note: 'the ids of the tiles after it went down by one' }, tiles: rows };
    }

    const display = findDisplay(displays, tile.satellite);
    if (!display) {
        return {
            answer: {
                error: `the tile is on "${String(tile.satellite ?? '')}", which is not an enabled display`,
                ask: 'Tell the user to enable it in the settings first, or remove the tile.',
                satellites: names,
            },
        };
    }

    if (command === 'moveTile' || command === 'updateTile') {
        const { fields, error } = fieldsOf();
        if (error) {
            return { answer: error };
        }
        const merged = { ...tile, ...fields };
        const type = String(merged.type);
        const size = String(merged.size);
        if (!sizesOf(type, display.kind).includes(size)) {
            return { answer: { error: `a ${type} tile comes in the sizes ${sizesOf(type, display.kind).join(', ')}` } };
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
            const place = findPlace(rows, display, size, page, [index]);
            if (!place) {
                return {
                    answer: {
                        error: `no room on page ${page}`,
                        ask: 'Tell the user and ask for another page or what to remove.',
                        freeCells: freeCells(rows, display),
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
        if (!fits(rows, display, target.page, size, target.col, target.row, [index])) {
            return {
                answer: {
                    error: `the tile does not fit at col ${target.col}, row ${target.row} of page ${target.page}`,
                    ask: 'Ask the user where else to put it.',
                    freeCells: freeCells(rows, display),
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

module.exports = { EDIT_COMMANDS, COMMANDS, HELP, runCommand };
