import React from 'react';

import {
    Box,
    Button,
    Checkbox,
    FormControlLabel,
    IconButton,
    MenuItem,
    TextField,
    ToggleButton,
    ToggleButtonGroup,
    Tooltip,
    Typography,
} from '@mui/material';
import { Add as IconAdd, Delete as IconDelete, ListAlt as IconPick } from '@mui/icons-material';

// from the package root, as the admin shares these modules
import { DialogSelectID, I18n } from '@iobroker/gui-components';
import { ConfigGeneric, type ConfigGenericProps, type ConfigGenericState } from '@iobroker/json-config';

import {
    COLS,
    ICONS,
    KINDS,
    PAGES,
    ROWS,
    SIZES,
    fits,
    freeCell,
    newTile,
    problemOf,
    sameSatellite,
    tileAt,
    tooMany,
    type Kind,
    type Size,
    type TileRow,
} from './layout';

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

type StateAttr = 'state' | 'state2' | 'state3';

const COLOR = {
    screen: '#0B1118',
    tile: '#18212B',
    tileOn: '#0C4A6E',
    label: '#8A9AAC',
    accent: '#38BDF8',
    track: '#2E3A47',
    heatOn: '#4CAF50',
    heatOff: '#4B5563',
};

interface TileEditorState extends ConfigGenericState {
    satellite: string;
    page: number;
    selected: number;
    pickFor: StateAttr | null;
    dragging: number;
    values: Record<string, ioBroker.StateValue | undefined>;
    names: Record<string, string>;
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
            values: {},
            names: {},
        };
    }

    async componentDidMount(): Promise<void> {
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

    setTiles(tiles: TileRow[], selected = this.state.selected): void {
        this.setState({ selected }, () => void this.onChange('tiles', tiles, () => void this.readStates()));
    }

    update(index: number, change: Partial<TileRow>): void {
        const tiles = this.tiles().map((t, i) => (i === index ? { ...t, ...change } : t));
        this.setTiles(tiles);
    }

    /** Current values and names of the states of the visible page, for the preview */
    async readStates(): Promise<void> {
        const socket = this.props.oContext.socket;
        const ids = new Set<string>();
        for (const t of this.pageTiles()) {
            for (const id of [t.tile.state, t.tile.state2, t.tile.state3]) {
                if (id && !(id in this.state.values)) {
                    ids.add(id);
                }
            }
        }
        if (!ids.size) {
            return;
        }
        const values: Record<string, ioBroker.StateValue | undefined> = {};
        const names: Record<string, string> = {};
        const lang = I18n.getLanguage();
        for (const id of ids) {
            try {
                const state = await socket.getState(id);
                values[id] = state?.val;
                const obj = await socket.getObject(id);
                const name = obj?.common?.name;
                names[id] = typeof name === 'object' && name ? name[lang] || name.en || '' : String(name || '');
            } catch {
                values[id] = undefined;
            }
        }
        this.setState(s => ({ values: { ...s.values, ...values }, names: { ...s.names, ...names } }));
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

    moveTo(index: number, col: number, row: number): void {
        const t = this.tiles()[index];
        if (t && fits(this.tiles(), this.state.satellite, this.state.page, t.size, col, row, index)) {
            this.update(index, { col, row });
        }
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

    renderTileFace(t: TileRow, w: number, h: number): React.JSX.Element {
        const value = this.state.values[t.state];
        const name = t.label || this.state.names[t.state] || t.state.split('.').pop() || I18n.t('sd_no_state');
        const num = typeof value === 'number' ? value : Number.NaN;
        const unit = t.unit && t.type !== 'dimmer' ? ` ${t.unit}` : '';
        const shown =
            value === undefined || value === null
                ? '–'
                : typeof value === 'number'
                  ? `${Number(value.toFixed(t.decimals === '' || t.decimals === null ? 1 : Number(t.decimals)))}${unit}`
                  : `${String(value)}${typeof value === 'boolean' ? '' : unit}`;
        const on =
            t.type === 'dimmer' && t.state2
                ? !!this.state.values[t.state2]
                : value === true || (typeof value === 'number' && value > 0);
        const lo = t.min === '' || t.min === null ? 0 : Number(t.min);
        const hi = t.max === '' || t.max === null ? 100 : Number(t.max);
        const frac = Number.isFinite(num) && hi > lo ? Math.max(0, Math.min(1, (num - lo) / (hi - lo))) : 0.5;
        const label = (
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
        const valueText = <div style={{ fontSize: big ? px(22) : px(14) }}>{shown}</div>;
        const toggle = (
            <div
                style={{
                    width: px(26),
                    height: px(14),
                    borderRadius: px(7),
                    background: on ? COLOR.accent : COLOR.track,
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
                        stroke={COLOR.accent}
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
                                stroke={COLOR.accent}
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
                                            background: COLOR.accent,
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
                                        stroke={COLOR.accent}
                                        strokeWidth={2}
                                        points={[0, 0.6, 0.4, 0.7, 0.3, 0.5, 0.2, 0.45, 0.35]
                                            .map((v, i) => `${(i * (w - px(16))) / 8},${v * px(14)}`)
                                            .join(' ')}
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
                                    stroke={COLOR.accent}
                                    strokeWidth={2}
                                    points={[0, 0.6, 0.4, 0.7, 0.3, 0.5, 0.2, 0.45, 0.35]
                                        .map((v, i) => `${(i * (w - px(16))) / 8},${v * px(18)}`)
                                        .join(' ')}
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
                                    background: COLOR.accent,
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
                        <div style={{ alignSelf: 'flex-end' }}>{toggle}</div>
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
                                    background: COLOR.accent,
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
                        {t.icon ? <span style={{ color: COLOR.accent, fontSize: px(9) }}>◉ {t.icon}</span> : null}
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
                            onDragOver={e => e.preventDefault()}
                            onDrop={e => {
                                e.preventDefault();
                                this.moveTo(this.state.dragging, col, row);
                            }}
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
                    const on = tile.type === 'switch' && (this.state.values[tile.state] === true || Number(this.state.values[tile.state]) > 0);
                    return (
                        <div
                            key={index}
                            draggable
                            onDragStart={() => this.setState({ dragging: index, selected: index })}
                            onDragEnd={() => this.setState({ dragging: -1 })}
                            onDragOver={e => e.preventDefault()}
                            onDrop={e => {
                                // dropped on itself: move by the cell under the pointer
                                e.preventDefault();
                                const box = e.currentTarget.parentElement?.getBoundingClientRect();
                                if (box) {
                                    const col = Math.min(COLS - 1, Math.max(0, Math.floor((e.clientX - box.left) / px(157))));
                                    const row = Math.min(ROWS - 1, Math.max(0, Math.floor((e.clientY - box.top) / px(58.5))));
                                    this.moveTo(this.state.dragging, col, row);
                                }
                            }}
                            onClick={() => this.setState({ selected: index })}
                            title={problem ? I18n.t(problem) : ''}
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
                                background: on ? COLOR.tileOn : COLOR.tile,
                                borderRadius: px(8),
                                color: '#fff',
                                cursor: 'grab',
                                overflow: 'hidden',
                                border: `2px solid ${selected ? COLOR.accent : problem ? '#EF4444' : 'transparent'}`,
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

    renderStateField(index: number, t: TileRow, attr: StateAttr, label: string): React.JSX.Element {
        return (
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <TextField
                    variant="standard"
                    fullWidth
                    label={I18n.t(label)}
                    value={t[attr] || ''}
                    onChange={e => this.update(index, { [attr]: e.target.value })}
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
                {t.type === 'button' || (t.type === 'switch' && t.size === 'q') ? (
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
                            >
                                {icon}
                            </MenuItem>
                        ))}
                    </TextField>
                ) : null}
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
                        this.update(index, { [attr]: id });
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
            <Box sx={{ width: '100%' }}>
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
            </Box>
        );
    }
}

export default TileEditor;
