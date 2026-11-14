// The grid rules of the firmware (docs/TILES.md of the satellite firmware), the same as lib/layout.js of the adapter.

export const PAGES = 4;
export const SLOTS = 8;
export const COLS = 2;
export const ROWS = 4;

/**
 * Columns and rows of a page, pages, tiles a page holds (lib/layout.js Grid), and the screen the editor draws (w x h
 * in units of the satellite screen, 320 x 240)
 */
export interface Grid {
    cols: number;
    rows: number;
    pages: number;
    slots: number;
    w: number;
    h: number;
    /** Gap between the tiles and at the edges */
    gap: number;
    /** Where the first row starts: the gap on a satellite, below the bar with the name and the clock on a tablet */
    top: number;
    /** A tablet: CSS pixels of its real screen per unit of the editor (the web app sizes by CSS pixels) */
    css?: number;
}

/** A satellite: 2 x 4 cells, 4 pages, 8 tiles a page (the firmware), its screen 320 x 240 */
export const SATELLITE_GRID: Grid = {
    cols: COLS,
    rows: ROWS,
    pages: PAGES,
    slots: SLOTS,
    w: 320,
    h: 240,
    gap: 6,
    top: 6,
};

/** The longer side of a tablet in the editor (the satellite: 320) */
const TABLET_SIDE = 400;

/**
 * The screen of a tablet in the editor: the shape of its display as the settings give it (width x height in pixels;
 * landscape or portrait is the user's choice), a 4:3 landscape screen without them.
 */
function tabletScreen(
    width: unknown,
    height: unknown,
): { w: number; h: number; gap: number; top: number; css: number } {
    let pw = Number(width);
    let ph = Number(height);
    if (!(pw > 0 && ph > 0)) {
        pw = 1024;
        ph = 768;
    }
    const ratio = ph / pw;
    const w = ratio <= 1 ? TABLET_SIDE : Math.round(TABLET_SIDE / ratio);
    const h = ratio <= 1 ? Math.round(TABLET_SIDE * ratio) : TABLET_SIDE;
    // the web app sizes by CSS pixels: a screen given in device pixels (an iPad: 2048 x 1536) has two of them per CSS
    // pixel; the sizes of www/style.css have lower and upper limits in CSS pixels, so the preview needs them
    const cssW = Math.max(pw, ph) > 1400 ? pw / 2 : pw;
    const css = cssW / w;
    const vmin = Math.min(pw, ph) * (cssW / pw);
    const clamp = (lo: number, v: number, hi: number): number => Math.min(hi, Math.max(lo, v));
    // as www/style.css: the gap clamp(6px, 1.2vmin, 14px), the bar clamp(32px, 5.5vmin, 52px)
    return { w, h, gap: clamp(6, vmin * 0.012, 14) / css, top: clamp(32, vmin * 0.055, 52) / css, css };
}

/** A tablet: what its row says, within these limits (lib/layout.js TABLET_LIMITS, TABLET_DEFAULT) */
const TABLET_LIMITS = { cols: 8, rows: 8, pages: 8 };
const TABLET_DEFAULT = { cols: 4, rows: 3, pages: 4 };

function wholeIn(value: unknown, max: number, fallback: number): number {
    const n = value === '' || value === null || value === undefined ? NaN : Number(value);
    return Number.isInteger(n) && n >= 1 && n <= max ? n : fallback;
}

/** The grid of a row of the tablets table */
export function tabletGrid(row: {
    cols?: unknown;
    rows?: unknown;
    pages?: unknown;
    width?: unknown;
    height?: unknown;
}): Grid {
    const cols = wholeIn(row.cols, TABLET_LIMITS.cols, TABLET_DEFAULT.cols);
    const rows = wholeIn(row.rows, TABLET_LIMITS.rows, TABLET_DEFAULT.rows);
    return {
        cols,
        rows,
        pages: wholeIn(row.pages, TABLET_LIMITS.pages, TABLET_DEFAULT.pages),
        slots: cols * rows,
        ...tabletScreen(row.width, row.height),
    };
}

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
    /** Main colour and background "#RRGGBB", empty = the default */
    color?: string;
    background?: string;
    /** State that switches the background (or holds a colour), and the background while it is on */
    bgState?: string;
    bgColor?: string;
    /** The icon replaces the name */
    iconOnly?: boolean;
    /** A switch without its toggle (the whole tile switches); unset = the default of its size (showToggle) */
    hideToggle?: boolean;
}

