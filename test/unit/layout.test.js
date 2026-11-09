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

    it('lists exactly the icons of the admin page', () => {
        const config = require('../../admin/jsonConfig.json');
        const icon = config.items._tiles.items.tiles.items.find(i => i.attr === 'icon');
        assert.deepEqual(
            icon.options.map(o => o.value).filter(Boolean),
            ICONS,
        );
    });
});
