// The grid rules of the firmware (docs/TILES.md of the satellite firmware), the same as lib/layout.js of the adapter.

export const PAGES = 4;
export const SLOTS = 8;
export const COLS = 2;
export const ROWS = 4;

export type Size = 's' | 'q' | 'w' | 'l';
export type Kind = 'value' | 'gauge' | 'bar' | 'chart' | 'switch' | 'dimmer' | 'button' | 'thermostat';

/** Cells (columns, rows) of each size */
export const SIZES: Record<Size, [number, number]> = { s: [1, 1], q: [1, 2], w: [2, 1], l: [2, 2] };

/** The sizes each kind comes in */
export const KINDS: Record<Kind, Size[]> = {
    value: ['s', 'q', 'w', 'l'],
    gauge: ['q', 'l'],
    bar: ['s', 'q', 'w', 'l'],
    chart: ['s', 'w', 'l'],
    switch: ['s', 'q', 'w'],
    dimmer: ['w', 'l'],
    button: ['s', 'q', 'w'],
    thermostat: ['q', 'l'],
};

/** Icons the firmware has (components/tiles/tiles.cpp of the satellite firmware) */
export const ICONS = [
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

/** One row of native.tiles (the adapter reads the same fields) */
export interface TileRow {
    enabled: boolean;
    satellite: string;
    page: number;
    col: number;
    row: number;
    size: Size;
    type: Kind;
    state: string;
    state2: string;
    state3?: string;
    label: string;
    unit: string;
    icon: string;
    decimals: number | '' | null;
    min: number | '' | null;
    max: number | '' | null;
    step?: number | '' | null;
    /** The tile turns red below / above this value */
    alertBelow?: number | '' | null;
    alertAbove?: number | '' | null;
}

/** The kinds that can turn red at a threshold (lib/layout.js ALERT_TYPES) */
export const ALERT_KINDS: Kind[] = ['value', 'gauge', 'bar', 'chart', 'thermostat'];

/** True when the value is beyond a threshold of the tile (lib/values.js alertColor) */
export function alerted(t: TileRow, value: number): boolean {
    if (!Number.isFinite(value) || !ALERT_KINDS.includes(t.type)) {
        return false;
    }
    const below = t.alertBelow === '' || t.alertBelow === null || t.alertBelow === undefined ? null : Number(t.alertBelow);
    const above = t.alertAbove === '' || t.alertAbove === null || t.alertAbove === undefined ? null : Number(t.alertAbove);
    return (below !== null && value < below) || (above !== null && value > above);
}

/**
 * Why the adapter would leave this tile out (an i18n key), or '' when it is fine. A tile without a state is not
 * marked: it is being set up.
 */
export function problemOf(t: TileRow): string {
    if (!KINDS[t.type] || !KINDS[t.type].includes(t.size)) {
        return 'sd_bad_size';
    }
    if (t.type === 'thermostat' && !String(t.state2 || '').trim()) {
        return 'sd_need_target';
    }
    return '';
}

export function sameSatellite(a: string, b: string): boolean {
    const id = (s: string): string =>
        String(s || '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_-]+/g, '_')
            .replace(/^_+|_+$/g, '') || 'satellite';
    return id(a) === id(b);
}

/** True when the size fits the grid at this cell */
export function inGrid(size: Size, col: number, row: number): boolean {
    const [cols, rows] = SIZES[size];
    return col >= 0 && row >= 0 && col + cols <= COLS && row + rows <= ROWS;
}

function overlaps(a: Pick<TileRow, 'size' | 'col' | 'row'>, b: Pick<TileRow, 'size' | 'col' | 'row'>): boolean {
    const [ac, ar] = SIZES[a.size];
    const [bc, br] = SIZES[b.size];
    return a.col < b.col + bc && b.col < a.col + ac && a.row < b.row + br && b.row < a.row + ar;
}

/**
 * True when a tile of this size fits at this cell of the page, without covering another enabled tile.
 *
 * @param tiles - All rows
 * @param satellite - Satellite name
 * @param page - Page
 * @param size - Size
 * @param col - Column of the top left cell
 * @param row - Row of the top left cell
 * @param skip - Index (or indexes) of the rows that move (not counted)
 */
export function fits(
    tiles: TileRow[],
    satellite: string,
    page: number,
    size: Size,
    col: number,
    row: number,
    skip: number | number[] = -1,
): boolean {
    if (!inGrid(size, col, row)) {
        return false;
    }
    const skipped = Array.isArray(skip) ? skip : [skip];
    return !tiles.some(
        (t, i) =>
            !skipped.includes(i) &&
            t.enabled !== false &&
            sameSatellite(t.satellite, satellite) &&
            Number(t.page) === page &&
            SIZES[t.size] &&
            overlaps(t, { size, col, row }),
    );
}

/**
 * Two tiles of a page trade places (each takes the top left cell of the other). Null when one of them would leave
 * the grid, cover a third tile or the two would cover each other.
 */
export function swapPlaces(
    tiles: TileRow[],
    a: number,
    b: number,
): { a: { col: number; row: number }; b: { col: number; row: number } } | null {
    const ta = tiles[a];
    const tb = tiles[b];
    if (!ta || !tb || a === b || !SIZES[ta.size] || !SIZES[tb.size]) {
        return null;
    }
    const na = { col: tb.col, row: tb.row };
    const nb = { col: ta.col, row: ta.row };
    const page = Number(ta.page);
    if (
        !fits(tiles, ta.satellite, page, ta.size, na.col, na.row, [a, b]) ||
        !fits(tiles, tb.satellite, page, tb.size, nb.col, nb.row, [a, b]) ||
        overlaps({ size: ta.size, ...na }, { size: tb.size, ...nb })
    ) {
        return null;
    }
    return { a: na, b: nb };
}

/** The first cell where a tile of this size fits, or null */
export function freeCell(
    tiles: TileRow[],
    satellite: string,
    page: number,
    size: Size,
    skip = -1,
): { col: number; row: number } | null {
    for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
            if (fits(tiles, satellite, page, size, col, row, skip)) {
                return { col, row };
            }
        }
    }
    return null;
}

/** The index of the enabled tile that covers this cell, or -1 */
export function tileAt(tiles: TileRow[], satellite: string, page: number, col: number, row: number): number {
    return tiles.findIndex(
        t =>
            t.enabled !== false &&
            sameSatellite(t.satellite, satellite) &&
            Number(t.page) === page &&
            SIZES[t.size] &&
            overlaps(t, { size: 's', col, row }),
    );
}

/** Enabled tiles of a page beyond the eight the firmware takes (in the order of the list) */
export function tooMany(tiles: TileRow[], satellite: string, page: number): number[] {
    const mine = tiles
        .map((t, i) => ({ t, i }))
        .filter(x => x.t.enabled !== false && sameSatellite(x.t.satellite, satellite) && Number(x.t.page) === page);
    return mine.slice(SLOTS).map(x => x.i);
}

export function newTile(satellite: string, page: number, col: number, row: number): TileRow {
    return {
        enabled: true,
        satellite,
        page,
        col,
        row,
        size: 's',
        type: 'value',
        state: '',
        state2: '',
        state3: '',
        label: '',
        unit: '',
        icon: '',
        decimals: '',
        min: '',
        max: '',
        step: '',
    };
}
