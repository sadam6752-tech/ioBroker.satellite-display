'use strict';

const assert = require('node:assert/strict');
const { runCommand, HELP, EDIT_COMMANDS } = require('../../lib/commands');

const SATS = [
    { enabled: true, name: 'Gast', host: '192.168.1.246' },
    { enabled: true, name: 'Panel-Mini', host: '192.168.1.157' },
    { enabled: false, name: 'Keller', host: '192.168.1.9' },
];

/**
 * @param {Record<string, unknown>[]} tiles - Rows of native.tiles
 * @param {Record<string, unknown>[]} [satellites] - Rows of native.satellites
 * @returns {object} Context of the commands
 */
const ctx = (tiles = [], satellites = SATS) => ({
    satellites,
    tiles,
    stateExists: async (/** @type {string} */ id) => !id.includes('missing'),
});

/**
 * @param {Record<string, unknown>} extra - Fields
 * @returns {Record<string, unknown>} A tile row on Gast, page 1
 */
const tile = extra => ({ enabled: true, satellite: 'Gast', page: 1, col: 0, row: 0, size: 's', type: 'value', state: 'a.0.x', ...extra });

/** Eight small tiles: page 1 of Gast is full */
const fullPage = () => {
    const rows = [];
    for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 2; c++) {
            rows.push(tile({ col: c, row: r }));
        }
    }
    return rows;
};

