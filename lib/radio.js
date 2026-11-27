'use strict';

// Tiles of ioBroker.webradio: a station (a tap plays it, a second tap stops it), "now playing", and buttons for stop,
// next, previous, sleep timer and volume. They are drawn as the tile types the firmware already has (switch, status,
// button), so a satellite needs no new firmware and a tablet draws them as it draws those.
//
// The tile talks to webradio only through its states: webradio.N.targets.<player>.{station, playing, title, stop,
// next, prev, sleep, volume} and webradio.N.info.stations. The player is the display itself when the tile names
// none: webradio finds a satellite-display satellite by its media.url state, a voice satellite by its player in
// ioBroker.assistant (native.esphome = host). A tablet plays nothing itself: its tiles name a player.

/** What a radio tile does → the firmware type it is drawn as */
const RADIO_ACTIONS = {
    station: 'switch',
    now: 'status',
    stop: 'button',
    next: 'button',
    prev: 'button',
    sleep: 'button',
    volUp: 'button',
    volDown: 'button',
};

/** The sizes of a radio tile: those of the three firmware types it is drawn as */
const RADIO_SIZES = ['s', 'q', 'w'];

/** The icon of each action when the tile names none (ICONS of lib/layout.js) */
const RADIO_ICONS = {
    station: 'music',
    now: 'speaker',
    stop: 'stop',
    next: 'play',
    prev: 'play',
    sleep: 'weather-night',
    volUp: 'speaker',
    volDown: 'speaker',
};

/** Minutes of the sleep timer, one step per tap; after the last one it is off again */
const SLEEP_STEPS = [15, 30, 60];

/** One tap on "louder" / "quieter": percent */
const VOLUME_STEP = 10;

/** The instance of webradio when the tile names none */
const DEFAULT_INSTANCE = 'webradio.0';

/** @type {Record<string, ioBroker.Translated>} the names of the buttons, in the language of the system */
const LABELS = {
    now: {
        en: 'Radio',
        de: 'Radio',
        ru: 'Радио',
        pt: 'Rádio',
        nl: 'Radio',
        fr: 'Radio',
        it: 'Radio',
        es: 'Radio',
        pl: 'Radio',
        uk: 'Радіо',
        'zh-cn': '电台',
    },
    stop: {
        en: 'Stop',
        de: 'Stopp',
        ru: 'Стоп',
        pt: 'Parar',
        nl: 'Stop',
        fr: 'Arrêt',
        it: 'Stop',
        es: 'Parar',
        pl: 'Stop',
        uk: 'Стоп',
        'zh-cn': '停止',
    },
    next: {
        en: 'Next',
        de: 'Weiter',
        ru: 'Дальше',
        pt: 'Seguinte',
        nl: 'Volgende',
        fr: 'Suivante',
        it: 'Successiva',
        es: 'Siguiente',
        pl: 'Następna',
        uk: 'Далі',
        'zh-cn': '下一个',
    },
    prev: {
        en: 'Previous',
        de: 'Zurück',
        ru: 'Назад',
        pt: 'Anterior',
        nl: 'Vorige',
        fr: 'Précédente',
        it: 'Precedente',
        es: 'Anterior',
        pl: 'Poprzednia',
        uk: 'Назад',
        'zh-cn': '上一个',
    },
    sleep: {
        en: 'Sleep',
        de: 'Schlummer',
        ru: 'Сон',
        pt: 'Dormir',
        nl: 'Slaap',
        fr: 'Sommeil',
        it: 'Spegnimento',
        es: 'Dormir',
        pl: 'Uśpienie',
        uk: 'Сон',
        'zh-cn': '睡眠',
    },
    volUp: {
        en: 'Louder',
        de: 'Lauter',
        ru: 'Громче',
        pt: 'Mais alto',
        nl: 'Harder',
        fr: 'Plus fort',
        it: 'Più forte',
        es: 'Más alto',
        pl: 'Głośniej',
        uk: 'Гучніше',
        'zh-cn': '调高',
    },
    volDown: {
        en: 'Quieter',
        de: 'Leiser',
        ru: 'Тише',
        pt: 'Mais baixo',
        nl: 'Zachter',
        fr: 'Moins fort',
        it: 'Più piano',
        es: 'Más bajo',
        pl: 'Ciszej',
        uk: 'Тихіше',
        'zh-cn': '调低',
    },
};

/**
 * @param {string} action - Action of a radio tile
 * @param {string} lang - Language of the system
 * @returns {string} The name of a button or of "now playing" in that language
 */
