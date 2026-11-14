'use strict';

const assert = require('node:assert/strict');
const {
    toNumber,
    isOn,
    textOf,
    nameOf,
    levelPercent,
    levelValue,
    switchValue,
    setpointValue,
    stateText,
    alertColor,
    backgroundOf,
    ALERT_COLOR,
    tileArgs,
    mediaStateOf,
    showsChange,
} = require('../../lib/values');

/**
 * @param {object} extra - Fields of the tile
 * @returns {import('../../lib/layout').Tile} A tile
 */
const tile = extra => ({
    satellite: 'gast',
    row: 1,
    page: 1,
    slot: 0,
    gridCol: 0,
    gridRow: 0,
    size: 'q',
    type: 'value',
    state: 'hm.0.room.TEMPERATURE',
    state2: '',
    label: '',
    unit: '',
    icon: '',
    decimals: null,
    min: null,
    max: null,
    ...extra,
});

describe('values', () => {
    it('reads numbers', () => {
        assert.equal(toNumber(21.5), 21.5);
        assert.equal(toNumber('21,5'), 21.5);
        assert.equal(toNumber(' 7 '), 7);
        assert.equal(toNumber(true), 1);
        assert.equal(toNumber('open'), null);
        assert.equal(toNumber(''), null);
        assert.equal(toNumber(null), null);
        assert.equal(toNumber(NaN), null);
    });

    it('reads on/off', () => {
        for (const v of [true, 1, 255, '1', 'true', 'ON', 'an']) {
            assert.equal(isOn(v), true, String(v));
        }
        for (const v of [false, 0, '0', 'false', 'off', '', null, undefined]) {
            assert.equal(isOn(v), false, String(v));
        }
    });

    it('turns other values into text in the system language', () => {
        assert.equal(textOf(true, 'de'), 'an');
        assert.equal(textOf(false, 'ru'), 'выкл');
        assert.equal(textOf(false, 'xx'), 'off');
        assert.equal(textOf('geschlossen', 'de'), 'geschlossen');
        assert.equal(textOf('x'.repeat(40), 'en').length, 32);
        assert.equal(textOf(null, 'en'), '–');
    });

    it('picks the name in the system language', () => {
        assert.equal(nameOf({ en: 'Temperature', de: 'Temperatur' }, 'de'), 'Temperatur');
        assert.equal(nameOf({ en: 'Temperature', de: 'Temperatur' }, 'ru'), 'Temperature');
        assert.equal(nameOf('Plain', 'de'), 'Plain');
        assert.equal(nameOf(undefined, 'de'), '');
    });

    it('converts levels between the range of the object and percent', () => {
        assert.equal(levelPercent(50, {}), 50);
        assert.equal(levelPercent(0.25, { min: 0, max: 1 }), 25);
        assert.equal(levelPercent(255, { min: 0, max: 255 }), 100);
        assert.equal(levelPercent(300, {}), 100);
        assert.equal(levelPercent('x', {}), null);
        assert.equal(levelValue(53, {}), 53);
        assert.equal(levelValue(53, { min: 0, max: 1 }), 0.53);
        assert.equal(levelValue(50, { min: 0, max: 255 }), 128);
        assert.equal(levelValue(150, {}), 100);
    });

    it('writes on/off in the type of the state', () => {
        assert.equal(switchValue(true, { type: 'boolean' }), true);
        assert.equal(switchValue(false, { type: 'number' }), 0);
        assert.equal(switchValue(true, { type: 'string' }), 'true');
        assert.equal(switchValue(true, undefined), true);
    });

    it('fills empty fields of a tile from the object', () => {
        const obj = /** @type {any} */ ({
            common: { name: { en: 'Living room', de: 'Wohnzimmer' }, unit: '°C', min: 10, max: 30 },
        });
        const args = tileArgs(tile({ type: 'gauge' }), obj, 'de');
        assert.deepEqual(args, {
            page: 1,
            slot: 0,
            col: 0,
            row: 0,
            size: 'q',
            type: 'gauge',
            label: 'Wohnzimmer',
            unit: '°C',
            icon: '',
            decimals: 1,
            min: 10,
            max: 30,
        });
    });

    it('keeps what the settings say over the object', () => {
        const obj = /** @type {any} */ ({ common: { name: 'Power', unit: 'W', min: 0, max: 5000 } });
        const args = tileArgs(tile({ type: 'bar', label: 'Herd', unit: 'kW', decimals: 2, min: 0, max: 7 }), obj, 'en');
        assert.equal(args.label, 'Herd');
        assert.equal(args.unit, 'kW');
        assert.equal(args.decimals, 2);
        assert.equal(args.max, 7);
    });

    it('uses sensible defaults without an object', () => {
        const args = tileArgs(tile({ type: 'chart', size: 'w', unit: 'W' }), null, 'en');
        assert.equal(args.label, 'TEMPERATURE');
        assert.equal(args.decimals, 0);
        assert.equal(args.min, 0);
        assert.equal(args.max, 0, 'a chart scales itself');
        const dimmer = tileArgs(tile({ type: 'dimmer', size: 'w', unit: '%' }), null, 'en');
        assert.equal(dimmer.unit, '', 'a dimmer shows percent itself');
    });

    it('cuts the name and the unit to what the firmware takes', () => {
        const args = tileArgs(tile({ label: 'A very long name that does not fit', unit: 'abcdefghij' }), null, 'en');
        assert.equal(args.label.length, 24);
        assert.equal(String(args.unit).length, 8);
    });

    it('takes the scale and the unit of a thermostat from its target temperature', () => {
        const target = {
            common: { name: 'Soll', type: 'number', role: 'level.temperature', unit: '°C', min: 10, max: 28 },
        };
        const args = tileArgs(tile({ type: 'thermostat', size: 'q', state2: 'a.0.soll' }), null, 'en', target);
        assert.equal(args.min, 10);
        assert.equal(args.max, 28);
        assert.equal(args.unit, '°C');
        assert.equal(args.decimals, 1);
        const plain = tileArgs(tile({ type: 'thermostat', size: 'q', state2: 'a.0.soll' }), null, 'en', null);
        assert.deepEqual([plain.min, plain.max], [5, 30]);
    });

    it('takes the background from the background state', () => {
        const { colorOf } = require('../../lib/layout');
        const tile = { background: 0x112233, bgColor: 0x7f1d1d };
        assert.equal(backgroundOf(true, tile, colorOf), 0x7f1d1d);
        assert.equal(backgroundOf(1, tile, colorOf), 0x7f1d1d);
        assert.equal(backgroundOf(false, tile, colorOf), 0x112233);
        assert.equal(backgroundOf('#00ff00', tile, colorOf), 0x00ff00, 'a colour in the state wins');
        assert.equal(backgroundOf(null, { background: null, bgColor: null }, colorOf), 0);
        assert.equal(backgroundOf(true, { background: null, bgColor: null }, colorOf), 0);
    });

    it('sends no name for a tile that shows only its icon', () => {
        const args = tileArgs(
            tile({ type: 'switch', size: 's', icon: 'lamp', iconOnly: true, label: 'Licht' }),
            null,
            'en',
        );
        assert.equal(args.label, '');
        assert.equal(args.icon, 'lamp');
    });

    it('turns a tile red beyond its thresholds', () => {
        const both = { alertBelow: 20, alertAbove: 80 };
        assert.equal(alertColor(10, both), ALERT_COLOR);
        assert.equal(alertColor(20, both), 0, 'the threshold itself is fine');
        assert.equal(alertColor(50, both), 0);
        assert.equal(alertColor(81, both), ALERT_COLOR);
        assert.equal(alertColor(-5, { alertBelow: null, alertAbove: 30 }), 0);
        assert.equal(alertColor(31, { alertBelow: null, alertAbove: 30 }), ALERT_COLOR);
    });

    it('shows the text that common.states gives a value', () => {
        const modes = { type: 'number', states: { 0: 'Aus', 1: 'Heizen', 2: { en: 'Cooling', de: 'Kühlen' } } };
        assert.equal(stateText(1, modes, 'de'), 'Heizen');
        assert.equal(stateText(2, modes, 'de'), 'Kühlen');
        assert.equal(stateText(2, modes, 'fr'), 'Cooling');
        assert.equal(stateText(5, modes, 'de'), null);
        assert.equal(stateText(1, { states: '0:Zu;1:Offen' }, 'de'), 'Offen');
        assert.equal(stateText(true, { states: { true: 'An', false: 'Aus' } }, 'de'), 'An');
        assert.equal(stateText('a', { states: ['a', 'b'] }, 'de'), null);
        assert.equal(stateText(1, {}, 'de'), null);
    });

    it('puts a setpoint on the grid of its step and into the range of the object', () => {
        assert.equal(setpointValue(21.4, 0.5, {}), 21.5);
        assert.equal(setpointValue(21.1 + 0.4, 0.5, {}), 21.5);
        assert.equal(setpointValue(22.2, 1, {}), 22);
        assert.equal(setpointValue(35, 0.5, { min: 5, max: 30 }), 30);
        assert.equal(setpointValue(2, 0.5, { min: 5, max: 30 }), 5);
        assert.equal(setpointValue(20.26, 0.1, {}), 20.3);
    });
});

describe('mediaStateOf', () => {
    it('turns what the player reports into the values of the role media.state', () => {
        assert.equal(mediaStateOf('playing'), 'play');
        assert.equal(mediaStateOf('announcing'), 'play');
        assert.equal(mediaStateOf('paused'), 'pause');
        assert.equal(mediaStateOf('idle'), 'stop');
        assert.equal(mediaStateOf(''), 'stop');
        assert.equal(mediaStateOf(undefined), 'stop');
    });
});

describe('showsChange', () => {
    it('shows a device state only when it is confirmed', () => {
        assert.equal(showsChange('hue.0.lamp.on', { ack: true }), true);
        assert.equal(showsChange('hue.0.lamp.on', { ack: false }), false);
        assert.equal(showsChange('alias.0.lamp.on', { ack: false }), false);
    });

    it('shows states of the user and of scripts also without ack, nobody confirms them', () => {
        assert.equal(showsChange('0_userdata.0.mode', { ack: false }), true);
        assert.equal(showsChange('javascript.0.flag', { ack: false }), true);
    });

    it('shows nothing for a deleted state', () => {
        assert.equal(showsChange('hue.0.lamp.on', null), false);
    });
});
