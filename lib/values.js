'use strict';

// From ioBroker values to what a tile shows, and from a touch back to the value of the state.

/** "on" / "off" for a boolean on a value tile */
const ON_OFF = {
    en: ['on', 'off'],
    de: ['an', 'aus'],
    ru: ['вкл', 'выкл'],
    pt: ['lig.', 'desl.'],
    nl: ['aan', 'uit'],
    fr: ['marche', 'arrêt'],
    it: ['acceso', 'spento'],
    es: ['enc.', 'apag.'],
    pl: ['wł.', 'wył.'],
    uk: ['увімк', 'вимк'],
    'zh-cn': ['开', '关'],
};

/** Units shown with one decimal when the settings name no decimals */
const ONE_DECIMAL = ['°C', '°F', '°', 'K', 'kW', 'kWh', 'MWh', 'V', 'A', 'm/s', 'km/h', 'mm', 'l', 'm³', 'bar', 'pH'];

/**
 * @param {unknown} val - Value of a state
 * @returns {number | null} The number, null when it is none
 */
function toNumber(val) {
    if (typeof val === 'number') {
        return Number.isFinite(val) ? val : null;
    }
    if (typeof val === 'boolean') {
        return val ? 1 : 0;
    }
    if (typeof val === 'string' && val.trim() !== '') {
        const n = Number(val.trim().replace(',', '.'));
        return Number.isFinite(n) ? n : null;
    }
    return null;
}

/**
 * @param {unknown} val - Value of a state
 * @returns {boolean} True for on (true, a number other than 0, "on", "true" ...)
 */
function isOn(val) {
    if (typeof val === 'boolean') {
        return val;
    }
    if (typeof val === 'number') {
        return val !== 0;
    }
    if (typeof val === 'string') {
        return ['1', 'true', 'on', 'an', 'ein', 'yes', 'open', 'opened'].includes(val.trim().toLowerCase());
    }
    return false;
}

/**
 * @param {unknown} val - Value of a state that is no number
 * @param {string} lang - Language of the system
 * @returns {string} Text for a value tile
 */
function textOf(val, lang) {
    if (typeof val === 'boolean') {
        const words = ON_OFF[lang] || ON_OFF.en;
        return val ? words[0] : words[1];
    }
    if (val === null || val === undefined) {
        return '–';
    }
    const text = typeof val === 'object' ? JSON.stringify(val) : String(val);
    return text.slice(0, 32);
}

/**
 * The text that `common.states` of the object gives a value (e.g. 0: "Aus", 1: "Heizen"), or null.
 *
 * @param {unknown} val - Value of the state
 * @param {Partial<ioBroker.StateCommon>} common - Common part of its object
 * @param {string} lang - Language of the system (for translated texts)
 * @returns {string | null} The text, null when the object has none for this value
 */
function stateText(val, common, lang) {
    let states = /** @type {unknown} */ (common.states);
    if (val === null || val === undefined || !states) {
        return null;
    }
    if (typeof states === 'string') {
        // the old form "0:Aus;1:An"
        /** @type {Record<string, string>} */
        const parsed = {};
        for (const part of states.split(';')) {
            const at = part.indexOf(':');
            if (at > 0) {
                parsed[part.slice(0, at).trim()] = part.slice(at + 1).trim();
            }
        }
        states = parsed;
    }
    if (Array.isArray(states)) {
        // a list of allowed values: they are their own texts
        return null;
    }
    if (typeof states !== 'object') {
        return null;
    }
    const text = /** @type {Record<string, unknown>} */ (states)[String(val)];
    if (text === undefined || text === null || text === '') {
        return null;
    }
    const shown =
        typeof text === 'object' ? nameOf(/** @type {ioBroker.StringOrTranslated} */ (text), lang) : String(text);
    return shown ? shown.slice(0, 32) : null;
}

/**
 * @param {ioBroker.StringOrTranslated | undefined} name - Name of an object
 * @param {string} lang - Language of the system
 * @returns {string} The name in that language
 */
function nameOf(name, lang) {
    if (!name) {
        return '';
    }
    if (typeof name === 'string') {
        return name;
    }
    return name[lang] || name.en || Object.values(name).find(v => typeof v === 'string') || '';
}

/**
 * The range of a level state (0..100 when the object names none).
 *
 * @param {Partial<ioBroker.StateCommon> | undefined} common - Common part of the state object
 * @returns {[number, number]} Minimum and maximum
 */
function levelRange(common) {
    const min = typeof common?.min === 'number' ? common.min : 0;
    const max = typeof common?.max === 'number' && common.max > min ? common.max : 100;
    return [min, max];
}

/**
 * @param {unknown} val - Value of a level state
 * @param {Partial<ioBroker.StateCommon> | undefined} common - Common part of the state object
 * @returns {number | null} Level 0..100 for the slider
 */
function levelPercent(val, common) {
    const n = toNumber(val);
    if (n === null) {
        return null;
    }
    const [min, max] = levelRange(common);
    return Math.max(0, Math.min(100, ((n - min) / (max - min)) * 100));
}

/**
 * @param {number} percent - Level 0..100 from the slider
 * @param {Partial<ioBroker.StateCommon> | undefined} common - Common part of the state object
 * @returns {number} Value for the level state
 */
