'use strict';

// Tiles of ioBroker.webradio (lib/radio.js and the radio part of lib/layout.js normalizeTiles).

const assert = require('node:assert/strict');
const radio = require('../../lib/radio');
const { normalizeTiles } = require('../../lib/layout');

const grid = { cols: 2, rows: 4, pages: 4, slots: 8 };
const mini = { kind: 'satellite', id: 'mini', name: 'Mini', host: '192.168.1.78', grid };
const hall = { kind: 'tablet', id: 'hall', name: 'Hall', host: '', grid: { cols: 4, rows: 3, pages: 2, slots: 12 } };

/**
 * @param {Record<string, unknown>} over - Fields of the row
 * @returns {Record<string, unknown>} A row of native.tiles
 */
function row(over) {
    return { satellite: 'Mini', page: 1, col: 0, row: 0, size: 's', type: 'radio', ...over };
}

describe('radio tiles', () => {
    it('a station tile needs no state, gets the icon music and no toggle', () => {
        const problems = [];
        const [tile] = normalizeTiles([row({ station: 'swr3' })], /** @type {any} */ ([mini]), problems);
        assert.deepEqual(problems, []);
        assert.equal(tile.type, 'radio');
        assert.equal(tile.icon, 'music');
        assert.equal(tile.showToggle, false);
        assert.deepEqual(tile.radio, { instance: 'webradio.0', action: 'station', station: 'swr3', target: '' });
    });

    it('wrong rows are reported: no station, unknown action, no webradio instance, a tablet without player', () => {
        const problems = [];
        const tiles = normalizeTiles(
            [
                row({}),
                row({ col: 1, radioAction: 'shuffle' }),
                row({ row: 1, radioAction: 'stop', radioInstance: 'web.0' }),
                row({ satellite: 'Hall', radioAction: 'next' }),
                row({ satellite: 'Hall', col: 1, radioAction: 'next', radioTarget: 'mini' }),
            ],
            /** @type {any} */ ([mini, hall]),
            problems,
        );
        assert.equal(tiles.length, 1, 'only the tablet tile with a player stays');
        assert.equal(tiles[0].radio?.target, 'mini');
        assert.match(problems[0], /needs a station/);
        assert.match(problems[1], /unknown radio action "shuffle"/);
        assert.match(problems[2], /no instance of ioBroker.webradio/);
        assert.match(problems[3], /tablet plays no radio itself/);
    });

    it('the player of a display: its own media.url, else the player of ioBroker.assistant on its host', () => {
        const targets = [
            { _id: 'webradio.0.targets.gast', native: { urlState: 'assistant.0.satellites.Gast.controls.p.url' } },
            { _id: 'webradio.0.targets.mini', native: { urlState: 'satellite-display.0.satellites.mini.media.url' } },
        ];
        assert.equal(
            radio.playerOf(targets, 'satellite-display.0.satellites.mini.media.url', []),
            'webradio.0.targets.mini',
        );
        assert.equal(
            radio.playerOf(targets, 'satellite-display.0.satellites.gast.media.url', ['assistant.0.satellites.Gast']),
            'webradio.0.targets.gast',
        );
        assert.equal(radio.playerOf(targets, 'satellite-display.0.satellites.x.media.url', []), '');
    });

    it('sleep timer steps 15 → 30 → 60 → off, volume in steps of 10 within 0-100', () => {
        assert.deepEqual([0, 15, 30, 60, 45].map(radio.nextSleep), [15, 30, 60, 0, 60]);
        assert.equal(radio.stepVolume(95, 10), 100);
        assert.equal(radio.stepVolume(5, -10), 0);
        assert.equal(radio.stepVolume(null, 10), 60, 'unknown volume counts as 50');
    });

    it('"now playing": the title, else the station name, nothing while stopped', () => {
        const names = radio.stationNames(JSON.stringify([{ id: 'swr3', name: 'SWR3' }, { bad: 1 }]));
        assert.equal(radio.nowText({ playing: true, station: 'swr3', title: 'Song' }, names), 'Song');
        assert.equal(radio.nowText({ playing: true, station: 'swr3', title: '' }, names), 'SWR3');
        assert.equal(radio.nowText({ playing: false, station: 'swr3', title: 'Song' }, names), '');
        assert.equal(radio.stationNames('not json').size, 0);
    });

    it('labels of the buttons in the language of the system, English for an unknown one', () => {
        assert.equal(radio.radioLabel('next', 'ru'), 'Дальше');
        assert.equal(radio.radioLabel('volDown', 'de'), 'Leiser');
        assert.equal(radio.radioLabel('stop', 'xx'), 'Stop');
        assert.equal(radio.radioLabel('station', 'en'), '');
    });
});
