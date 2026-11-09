'use strict';

// Builds the tile editor of the admin (src-admin, React) into admin/custom: `npm run build`.
// It lives in tools/ so that the dependency check of the repository checker skips it.

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

clean();
npmInstall(srcAdmin)
    .then(() => buildReact(srcAdmin, { rootDir: srcAdmin, vite: true }))
    .then(() => copy())
    .catch(e => {
        console.error(e);
        process.exit(2);
    });