function levelValue(percent, common) {
    const [min, max] = levelRange(common);
    const v = min + (Math.max(0, Math.min(100, percent)) / 100) * (max - min);
    // a whole-number range keeps whole numbers, a range like 0..1 keeps two decimals
    return max - min >= 20 ? Math.round(v) : Math.round(v * 100) / 100;
}

/**
 * @param {boolean} on - Wanted state
 * @param {Partial<ioBroker.StateCommon> | undefined} common - Common part of the state object
 * @returns {boolean | number | string} Value of the type of the state
 */
function switchValue(on, common) {
    if (common?.type === 'number') {
        return on ? 1 : 0;
    }
    if (common?.type === 'string') {
        return on ? 'true' : 'false';
    }
    return on;
}

/** Colour of a tile whose value crossed a threshold (red) */
const ALERT_COLOR = 0xef4444;

/**
 * The colour of a tile for its value: red beyond a threshold, else 0 (the colours of the theme).
 *
 * @param {number} value - Value of the tile
 * @param {{alertBelow: number | null, alertAbove: number | null}} tile - Its thresholds
 * @returns {number} Colour 0xRRGGBB, 0 = theme
 */
function alertColor(value, tile) {
    if (tile.alertBelow !== null && value < tile.alertBelow) {
        return ALERT_COLOR;
    }
    if (tile.alertAbove !== null && value > tile.alertAbove) {
        return ALERT_COLOR;
    }
    return 0;
}

/**
 * The background a tile gets from its background state: a colour "#RRGGBB" written into the state, else the
 * background colour of the tile while the state is on (true, a number other than 0, "on"), else its own background.
 *
 * @param {unknown} val - Value of the background state
 * @param {{background: number | null, bgColor: number | null}} tile - The colours of the tile
 * @param {(value: unknown) => number | null} colorOf - Reads a colour
 * @returns {number} Background 0xRRGGBB, 0 = the theme
 */
function backgroundOf(val, tile, colorOf) {
    const own = colorOf(typeof val === 'string' ? val : '');
    if (own !== null && typeof val === 'string' && val.trim().startsWith('#')) {
        return own;
    }
    if (tile.bgColor !== null && isOn(val)) {
        return tile.bgColor;
    }
    return tile.background ?? 0;
}

/**
 * The target temperature a thermostat tile asks for, on the grid of its step and within the range of the object.
 *
 * @param {number} value - Setpoint from the satellite
 * @param {number} step - Step of the - / + buttons
 * @param {Partial<ioBroker.StateCommon>} common - Common part of the object of the target temperature
 * @returns {number} Value to write
 */
function setpointValue(value, step, common) {
    let v = step > 0 ? Math.round(value / step) * step : value;
    if (typeof common.min === 'number') {
        v = Math.max(common.min, v);
    }
    if (typeof common.max === 'number') {
        v = Math.min(common.max, v);
    }
    // no 21.500000000000004
    return Math.round(v * 1000) / 1000;
}

/**
 * The arguments of tile_set for a tile, the empty fields filled from the object of its state.
 *
 * @param {import('./layout').Tile} tile - Tile from the settings
 * @param {ioBroker.Object | null | undefined} obj - Object of its state
 * @param {string} lang - Language of the system
 * @param {ioBroker.Object | null} [obj2] - Object of the second state (the target temperature of a thermostat)
 * @returns {Record<string, string | number>} Arguments of tile_set
 */
function tileArgs(tile, obj, lang, obj2) {
    const common = /** @type {Partial<ioBroker.StateCommon>} */ (obj?.common || {});
    const common2 = /** @type {Partial<ioBroker.StateCommon>} */ (obj2?.common || {});
    let label = tile.label || nameOf(common.name, lang) || tile.state.split('.').pop() || '';
    // only the icon: the firmware shows it in the place of the name
    label = tile.iconOnly ? '' : label.slice(0, 24);
    const unit = (tile.type === 'dimmer' ? '' : tile.unit || common.unit || common2.unit || '').slice(0, 8);
    let min = tile.min;
    let max = tile.max;
    if (tile.type === 'gauge' || tile.type === 'bar') {
        min ??= typeof common.min === 'number' ? common.min : 0;
        max ??= typeof common.max === 'number' ? common.max : 100;
    } else if (tile.type === 'thermostat') {
        // the scale of the arc and the limits of the target: from the object of the target temperature
        min ??= typeof common2.min === 'number' ? common2.min : 5;
        max ??= typeof common2.max === 'number' ? common2.max : 30;
    } else if (tile.type === 'chart') {
        // equal values: the chart scales itself
        min ??= 0;
        max ??= 0;
    } else {
        min = 0;
        max = 100;
    }
    let decimals = tile.decimals;
    if (decimals === null) {
        // temperatures, energy and the like with one decimal, counts, percent and watts without
        decimals = ONE_DECIMAL.includes(unit) ? 1 : 0;
    }
    return {
        page: tile.page,
        slot: tile.slot,
        col: tile.gridCol,
        row: tile.gridRow,
        size: tile.size,
        type: tile.type,
        label,
        unit,
        icon: tile.icon,
        decimals,
        min,
        max,
    };
}

module.exports = {
    ON_OFF,
    toNumber,
    isOn,
    textOf,
    stateText,
    nameOf,
    levelRange,
    levelPercent,
    levelValue,
    switchValue,
    setpointValue,
    alertColor,
    backgroundOf,
    ALERT_COLOR,
    tileArgs,
};
