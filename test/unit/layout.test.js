'use strict';

const assert = require('node:assert/strict');
const {
    normalizeSatellites,
    normalizeTiles,
    idOf,
    numberOrNull,
    ICONS,
    colorOf,
    cellsOf,
} = require('../../lib/layout');

const SATS = [
    { enabled: true, name: 'Gast', host: '192.168.1.246', port: 6053 },
    { enabled: true, name: 'Arbeit Zimmer', host: '192.168.1.135' },
];

/**
 * @param {object} extra - Fields of the row
 * @returns {object} A tile row
 */
const row = extra => ({
    enabled: true,
    satellite: 'Gast',
    page: 1,
    col: 0,
    row: 0,
    size: 'q',
    type: 'value',
    state: 'a.0.x',
    ...extra,
});

describe('layout', () => {
    it('makes object ids of satellite names', () => {
        assert.equal(idOf('Gast'), 'gast');
        assert.equal(idOf(' Arbeit Zimmer '), 'arbeit_zimmer');
        assert.equal(idOf('Küche/2'), 'k_che_2');
        assert.equal(idOf(''), 'satellite');
    });

    it('reads empty number fields as null', () => {
        assert.equal(numberOrNull(''), null);
        assert.equal(numberOrNull(undefined), null);
        assert.equal(numberOrNull('abc'), null);
        assert.equal(numberOrNull('2.5'), 2.5);
        assert.equal(numberOrNull(0), 0);
    });

    it('takes the enabled satellites, port 6053 by default', () => {
        const problems = [];
        const sats = normalizeSatellites(
            [...SATS, { enabled: false, name: 'Off', host: '1.2.3.4' }, { name: 'NoHost' }],
            problems,
        );
        assert.deepEqual(
            sats.map(s => [s.id, s.port]),
            [
                ['gast', 6053],
                ['arbeit_zimmer', 6053],
            ],
        );
        assert.equal(problems.length, 1);
        assert.match(problems[0], /Satellite 4/);
    });

    it('refuses a satellite name used twice', () => {
        const problems = [];
        normalizeSatellites([SATS[0], { name: 'gast', host: '1.1.1.1' }], problems);
        assert.match(problems[0], /used twice/);
    });

    it('numbers the tiles of a page in the order of the table, per satellite and page', () => {
        const problems = [];
        const sats = normalizeSatellites(SATS, problems);
        const tiles = normalizeTiles(
            [
                row({ col: 0 }),
                row({ col: 1 }),
                row({ page: 2, size: 'w', type: 'chart' }),
                row({ satellite: 'Arbeit Zimmer' }),
                row({ row: 2, size: 'w', type: 'dimmer', state2: 'a.0.on' }),
            ],
            sats,
            problems,
        );
        assert.deepEqual(problems, []);
        assert.deepEqual(
            tiles.map(t => [t.satellite, t.page, t.slot]),
            [
                ['gast', 1, 0],
                ['gast', 1, 1],
                ['gast', 2, 0],
                ['arbeit_zimmer', 1, 0],
                ['gast', 1, 2],
            ],
        );
        assert.equal(tiles[4].state2, 'a.0.on');
        assert.equal(tiles[0].state2, '', 'only a dimmer keeps a second state');
    });

    it('reports the rows that do not fit, the others stay', () => {
        const problems = [];
        const sats = normalizeSatellites(SATS, problems);
        const tiles = normalizeTiles(
            [
                row({}),
                row({ row: 1 }), // covers the first (square = 2 rows)
                row({ col: 1, size: 'w' }), // a wide tile in the right column leaves the grid
                row({ row: 3, size: 'q' }), // a square tile in the last row leaves the grid
                row({ type: 'gauge', size: 's', col: 1 }), // a gauge is not small
                row({ type: 'blink', col: 1 }),
                row({ page: 5 }),
                row({ satellite: 'Keller' }),
                row({ state: '', col: 1 }),
            ],
            sats,
            problems,
        );
        assert.equal(tiles.length, 1);
        assert.equal(problems.length, 8);
        assert.match(problems[0], /^Tile 2: covers tile 1/);
        assert.match(problems[1], /^Tile 3: does not fit/);
        assert.match(problems[2], /^Tile 4: does not fit/);
        assert.match(problems[3], /^Tile 5: a gauge tile comes in the sizes q, l/);
        assert.match(problems[4], /unknown type "blink"/);
        assert.match(problems[5], /page must be 1 to 4/);
        assert.match(problems[6], /no enabled satellite or tablet "Keller"/);
        assert.match(problems[7], /no state chosen/);
    });

    it('takes a thermostat over the whole page of a satellite (f, 2 x 4) or one column of it (t, 1 x 4), no other type', () => {
        const problems = [];
        const sats = normalizeSatellites(SATS, problems);
        const thermostat = { type: 'thermostat', size: 'f', state: 'a.0.t', state2: 'a.0.set' };
        const tiles = normalizeTiles(
            [
                row(thermostat),
                row({ size: 's', col: 1, row: 3 }), // under the thermostat
                row({ ...thermostat, page: 2, row: 1 }), // 2 x 4 from row 1 leaves the grid
                row({ type: 'value', size: 'f', page: 3 }), // only a thermostat comes in f
                row({ ...thermostat, satellite: 'Arbeit Zimmer', page: 4 }),
                row({ ...thermostat, satellite: 'Arbeit Zimmer', page: 3, size: 't' }), // one column (2.6.2)
                row({ ...thermostat, satellite: 'Arbeit Zimmer', page: 3, col: 1, size: 't' }), // and the other one
                row({ ...thermostat, satellite: 'Arbeit Zimmer', page: 2, row: 1, size: 't' }), // 1 x 4 from row 1
                row({ ...thermostat, satellite: 'Arbeit Zimmer', page: 2, size: 'w' }), // no wide thermostat
                row({ type: 'value', satellite: 'Arbeit Zimmer', page: 1, size: 't' }), // only a thermostat is tall
            ],
            sats,
            problems,
        );
        assert.deepEqual(
            tiles.map(t => [t.satellite, t.page, t.size, t.gridCol, t.gridRow]),
            [
                ['gast', 1, 'f', 0, 0],
                ['arbeit_zimmer', 4, 'f', 0, 0],
                ['arbeit_zimmer', 3, 't', 0, 0],
                ['arbeit_zimmer', 3, 't', 1, 0],
            ],
        );
        assert.equal(problems.length, 6);
        assert.match(problems[0], /^Tile 2: covers tile 1/);
        assert.match(problems[1], /^Tile 3: does not fit/);
        assert.match(problems[2], /^Tile 4: a value tile comes in the sizes s, q, w, l, not "f"/);
        assert.match(problems[3], /^Tile 8: does not fit/);
        assert.match(problems[4], /^Tile 9: a thermostat tile comes in the sizes q, t, l, f, not "w"/);
        assert.match(problems[5], /^Tile 10: a value tile comes in the sizes s, q, w, l, not "t"/);
    });

    it('gives f the cells of the display: 2 x 4 on a satellite, 4 x 3 on a tablet', () => {
        assert.deepEqual(cellsOf('f', 'satellite'), [2, 4]);
        assert.deepEqual(cellsOf('f', 'tablet'), [4, 3]);
        assert.deepEqual(cellsOf('t', 'satellite'), [1, 4]);
        assert.deepEqual(cellsOf('l', 'satellite'), [2, 2]);
        assert.deepEqual(cellsOf('x', 'tablet'), [3, 2]);
        assert.equal(cellsOf('z', 'satellite'), null);
    });

    it('keeps the states, names and units a group, a level and a battery take, and drops the others', () => {
        const problems = [];
        const sats = normalizeSatellites(SATS, problems);
        const full = {
            state2: 'a.0.b',
            state3: 'a.0.c',
            state4: 'a.0.d',
            title: ' Temperaturen ',
            label2: 'Innen',
            unit4: '°C',
        };
        const [group, level, battery, status] = normalizeTiles(
            [
                row({ type: 'group', ...full }),
                row({ col: 1, type: 'level', ...full }),
                row({ row: 2, type: 'battery', ...full }),
                row({ row: 2, col: 1, size: 's', type: 'status', ...full }),
            ],
            sats,
            problems,
        );
        assert.deepEqual(problems, []);
        assert.deepEqual(
            [group.state2, group.state3, group.state4, group.title, group.label2, group.unit4],
            ['a.0.b', 'a.0.c', 'a.0.d', 'Temperaturen', 'Innen', '°C'],
        );
        assert.deepEqual([level.state2, level.state3, level.state4, level.title], ['a.0.b', '', '', '']);
        assert.deepEqual([battery.state2, battery.state3, battery.state4], ['a.0.b', 'a.0.c', '']);
        assert.deepEqual([status.state2, status.state3, status.state4], ['', '', '']);
    });

    it('gives the new types the sizes of the firmware 2.4.0', () => {
        const problems = [];
        const sats = normalizeSatellites(SATS, problems);
        normalizeTiles([row({ type: 'level', size: 's' }), row({ col: 1, type: 'status', size: 'l' })], sats, problems);
        assert.match(problems[0], /a level tile comes in the sizes q, l/);
        assert.match(problems[1], /a status tile comes in the sizes s, q, w/);
    });

    it('needs the target temperature for a thermostat, keeps its relay and step', () => {
        const problems = [];
        const sats = normalizeSatellites(SATS, problems);
        const tiles = normalizeTiles(
            [
                row({ type: 'thermostat', state2: 'a.0.soll', state3: 'a.0.relay', step: '1' }),
                row({ type: 'thermostat', col: 1, state2: 'a.0.soll' }),
                row({ type: 'thermostat', row: 2 }),
                row({ type: 'thermostat', row: 2, col: 1, size: 's', state2: 'a.0.soll' }),
                row({ type: 'value', row: 2, state2: 'a.0.x', state3: 'a.0.y' }),
            ],
            sats,
            problems,
        );
        assert.equal(problems.length, 2);
        assert.match(problems[0], /^Tile 3: a thermostat needs the state of its target temperature/);
        assert.match(problems[1], /^Tile 4: a thermostat tile comes in the sizes q, t, l, f, not "s"/);
        assert.deepEqual(
            tiles.map(t => [t.state2, t.state3, t.step]),
            [
                ['a.0.soll', 'a.0.relay', 1],
                ['a.0.soll', '', 0.5],
                ['', '', 0.5],
            ],
        );
    });

    it('shows the toggle of a switch as set, else by its size and icon', () => {
        const problems = [];
        const sats = normalizeSatellites(SATS, problems);
        const t = extra => normalizeTiles([row({ type: 'switch', ...extra })], sats, problems)[0].showToggle;
        assert.equal(t({ size: 's' }), true, 'no icon: with the toggle');
        assert.equal(t({ size: 's', icon: 'lamp' }), false, 'icon and name: the tile is the switch');
        assert.equal(t({ size: 's', icon: 'lamp', iconOnly: true }), true, 'only the icon: with the toggle');
        assert.equal(t({ size: 'q', icon: 'lamp' }), true, 'square: with the toggle');
        assert.equal(t({ size: 'q', icon: 'lamp', hideToggle: true }), false);
        assert.equal(t({ size: 's', icon: 'lamp', hideToggle: false }), true);
        assert.equal(normalizeTiles([row({ type: 'value' })], sats, problems)[0].showToggle, true);
    });

    it('sends the hash of the PIN, never the PIN, and only for 4 to 6 digits', () => {
        const { lockOf } = require('../../lib/layout');
        const problems = [];
        const lock = lockOf({ lockEnabled: true, pin: ' 1234 ' }, 0, problems);
        // the same as the firmware computes: SHA-256 of "satellite-display:" + PIN
        assert.equal(lock.pinHash, '99c0a75a0cb2831b528227a07847fbbb481a401f567abcfef8b48ae3befe06c1');
        assert.equal(lock.pinLength, 4);
        assert.deepEqual(lockOf({ lockEnabled: false, pin: '1234' }, 0, problems), { pinHash: '', pinLength: 0 });
        assert.deepEqual(problems, []);
        for (const pin of ['123', '1234567', '12a4', '']) {
            assert.deepEqual(lockOf({ lockEnabled: true, pin }, 1, problems), { pinHash: '', pinLength: 0 });
        }
        assert.equal(problems.length, 4);
        assert.match(problems[0], /^Satellite 2: the PIN must have 4 to 6 digits/);
        const sats = normalizeSatellites([{ ...SATS[0], lockEnabled: true, pin: '987654' }], []);
        assert.equal(sats[0].pinLength, 6);
        assert.ok(!JSON.stringify(sats).includes('987654'), 'the PIN does not leave the settings');
    });

    it('reads colours of the settings', () => {
        assert.equal(colorOf('#38BDF8'), 0x38bdf8);
        assert.equal(colorOf('#fff'), 0xffffff);
        assert.equal(colorOf(''), null);
        assert.equal(colorOf('blue'), null);
        assert.equal(colorOf(undefined), null);
    });

    it('keeps the colours, the background state and "icon only" of a tile', () => {
        const problems = [];
        const sats = normalizeSatellites(SATS, problems);
        const tiles = normalizeTiles(
            [
                row({
                    size: 's',
                    color: '#ff0000',
                    background: '#111111',
                    bgState: ' a.0.alarm ',
                    bgColor: '#7f1d1d',
                    icon: 'bell',
                    iconOnly: true,
                }),
                row({ col: 1, size: 's', iconOnly: true }),
                row({ row: 2, size: 's', type: 'button', icon: 'bell', iconOnly: true }),
            ],
            sats,
            problems,
        );
        assert.deepEqual(problems, []);
        assert.deepEqual(
            [tiles[0].color, tiles[0].background, tiles[0].bgState, tiles[0].bgColor, tiles[0].iconOnly],
            [0xff0000, 0x111111, 'a.0.alarm', 0x7f1d1d, true],
        );
        assert.equal(tiles[1].iconOnly, false, 'without an icon there is nothing to show instead of the name');
        assert.equal(tiles[2].iconOnly, false, 'a button always shows its name');
    });

    it('keeps thresholds only for the tiles that show a number', () => {
        const problems = [];
        const sats = normalizeSatellites(SATS, problems);
        const tiles = normalizeTiles(
            [
                row({ type: 'bar', alertBelow: '20', alertAbove: '' }),
                row({ type: 'switch', col: 1, size: 's', alertBelow: 5, alertAbove: 9 }),
            ],
            sats,
            problems,
        );
        assert.deepEqual(problems, []);
        assert.deepEqual(
            tiles.map(t => [t.alertBelow, t.alertAbove]),
            [
                [20, null],
                [null, null],
            ],
        );
    });

    it('allows eight small tiles on a page and refuses the ninth (the grid is full)', () => {
        const problems = [];
        const sats = normalizeSatellites(SATS, problems);
        const rows = [];
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 2; c++) {
                rows.push(row({ col: c, row: r, size: 's' }));
            }
        }
        rows.push(row({ size: 's' }));
        const tiles = normalizeTiles(rows, sats, problems);
        assert.equal(tiles.length, 8);
        assert.equal(problems.length, 1);
    });

    it('keeps known icons, drops unknown ones with a message, and clamps the decimals', () => {
        const problems = [];
        const sats = normalizeSatellites(SATS, problems);
        const tiles = normalizeTiles(
            [
                row({ type: 'button', icon: 'mdi:coffee', decimals: 7 }),
                row({ type: 'button', icon: 'rocket', col: 1, decimals: '' }),
            ],
            sats,
            problems,
        );
        assert.equal(tiles[0].icon, 'coffee');
        assert.equal(tiles[0].decimals, 3);
        assert.equal(tiles[1].icon, '');
        assert.equal(tiles[1].decimals, null);
        assert.match(problems[0], /no icon "rocket"/);
        assert.ok(ICONS.includes('coffee'));
    });

    it('the tile editor draws every icon of the firmware', () => {
        const fs = require('node:fs');
        const path = require('node:path');
        const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src-admin', 'src', 'icons.tsx'), 'utf8');
        const block = src.slice(src.indexOf('ICON_PATHS'), src.indexOf('};', src.indexOf('ICON_PATHS')));
        const names = [...block.matchAll(/^\s+'?([a-z-]+)'?: mdi/gm)].map(m => m[1]);
        assert.deepEqual(names, ICONS);
    });

    it('the tile editor of the admin has the same icons, kinds and sizes', () => {
        const fs = require('node:fs');
        const path = require('node:path');
        const { TYPES, SIZES } = require('../../lib/layout');
        const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src-admin', 'src', 'layout.ts'), 'utf8');
        const block = name =>
            src.slice(src.indexOf(`export const ${name}`), src.indexOf(';', src.indexOf(`export const ${name}`)));
        const icons = [...block('ICONS').matchAll(/'([a-z-]+)'/g)].map(m => m[1]);
        assert.deepEqual(icons, ICONS);
        for (const [kind, sizes] of Object.entries(TYPES)) {
            assert.ok(block('KINDS').includes(`${kind}: [${sizes.map(s => `'${s}'`).join(', ')}]`), kind);
        }
        for (const [size, [c, r]] of Object.entries(SIZES)) {
            assert.ok(block('SIZES').includes(`${size}: [${c}, ${r}]`), size);
        }
        const { SATELLITE_SIZES } = require('../../lib/layout');
        for (const [size, [c, r]] of Object.entries(SATELLITE_SIZES)) {
            assert.ok(block('SATELLITE_SIZES').includes(`${size}: [${c}, ${r}]`), `satellite ${size}`);
        }
        const { ITEM_TYPES, EXTRA_STATES, ALERT_TYPES } = require('../../lib/layout');
        const quoted = list => list.map(k => `'${k}'`).join(', ');
        assert.ok(block('FIRMWARE_230_KINDS').includes(`[${quoted(ITEM_TYPES)}]`), 'FIRMWARE_230_KINDS');
        assert.ok(block('ALERT_KINDS').includes(`[${quoted(ALERT_TYPES)}]`), 'ALERT_KINDS');
        for (const [key, kinds] of Object.entries(EXTRA_STATES)) {
            assert.ok(block('EXTRA_STATES').includes(`${key}: [${quoted(kinds)}]`), key);
        }
    });
});