function radioLabel(action, lang) {
    const t = LABELS[action];
    return t ? t[/** @type {ioBroker.Languages} */ (lang)] || t.en : '';
}

/**
 * The radio part of a row of the settings, checked. A problem is added to `problems`; null leaves the tile out.
 *
 * @param {Record<string, unknown>} row - Row of native.tiles
 * @param {string} where - "Tile n" for messages
 * @param {boolean} tablet - The tile is on a tablet (which plays nothing itself)
 * @param {string[]} problems - Messages
 * @returns {{instance: string, action: string, station: string, target: string} | null} The radio settings
 */
function radioOf(row, where, tablet, problems) {
    const action = String(row.radioAction || 'station');
    if (!RADIO_ACTIONS[action]) {
        problems.push(`${where}: unknown radio action "${action}"`);
        return null;
    }
    const instance = String(row.radioInstance || DEFAULT_INSTANCE).trim();
    if (!/^webradio\.\d+$/.test(instance)) {
        problems.push(`${where}: "${instance}" is no instance of ioBroker.webradio`);
        return null;
    }
    const station = String(row.station || '').trim();
    if (action === 'station' && !station) {
        problems.push(`${where}: a radio station tile needs a station`);
        return null;
    }
    const target = String(row.radioTarget || '').trim();
    if (!target && tablet) {
        problems.push(`${where}: a tablet plays no radio itself, the radio tile needs a player`);
        return null;
    }
    return { instance, action, station, target };
}

/**
 * The player of webradio that plays on a display: the one whose URL state is the media.url of the satellite, or one
 * in ioBroker.assistant on the same host (a voice satellite whose player belongs to the assistant).
 *
 * @param {{_id?: string, native?: Record<string, unknown>}[]} targets - The channels webradio.N.targets.*
 * @param {string} ownUrlState - satellite-display.N.satellites.<id>.media.url
 * @param {string[]} assistantDevices - Ids of ioBroker.assistant devices on the host of the satellite
 * @returns {string} The id of the channel, '' when none
 */
function playerOf(targets, ownUrlState, assistantDevices) {
    const urls = targets.map(t => ({
        id: String(t._id || ''),
        url: String(t.native?.urlState || ''),
    }));
    const own = urls.find(t => t.url === ownUrlState);
    if (own) {
        return own.id;
    }
    const assistant = urls.find(t => assistantDevices.some(dev => t.url.startsWith(`${dev}.`)));
    return assistant?.id ?? '';
}

/**
 * The next step of the sleep timer: off → 15 → 30 → 60 → off.
 *
 * @param {unknown} minutes - Minutes set now (0 = off)
 * @returns {number} Minutes to set
 */
function nextSleep(minutes) {
    const now = Number(minutes) || 0;
    return SLEEP_STEPS.find(m => m > now) ?? 0;
}

/**
 * @param {unknown} volume - Volume now, 0-100
 * @param {number} delta - +/- step
 * @returns {number} The new volume, 0-100
 */
function stepVolume(volume, delta) {
    const now = volume === null || volume === undefined || volume === '' ? NaN : Number(volume);
    return Math.max(0, Math.min(100, Math.round((Number.isFinite(now) ? now : 50) + delta)));
}

/**
 * The names of the stations of webradio.N.info.stations.
 *
 * @param {unknown} val - Value of the state (JSON list of {id, name})
 * @returns {Map<string, string>} id → name
 */
function stationNames(val) {
    /** @type {Map<string, string>} */
    const names = new Map();
    try {
        const list = typeof val === 'string' ? JSON.parse(val) : val;
        for (const s of Array.isArray(list) ? list : []) {
            if (s && typeof s.id === 'string') {
                names.set(s.id, String(s.name || s.id));
            }
        }
    } catch {
        // no list: the ids are shown
    }
    return names;
}

/**
 * What a "now playing" tile shows: the title the station sends, else the name of the station, else nothing.
 *
 * @param {{playing: boolean, station: string, title: string}} now - State of the player
 * @param {Map<string, string>} names - Names of the stations
 * @returns {string} Text of the tile, '' when nothing plays
 */
function nowText(now, names) {
    if (!now.playing) {
        return '';
    }
    return (now.title || names.get(now.station) || now.station || '').slice(0, 48);
}

module.exports = {
    RADIO_ACTIONS,
    RADIO_SIZES,
    RADIO_ICONS,
    SLEEP_STEPS,
    VOLUME_STEP,
    DEFAULT_INSTANCE,
    radioLabel,
    radioOf,
    playerOf,
    nextSleep,
    stepVolume,
    stationNames,
    nowText,
};
