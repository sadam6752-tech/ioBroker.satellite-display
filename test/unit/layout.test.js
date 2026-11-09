'use strict';

const assert = require('node:assert/strict');
const { normalizeSatellites, normalizeTiles, idOf, numberOrNull, ICONS } = require('../../lib/layout');

const SATS = [
    { enabled: true, name: 'Gast', host: '192.168.1.246', port: 6053 },
    { enabled: true, name: 'Arbeit Zimmer', host: '192.168.1.135' },
];

/**
 * @param {object} extra - Fields of the row
 * @returns {object} A tile row
 */
const row = extra => ({ enabled: true, satellite: 'Gast', page: 1, col: 0, row: 0, size: 'q', type: 'value', state: 'a.0.x', ...extra });

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
        const sats = normalizeSatellites([...SATS, { enabled: false, name: 'Off', host: '1.2.3.4' }, { name: 'NoHost' }], problems);
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
        assert.match(problems[6], /no enabled satellite "Keller"/);
        assert.match(problems[7], /no state chosen/);
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
        assert.match(problems[1], /^Tile 4: a thermostat tile comes in the sizes q, l/);
        assert.deepEqual(
            tiles.map(t => [t.state2, t.state3, t.step]),
            [
                ['a.0.soll', 'a.0.relay', 1],
                ['a.0.soll', '', 0.5],
                ['', '', 0.5],
            ],
        );
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
        const block = name => src.slice(src.indexOf(`export const ${name}`), src.indexOf(';', src.indexOf(`export const ${name}`)));
        const icons = [...block('ICONS').matchAll(/'([a-z-]+)'/g)].map(m => m[1]);
        assert.deepEqual(icons, ICONS);
        for (const [kind, sizes] of Object.entries(TYPES)) {
            assert.ok(block('KINDS').includes(`${kind}: [${sizes.map(s => `'${s}'`).join(', ')}]`), kind);
        }
        for (const [size, [c, r]] of Object.entries(SIZES)) {
            assert.ok(block('SIZES').includes(`${size}: [${c}, ${r}]`), size);
        }
    });
});
