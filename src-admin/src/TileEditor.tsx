import React from 'react';

import {
    Box,
    Button,
    Checkbox,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControlLabel,
    IconButton,
    MenuItem,
    TextField,
    ToggleButton,
    ToggleButtonGroup,
    Tooltip,
    Typography,
} from '@mui/material';
import {
    Add as IconAdd,
    ContentCopy as IconCopy,
    Delete as IconDelete,
    Cast as IconCast,
    Close as IconClear,
    CastConnected as IconCastStop,
    FileCopy as IconCopyPage,
    ListAlt as IconPick,
    Undo as IconUndo,
} from '@mui/icons-material';

// from the package root, as the admin shares these modules
import { DialogSelectID, I18n } from '@iobroker/gui-components';
import { ConfigGeneric, type ConfigGenericProps, type ConfigGenericState } from '@iobroker/json-config';

import {
    COLS,
    ALERT_KINDS,
    ICONS,
    KINDS,
    PAGES,
    ROWS,
    alerted,
    cssColor,
    showToggle,
    SIZES,
    fits,
    freeCell,
    newTile,
    problemOf,
    sameSatellite,
    swapPlaces,
    tileAt,
    tooMany,
    type Kind,
    type Size,
    type TileRow,
} from './layout';
import { TileIcon } from './icons';

/** The line of a chart in the preview without a history */
const SAMPLE_LINE = [0, 0.6, 0.4, 0.7, 0.3, 0.5, 0.2, 0.45, 0.35];

/** The text that common.states of the object gives a value, as the adapter shows it (lib/values.js stateText) */
function stateTextOf(val: unknown, common: Partial<ioBroker.StateCommon> | null | undefined): string | null {
    let states: unknown = common?.states;
    if (val === null || val === undefined || !states) {
        return null;
    }
    if (typeof states === 'string') {
        const parsed: Record<string, string> = {};
        for (const part of states.split(';')) {
            const at = part.indexOf(':');
            if (at > 0) {
                parsed[part.slice(0, at).trim()] = part.slice(at + 1).trim();
            }
        }
        states = parsed;
    }
    if (Array.isArray(states) || typeof states !== 'object') {
        return null;
    }
    const text = (states as Record<string, unknown>)[String(val)];
    if (text === undefined || text === null || text === '') {
        return null;
    }
    if (typeof text === 'object') {
        const lang = I18n.getLanguage();
        const t = text as Record<string, string>;
        return (t[lang] || t.en || '').slice(0, 32) || null;
    }
    return String(text).slice(0, 32);
}

/** Changes kept for undo */
const UNDO_STEPS = 50;
/** Changes of the same field within this time are one undo step (typing a name) */
const UNDO_MERGE_MS = 1000;

/** The screen is 320 x 240; the preview is drawn this much bigger */
const SCALE = 1.5;
const px = (v: number): number => Math.round(v * SCALE);
const colX = (col: number): number => 6 + col * 157;
const rowY = (row: number): number => 6 + Math.floor((row * 117) / 2);

const KIND_KEYS: Record<Kind, string> = {
    value: 'sd_kind_value',
    gauge: 'sd_kind_gauge',
    bar: 'sd_kind_bar',
    chart: 'sd_kind_chart',
    switch: 'sd_kind_switch',
    dimmer: 'sd_kind_dimmer',
    button: 'sd_kind_button',
    thermostat: 'sd_kind_thermostat',
};
const SIZE_LABELS: Record<Size, string> = { s: '1 × 1', q: '1 × 2', w: '2 × 1', l: '2 × 2' };

type StateAttr = 'state' | 'state2' | 'state3' | 'bgState';

const COLOR = {
    screen: '#0B1118',
    tile: '#18212B',
    tileOn: '#0C4A6E',
    label: '#8A9AAC',
    accent: '#38BDF8',
    track: '#2E3A47',
    heatOn: '#4CAF50',
    heatOff: '#4B5563',
    alert: '#EF4444',
};

interface TileEditorState extends ConfigGenericState {
    satellite: string;
    page: number;
    selected: number;
    pickFor: StateAttr | null;
    dragging: number;
    /** Tile under the dragged one, and whether they can trade places */
    dropOn: { index: number; ok: boolean } | null;
    /** Content of a state field when it got the focus */
    typedFrom: string;
    /** Number of steps that can be undone */
    undoCount: number;
    /** The dialog "copy page": open, target satellite and page */
    copy: { satellite: string; page: number } | null;
    values: Record<string, ioBroker.StateValue | undefined>;
    names: Record<string, string>;
    units: Record<string, string>;
    /** Common part of the objects of the states (type, write, states) for the hints and the texts */
    commons: Record<string, Partial<ioBroker.StateCommon> | null>;
    /** Values of the history adapter for the chart tiles of the page, oldest first */
    histories: Record<string, number[]>;
    /** Preview on the satellite: running, and what the adapter answered */
    preview: { on: boolean; text: string; error: boolean };
}

class TileEditor extends ConfigGeneric<ConfigGenericProps, TileEditorState> {
    constructor(props: ConfigGenericProps) {
        super(props);
        this.state = {
            ...this.state,
            satellite: '',
            page: 1,
            selected: -1,
            pickFor: null,
            dragging: -1,
            dropOn: null,
            typedFrom: '',
            undoCount: 0,
            copy: null,
            values: {},
            names: {},
            units: {},
            commons: {},
            histories: {},
            preview: { on: false, text: '', error: false },
        };
    }

    /** Earlier versions of the tiles, newest last */
    private history: TileRow[][] = [];
    private lastChange = { key: '', ts: 0 };
    private root = React.createRef<HTMLDivElement>();

