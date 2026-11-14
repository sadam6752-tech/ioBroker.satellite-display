'use strict';

// A satellite or tablet renamed in the settings: its object id comes from the name, so without this a rename looked
// like one device removed and another one added - the link of a tablet (its access key) stopped working and its
// tiles pointed at a name that was gone (2026-11-14: "Gästezimmer" → "Gaestezimmer").
//
// At the start the adapter compares the devices it created (satellites.*, tablets.*, with the name they had) with the
// settings: when of one kind exactly one device is gone and exactly one display is new, it is the same one renamed.

const { idOf } = require('./layout');

/**
 * @typedef {object} OldDevice - A device object the adapter created before
 * @property {'satellite' | 'tablet'} kind - Its folder: satellites or tablets
 * @property {string} id - Object id part (satellites.<id>)
 * @property {string} name - The name it was created with (common.name)
 */

/**
 * @typedef {object} Rename
 * @property {'satellite' | 'tablet'} kind - What was renamed
 * @property {string} fromId - Object id part of the old name
 * @property {string} from - Old name
 * @property {string} toId - Object id part of the new name
 * @property {string} to - New name
 */

/**
 * @param {OldDevice[]} devices - Devices of the objects
 * @param {import('./layout').SatelliteConfig[]} displays - Displays of the settings
 * @returns {Rename[]} The renames: per kind one at most, only when nothing else changed with it
 */
function findRenames(devices, displays) {
    /** @type {Rename[]} */
    const result = [];
    for (const kind of /** @type {const} */ (['satellite', 'tablet'])) {
        const mine = displays.filter(d => d.kind === kind);
        const gone = devices.filter(d => d.kind === kind && !mine.some(m => m.id === d.id));
        const added = mine.filter(m => !devices.some(d => d.kind === kind && d.id === m.id));
        if (gone.length === 1 && added.length === 1 && gone[0].name) {
            result.push({ kind, fromId: gone[0].id, from: gone[0].name, toId: added[0].id, to: added[0].name });
        }
    }
    return result;
}

/**
 * The tiles of the old name go to the new one.
 *
 * @param {Record<string, unknown>[]} tiles - Rows of native.tiles
 * @param {Rename[]} renames - Renames
 * @returns {{tiles: Record<string, unknown>[], changed: number}} The rows, and how many changed
 */
function renameTiles(tiles, renames) {
    let changed = 0;
    const rows = (Array.isArray(tiles) ? tiles : []).map(row => {
        const r = renames.find(x => idOf(String(row?.satellite ?? '')) === x.fromId);
        if (!r) {
            return row;
        }
        changed++;
        return { ...row, satellite: r.to };
    });
    return { tiles: rows, changed };
}

/**
 * The page titles of the old name go to the new one (native.pageTitles is keyed by the object id of the display).
 *
 * @param {unknown} pageTitles - native.pageTitles
 * @param {Rename[]} renames - Renames
 * @returns {{pageTitles: Record<string, unknown>, changed: number}} The titles, and how many displays changed
 */
function renamePageTitles(pageTitles, renames) {
    const all = /** @type {Record<string, unknown>} */ (
        pageTitles && typeof pageTitles === 'object' ? { ...pageTitles } : {}
    );
    let changed = 0;
    for (const r of renames) {
        if (all[r.fromId] !== undefined) {
            all[r.toId] = all[r.fromId];
            delete all[r.fromId];
            changed++;
        }
    }
    return { pageTitles: all, changed };
}

module.exports = { findRenames, renameTiles, renamePageTitles };
