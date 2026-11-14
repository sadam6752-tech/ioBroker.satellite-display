'use strict';

// A renamed satellite or tablet stays the same device: its tiles go along, a tablet keeps its link (2026-11-14:
// "Gästezimmer" → "Gaestezimmer" left the tablet without connection and its tiles without a display).

const assert = require('node:assert/strict');
const { findRenames, renameTiles, renamePageTitles } = require('../../lib/renames');
const { normalizeDisplays } = require('../../lib/layout');

const displaysOf = (satellites, tablets = []) => normalizeDisplays({ satellites, tablets, pwaEnabled: true }, []);

describe('renames', () => {
    it('one tablet gone and one new: the same tablet renamed', () => {
        const devices = [
            { kind: 'tablet', id: 'g_stezimmer', name: 'Gästezimmer' },
            { kind: 'satellite', id: 'gast', name: 'Gast' },
        ];
        const displays = displaysOf([{ name: 'Gast', host: '1.1.1.1' }], [{ name: 'Gaestezimmer' }]);
        assert.deepEqual(findRenames(devices, displays), [
            { kind: 'tablet', fromId: 'g_stezimmer', from: 'Gästezimmer', toId: 'gaestezimmer', to: 'Gaestezimmer' },
        ]);
    });

    it('a satellite renamed too, each kind on its own', () => {
        const devices = [
            { kind: 'satellite', id: 'kueche', name: 'Kueche' },
            { kind: 'tablet', id: 'flur', name: 'Flur' },
        ];
        const displays = displaysOf([{ name: 'Küche Ost', host: '1.1.1.1' }], [{ name: 'Flur' }]);
        assert.deepEqual(
            findRenames(devices, displays).map(r => [r.kind, r.from, r.to]),
            [['satellite', 'Kueche', 'Küche Ost']],
        );
    });

    it('nothing when it is not clear: two gone and two new, one only removed, one only added', () => {
        const two = [
            { kind: 'tablet', id: 'a', name: 'A' },
            { kind: 'tablet', id: 'b', name: 'B' },
        ];
        assert.deepEqual(findRenames(two, displaysOf([], [{ name: 'C' }, { name: 'D' }])), []);
        assert.deepEqual(findRenames([{ kind: 'tablet', id: 'a', name: 'A' }], displaysOf([], [])), []);
        assert.deepEqual(findRenames([], displaysOf([], [{ name: 'New' }])), []);
        assert.deepEqual(findRenames([{ kind: 'tablet', id: 'a', name: '' }], displaysOf([], [{ name: 'B' }])), []);
    });

    it('a satellite never becomes a tablet', () => {
        const devices = [{ kind: 'satellite', id: 'gast', name: 'Gast' }];
        assert.deepEqual(findRenames(devices, displaysOf([], [{ name: 'Tablet' }])), []);
    });

    it('the tiles of the old name go to the new one, the others stay', () => {
        const tiles = [
            { satellite: 'Gästezimmer', page: 1 },
            { satellite: 'gästezimmer', page: 2 },
            { satellite: 'Gast', page: 1 },
        ];
        const renames = [
            { kind: 'tablet', fromId: 'g_stezimmer', from: 'Gästezimmer', toId: 'gaestezimmer', to: 'Gaestezimmer' },
        ];
        const { tiles: out, changed } = renameTiles(tiles, renames);
        assert.equal(changed, 2);
        assert.deepEqual(
            out.map(t => t.satellite),
            ['Gaestezimmer', 'Gaestezimmer', 'Gast'],
        );
        assert.equal(tiles[0].satellite, 'Gästezimmer', 'the rows of the settings are not changed in place');
        assert.equal(renameTiles(tiles, []).changed, 0);
    });

    it('the page titles of the old name go to the new one', () => {
        const renames = [{ kind: 'tablet', fromId: 'hall', from: 'Hall', toId: 'halle', to: 'Halle' }];
        const titles = { hall: { 1: 'Licht' }, flur: { 1: 'Heizung' } };
        assert.deepEqual(renamePageTitles(titles, renames), {
            pageTitles: { halle: { 1: 'Licht' }, flur: { 1: 'Heizung' } },
            changed: 1,
        });
        assert.equal(renamePageTitles(undefined, renames).changed, 0);
    });
});
