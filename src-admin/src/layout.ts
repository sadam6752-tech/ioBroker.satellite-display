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
 * @param skip - Index of the row that moves (not counted)
 */
export function fits(
    tiles: TileRow[],
    satellite: string,
    page: number,
    size: Size,
    col: number,
    row: number,
    skip = -1,
): boolean {
    if (!inGrid(size, col, row)) {
        return false;
    }
    return !tiles.some(
        (t, i) =>
            i !== skip &&
            t.enabled !== false &&
            sameSatellite(t.satellite, satellite) &&
            Number(t.page) === page &&
            SIZES[t.size] &&
            overlaps(t, { size, col, row }),
    );
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
