'use strict';

// Builds the tile editor of the admin (src-admin, React) into admin/custom: `npm run build`.
// It lives in tools/ so that the dependency check of the repository checker skips it.

const fs = require('node:fs');
const { deleteFoldersRecursive, npmInstall, buildReact, copyFiles } = require('@iobroker/build-tools');

const root = `${__dirname}/..`;
const srcAdmin = `${root}/src-admin/`;
process.chdir(root);

function clean() {
    deleteFoldersRecursive(`${root}/admin/custom`);
    deleteFoldersRecursive(`${srcAdmin}build`);
}

function copy() {
    copyFiles(['src-admin/build/assets/*.js'], 'admin/custom/assets');
    copyFiles(['src-admin/build/customComponents.js'], 'admin/custom');
    copyFiles(['src-admin/src/i18n/*.json'], 'admin/custom/i18n');
}

/**
 * The file name of the editor stays the same from version to version, so a browser would keep the old one in its
 * cache: the address in jsonConfig carries the version of the adapter (test/unit/i18n.test.js checks it).
 */
function stampVersion() {
    const { version } = JSON.parse(fs.readFileSync(`${root}/package.json`, 'utf8'));
    const file = `${root}/admin/jsonConfig.json`;
    const text = fs.readFileSync(file, 'utf8');
    const stamped = text.replace(
        /"custom\/customComponents\.js(\?v=[^"]*)?"/,
        `"custom/customComponents.js?v=${version}"`,
    );
    if (stamped !== text) {
        fs.writeFileSync(file, stamped);
    }
}

clean();
stampVersion();
npmInstall(srcAdmin)
    .then(() => buildReact(srcAdmin, { rootDir: srcAdmin, vite: true }))
    .then(() => copy())
    .catch(e => {
        console.error(e);
        process.exit(2);
    });
