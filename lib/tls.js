'use strict';

// HTTPS for the web app of the tablets: a certificate of the certificate collection of ioBroker (Admin > Settings >
// Certificates), the same pair the web adapter uses (as in ioBroker.e-invoices, src/lib/tls.ts). A tablet installs
// the web app and keeps its screen on only from a secure origin, on iOS always.
//
// The decision is the operator's: when HTTPS is on and the certificate cannot be loaded, the server stays off and
// does NOT fall back to plain HTTP, because the access key of a tablet would then go over an unencrypted line.

/**
 * @typedef {object} TlsOptions - Certificate material (PEM text)
 * @property {string} key - Private key
 * @property {string} cert - Public certificate
 * @property {string} [ca] - Chain, optional
 */

/**
 * @typedef {{mode: 'http'} | {mode: 'https', tls: TlsOptions} | {mode: 'unavailable', reason: string}} TlsDecision
 */

/**
 * @typedef {(publicName: string, privateName: string, chainedName?: string) => Promise<unknown>} CertificateLoader
 *   - `adapter.getCertificatesAsync`: resolves [certificates, leConfig]
 */

/**
 * Decides how the web app is served and loads the certificate for HTTPS.
 *
 * @param {{secure?: unknown, certPublic?: unknown, certPrivate?: unknown, certChained?: unknown}} config - HTTPS part
 *   of the settings
 * @param {CertificateLoader} load - Reads certificates from the ioBroker collection
 * @returns {Promise<TlsDecision>} How to serve
 */
async function decideTls(config, load) {
    if (config.secure !== true) {
        return { mode: 'http' };
    }
    const publicName = String(config.certPublic ?? '').trim();
    const privateName = String(config.certPrivate ?? '').trim();
    if (!publicName || !privateName) {
        return {
            mode: 'unavailable',
            reason: 'HTTPS is switched on, but no public certificate and private key are chosen in the settings (tab Tablets)',
        };
    }
    try {
        const answer = await load(publicName, privateName, String(config.certChained ?? '').trim() || undefined);
        const certificates = /** @type {{key?: string, cert?: string, ca?: string} | undefined} */ (
            Array.isArray(answer) ? answer[0] : answer
        );
        if (!certificates?.key || !certificates.cert) {
            return {
                mode: 'unavailable',
                reason: `HTTPS is switched on, but the certificate "${publicName}" / "${privateName}" is not in the certificate collection of ioBroker (Admin > Settings > Certificates)`,
            };
        }
        return { mode: 'https', tls: { key: certificates.key, cert: certificates.cert, ca: certificates.ca } };
    } catch (e) {
        return { mode: 'unavailable', reason: `the certificate could not be loaded: ${e.message}` };
    }
}

module.exports = { decideTls };