describe('commands on the tiles', () => {
    it('explains itself for an agent: commands, sizes, icons and when to ask the user', async () => {
        const { answer } = await runCommand('help', {}, ctx());
        assert.equal(answer, HELP);
        for (const word of ['addTile', 'moveTile', 'removeTile', 'getTiles', 'ceiling-light', 's = 1x1', 'ask which one', 'never reuse']) {
            assert.ok(String(answer).includes(word), word);
        }
        assert.deepEqual(EDIT_COMMANDS, ['help', 'getTiles', 'addTile', 'updateTile', 'moveTile', 'removeTile']);
    });

    it('asks which satellite when there are several and none was named', async () => {
        const { answer, tiles } = await runCommand('addTile', { type: 'switch', state: 'hue.0.light.on' }, ctx());
        assert.equal(answer.error, 'which satellite?');
        assert.deepEqual(answer.satellites, ['Gast', 'Panel-Mini']);
        assert.equal(tiles, undefined, 'nothing changed');
    });

    it('takes the only satellite when there is just one', async () => {
        const { answer } = await runCommand('addTile', { type: 'switch', state: 'hue.0.light.on' }, ctx([], [SATS[0]]));
        assert.equal(answer.ok, true);
        assert.equal(answer.added.satellite, 'Gast');
        assert.match(String(answer.note), /ask the user which satellite/);
    });

    it('names the satellites when the given one does not exist', async () => {
        const { answer } = await runCommand('addTile', { satellite: 'Küche', type: 'switch', state: 'a.0.on' }, ctx());
        assert.match(String(answer.error), /no satellite "Küche"/);
        assert.deepEqual(answer.satellites, ['Gast', 'Panel-Mini']);
    });

    it('adds a narrow switch with an icon in the first free place', async () => {
        const rows = [tile({}), tile({ col: 1, size: 's' })];
        const { answer, tiles } = await runCommand(
            'addTile',
            { satellite: 'gast', type: 'switch', size: 's', state: 'hue.0.wohnzimmer.on', icon: 'mdi:ceiling-light' },
            ctx(rows),
        );
        assert.equal(answer.ok, true);
        assert.deepEqual(
            [answer.added.id, answer.added.satellite, answer.added.page, answer.added.col, answer.added.row, answer.added.icon],
            [3, 'Gast', 1, 0, 1, 'ceiling-light'],
        );
        assert.equal(tiles.length, 3);
        assert.equal(rows.length, 2, 'the rows of the settings are not changed in place');
    });

    it('takes the smallest size of a kind when none is given', async () => {
        const { answer } = await runCommand('addTile', { satellite: 'Gast', type: 'gauge', state: 'a.0.t' }, ctx());
        assert.equal(answer.added.size, 'q');
    });

    it('goes to the next page when the first is full, and says so when all are', async () => {
        const { answer } = await runCommand('addTile', { satellite: 'Gast', type: 'switch', state: 'a.0.on' }, ctx(fullPage()));
        assert.equal(answer.added.page, 2);

        let rows = [];
        for (let p = 1; p <= 4; p++) {
            rows = rows.concat(fullPage().map(r => ({ ...r, page: p })));
        }
        const full = await runCommand('addTile', { satellite: 'Gast', type: 'switch', state: 'a.0.on' }, ctx(rows));
        assert.match(String(full.answer.error), /no room/);
        assert.match(String(full.answer.ask), /what to remove/);
        assert.deepEqual(full.answer.tilesPerPage, { 1: 8, 2: 8, 3: 8, 4: 8 });
        assert.equal(full.tiles, undefined);
    });

    it('refuses what the firmware cannot show, with what it can', async () => {
        const icon = await runCommand('addTile', { satellite: 'Gast', type: 'switch', state: 'a.0.on', icon: 'rocket' }, ctx());
        assert.match(String(icon.answer.error), /no icon "rocket"/);
        assert.ok(Array.isArray(icon.answer.icons));
        const size = await runCommand('addTile', { satellite: 'Gast', type: 'gauge', size: 's', state: 'a.0.t' }, ctx());
        assert.match(String(size.answer.error), /comes in the sizes q, l/);
        const kind = await runCommand('addTile', { satellite: 'Gast', type: 'lamp', state: 'a.0.on' }, ctx());
        assert.match(String(kind.answer.error), /unknown type/);
        const thermostat = await runCommand('addTile', { satellite: 'Gast', type: 'thermostat', state: 'a.0.t' }, ctx());
        assert.match(String(thermostat.answer.error), /needs state2/);
        const missing = await runCommand('addTile', { satellite: 'Gast', type: 'switch', state: 'a.0.missing' }, ctx());
        assert.match(String(missing.answer.error), /does not exist/);
        const taken = await runCommand('addTile', { satellite: 'Gast', type: 'switch', state: 'a.0.on', page: 1, col: 0, row: 0 }, ctx([tile({})]));
        assert.match(String(taken.answer.error), /no room for a s tile at col 0, row 0/);
    });

    it('lists the tiles and the free cells of a satellite', async () => {
        const { answer } = await runCommand('getTiles', { satellite: 'Gast' }, ctx([tile({}), tile({ satellite: 'Panel-Mini' })]));
        assert.deepEqual(answer.satellites, ['Gast', 'Panel-Mini']);
        assert.deepEqual(
            answer.tiles.map(t => [t.id, t.satellite]),
            [[1, 'Gast']],
        );
        assert.equal(answer.freeCells.Gast[1].length, 7);
        assert.equal(answer.freeCells.Gast[2].length, 8);
    });

    it('moves a tile to a free cell of another page, or tells where there is room', async () => {
        const rows = [tile({}), tile({ col: 1 })];
        const moved = await runCommand('moveTile', { id: 2, page: 3 }, ctx(rows));
        assert.deepEqual([moved.answer.tile.page, moved.answer.tile.col, moved.answer.tile.row], [3, 0, 0]);
        const blocked = await runCommand('moveTile', { id: 2, page: 1, col: 0, row: 0 }, ctx(rows));
        assert.match(String(blocked.answer.error), /does not fit/);
    });

    it('changes a tile and removes one', async () => {
        const rows = [tile({}), tile({ col: 1, type: 'switch', state: 'a.0.on' })];
        const changed = await runCommand('updateTile', { id: 2, icon: 'lamp', label: 'Stehlampe' }, ctx(rows));
        assert.equal(changed.answer.tile.icon, 'lamp');
        assert.equal(changed.tiles[1].label, 'Stehlampe');
        const removed = await runCommand('removeTile', { id: 1 }, ctx(rows));
        assert.equal(removed.tiles.length, 1);
        assert.equal(removed.answer.removed.id, 1);
        const unknown = await runCommand('removeTile', { id: 9 }, ctx(rows));
        assert.match(String(unknown.answer.error), /no tile with id 9/);
    });
});