    private onKey = (e: KeyboardEvent): void => {
        if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.key.toLowerCase() !== 'z') {
            return;
        }
        // a text field undoes its own typing; the editor only while it is on screen
        const target = e.target as HTMLElement | null;
        if (target && (target.closest('input, textarea, [contenteditable="true"]') || target.closest('[role="dialog"]'))) {
            return;
        }
        if (!this.root.current || this.root.current.offsetParent === null || !this.history.length) {
            return;
        }
        e.preventDefault();
        this.undo();
    };

    componentWillUnmount(): void {
        window.removeEventListener('keydown', this.onKey);
        super.componentWillUnmount?.();
    }

    async componentDidMount(): Promise<void> {
        window.addEventListener('keydown', this.onKey);
        await super.componentDidMount();
        const names = this.satelliteNames();
        if (names.length) {
            this.setState({ satellite: names[0] }, () => void this.readStates());
        }
    }

    tiles(): TileRow[] {
        const tiles = ConfigGeneric.getValue(this.props.data, 'tiles');
        return Array.isArray(tiles) ? (tiles as TileRow[]) : [];
    }

    /** Satellites of the settings, then the names only tiles still use */
    satelliteNames(): string[] {
        const sats = ConfigGeneric.getValue(this.props.data, 'satellites');
        const names: string[] = (Array.isArray(sats) ? sats : [])
            .map((s: { name?: string }) => String(s?.name || '').trim())
            .filter(Boolean);
        for (const t of this.tiles()) {
            const name = String(t.satellite || '').trim();
            if (name && !names.some(n => sameSatellite(n, name))) {
                names.push(name);
            }
        }
        return names;
    }

    isConfigured(name: string): boolean {
        const sats = ConfigGeneric.getValue(this.props.data, 'satellites');
        return (Array.isArray(sats) ? sats : []).some((s: { name?: string }) => sameSatellite(s?.name || '', name));
    }

    /**
     * @param mergeKey - Changes with the same key in quick succession (typing) are one undo step
     */
    setTiles(tiles: TileRow[], selected = this.state.selected, mergeKey = ''): void {
        const now = Date.now();
        const merge = !!mergeKey && mergeKey === this.lastChange.key && now - this.lastChange.ts < UNDO_MERGE_MS;
        if (!merge) {
            this.history.push(this.tiles());
            if (this.history.length > UNDO_STEPS) {
                this.history.shift();
            }
        }
        this.lastChange = { key: mergeKey, ts: now };
        this.setState({ selected, undoCount: this.history.length }, () =>
            void this.onChange('tiles', tiles, () => void this.readStates()),
        );
    }

    update(index: number, change: Partial<TileRow>): void {
        const tiles = this.tiles().map((t, i) => (i === index ? { ...t, ...change } : t));
        this.setTiles(tiles, this.state.selected, `${index}:${Object.keys(change).sort().join(',')}`);
    }

    /** Back to the tiles before the last change */
    undo(): void {
        const previous = this.history.pop();
        if (!previous) {
            return;
        }
        this.lastChange = { key: '', ts: 0 };
        const selected = this.state.selected < previous.length ? this.state.selected : -1;
        this.setState({ selected, undoCount: this.history.length }, () =>
            void this.onChange('tiles', previous, () => void this.readStates()),
        );
    }

    /** The tiles of a page of a satellite (also the inactive ones) */
    tilesOf(satellite: string, page: number): number[] {
        return this.tiles()
            .map((t, i) => ({ t, i }))
            .filter(x => sameSatellite(x.t.satellite, satellite) && Number(x.t.page) === page)
            .map(x => x.i);
    }

    /** Copies the visible page to the page of the dialog; the tiles that were there are replaced */
    copyPage(): void {
        const copy = this.state.copy;
        if (!copy) {
            return;
        }
        const source = new Set(this.tilesOf(this.state.satellite, this.state.page));
        const replaced = new Set(this.tilesOf(copy.satellite, copy.page));
        const copies = this.tiles()
            .filter((_t, i) => source.has(i))
            .map(t => ({ ...t, satellite: copy.satellite, page: copy.page }));
        const tiles = [...this.tiles().filter((_t, i) => !replaced.has(i)), ...copies];
        this.setTiles(tiles, -1);
        this.setState({ copy: null, satellite: copy.satellite, page: copy.page });
    }

    renderCopyDialog(names: string[]): React.JSX.Element | null {
        const copy = this.state.copy;
        if (!copy) {
            return null;
        }
        const same = sameSatellite(copy.satellite, this.state.satellite) && copy.page === this.state.page;
        const replaced = same ? 0 : this.tilesOf(copy.satellite, copy.page).length;
        return (
            <Dialog
                open
                onClose={() => this.setState({ copy: null })}
            >
                <DialogTitle>{I18n.t('sd_copy_page_title', this.state.page)}</DialogTitle>
                <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 320 }}>
                    <TextField
                        select
                        variant="standard"
                        label={I18n.t('sd_target_satellite')}
                        value={copy.satellite}
                        onChange={e => this.setState({ copy: { ...copy, satellite: e.target.value } })}
                    >
                        {names.map(n => (
                            <MenuItem
                                key={n}
                                value={n}
                            >
                                {n}
                            </MenuItem>
                        ))}
                    </TextField>
                    <TextField
                        select
                        variant="standard"
                        label={I18n.t('sd_target_page')}
                        value={copy.page}
                        onChange={e => this.setState({ copy: { ...copy, page: Number(e.target.value) } })}
                    >
                        {Array.from({ length: PAGES }, (_v, i) => i + 1).map(p => (
                            <MenuItem
                                key={p}
                                value={p}
                            >
                                {p}
                            </MenuItem>
                        ))}
                    </TextField>
                    {replaced ? (
                        <Typography
                            variant="body2"
                            color="warning.main"
                        >
                            {I18n.t('sd_copy_replace', replaced)}
                        </Typography>
                    ) : null}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => this.setState({ copy: null })}>{I18n.t('sd_cancel')}</Button>
                    <Button
                        variant="contained"
                        disabled={same}
                        onClick={() => this.copyPage()}
                    >
                        {I18n.t('sd_copy')}
                    </Button>
                </DialogActions>
            </Dialog>
        );
    }

    /** Current values and names of the states of the visible page, for the preview */
    async readStates(): Promise<void> {
        const socket = this.props.oContext.socket;
        const ids = new Set<string>();
        for (const t of this.pageTiles()) {
            for (const id of [t.tile.state, t.tile.state2, t.tile.state3, t.tile.bgState || '']) {
                if (id && !(id in this.state.values)) {
                    ids.add(id);
                }
            }
        }
        if (!ids.size) {
            await this.readHistories();
            return;
        }
        const values: Record<string, ioBroker.StateValue | undefined> = {};
        const names: Record<string, string> = {};
        const units: Record<string, string> = {};
        const commons: Record<string, Partial<ioBroker.StateCommon> | null> = {};
        for (const id of ids) {
            try {
                const state = await socket.getState(id);
                values[id] = state?.val;
                const info = await this.readObject(id);
                names[id] = info.name;
                units[id] = info.unit;
                commons[id] = info.common;
            } catch {
                values[id] = undefined;
            }
        }
        this.setState(s => ({
            values: { ...s.values, ...values },
            names: { ...s.names, ...names },
            units: { ...s.units, ...units },
            commons: { ...s.commons, ...commons },
        }));
        await this.readHistories();
    }

    /** The history of the chart tiles of the page from the history adapter of the settings (as the satellite gets it) */
    async readHistories(): Promise<void> {
        const instance = String(ConfigGeneric.getValue(this.props.data, 'historyInstance') || '').trim();
        if (!instance) {
            return;
        }
        const hours = Number(ConfigGeneric.getValue(this.props.data, 'chartHours')) || 24;
        const end = Date.now();
        const histories: Record<string, number[]> = {};
        for (const { tile } of this.pageTiles()) {
            if (tile.type !== 'chart' || !tile.state || tile.state in this.state.histories) {
                continue;
            }
            try {
                const rows = await this.props.oContext.socket.getHistory(tile.state, {
                    instance,
                    start: end - hours * 3600_000,
                    end,
                    aggregate: 'average',
                    count: 30,
                    ignoreNull: true,
                    removeBorderValues: true,
                } as ioBroker.GetHistoryOptions);
                histories[tile.state] = (Array.isArray(rows) ? rows : [])
                    .map(r => Number(r?.val))
                    .filter(v => Number.isFinite(v));
            } catch {
                histories[tile.state] = [];
            }
        }
        if (Object.keys(histories).length) {
            this.setState(s => ({ histories: { ...s.histories, ...histories } }));
        }
    }

    /**
     * The line of a chart in the preview: its history (0 = top, 1 = bottom), else a sample line.
     *
     * @returns The points and whether they are real
     */
    chartLine(t: TileRow): { points: number[]; real: boolean } {
        const data = this.state.histories[t.state] || [];
        if (data.length < 2) {
            return { points: SAMPLE_LINE, real: false };
        }
        let lo = t.min === '' || t.min === null ? Number.NaN : Number(t.min);
        let hi = t.max === '' || t.max === null ? Number.NaN : Number(t.max);
        if (!(hi > lo)) {
            lo = Math.min(...data);
            hi = Math.max(...data);
        }
        if (hi - lo < 1e-6) {
            lo -= 1;
            hi += 1;
        }
        return {
            points: data.map(v => 1 - (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)),
            real: true,
        };
    }

    /** Sends the tiles of the satellite as they are in the editor (not saved) to the satellite */
    async showOnSatellite(end = false): Promise<void> {
        const { adapterName, instance, socket } = this.props.oContext;
        const target = `${adapterName}.${instance}`;
        const satellite = this.state.satellite;
        const tiles = this.tiles().filter(t => sameSatellite(t.satellite, satellite));
        try {
            const answer = await Promise.race([
                socket.sendTo(target, end ? 'previewEnd' : 'preview', { satellite, tiles }),
                new Promise((_resolve, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
            ]);
            const a = (answer || {}) as { error?: string; tiles?: number; problems?: string[]; connected?: boolean };
            if (a.error) {
                this.setState({ preview: { on: false, text: I18n.t('sd_preview_not_saved'), error: true } });
            } else if (end) {
                this.setState({ preview: { on: false, text: I18n.t('sd_preview_ended'), error: false } });
            } else {
                const problems = a.problems?.length ? ` ${a.problems.join('; ')}` : '';
                this.setState({
                    preview: {
                        on: true,
                        text: `${I18n.t(a.connected ? 'sd_preview_shown' : 'sd_preview_waiting', a.tiles ?? 0)}${problems}`,
                        error: !!problems,
                    },
                });
            }
        } catch {
            this.setState({ preview: { on: false, text: I18n.t('sd_preview_no_adapter'), error: true } });
        }
    }

    /**
     * What may not work as meant with the states of a tile (i18n keys): a state that does not exist, a touch on a
     * read-only state, a number tile on a state that is no number.
     */
    hintsOf(t: TileRow): string[] {
        const hints: string[] = [];
        const common = (id: string): Partial<ioBroker.StateCommon> | null | undefined =>
            id ? this.state.commons[id] : undefined;
        for (const id of [t.state, t.state2, t.state3]) {
            if (id && common(id) === null) {
                hints.push('sd_hint_missing');
                break;
            }
        }
        const written =
            t.type === 'switch' || t.type === 'button' || t.type === 'dimmer'
                ? [t.state, t.type === 'dimmer' ? t.state2 : '']
                : t.type === 'thermostat'
                  ? [t.state2]
                  : [];
        if (written.some(id => common(id)?.write === false)) {
            hints.push('sd_hint_read_only');
        }
        const numeric =
            t.type === 'gauge' || t.type === 'bar' || t.type === 'chart' || t.type === 'dimmer' || t.type === 'thermostat';
        const type = common(t.state)?.type;
        if (numeric && type && type !== 'number' && type !== 'mixed') {
            hints.push('sd_hint_not_number');
        }
        return hints;
    }

    /** Name (in the language of the admin) and unit of the object of a state */
    async readObject(id: string): Promise<{ name: string; unit: string; common: Partial<ioBroker.StateCommon> | null }> {
        const lang = I18n.getLanguage();
        const obj = await this.props.oContext.socket.getObject(id);
        const name = obj?.common?.name;
        const unit = (obj?.common as { unit?: string } | undefined)?.unit;
        return {
            name: typeof name === 'object' && name ? name[lang] || name.en || '' : String(name || ''),
            unit: typeof unit === 'string' ? unit : '',
            common: obj ? (obj.common as Partial<ioBroker.StateCommon>) : null,
        };
    }

    /**
     * A state was chosen: the name and the unit of its object go into the fields, unless the user wrote their own
     * (a field that still holds what the previous state brought is replaced). One update for all fields.
     *
     * @param old - The state before (its name and unit count as not written by the user)
     */
    async takeState(index: number, attr: StateAttr, id: string, old: string): Promise<void> {
        let info: { name: string; unit: string; common: Partial<ioBroker.StateCommon> | null } = {
            name: '',
            unit: '',
            common: null,
        };
        try {
            info = await this.readObject(id);
        } catch {
            // the id alone
        }
        const t = this.tiles()[index];
        if (!t) {
            return;
        }
        const change: Partial<TileRow> = { [attr]: id };
        const autoName = !t.label || t.label === (this.state.names[old] || '');
        const autoUnit = !t.unit || t.unit === (this.state.units[old] || '');
        // the name of a tile comes from its main state; a thermostat takes the unit of its target when it has none
        if (attr === 'state' && autoName && info.name) {
            change.label = info.name.slice(0, 24);
        }
        if (info.unit && ((attr === 'state' && autoUnit) || (attr === 'state2' && t.type === 'thermostat' && !t.unit))) {
            change.unit = info.unit.slice(0, 8);
        }
        this.setState(s => ({
            names: { ...s.names, [id]: info.name },
            units: { ...s.units, [id]: info.unit },
            commons: { ...s.commons, [id]: info.common },
        }));
        this.update(index, change);
    }

    pageTiles(): { tile: TileRow; index: number }[] {
        return this.tiles()
            .map((tile, index) => ({ tile, index }))
            .filter(
                x =>
                    x.tile.enabled !== false &&
                    sameSatellite(x.tile.satellite, this.state.satellite) &&
                    Number(x.tile.page) === this.state.page &&
                    !!SIZES[x.tile.size],
            );
    }

    addAt(col: number, row: number): void {
        const tiles = [...this.tiles(), newTile(this.state.satellite, this.state.page, col, row)];
        this.setTiles(tiles, tiles.length - 1);
    }

    /** The cell of the screen under the pointer */
    cellAt(e: React.DragEvent<HTMLDivElement>): { col: number; row: number } {
        const box = e.currentTarget.getBoundingClientRect();
        return {
            col: Math.min(COLS - 1, Math.max(0, Math.floor((e.clientX - box.left) / px(157)))),
            row: Math.min(ROWS - 1, Math.max(0, Math.floor((e.clientY - box.top) / px(58.5)))),
        };
    }

    /** The other tile under the pointer while a tile is dragged, or -1 */
    dropTarget(e: React.DragEvent<HTMLDivElement>): number {
        const from = this.state.dragging;
        if (from === -1) {
            return -1;
        }
        const { col, row } = this.cellAt(e);
        const target = tileAt(this.tiles(), this.state.satellite, this.state.page, col, row);
        return target === from ? -1 : target;
    }

    onScreenDragOver(e: React.DragEvent<HTMLDivElement>): void {
        if (this.state.dragging === -1) {
            return;
        }
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const target = this.dropTarget(e);
        const current = this.state.dropOn;
        if (target === -1) {
            if (current) {
                this.setState({ dropOn: null });
            }
        } else if (current?.index !== target) {
            this.setState({ dropOn: { index: target, ok: !!swapPlaces(this.tiles(), this.state.dragging, target) } });
        }
    }

    /** On another tile: the two trade places; on a free cell (or on itself): the tile moves there */
    onScreenDrop(e: React.DragEvent<HTMLDivElement>): void {
        const from = this.state.dragging;
        if (from === -1) {
            return;
        }
        e.preventDefault();
        const target = this.dropTarget(e);
        this.setState({ dropOn: null, dragging: -1 });
        if (target !== -1) {
            this.swapWith(target, from);
        } else {
            const { col, row } = this.cellAt(e);
            this.moveTo(from, col, row);
        }
    }

    /** The dragged tile and the one it was dropped on trade places */
    swapWith(target: number, from: number): void {
        const places = swapPlaces(this.tiles(), from, target);
        if (places) {
            const tiles = this.tiles().map((t, i) =>
                i === from ? { ...t, ...places.a } : i === target ? { ...t, ...places.b } : t,
            );
            this.setTiles(tiles, from);
        }
    }

    moveTo(index: number, col: number, row: number): void {
        const t = this.tiles()[index];
        if (t && fits(this.tiles(), this.state.satellite, this.state.page, t.size, col, row, index)) {
            this.update(index, { col, row });
        }
    }

    /** Where a copy of the tile goes: the first free cell of its page, else of the next pages; null when full */
    copyPlace(index: number): { page: number; col: number; row: number } | null {
        const t = this.tiles()[index];
        if (!t) {
            return null;
        }
        const first = Number(t.page);
        for (let i = 0; i < PAGES; i++) {
            const page = ((first - 1 + i) % PAGES) + 1;
            const cell = freeCell(this.tiles(), t.satellite, page, t.size);
            if (cell && tooMany(this.tiles(), t.satellite, page).length === 0) {
                const onPage = this.tiles().filter(
                    x => x.enabled !== false && sameSatellite(x.satellite, t.satellite) && Number(x.page) === page,
                ).length;
                if (onPage < 8) {
                    return { page, ...cell };
                }
            }
        }
        return null;
    }

    /** A copy of the tile, with the same states and settings, on the first free place; it is selected */
    duplicate(index: number): void {
        const place = this.copyPlace(index);
        if (!place) {
            return;
        }
        const tiles = [...this.tiles(), { ...this.tiles()[index], ...place }];
        this.setTiles(tiles, tiles.length - 1);
        this.setState({ page: place.page });
    }

    remove(index: number): void {
        this.setTiles(
            this.tiles().filter((_t, i) => i !== index),
            -1,
        );
    }

    changeKind(index: number, type: Kind): void {
        const t = this.tiles()[index];
        let { size, col, row } = t;
        if (!KINDS[type].includes(size)) {
            // the first size of the new kind that fits here or somewhere on the page
            const here = KINDS[type].find(s => fits(this.tiles(), t.satellite, Number(t.page), s, col, row, index));
            if (here) {
                size = here;
            } else {
                for (const s of KINDS[type]) {
                    const cell = freeCell(this.tiles(), t.satellite, Number(t.page), s, index);
                    if (cell) {
                        size = s;
                        ({ col, row } = cell);
                        break;
                    }
                }
            }
        }
        this.update(index, {
            type,
            size,
            col,
            row,
            state2: type === 'dimmer' || type === 'thermostat' ? t.state2 : '',
            state3: type === 'thermostat' ? t.state3 || '' : '',
        });
    }

    changePage(index: number, page: number): void {
        const t = this.tiles()[index];
        const cell = freeCell(this.tiles(), t.satellite, page, t.size, index);
        if (cell) {
            this.update(index, { page, ...cell });
            this.setState({ page });
        }
    }

    /** Main colour of a tile: its own, else the default of the settings, else the blue of the theme */
    accentOf(t: TileRow): string {
        return cssColor(t.color) || cssColor(ConfigGeneric.getValue(this.props.data, 'accentColor')) || COLOR.accent;
    }

    /** Background of a tile as the adapter sends it (lib/values.js backgroundOf) */
    backgroundOf(t: TileRow): string {
        const own = cssColor(t.background) || COLOR.tile;
        if (!t.bgState) {
            return own;
        }
        const val = this.state.values[t.bgState];
        if (typeof val === 'string' && cssColor(val)) {
            return cssColor(val);
        }
        const on = val === true || (typeof val === 'number' && val !== 0) || (typeof val === 'string' && ['on', 'true', '1'].includes(val.toLowerCase()));
        return on && cssColor(t.bgColor) ? cssColor(t.bgColor) : own;
    }

    /** True when the firmware shows the icon of this tile in front of (or instead of) the name */
    showsIcon(t: TileRow): boolean {
        return !!t.icon && t.type !== 'button' && t.size !== 'q';
    }

    /** A switch without its toggle: the whole tile switches and lights up */
    tileSwitch(t: TileRow): boolean {
        return t.type === 'switch' && !showToggle(t);
    }

    renderTileFace(t: TileRow, w: number, h: number): React.JSX.Element {
        const body = this.renderTileBody(t, w, h);
        if (!this.showsIcon(t)) {
            return body;
        }
        const value = this.state.values[t.state];
        const lit = this.tileSwitch(t) && (value === true || (typeof value === 'number' && value > 0));
        const icon = (
            <TileIcon
                name={t.icon}
                size={px(20)}
                color={lit ? this.accentOf(t) : COLOR.label}
            />
        );
        return (
            <div
                style={{
                    display: 'flex',
                    alignItems: t.size === 'l' ? 'flex-start' : 'center',
                    gap: px(6),
                    height: '100%',
                }}
            >
                {icon}
                <div style={{ flex: 1, minWidth: 0, height: '100%' }}>{body}</div>
            </div>
        );
    }

    renderTileBody(t: TileRow, w: number, h: number): React.JSX.Element {
        const value = this.state.values[t.state];
        const name = t.label || this.state.names[t.state] || t.state.split('.').pop() || I18n.t('sd_no_state');
        const num = typeof value === 'number' ? value : Number.NaN;
        const unit = t.unit && t.type !== 'dimmer' ? ` ${t.unit}` : '';
        const mapped = stateTextOf(value, this.state.commons[t.state]);
        const shown =
            mapped !== null
                ? mapped
                : value === undefined || value === null
                ? '–'
                : typeof value === 'number'
                  ? `${Number(value.toFixed(t.decimals === '' || t.decimals === null ? 1 : Number(t.decimals)))}${unit}`
                  : `${String(value)}${typeof value === 'boolean' ? '' : unit}`;
        const on =
            t.type === 'dimmer' && t.state2
                ? !!this.state.values[t.state2]
                : value === true || (typeof value === 'number' && value > 0);
        const line = t.type === 'chart' ? this.chartLine(t) : { points: SAMPLE_LINE, real: false };
        const lo = t.min === '' || t.min === null ? 0 : Number(t.min);
        const hi = t.max === '' || t.max === null ? 100 : Number(t.max);
        const frac = Number.isFinite(num) && hi > lo ? Math.max(0, Math.min(1, (num - lo) / (hi - lo))) : 0.5;
        const label = t.iconOnly && this.showsIcon(t) ? <span /> : (
            <div
                style={{
                    color: COLOR.label,
                    fontSize: px(10),
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                }}
            >
                {name}
            </div>
        );
        const big = h > px(60);
        const accent = alerted(t, num) ? COLOR.alert : this.accentOf(t);
        const own = cssColor(t.color) || cssColor(ConfigGeneric.getValue(this.props.data, 'accentColor'));
        const valueColor = alerted(t, num) ? COLOR.alert : own || undefined;
        const valueText = <div style={{ fontSize: big ? px(22) : px(14), color: valueColor }}>{shown}</div>;
        const toggle = (
            <div
                style={{
                    width: px(26),
                    height: px(14),
                    borderRadius: px(7),
                    background: on ? accent : COLOR.track,
                    position: 'relative',
                    flex: 'none',
                }}
            >
                <div
                    style={{
                        position: 'absolute',
                        top: px(2),
                        left: on ? px(14) : px(2),
                        width: px(10),
                        height: px(10),
                        borderRadius: '50%',
                        background: '#fff',
                    }}
                />
            </div>
        );
        const arc = (d: number, style: React.CSSProperties): React.JSX.Element => {
            const r = d / 2 - px(4);
            const len = Math.PI * 2 * r * 0.75;
            return (
                <svg
                    width={d}
                    height={d}
                    style={style}
                >
                    <circle
                        cx={d / 2}
                        cy={d / 2}
                        r={r}
                        fill="none"
                        stroke={COLOR.track}
                        strokeWidth={px(5)}
                        strokeDasharray={`${len} ${len * 2}`}
                        transform={`rotate(135 ${d / 2} ${d / 2})`}
                        strokeLinecap="round"
                    />
                    <circle
                        cx={d / 2}
                        cy={d / 2}
                        r={r}
                        fill="none"
                        stroke={accent}
                        strokeWidth={px(5)}
                        strokeDasharray={`${len * frac} ${len * 3}`}
                        transform={`rotate(135 ${d / 2} ${d / 2})`}
                        strokeLinecap="round"
                    />
                    <text
                        x={d / 2}
                        y={d / 2 + px(4)}
                        textAnchor="middle"
                        fill="#fff"
                        fontSize={px(11)}
                    >
                        {shown}
                    </text>
                </svg>
            );
        };
        switch (t.type) {
            case 'thermostat': {
                const target = this.state.values[t.state2];
                const step = Number(t.step) > 0 ? Number(t.step) : 0.5;
                const targetText =
                    typeof target === 'number'
                        ? `${target.toFixed(step < 1 ? 1 : 0)}${t.unit ? ` ${t.unit}` : ''}`
                        : '–';
                const relay = t.state3 ? this.state.values[t.state3] : undefined;
                const dot =
                    t.state3 && relay !== undefined && relay !== null ? (
                        <div
                            style={{
                                position: 'absolute',
                                right: px(6),
                                top: px(5),
                                width: px(10),
                                height: px(10),
                                borderRadius: '50%',
                                background: relay === true || Number(relay) > 0 ? COLOR.heatOn : COLOR.heatOff,
                            }}
                        />
                    ) : null;
                const stepRow = (
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            color: COLOR.label,
                            flex: 1,
                        }}
                    >
                        <span style={{ fontSize: px(18), fontWeight: 700 }}>−</span>
                        <span style={{ fontSize: t.size === 'l' ? px(22) : px(11), color: t.size === 'l' ? '#fff' : COLOR.label }}>
                            {targetText}
                        </span>
                        <span style={{ fontSize: px(18), fontWeight: 700 }}>+</span>
                    </div>
                );
                return t.size === 'l' ? (
                    <>
                        {dot}
                        {label}
                        <div style={{ display: 'flex', alignItems: 'center', gap: px(12) }}>
                            {arc(px(52), { display: 'block', flex: 'none' })}
                            {stepRow}
                        </div>
                    </>
                ) : (
                    <>
                        {dot}
                        {label}
                        {arc(px(46), { display: 'block', margin: '0 auto' })}
                        <div style={{ display: 'flex', marginTop: -px(4) }}>{stepRow}</div>
                    </>
                );
            }
            case 'gauge': {
                const d = px(56);
                const r = d / 2 - px(4);
                const len = Math.PI * 2 * r * 0.75;
                return (
                    <>
                        {label}
                        <svg
                            width={d}
                            height={d}
                            style={{ display: 'block', margin: `${px(2)}px auto 0` }}
                        >
                            <circle
                                cx={d / 2}
                                cy={d / 2}
                                r={r}
                                fill="none"
                                stroke={COLOR.track}
                                strokeWidth={px(5)}
                                strokeDasharray={`${len} ${len * 2}`}
                                transform={`rotate(135 ${d / 2} ${d / 2})`}
                                strokeLinecap="round"
                            />
                            <circle
                                cx={d / 2}
                                cy={d / 2}
                                r={r}
                                fill="none"
                                stroke={accent}
                                strokeWidth={px(5)}
                                strokeDasharray={`${len * frac} ${len * 3}`}
                                transform={`rotate(135 ${d / 2} ${d / 2})`}
                                strokeLinecap="round"
                            />
                            <text
                                x={d / 2}
                                y={d / 2 + px(4)}
                                textAnchor="middle"
                                fill="#fff"
                                fontSize={px(11)}
                            >
                                {shown}
                            </text>
                        </svg>
                    </>
                );
            }
            case 'bar':
            case 'chart':
                if (t.size === 's') {
                    return (
                        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: px(4) }}>
                                <div style={{ flex: 1, minWidth: 0 }}>{label}</div>
                                <div style={{ fontSize: px(14) }}>{shown}</div>
                            </div>
                            {t.type === 'bar' ? (
                                <div
                                    style={{
                                        height: px(4),
                                        background: COLOR.track,
                                        borderRadius: px(2),
                                        marginTop: 'auto',
                                        marginBottom: px(4),
                                    }}
                                >
                                    <div
                                        style={{
                                            width: `${frac * 100}%`,
                                            height: '100%',
                                            background: accent,
                                            borderRadius: px(2),
                                        }}
                                    />
                                </div>
                            ) : (
                                <svg
                                    width={w - px(16)}
                                    height={px(14)}
                                    style={{ display: 'block', marginTop: 'auto', marginBottom: px(2) }}
                                >
                                    <polyline
                                        fill="none"
                                        stroke={accent}
                                        strokeWidth={2}
                                        points={line.points
                                            .map((v, i, a) => `${(i * (w - px(16))) / (a.length - 1)},${v * px(14)}`)
                                            .join(' ')}
                                        opacity={line.real ? 1 : 0.5}
                                    />
                                </svg>
                            )}
                        </div>
                    );
                }
                if (t.type === 'chart') {
                    return (
                        <>
                            {label}
                            {valueText}
                            <svg
                                width={w - px(16)}
                                height={px(18)}
                                style={{ display: 'block' }}
                            >
                                <polyline
                                    fill="none"
                                    stroke={accent}
                                    strokeWidth={2}
                                    points={line.points
                                        .map((v, i, a) => `${(i * (w - px(16))) / (a.length - 1)},${v * px(18)}`)
                                        .join(' ')}
                                    opacity={line.real ? 1 : 0.5}
                                />
                            </svg>
                        </>
                    );
                }
                return (
                    <>
                        {label}
                        {valueText}
                        <div
                            style={{
                                height: px(5),
                                background: COLOR.track,
                                borderRadius: px(3),
                                marginTop: big ? px(14) : px(2),
                            }}
                        >
                            <div
                                style={{
                                    width: `${frac * 100}%`,
                                    height: '100%',
                                    background: accent,
                                    borderRadius: px(3),
                                }}
                            />
                        </div>
                    </>
                );
            case 'switch':
                return (
                    <div style={{ display: 'flex', alignItems: big ? 'flex-start' : 'center', gap: px(6), height: '100%', flexDirection: big ? 'column' : 'row', justifyContent: 'space-between' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>{label}</div>
                        {big ? (
                            // a square switch: its icon bottom left, the toggle bottom right
                            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', width: '100%' }}>
                                {t.icon ? (
                                    <TileIcon
                                        name={t.icon}
                                        size={px(20)}
                                        color={on ? this.accentOf(t) : COLOR.label}
                                    />
                                ) : (
                                    <span />
                                )}
                                {this.tileSwitch(t) ? null : toggle}
                            </div>
                        ) : this.tileSwitch(t) ? null : (
                            toggle
                        )}
                    </div>
                );
            case 'dimmer':
                return (
                    <div style={{ display: 'flex', alignItems: 'center', gap: px(6), height: '100%' }}>
                        <div style={{ width: px(40), minWidth: 0 }}>{label}</div>
                        {toggle}
                        <div style={{ flex: 1, height: px(5), background: COLOR.track, borderRadius: px(3) }}>
                            <div
                                style={{
                                    width: `${Number.isFinite(num) ? Math.max(0, Math.min(100, num)) : 50}%`,
                                    height: '100%',
                                    background: accent,
                                    borderRadius: px(3),
                                }}
                            />
                        </div>
                        <div style={{ fontSize: px(11), width: px(30), textAlign: 'right' }}>
                            {Number.isFinite(num) ? `${Math.round(num)} %` : '–'}
                        </div>
                    </div>
                );
            case 'button':
                return (
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            height: '100%',
                            gap: px(6),
                            flexDirection: big ? 'column' : 'row',
                        }}
                    >
                        {t.icon ? (
                            <TileIcon
                                name={t.icon}
                                size={px(20)}
                                color={accent}
                            />
                        ) : null}
                        <span style={{ fontSize: px(11) }}>{name}</span>
                    </div>
                );
            default:
                return h <= px(53) && w <= px(151) ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '100%' }}>
                        <div style={{ minWidth: 0, flex: 1 }}>{label}</div>
                        <div style={{ fontSize: px(13) }}>{shown}</div>
                    </div>
                ) : (
                    <>
                        {label}
                        {valueText}
                    </>
                );
        }
    }

    renderScreen(): React.JSX.Element {
        const tiles = this.tiles();
        const extra = new Set(tooMany(tiles, this.state.satellite, this.state.page));
        const cells: React.JSX.Element[] = [];
        for (let row = 0; row < ROWS; row++) {
            for (let col = 0; col < COLS; col++) {
                if (tileAt(tiles, this.state.satellite, this.state.page, col, row) !== -1) {
                    continue;
                }
                cells.push(
                    <Tooltip
                        key={`c${col}${row}`}
                        title={I18n.t('sd_add_here')}
                    >
                        <div
                            onClick={() => this.addAt(col, row)}
                            style={{
                                position: 'absolute',
                                left: px(colX(col)),
                                top: px(rowY(row)),
                                width: px(151),
                                height: px(rowY(row + 1) - 6 - rowY(row)),
                                border: `1px dashed #3a4654`,
                                borderRadius: px(8),
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: '#56657a',
                                cursor: 'pointer',
                                boxSizing: 'border-box',
                            }}
                        >
                            <IconAdd />
                        </div>
                    </Tooltip>,
                );
            }
        }
        return (
            <div
                onDragOver={e => this.onScreenDragOver(e)}
                onDragLeave={e => {
                    // only when the pointer leaves the screen, not when it moves onto a child
                    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                        this.setState({ dropOn: null });
                    }
                }}
                onDrop={e => this.onScreenDrop(e)}
                style={{
                    position: 'relative',
                    width: px(320),
                    height: px(240),
                    background: COLOR.screen,
                    borderRadius: 10,
                    outline: '8px solid #2a2a2a',
                    margin: 8,
                    flex: 'none',
                    fontFamily: 'Roboto, sans-serif',
                }}
            >
                {cells}
                {this.pageTiles().map(({ tile, index }) => {
                    const [cols, rows] = SIZES[tile.size];
                    const w = px(cols === 2 ? 308 : 151);
                    const h = px(rowY(tile.row + rows) - 6 - rowY(tile.row));
                    const selected = index === this.state.selected;
                    const problem = extra.has(index) ? 'sd_too_many' : problemOf(tile);
                    const dropOn = this.state.dropOn?.index === index ? this.state.dropOn : null;
                    const on = tile.type === 'switch' && (this.state.values[tile.state] === true || Number(this.state.values[tile.state]) > 0);
                    return (
                        <div
                            key={index}
                            draggable
                            onDragStart={e => {
                                // Firefox starts a drag only with data
                                e.dataTransfer.setData('text/plain', String(index));
                                e.dataTransfer.effectAllowed = 'move';
                                this.setState({ dragging: index, selected: index });
                            }}
                            onDragEnd={() => this.setState({ dragging: -1, dropOn: null })}
                            onClick={() => this.setState({ selected: index })}
                            title={dropOn ? I18n.t(dropOn.ok ? 'sd_swap' : 'sd_no_swap') : problem ? I18n.t(problem) : ''}
                            style={{
                                position: 'absolute',
                                left: px(colX(tile.col)),
                                top: px(rowY(tile.row)),
                                width: w,
                                height: h,
                                boxSizing: 'border-box',
                                padding: `${px(4)}px ${px(7)}px`,
                                display: tile.type === 'thermostat' ? 'flex' : undefined,
                                flexDirection: tile.type === 'thermostat' ? 'column' : undefined,
                                background: on ? COLOR.tileOn : this.backgroundOf(tile),
                                borderRadius: px(8),
                                color: '#fff',
                                cursor: 'grab',
                                overflow: 'hidden',
                                border: `2px ${dropOn ? 'dashed' : 'solid'} ${
                                    dropOn
                                        ? dropOn.ok
                                            ? COLOR.accent
                                            : '#EF4444'
                                        : selected
                                          ? COLOR.accent
                                          : problem
                                            ? '#EF4444'
                                            : 'transparent'
                                }`,
                                opacity: problem ? 0.5 : 1,
                                userSelect: 'none',
                            }}
                        >
                            {this.renderTileFace(tile, w, h)}
                        </div>
                    );
                })}
            </div>
        );
    }

    /** A colour of the tile; empty = the default (shown pale), the cross empties it */
    renderColorField(
        index: number,
        t: TileRow,
        attr: 'color' | 'background' | 'bgColor',
        label: string,
        fallback: string,
    ): React.JSX.Element {
        const value = cssColor(t[attr]);
        return (
            <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 0.5 }}>
                <TextField
                    variant="standard"
                    type="color"
                    label={I18n.t(label)}
                    value={value || fallback}
                    sx={{ width: 110, opacity: value ? 1 : 0.5 }}
                    onChange={e => this.update(index, { [attr]: e.target.value })}
                />
                {value ? (
                    <IconButton
                        size="small"
                        title={I18n.t('sd_default')}
                        onClick={() => this.update(index, { [attr]: '' })}
                    >
                        <IconClear fontSize="small" />
                    </IconButton>
                ) : (
                    <Typography
                        variant="caption"
                        sx={{ opacity: 0.6, pb: 0.5 }}
                    >
                        {I18n.t('sd_default')}
                    </Typography>
                )}
            </Box>
        );
    }

    renderStateField(index: number, t: TileRow, attr: StateAttr, label: string): React.JSX.Element {
        return (
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <TextField
                    variant="standard"
                    fullWidth
                    label={I18n.t(label)}
                    value={t[attr] || ''}
                    onChange={e => this.update(index, { [attr]: e.target.value })}
                    onFocus={e => this.setState({ typedFrom: e.target.value })}
                    onBlur={e => {
                        const id = e.target.value.trim();
                        const from = this.state.typedFrom;
                        if (id && id !== from) {
                            void this.takeState(index, attr, id, from);
                        }
                    }}
                />
                <IconButton
                    size="small"
                    title={I18n.t('sd_pick_state')}
                    onClick={() => this.setState({ pickFor: attr })}
                >
                    <IconPick />
                </IconButton>
            </Box>
        );
    }

    renderPanel(): React.JSX.Element {
        const index = this.state.selected;
        const t = this.tiles()[index];
        if (!t || !sameSatellite(t.satellite, this.state.satellite)) {
            return (
                <Typography
                    variant="body2"
                    sx={{ opacity: 0.7, p: 1 }}
                >
                    {I18n.t('sd_hint')}
                </Typography>
            );
        }
        const tiles = this.tiles();
        const num = (v: string): number | '' => (v === '' ? '' : Number(v));
        const scaled = t.type === 'gauge' || t.type === 'bar' || t.type === 'chart' || t.type === 'thermostat';
        const stateLabel =
            t.type === 'dimmer' ? 'sd_level_state' : t.type === 'thermostat' ? 'sd_current_state' : 'sd_state';
        return (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, minWidth: 260, maxWidth: 360, flex: 1 }}>
                {problemOf(t) ? (
                    <Typography
                        variant="body2"
                        color="error"
                    >
                        {I18n.t(problemOf(t))}
                    </Typography>
                ) : null}
                {this.hintsOf(t).map(hint => (
                    <Typography
                        key={hint}
                        variant="body2"
                        color="warning.main"
                    >
                        {I18n.t(hint)}
                    </Typography>
                ))}
                <FormControlLabel
                    control={
                        <Checkbox
                            checked={t.enabled !== false}
                            onChange={e => this.update(index, { enabled: e.target.checked })}
                        />
                    }
                    label={I18n.t('sd_active')}
                />
                <TextField
                    select
                    variant="standard"
                    label={I18n.t('sd_kind')}
                    value={t.type}
                    onChange={e => this.changeKind(index, e.target.value as Kind)}
                >
                    {(Object.keys(KINDS) as Kind[]).map(k => (
                        <MenuItem
                            key={k}
                            value={k}
                        >
                            {I18n.t(KIND_KEYS[k])}
                        </MenuItem>
                    ))}
                </TextField>
                <Box>
                    <Typography
                        variant="caption"
                        sx={{ opacity: 0.7 }}
                    >
                        {I18n.t('sd_size')}
                    </Typography>
                    <ToggleButtonGroup
                        exclusive
                        size="small"
                        value={t.size}
                        sx={{ display: 'flex' }}
                        onChange={(_e, size: Size | null) => size && this.update(index, { size })}
                    >
                        {KINDS[t.type].map(s => (
                            <ToggleButton
                                key={s}
                                value={s}
                                sx={{ flex: 1 }}
                                disabled={s !== t.size && !fits(tiles, t.satellite, Number(t.page), s, t.col, t.row, index)}
                            >
                                {SIZE_LABELS[s]}
                            </ToggleButton>
                        ))}
                    </ToggleButtonGroup>
                </Box>
                {this.renderStateField(index, t, 'state', stateLabel)}
                {t.type === 'dimmer' ? this.renderStateField(index, t, 'state2', 'sd_onoff_state') : null}
                {t.type === 'thermostat' ? this.renderStateField(index, t, 'state2', 'sd_target_state') : null}
                {t.type === 'thermostat' ? this.renderStateField(index, t, 'state3', 'sd_relay_state') : null}
                <Box sx={{ display: 'flex', gap: 1 }}>
                    <TextField
                        variant="standard"
                        sx={{ flex: 2 }}
                        label={I18n.t('sd_label')}
                        placeholder={this.state.names[t.state] || ''}
                        value={t.label || ''}
                        slotProps={{ htmlInput: { maxLength: 24 } }}
                        onChange={e => this.update(index, { label: e.target.value })}
                    />
                    {t.type !== 'dimmer' && t.type !== 'button' && t.type !== 'switch' ? (
                        <TextField
                            variant="standard"
                            sx={{ flex: 1 }}
                            label={I18n.t('sd_unit')}
                            value={t.unit || ''}
                            slotProps={{ htmlInput: { maxLength: 8 } }}
                            onChange={e => this.update(index, { unit: e.target.value })}
                        />
                    ) : null}
                </Box>
                {t.type === 'button' || t.type === 'switch' || t.size !== 'q' ? (
                    <TextField
                        select
                        variant="standard"
                        label={I18n.t('sd_icon')}
                        value={t.icon || ''}
                        onChange={e => this.update(index, { icon: e.target.value })}
                    >
                        <MenuItem value="">–</MenuItem>
                        {ICONS.map(icon => (
                            <MenuItem
                                key={icon}
                                value={icon}
                                sx={{ gap: 1.5 }}
                            >
                                <TileIcon
                                    name={icon}
                                    size={22}
                                    color="currentColor"
                                />
                                {icon}
                            </MenuItem>
                        ))}
                    </TextField>
                ) : null}
                {t.type === 'switch' ? (
                    <FormControlLabel
                        control={
                            <Checkbox
                                checked={!showToggle(t)}
                                onChange={e => this.update(index, { hideToggle: e.target.checked })}
                            />
                        }
                        label={I18n.t('sd_hide_toggle')}
                    />
                ) : null}
                {t.icon && t.type !== 'button' && t.size !== 'q' ? (
                    <FormControlLabel
                        control={
                            <Checkbox
                                checked={!!t.iconOnly}
                                onChange={e => this.update(index, { iconOnly: e.target.checked })}
                            />
                        }
                        label={I18n.t('sd_icon_only')}
                    />
                ) : null}
                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                    {this.renderColorField(index, t, 'color', 'sd_color', this.accentOf({ ...t, color: '' }))}
                    {this.renderColorField(index, t, 'background', 'sd_background', COLOR.tile)}
                </Box>
                {this.renderStateField(index, t, 'bgState', 'sd_bg_state')}
                {t.bgState ? this.renderColorField(index, t, 'bgColor', 'sd_bg_color', '#7F1D1D') : null}
                {t.type === 'value' || scaled ? (
                    <Box sx={{ display: 'flex', gap: 1 }}>
                        <TextField
                            variant="standard"
                            type="number"
                            sx={{ flex: 1 }}
                            label={I18n.t('sd_decimals')}
                            value={t.decimals ?? ''}
                            slotProps={{ htmlInput: { min: 0, max: 3 } }}
                            onChange={e => this.update(index, { decimals: num(e.target.value) })}
                        />
                        {scaled ? (
                            <>
                                <TextField
                                    variant="standard"
                                    type="number"
                                    sx={{ flex: 1 }}
                                    label={I18n.t('sd_min')}
                                    value={t.min ?? ''}
                                    onChange={e => this.update(index, { min: num(e.target.value) })}
                                />
                                <TextField
                                    variant="standard"
                                    type="number"
                                    sx={{ flex: 1 }}
                                    label={I18n.t('sd_max')}
                                    value={t.max ?? ''}
                                    onChange={e => this.update(index, { max: num(e.target.value) })}
                                />
                            </>
                        ) : null}
                    </Box>
                ) : null}
                {ALERT_KINDS.includes(t.type) ? (
                    <Box sx={{ display: 'flex', gap: 1 }}>
                        <TextField
                            variant="standard"
                            type="number"
                            sx={{ flex: 1 }}
                            label={I18n.t('sd_alert_below')}
                            value={t.alertBelow ?? ''}
                            onChange={e => this.update(index, { alertBelow: num(e.target.value) })}
                        />
                        <TextField
                            variant="standard"
                            type="number"
                            sx={{ flex: 1 }}
                            label={I18n.t('sd_alert_above')}
                            value={t.alertAbove ?? ''}
                            onChange={e => this.update(index, { alertAbove: num(e.target.value) })}
                        />
                    </Box>
                ) : null}
                {t.type === 'thermostat' ? (
                    <TextField
                        variant="standard"
                        type="number"
                        label={I18n.t('sd_step')}
                        placeholder="0.5"
                        value={t.step ?? ''}
                        slotProps={{ htmlInput: { min: 0.1, step: 0.1 } }}
                        onChange={e => this.update(index, { step: num(e.target.value) })}
                    />
                ) : null}
                <TextField
                    select
                    variant="standard"
                    label={I18n.t('sd_page')}
                    value={Number(t.page)}
                    onChange={e => this.changePage(index, Number(e.target.value))}
                >
                    {[1, 2, 3, 4].map(p => (
                        <MenuItem
                            key={p}
                            value={p}
                            disabled={p !== Number(t.page) && !freeCell(tiles, t.satellite, p, t.size, index)}
                        >
                            {p}
                        </MenuItem>
                    ))}
                </TextField>
                <Button
                    variant="outlined"
                    startIcon={<IconCopy />}
                    disabled={!this.copyPlace(index)}
                    title={this.copyPlace(index) ? '' : I18n.t('sd_no_room')}
                    onClick={() => this.duplicate(index)}
                >
                    {I18n.t('sd_duplicate')}
                </Button>
                <Button
                    color="error"
                    variant="outlined"
                    startIcon={<IconDelete />}
                    onClick={() => this.remove(index)}
                >
                    {I18n.t('sd_delete')}
                </Button>
            </Box>
        );
    }

    renderPicker(): React.JSX.Element | null {
        const index = this.state.selected;
        const attr = this.state.pickFor;
        const t = this.tiles()[index];
        if (!attr || !t) {
            return null;
        }
        return (
            <DialogSelectID
                dialogName="satelliteDisplayTile"
                socket={this.props.oContext.socket}
                theme={this.props.oContext.theme}
                themeType={this.props.oContext.themeType}
                imagePrefix="../.."
                selected={t[attr] || ''}
                onClose={() => this.setState({ pickFor: null })}
                onOk={selected => {
                    const id = Array.isArray(selected) ? selected[0] : selected;
                    this.setState({ pickFor: null });
                    if (id) {
                        void this.takeState(index, attr, id, t[attr] || '');
                    }
                }}
            />
        );
    }

    renderItem(): React.JSX.Element {
        const names = this.satelliteNames();
        if (!names.length) {
            return <Typography sx={{ p: 2 }}>{I18n.t('sd_no_satellites')}</Typography>;
        }
        const satellite = names.find(n => sameSatellite(n, this.state.satellite)) || names[0];
        const counts = [1, 2, 3, 4].map(
            p =>
                this.tiles().filter(
                    t => t.enabled !== false && sameSatellite(t.satellite, satellite) && Number(t.page) === p,
                ).length,
        );
        const disabledHere = this.tiles().filter(
            t => t.enabled === false && sameSatellite(t.satellite, satellite) && Number(t.page) === this.state.page,
        ).length;
        return (
            <Box
                sx={{ width: '100%' }}
                ref={this.root}
            >
                <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap', mb: 2 }}>
                    <TextField
                        select
                        variant="standard"
                        label={I18n.t('sd_satellite')}
                        value={satellite}
                        sx={{ minWidth: 180 }}
                        onChange={e =>
                            this.setState({ satellite: e.target.value, selected: -1 }, () => void this.readStates())
                        }
                    >
                        {names.map(n => (
                            <MenuItem
                                key={n}
                                value={n}
                            >
                                {this.isConfigured(n) ? n : `${n} (${I18n.t('sd_not_configured')})`}
                            </MenuItem>
                        ))}
                    </TextField>
                    <ToggleButtonGroup
                        exclusive
                        size="small"
                        value={this.state.page}
                        onChange={(_e, page: number | null) =>
                            page && this.setState({ page, selected: -1 }, () => void this.readStates())
                        }
                    >
                        {Array.from({ length: PAGES }, (_v, i) => i + 1).map(p => (
                            <ToggleButton
                                key={p}
                                value={p}
                            >
                                {I18n.t('sd_page')} {p}
                                {counts[p - 1] ? ` (${counts[p - 1]})` : ''}
                            </ToggleButton>
                        ))}
                    </ToggleButtonGroup>
                    <Button
                        size="small"
                        variant="outlined"
                        startIcon={<IconCopyPage />}
                        disabled={!this.tilesOf(satellite, this.state.page).length}
                        onClick={() =>
                            this.setState({
                                copy: {
                                    satellite,
                                    page: (this.state.page % PAGES) + 1,
                                },
                            })
                        }
                    >
                        {I18n.t('sd_copy_page')}
                    </Button>
                    <Tooltip title={`${I18n.t('sd_undo')} (Ctrl+Z)`}>
                        <span>
                            <IconButton
                                size="small"
                                disabled={!this.state.undoCount}
                                onClick={() => this.undo()}
                            >
                                <IconUndo />
                            </IconButton>
                        </span>
                    </Tooltip>
                    <Tooltip title={I18n.t('sd_preview_hint')}>
                        <span>
                            <Button
                                size="small"
                                variant="outlined"
                                startIcon={<IconCast />}
                                disabled={!this.isConfigured(satellite)}
                                onClick={() => void this.showOnSatellite()}
                            >
                                {I18n.t('sd_preview')}
                            </Button>
                        </span>
                    </Tooltip>
                    {this.state.preview.on ? (
                        <Button
                            size="small"
                            startIcon={<IconCastStop />}
                            onClick={() => void this.showOnSatellite(true)}
                        >
                            {I18n.t('sd_preview_end')}
                        </Button>
                    ) : null}
                    {this.state.preview.text ? (
                        <Typography
                            variant="body2"
                            color={this.state.preview.error ? 'warning.main' : 'text.secondary'}
                        >
                            {this.state.preview.text}
                        </Typography>
                    ) : null}
                </Box>
                <Box sx={{ display: 'flex', gap: 3, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    <Box>
                        {this.renderScreen()}
                        <Typography
                            variant="caption"
                            component="div"
                            sx={{ opacity: 0.7, mt: 2, maxWidth: px(320) }}
                        >
                            {I18n.t('sd_how')}
                            {disabledHere ? ` ${I18n.t('sd_disabled_count', disabledHere)}` : ''}
                        </Typography>
                    </Box>
                    {this.renderPanel()}
                </Box>
                {this.renderPicker()}
                {this.renderCopyDialog(names)}
            </Box>
        );
    }
}

export default TileEditor;