/**
 * Whether a switch shows its toggle (lib/layout.js showToggleOf). A tablet has the room for the icon and the toggle
 * together, so there it keeps its toggle unless the editor hides it.
 */
export function showToggle(t: TileRow, tablet = false): boolean {
    if (t.type !== 'switch') {
        return true;
    }
    if (typeof t.hideToggle === 'boolean') {
        return !t.hideToggle;
    }
    return tablet || !((t.size === 's' || t.size === 'w') && !!t.icon && !t.iconOnly);
}

/** "#RRGGBB" (or "#RGB") of a colour field, '' when empty or no colour */
export function cssColor(value: unknown): string {
    const text = String(value ?? '').trim();
    if (/^#[0-9a-f]{6}$/i.test(text)) {
        return text;
    }
    const m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(text);
    return m ? `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}` : '';
}

/** The kinds that can turn red at a threshold (lib/layout.js ALERT_TYPES) */
export const ALERT_KINDS: Kind[] = ['value', 'gauge', 'bar', 'chart', 'thermostat'];

/** True when the value is beyond a threshold of the tile (lib/values.js alertColor) */
export function alerted(t: TileRow, value: number): boolean {
    if (!Number.isFinite(value) || !ALERT_KINDS.includes(t.type)) {
        return false;
    }
    const below =
        t.alertBelow === '' || t.alertBelow === null || t.alertBelow === undefined ? null : Number(t.alertBelow);
    const above =
        t.alertAbove === '' || t.alertAbove === null || t.alertAbove === undefined ? null : Number(t.alertAbove);
    return (below !== null && value < below) || (above !== null && value > above);
}

/** The sizes of a kind: a tablet draws every kind in every size, a satellite has those of its firmware (lib/layout.js) */
export function sizesOf(type: Kind, tablet = false): Size[] {
    if (!KINDS[type]) {
        return [];
    }
    return tablet ? ['s', 'q', 'w', 'l'] : KINDS[type];
}

/**
 * Why the adapter would leave this tile out (an i18n key), or '' when it is fine. A tile without a state is not
 * marked: it is being set up.
 */
export function problemOf(t: TileRow, tablet = false): string {
    if (!sizesOf(t.type, tablet).includes(t.size)) {
        return 'sd_bad_size';
    }
    if (t.type === 'thermostat' && !String(t.state2 || '').trim()) {
        return 'sd_need_target';
    }
    return '';
}

/** The object id part of a display name (lib/layout.js idOf) */
export function displayId(name: string): string {
    return (
        String(name || '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_-]+/g, '_')
            .replace(/^_+|_+$/g, '') || 'satellite'
    );
}

export function sameSatellite(a: string, b: string): boolean {
    return displayId(a) === displayId(b);
}

/** True when the size fits the grid at this cell */
export function inGrid(size: Size, col: number, row: number, grid: Grid): boolean {
    const [cols, rows] = SIZES[size];
    return col >= 0 && row >= 0 && col + cols <= grid.cols && row + rows <= grid.rows;
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
 * @param grid - Grid of the display
 */
export function fits(
    tiles: TileRow[],
    satellite: string,
    page: number,
    size: Size,
    col: number,
    row: number,
    skip: number | number[] = -1,
    grid: Grid,
): boolean {
    if (!inGrid(size, col, row, grid)) {
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
    grid: Grid,
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
        !fits(tiles, ta.satellite, page, ta.size, na.col, na.row, [a, b], grid) ||
        !fits(tiles, tb.satellite, page, tb.size, nb.col, nb.row, [a, b], grid) ||
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
    grid: Grid,
): { col: number; row: number } | null {
    for (let row = 0; row < grid.rows; row++) {
        for (let col = 0; col < grid.cols; col++) {
            if (fits(tiles, satellite, page, size, col, row, skip, grid)) {
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

/** Enabled tiles of a page beyond those the display takes (in the order of the list) */
export function tooMany(tiles: TileRow[], satellite: string, page: number, grid: Grid): number[] {
    const mine = tiles
        .map((t, i) => ({ t, i }))
        .filter(x => x.t.enabled !== false && sameSatellite(x.t.satellite, satellite) && Number(x.t.page) === page);
    return mine.slice(grid.slots).map(x => x.i);
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
