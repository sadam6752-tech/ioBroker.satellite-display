/* Tiles on a tablet: the web app of ioBroker.satellite-display.
 *
 * It does what the tile pages of the satellite firmware do (docs/TILES.md of the firmware): the adapter sends the
 * layout and the values as the actions tile_set, tile_value ... over a WebSocket, a touch goes back as an input.
 * The access key comes in the link from the settings (?key=...) and is kept in the browser.
 */
'use strict';

(() => {
    const ICONS = self.TILE_ICONS || {};
    const LOCK_PATH = ICONS.lock || '';
    const VERSION = '1';
    /** After this long without a touch the first page comes back (the firmware goes back to its clock) */
    const IDLE_MS = 60_000;
    /** A thermostat sends its new target this long after the last press of - / + (as the firmware) */
    const SETPOINT_DELAY_MS = 1000;
    /** Wrong PINs in a row before the keypad waits */
    const MAX_WRONG = 5;
    const WAIT_MS = 60_000;
    /** Points a chart keeps */
    const CHART_POINTS = 60;

    // ---- texts -------------------------------------------------------------------------------------------------

    const TEXTS = {
        en: {
            outdated:
                'This link is out of date: the tablet was removed in the settings or got a new link. Open its current link (settings, tab Tablets).',
            connecting: 'Connecting…',
            noKey: 'Open the link of this tablet from the settings of satellite-display (tab Tablets).',
            refused:
                'No connection. Is the link still the one from the settings (tab Tablets), and does the adapter run?',
            wrong: 'Wrong PIN',
            wait: 'Too many wrong PINs, wait {s} s',
            empty: 'No tiles yet: add them in the tile editor of the adapter, or ask your AI agent.',
            lock: 'Lock',
            replaced: 'This tablet is open in another window. Tap here to show it in this one.',
        },
        de: {
            outdated:
                'Dieser Link ist veraltet: das Tablet wurde in den Einstellungen entfernt oder hat einen neuen Link. Öffne seinen aktuellen Link (Einstellungen, Reiter Tablets).',
            connecting: 'Verbinde…',
            noKey: 'Öffne den Link dieses Tablets aus den Einstellungen von satellite-display (Reiter Tablets).',
            refused:
                'Keine Verbindung. Ist der Link noch der aus den Einstellungen (Reiter Tablets), und läuft der Adapter?',
            wrong: 'Falsche PIN',
            wait: 'Zu viele falsche PINs, warte {s} s',
            empty: 'Noch keine Kacheln: im Kachel-Editor des Adapters anlegen oder den KI-Agenten bitten.',
            lock: 'Sperren',
            replaced: 'Dieses Tablet ist in einem anderen Fenster geöffnet. Hier tippen, um es in diesem zu zeigen.',
        },
        ru: {
            outdated:
                'Эта ссылка устарела: планшет удалён в настройках или получил новую ссылку. Откройте его актуальную ссылку (настройки, вкладка Tablets).',
            connecting: 'Подключение…',
            noKey: 'Откройте ссылку этого планшета из настроек satellite-display (вкладка Tablets).',
            refused: 'Нет связи. Ссылка всё ещё та, что в настройках (вкладка Tablets), и адаптер запущен?',
            wrong: 'Неверный PIN',
            wait: 'Слишком много неверных PIN, подождите {s} с',
            empty: 'Плиток пока нет: добавьте их в редакторе плиток адаптера или попросите ИИ-агента.',
            lock: 'Заблокировать',
            replaced: 'Этот планшет открыт в другом окне. Коснитесь здесь, чтобы показать его в этом.',
        },
        pt: {
            outdated:
                'Esta ligação está desatualizada: o tablet foi removido nas definições ou recebeu uma nova ligação. Abra a ligação atual (definições, separador Tablets).',
            connecting: 'A ligar…',
            noKey: 'Abra a ligação deste tablet a partir das definições do satellite-display (separador Tablets).',
            refused: 'Sem ligação. A ligação ainda é a das definições (separador Tablets) e o adaptador está a correr?',
            wrong: 'PIN errado',
            wait: 'Demasiados PIN errados, aguarde {s} s',
            empty: 'Ainda sem mosaicos: adicione-os no editor de mosaicos do adaptador ou peça ao seu agente de IA.',
            lock: 'Bloquear',
            replaced: 'Este tablet está aberto noutra janela. Toque aqui para o mostrar nesta.',
        },
        nl: {
            outdated:
                'Deze link is verouderd: de tablet is in de instellingen verwijderd of heeft een nieuwe link. Open de huidige link (instellingen, tabblad Tablets).',
            connecting: 'Verbinden…',
            noKey: 'Open de link van deze tablet uit de instellingen van satellite-display (tabblad Tablets).',
            refused: 'Geen verbinding. Is de link nog die uit de instellingen (tabblad Tablets), en draait de adapter?',
            wrong: 'Verkeerde pincode',
            wait: 'Te veel verkeerde pincodes, wacht {s} s',
            empty: 'Nog geen tegels: voeg ze toe in de tegeleditor van de adapter of vraag het je AI-agent.',
            lock: 'Vergrendelen',
            replaced: 'Deze tablet is in een ander venster geopend. Tik hier om hem in dit venster te tonen.',
        },
        fr: {
            outdated:
                'Ce lien est périmé : la tablette a été supprimée dans les paramètres ou a reçu un nouveau lien. Ouvrez son lien actuel (paramètres, onglet Tablets).',
            connecting: 'Connexion…',
            noKey: 'Ouvrez le lien de cette tablette depuis les paramètres de satellite-display (onglet Tablets).',
            refused:
                "Pas de connexion. Le lien est-il toujours celui des paramètres (onglet Tablets), et l'adaptateur tourne-t-il ?",
            wrong: 'PIN incorrect',
            wait: 'Trop de PIN incorrects, attendez {s} s',
            empty: "Pas encore de tuiles : ajoutez-les dans l'éditeur de tuiles de l'adaptateur ou demandez à votre agent IA.",
            lock: 'Verrouiller',
            replaced: 'Cette tablette est ouverte dans une autre fenêtre. Touchez ici pour l’afficher dans celle-ci.',
        },
        it: {
            outdated:
                'Questo link è scaduto: il tablet è stato rimosso nelle impostazioni o ha ricevuto un nuovo link. Apri il suo link attuale (impostazioni, scheda Tablets).',
            connecting: 'Connessione…',
            noKey: 'Apri il link di questo tablet dalle impostazioni di satellite-display (scheda Tablets).',
            refused:
                "Nessuna connessione. Il link è ancora quello delle impostazioni (scheda Tablets) e l'adattatore è in esecuzione?",
            wrong: 'PIN errato',
            wait: 'Troppi PIN errati, attendi {s} s',
            empty: "Ancora nessun riquadro: aggiungili nell'editor dei riquadri dell'adattatore o chiedi al tuo agente IA.",
            lock: 'Blocca',
            replaced: 'Questo tablet è aperto in un’altra finestra. Tocca qui per mostrarlo in questa.',
        },
        es: {
            outdated:
                'Este enlace está desactualizado: la tableta se eliminó en los ajustes o recibió un enlace nuevo. Abre su enlace actual (ajustes, pestaña Tablets).',
            connecting: 'Conectando…',
            noKey: 'Abre el enlace de esta tableta desde los ajustes de satellite-display (pestaña Tablets).',
            refused:
                '¿Sin conexión? ¿El enlace sigue siendo el de los ajustes (pestaña Tablets) y el adaptador está en marcha?',
            wrong: 'PIN incorrecto',
            wait: 'Demasiados PIN incorrectos, espera {s} s',
            empty: 'Aún no hay mosaicos: añádelos en el editor de mosaicos del adaptador o pídeselo a tu agente de IA.',
            lock: 'Bloquear',
            replaced: 'Esta tableta está abierta en otra ventana. Toca aquí para mostrarla en esta.',
        },
        pl: {
            outdated:
                'Ten link jest nieaktualny: tablet usunięto w ustawieniach albo dostał nowy link. Otwórz jego aktualny link (ustawienia, karta Tablets).',
            connecting: 'Łączenie…',
            noKey: 'Otwórz link tego tabletu z ustawień satellite-display (karta Tablets).',
            refused: 'Brak połączenia. Czy link to nadal ten z ustawień (karta Tablets) i czy adapter działa?',
            wrong: 'Błędny PIN',
            wait: 'Za dużo błędnych PIN-ów, poczekaj {s} s',
            empty: 'Brak kafelków: dodaj je w edytorze kafelków adaptera albo poproś agenta AI.',
            lock: 'Zablokuj',
            replaced: 'Ten tablet jest otwarty w innym oknie. Dotknij tutaj, aby pokazać go w tym.',
        },
        uk: {
            outdated:
                'Це посилання застаріло: планшет видалено в налаштуваннях або він отримав нове посилання. Відкрийте його актуальне посилання (налаштування, вкладка Tablets).',
            connecting: 'Підключення…',
            noKey: 'Відкрийте посилання цього планшета з налаштувань satellite-display (вкладка Tablets).',
            refused: 'Немає зв’язку. Посилання все ще те, що в налаштуваннях (вкладка Tablets), і адаптер запущено?',
            wrong: 'Неправильний PIN',
            wait: 'Забагато неправильних PIN, зачекайте {s} с',
            empty: 'Плиток поки немає: додайте їх у редакторі плиток адаптера або попросіть ШІ-агента.',
            lock: 'Заблокувати',
            replaced: 'Цей планшет відкрито в іншому вікні. Торкніться тут, щоб показати його в цьому.',
        },
        'zh-cn': {
            outdated:
                '此链接已过期：该平板电脑已在设置中删除或获得了新链接。请打开它的当前链接（设置，Tablets 选项卡）。',
            connecting: '正在连接…',
            noKey: '请从 satellite-display 的设置（Tablets 选项卡）中打开此平板电脑的链接。',
            refused: '无连接。链接是否仍是设置（Tablets 选项卡）中的链接，适配器是否在运行？',
            wrong: 'PIN 错误',
            wait: 'PIN 错误次数过多，请等待 {s} 秒',
            empty: '还没有磁贴：在适配器的磁贴编辑器中添加，或请你的 AI 代理添加。',
            lock: '锁定',
            replaced: '此平板电脑已在另一个窗口中打开。点按此处在此窗口中显示。',
        },
    };
    const lang = (() => {
        const l = String(navigator.language || 'en').toLowerCase();
        if (l.startsWith('zh')) {
            return 'zh-cn';
        }
        const base = l.split('-')[0];
        return TEXTS[base] ? base : 'en';
    })();
    const t = (key, vars = {}) =>
        String(TEXTS[lang][key] || TEXTS.en[key]).replace(/\{(\w+)\}/g, (_m, k) => String(vars[k] ?? ''));
    document.documentElement.lang = lang;

    // ---- SHA-256 (the PIN is checked here, also over plain HTTP where crypto.subtle is missing) ----------------

    const K = new Uint32Array([
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
        0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
        0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
        0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
        0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
        0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
        0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ]);

    /**
     * @param {string} text - Text
     * @returns {string} SHA-256 of its UTF-8 bytes, 64 hex digits
     */
    function sha256(text) {
        const bytes = new TextEncoder().encode(text);
        const len = bytes.length;
        const words = new Uint32Array((((len + 8) >> 6) + 1) * 16);
        for (let i = 0; i < len; i++) {
            words[i >> 2] |= bytes[i] << (24 - (i % 4) * 8);
        }
        words[len >> 2] |= 0x80 << (24 - (len % 4) * 8);
        words[words.length - 1] = len * 8;
        const h = new Uint32Array([
            0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
        ]);
        const w = new Uint32Array(64);
        const rotr = (x, n) => (x >>> n) | (x << (32 - n));
        for (let off = 0; off < words.length; off += 16) {
            for (let i = 0; i < 64; i++) {
                if (i < 16) {
                    w[i] = words[off + i];
                } else {
                    const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
                    const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
                    w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
                }
            }
            let [a, b, c, d, e, f, g, hh] = h;
            for (let i = 0; i < 64; i++) {
                const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
                const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
                hh = g;
                g = f;
                f = e;
                e = (d + t1) | 0;
                d = c;
                c = b;
                b = a;
                a = (t1 + t2) | 0;
            }
            h[0] += a;
            h[1] += b;
            h[2] += c;
            h[3] += d;
            h[4] += e;
            h[5] += f;
            h[6] += g;
            h[7] += hh;
        }
        return Array.from(h, x => x.toString(16).padStart(8, '0')).join('');
    }

    // ---- elements and helpers ----------------------------------------------------------------------------------

    const $ = id => document.getElementById(id);
    const pagesEl = $('pages');
    const noticeEl = $('notice');
    $('lockIcon').setAttribute('d', LOCK_PATH);
    $('padLockIcon').setAttribute('d', LOCK_PATH);
    $('lockButton').setAttribute('aria-label', t('lock'));

    /**
     * @param {string} tag - Element
     * @param {string} [cls] - Class names
     * @param {string} [text] - Text
     * @returns {HTMLElement} The element
     */
    function el(tag, cls, text) {
        const e = document.createElement(tag);
        if (cls) {
            e.className = cls;
        }
        if (text !== undefined) {
            e.textContent = text;
        }
        return e;
    }

    const SVG = 'http://www.w3.org/2000/svg';
    /**
     * @param {string} tag - SVG element
     * @param {Record<string, string | number>} attrs - Attributes
     * @returns {SVGElement} The element
     */
    function svg(tag, attrs = {}) {
        const e = document.createElementNS(SVG, tag);
        for (const [k, v] of Object.entries(attrs)) {
            e.setAttribute(k, String(v));
        }
        return e;
    }

    /**
     * @param {string} name - Icon of the firmware list
     * @returns {SVGElement | null} The icon, null when unknown
     */
    function iconEl(name) {
        const d = ICONS[String(name || '').replace(/^mdi:/, '')];
        if (!d) {
            return null;
        }
        const s = svg('svg', { viewBox: '0 0 24 24', class: 'icon' });
        s.appendChild(svg('path', { d }));
        return s;
    }

    /**
     * @param {number} color - 0xRRGGBB, 0 = none
     * @returns {string} CSS colour, '' for none
     */
    const cssColor = color => (color > 0 ? `#${(color & 0xffffff).toString(16).padStart(6, '0')}` : '');

    const formats = new Map();
    /**
     * @param {number} value - Number
     * @param {number} decimals - Decimals 0-3
     * @returns {string} The number in the language of the tablet
     */
    function fmt(value, decimals) {
        const d = Math.max(0, Math.min(3, Number(decimals) || 0));
        if (!formats.has(d)) {
            formats.set(
                d,
                new Intl.NumberFormat(navigator.language, { minimumFractionDigits: d, maximumFractionDigits: d }),
            );
        }
        return formats.get(d).format(value);
    }

    // ---- the tiles ---------------------------------------------------------------------------------------------

    /** @type {{cols: number, rows: number, pages: number}} */
    let grid = { cols: 4, rows: 3, pages: 4 };
    /** @type {Map<string, any>} "page/slot" → tile */
    const tiles = new Map();
    let renderQueued = false;
    /** @type {WebSocket | null} */
    let ws = null;

    const SIZES = { s: [1, 1], q: [1, 2], w: [2, 1], l: [2, 2] };
    const keyOf = (page, slot) => `${page}/${slot}`;

    /**
     * Sends a touch to the adapter.
     *
     * @param {any} tile - Tile
     * @param {string} input - switch, level, press or setpoint
     * @param {number} value - Its value
     */
    function sendInput(tile, input, value) {
        if (ws && ws.readyState === 1) {
            ws.send(JSON.stringify({ type: 'input', page: tile.page, slot: tile.slot, input, value }));
        }
    }

    /** Builds the pages again after the layout changed (once per batch of tile_set). */
    function queueRender() {
        if (!renderQueued) {
            renderQueued = true;
            requestAnimationFrame(render);
        }
    }

    function render() {
        renderQueued = false;
        const current = currentPage();
        pagesEl.textContent = '';
        const used = [...new Set([...tiles.values()].map(x => x.page))].sort((a, b) => a - b);
        if (!used.length) {
            if (ws && ws.readyState === 1 && configured) {
                showNotice(t('empty'));
            }
        } else if (noticeEl.dataset.kind === 'empty') {
            hideNotice();
        }
        for (const page of used) {
            const p = el('section', 'page');
            p.dataset.page = String(page);
            p.style.gridTemplateColumns = `repeat(${grid.cols}, 1fr)`;
            p.style.gridTemplateRows = `repeat(${grid.rows}, 1fr)`;
            for (const tile of [...tiles.values()].filter(x => x.page === page)) {
                p.appendChild(build(tile));
                update(tile);
            }
            pagesEl.appendChild(p);
        }
        drawDots();
        const back = used.indexOf(current);
        if (back > 0) {
            pagesEl.scrollLeft = back * pagesEl.clientWidth;
        }
        drawTitle();
    }

    /**
     * The DOM of a tile from its tile_set.
     *
     * @param {any} tile - Tile
     * @returns {HTMLElement} Its element
     */
    function build(tile) {
        const a = tile.args;
        const [w, h] = SIZES[a.size] || [1, 1];
        // value, bar, chart and switch go into one line when the tile is flat (the CSS decides by its shape)
        const rowable = ['value', 'bar', 'chart', 'switch'].includes(a.type);
        const e = el('div', `tile ${a.type} size-${a.size}${a.size === 'q' ? ' square' : ''}`);
        e.style.gridColumn = `${a.col + 1} / span ${w}`;
        e.style.gridRow = `${a.row + 1} / span ${h}`;
        const b = e.appendChild(el('div', `body${rowable ? ' rowable' : ''}`));
        tile.el = e;
        tile.parts = {};

        const head = el('div', 'head');
        const icon = iconEl(a.icon);
        if (icon && !(a.type === 'switch' && a.size === 'q')) {
            head.appendChild(icon);
        }
        if (a.label) {
            head.appendChild(el('span', 'label', a.label));
        }

        switch (a.type) {
            case 'value': {
                b.appendChild(head);
                tile.parts.value = b.appendChild(el('div', 'value', '–'));
                break;
            }
            case 'bar': {
                b.appendChild(head);
                tile.parts.value = b.appendChild(el('div', 'value', '–'));
                const bar = b.appendChild(el('div', 'meter'));
                tile.parts.fill = bar.appendChild(el('i'));
                break;
            }
            case 'chart': {
                b.appendChild(head);
                tile.parts.value = b.appendChild(el('div', 'value', '–'));
                const s = svg('svg', { class: 'chart', viewBox: '0 0 100 100', preserveAspectRatio: 'none' });
                tile.parts.line = s.appendChild(svg('polyline', { points: '' }));
                b.appendChild(s);
                break;
            }
            case 'gauge':
            case 'thermostat': {
                b.appendChild(head);
                const s = svg('svg', { class: 'arc', viewBox: '0 0 100 82' });
                const d = 'M 18.2 71.8 A 40 40 0 1 1 81.8 71.8';
                s.appendChild(
                    svg('path', {
                        d,
                        class: 'track',
                        fill: 'none',
                        'stroke-width': 9,
                        'stroke-linecap': 'round',
                        pathLength: 100,
                    }),
                );
                tile.parts.arc = s.appendChild(
                    svg('path', {
                        d,
                        class: 'fill',
                        fill: 'none',
                        'stroke-width': 9,
                        'stroke-linecap': 'round',
                        pathLength: 100,
                        'stroke-dasharray': '0 100',
                    }),
                );
                tile.parts.arcText = s.appendChild(svg('text', { x: 50, y: 52, 'font-size': 17 }));
                tile.parts.arcText.textContent = '–';
                b.appendChild(s);
                if (a.type === 'thermostat') {
                    const sp = b.appendChild(el('div', 'setpoint'));
                    const minus = sp.appendChild(el('button', '', '−'));
                    tile.parts.target = sp.appendChild(el('span', 'target', '–'));
                    const plus = sp.appendChild(el('button', '', '+'));
                    minus.addEventListener('click', ev => stepSetpoint(ev, tile, -1));
                    plus.addEventListener('click', ev => stepSetpoint(ev, tile, 1));
                    tile.parts.relay = b.appendChild(el('i', 'relay hidden'));
                }
                break;
            }
            case 'switch': {
                e.classList.add('touch');
                if (a.size === 'q' && icon) {
                    b.appendChild(icon);
                }
                b.appendChild(head);
                tile.parts.toggle = b.appendChild(el('div', 'toggle'));
                e.addEventListener('click', () => {
                    tile.on = !tile.on;
                    update(tile);
                    sendInput(tile, 'switch', tile.on ? 1 : 0);
                });
                break;
            }
            case 'dimmer': {
                const top = el('div', 'head');
                top.append(...head.childNodes);
                tile.parts.toggle = el('div', 'toggle');
                tile.parts.toggle.style.marginLeft = 'auto';
                top.appendChild(tile.parts.toggle);
                b.appendChild(top);
                const r = b.appendChild(el('div', 'dimmerRow'));
                const input = /** @type {HTMLInputElement} */ (el('input', 'level'));
                input.type = 'range';
                input.min = '0';
                input.max = '100';
                input.step = '1';
                tile.parts.level = r.appendChild(input);
                tile.parts.percent = r.appendChild(el('span', 'percent', '–'));
                tile.parts.toggle.addEventListener('click', () => {
                    tile.on = !tile.on;
                    update(tile);
                    sendInput(tile, 'switch', tile.on ? 1 : 0);
                });
                input.addEventListener('input', () => {
                    tile.dragging = true;
                    tile.value = Number(input.value);
                    update(tile);
                });
                // sent once when it is released, as the firmware does
                input.addEventListener('change', () => {
                    tile.dragging = false;
                    tile.value = Number(input.value);
                    tile.on = tile.value > 0;
                    update(tile);
                    sendInput(tile, 'level', tile.value);
                });
                break;
            }
            case 'button': {
                e.classList.add('touch');
                if (icon) {
                    b.appendChild(icon);
                }
                if (a.label) {
                    b.appendChild(el('span', 'label', a.label));
                }
                e.addEventListener('click', () => {
                    e.classList.add('pressed');
                    setTimeout(() => e.classList.remove('pressed'), 180);
                    sendInput(tile, 'press', 1);
                });
                break;
            }
            default:
                b.appendChild(head);
        }
        return e;
    }

    /**
     * - / + of a thermostat: the target moves at once, the adapter gets it a second after the last press.
     *
     * @param {Event} ev - Click
     * @param {any} tile - Thermostat
     * @param {number} dir - -1 or 1
     */
    function stepSetpoint(ev, tile, dir) {
        ev.stopPropagation();
        const a = tile.args;
        const step = tile.step > 0 ? tile.step : 0.5;
        const base = tile.setpoint ?? tile.value ?? a.min;
        const next = Math.round((base + dir * step) / step) * step;
        tile.setpoint = Math.max(a.min, Math.min(a.max, next));
        tile.pressing = true;
        update(tile);
        clearTimeout(tile.setpointTimer);
        tile.setpointTimer = setTimeout(() => {
            tile.pressing = false;
            sendInput(tile, 'setpoint', tile.setpoint);
        }, SETPOINT_DELAY_MS);
    }

    /**
     * Shows the current values of a tile in its elements.
     *
     * @param {any} tile - Tile
     */
    function update(tile) {
        const e = tile.el;
        if (!e) {
            return;
        }
        const a = tile.args;
        const p = tile.parts;
        const color = cssColor(tile.color);
        e.style.setProperty('--c', color || 'var(--accent)');
        e.style.background = cssColor(tile.background);
        const unit = a.unit ? `<span class="unit">${escapeHtml(a.unit)}</span>` : '';
        const number = v => (typeof v === 'number' ? fmt(v, a.decimals) : '–');
        const span = (min, max, v) => (max > min ? Math.max(0, Math.min(1, (v - min) / (max - min))) : 0);
        switch (a.type) {
            case 'value':
                // a text (e.g. "Geschlossen") is longer than a number: smaller, and it may wrap
                p.value.classList.toggle('text', tile.text !== undefined);
                if (tile.text !== undefined) {
                    p.value.textContent = tile.text;
                } else {
                    p.value.innerHTML = `${number(tile.value)}${typeof tile.value === 'number' ? unit : ''}`;
                }
                break;
            case 'bar':
                p.value.innerHTML = `${number(tile.value)}${typeof tile.value === 'number' ? unit : ''}`;
                p.fill.style.width = `${typeof tile.value === 'number' ? span(a.min, a.max, tile.value) * 100 : 0}%`;
                break;
            case 'chart': {
                p.value.innerHTML = `${number(tile.value)}${typeof tile.value === 'number' ? unit : ''}`;
                const pts = tile.points || [];
                let lo = a.min;
                let hi = a.max;
                if (!(hi > lo) && pts.length) {
                    lo = Math.min(...pts);
                    hi = Math.max(...pts);
                    if (hi === lo) {
                        lo -= 1;
                        hi += 1;
                    }
                }
                const n = Math.max(1, pts.length - 1);
                p.line.setAttribute(
                    'points',
                    pts
                        .map((v, i) => `${((i / n) * 100).toFixed(2)},${(96 - span(lo, hi, v) * 92).toFixed(2)}`)
                        .join(' '),
                );
                break;
            }
            case 'gauge':
            case 'thermostat': {
                const v = tile.value;
                p.arc.setAttribute(
                    'stroke-dasharray',
                    `${typeof v === 'number' ? span(a.min, a.max, v) * 100 : 0} 100`,
                );
                p.arcText.textContent =
                    typeof v === 'number' ? `${fmt(v, a.decimals)}${a.unit ? ` ${a.unit}` : ''}` : '–';
                if (a.type === 'thermostat') {
                    const sp = tile.setpoint;
                    const d = tile.step > 0 && tile.step < 1 ? 1 : 0;
                    p.target.textContent =
                        typeof sp === 'number'
                            ? `${fmt(sp, Math.max(d, a.decimals))}${a.unit ? ` ${a.unit}` : ''}`
                            : '–';
                    p.relay.classList.toggle('hidden', tile.relay === undefined);
                    p.relay.classList.toggle('on', tile.relay === true);
                }
                break;
            }
            case 'switch':
                p.toggle.classList.toggle('on', !!tile.on);
                p.toggle.style.display = tile.showToggle === false ? 'none' : '';
                e.classList.toggle('lit', !!tile.on);
                break;
            case 'dimmer': {
                p.toggle.classList.toggle('on', !!tile.on);
                e.classList.toggle('lit', !!tile.on);
                const v = typeof tile.value === 'number' ? Math.round(tile.value) : null;
                if (!tile.dragging && v !== null) {
                    p.level.value = String(v);
                }
                p.level.style.setProperty('--p', `${v ?? 0}%`);
                p.percent.textContent = v === null ? '–' : `${v} %`;
                break;
            }
            default:
                break;
        }
    }

    /**
     * @param {string} text - Text
     * @returns {string} The text, safe in HTML
     */
    function escapeHtml(text) {
        return String(text).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
    }

    /**
     * One action of the adapter (the actions of the satellite firmware, docs/TILES.md).
     *
     * @param {string} name - Action
     * @param {any} d - Its arguments
     */
    function onAction(name, d) {
        if (name === 'lock_config') {
            lockConfig(d);
            return;
        }
        if (name === 'lock_set') {
            setLocked(!!d.locked, true);
            return;
        }
        if (name === 'page_title') {
            const page = Number(d.page);
            const title = String(d.title ?? '').slice(0, 32);
            if (title) {
                pageTitles.set(page, title);
            } else {
                pageTitles.delete(page);
            }
            drawTitle();
            return;
        }
        if (name === 'tile_clear') {
            for (const [k, tile] of tiles) {
                if (!d.page || tile.page === d.page) {
                    tiles.delete(k);
                }
            }
            queueRender();
            return;
        }
        if (name === 'tile_set') {
            const tile = {
                page: d.page,
                slot: d.slot,
                args: {
                    ...d,
                    min: Number(d.min) || 0,
                    max: Number(d.max) || 0,
                    decimals: Number(d.decimals) || 0,
                },
                showToggle: true,
                color: 0,
                background: 0,
                points: [],
            };
            tiles.set(keyOf(d.page, d.slot), tile);
            queueRender();
            return;
        }
        const tile = tiles.get(keyOf(d.page, d.slot));
        if (!tile) {
            return; // a value for an empty slot is ignored, as on the satellite
        }
        switch (name) {
            case 'tile_value':
                tile.value = Number(d.value);
                tile.text = undefined;
                if (tile.args.type === 'dimmer' && tile.dragging) {
                    return;
                }
                if (tile.args.type === 'chart') {
                    tile.points.push(tile.value);
                    tile.points = tile.points.slice(-CHART_POINTS);
                }
                break;
            case 'tile_text':
                tile.text = String(d.value ?? '');
                break;
            case 'tile_state':
                if (tile.args.type === 'thermostat') {
                    tile.relay = !!d.on;
                } else {
                    tile.on = !!d.on;
                }
                break;
            case 'tile_history':
                tile.points = (Array.isArray(d.points) ? d.points : [])
                    .map(Number)
                    .filter(Number.isFinite)
                    .slice(-CHART_POINTS);
                break;
            case 'tile_color':
                tile.color = Number(d.color) || 0;
                break;
            case 'tile_background':
                tile.background = Number(d.color) || 0;
                break;
            case 'tile_toggle':
                tile.showToggle = d.show !== false;
                break;
            case 'tile_setpoint':
                tile.step = Number(d.step) || 0.5;
                // while - / + are pressed the screen keeps what the user set
                if (!tile.pressing) {
                    tile.setpoint = Number(d.value);
                }
                break;
            default:
                return;
        }
        update(tile);
    }

    // ---- pages, clock, idle ------------------------------------------------------------------------------------

    function currentPage() {
        const pages = pagesEl.querySelectorAll('.page');
        if (!pages.length || !pagesEl.clientWidth) {
            return 0;
        }
        const i = Math.round(pagesEl.scrollLeft / pagesEl.clientWidth);
        return Number(pages[Math.min(i, pages.length - 1)].dataset.page);
    }

    /** Titles of the pages (page_title): page → title */
    const pageTitles = new Map();

    /** The title of the page shown, next to the name of the tablet */
    function drawTitle() {
        $('pageTitle').textContent = pageTitles.get(currentPage()) || '';
    }

    function drawDots() {
        const dots = $('dots');
        const count = pagesEl.querySelectorAll('.page').length;
        dots.textContent = '';
        if (count < 2) {
            return;
        }
        const i = Math.round(pagesEl.scrollLeft / Math.max(1, pagesEl.clientWidth));
        for (let n = 0; n < count; n++) {
            dots.appendChild(el('i', n === i ? 'on' : ''));
        }
    }
    pagesEl.addEventListener(
        'scroll',
        () =>
            requestAnimationFrame(() => {
                drawDots();
                drawTitle();
            }),
        { passive: true },
    );

    function tick() {
        const now = new Date();
        $('clock').textContent = now.toLocaleTimeString(navigator.language, { hour: '2-digit', minute: '2-digit' });
    }
    tick();
    setInterval(tick, 10_000);

    let lastTouch = Date.now();
    document.addEventListener(
        'pointerdown',
        () => {
            lastTouch = Date.now();
        },
        { capture: true, passive: true },
    );
    setInterval(() => {
        const idle = Date.now() - lastTouch;
        if (idle > IDLE_MS && pagesEl.scrollLeft > 0) {
            pagesEl.scrollTo({ left: 0, behavior: 'smooth' });
        }
        if (lock.enabled && !lock.locked) {
            const limit = lock.mode === 0 ? lock.minutes * 60_000 : lock.mode === 1 ? IDLE_MS : 0;
            if (limit && idle > limit) {
                setLocked(true);
            }
        }
    }, 5000);

    // ---- screen lock (lock_config, as the firmware 2.1) -------------------------------------------------------

    const lock = {
        enabled: false,
        hash: '',
        length: 4,
        mode: 0,
        minutes: 5,
        locked: false,
        failed: 0,
        waitUntil: 0,
        typed: '',
    };
    let lockSeen = false;

    /** @param {any} d - lock_config */
    function lockConfig(d) {
        const was = lock.enabled;
        lock.enabled = !!d.enabled && /^[0-9a-f]{64}$/i.test(String(d.pin_hash || ''));
        lock.hash = String(d.pin_hash || '').toLowerCase();
        lock.length = Math.max(4, Math.min(6, Number(d.length) || 4));
        lock.mode = [0, 1, 2].includes(Number(d.mode)) ? Number(d.mode) : 0;
        lock.minutes = Math.max(1, Number(d.minutes) || 5);
        $('lockButton').hidden = !lock.enabled;
        if (!lock.enabled) {
            setLocked(false, true);
        } else if (!lockSeen || !was) {
            // after a start (of the app) a tablet with the lock on starts locked, as a satellite after a restart
            setLocked(true);
        } else {
            report();
        }
        lockSeen = true;
    }

    /**
     * @param {boolean} locked - Locked
     * @param {boolean} [quiet] - Do not report it (the adapter asked for it)
     */
    function setLocked(locked, quiet = false) {
        const next = lock.enabled && locked;
        if (next !== lock.locked || !quiet) {
            lock.locked = next;
            lock.typed = '';
            drawPad();
            report();
        }
    }

    function report() {
        if (ws && ws.readyState === 1 && lock.enabled) {
            ws.send(JSON.stringify({ type: 'lock', locked: lock.locked, failed: lock.failed }));
        }
    }

    function drawPad() {
        const pad = $('keypad');
        pad.hidden = !lock.locked;
        $('stars').textContent =
            '•'.repeat(lock.typed.length) + '◦'.repeat(Math.max(0, lock.length - lock.typed.length));
        const wait = Math.ceil((lock.waitUntil - Date.now()) / 1000);
        $('padMessage').textContent = wait > 0 ? t('wait', { s: wait }) : lock.failed ? t('wrong') : '';
    }

    function buildPad() {
        const keys = pad => pad.querySelector('.keys');
        const box = keys($('keypad'));
        for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫']) {
            const b = el('button', k ? '' : 'blank', k);
            b.type = 'button';
            b.addEventListener('click', () => key(k));
            box.appendChild(b);
        }
    }

    /** @param {string} k - Key of the keypad */
    function key(k) {
        if (!k || Date.now() < lock.waitUntil) {
            drawPad();
            return;
        }
        if (k === '⌫') {
            lock.typed = lock.typed.slice(0, -1);
        } else if (lock.typed.length < lock.length) {
            lock.typed += k;
        }
        if (lock.typed.length === lock.length) {
            if (sha256(`satellite-display:${lock.typed}`) === lock.hash) {
                lock.failed = 0;
                lock.typed = '';
                lastTouch = Date.now();
                setLocked(false);
                return;
            }
            lock.failed++;
            lock.typed = '';
            if (lock.failed % MAX_WRONG === 0) {
                lock.waitUntil = Date.now() + WAIT_MS;
                const timer = setInterval(() => {
                    drawPad();
                    if (Date.now() >= lock.waitUntil) {
                        clearInterval(timer);
                    }
                }, 1000);
            }
            report();
        }
        drawPad();
    }
    buildPad();
    $('lockButton').addEventListener('click', () => setLocked(true));

    // ---- notices -----------------------------------------------------------------------------------------------

    /**
     * @param {string} text - Text
     * @param {boolean} [block] - Cover the whole screen
     */
    function showNotice(text, block = false) {
        noticeEl.textContent = text;
        noticeEl.classList.toggle('block', block);
        noticeEl.dataset.kind = text === t('empty') ? 'empty' : '';
        noticeEl.hidden = false;
    }

    function hideNotice() {
        noticeEl.hidden = true;
    }

    // ---- the connection ----------------------------------------------------------------------------------------

    const accessKey = (() => {
        // the page of a tablet is /t/<key>/ (also the start page of the installed app); ?key= of older links
        const inPath = /^\/t\/([^/]+)\//.exec(location.pathname);
        let fromUrl = new URLSearchParams(location.search).get('key');
        if (inPath) {
            try {
                fromUrl = decodeURIComponent(inPath[1]);
            } catch {
                fromUrl = inPath[1];
            }
        }
        try {
            if (fromUrl) {
                localStorage.setItem('satellite-display.key', fromUrl);
                return fromUrl;
            }
            return localStorage.getItem('satellite-display.key') || '';
        } catch {
            return fromUrl || '';
        }
    })();

    /** Close code of the adapter: a newer connection of the same tablet took over (lib/tablet.js) */
    const REPLACED = 4000;
    /** Close code of the adapter: no tablet has this key (lib/tablet-server.js) */
    const UNKNOWN_KEY = 4001;
    let replacedHere = false;
    noticeEl.addEventListener('click', () => {
        if (replacedHere) {
            replacedHere = false;
            hideNotice();
            failures = 0;
            connect();
        }
    });

    let configured = false;
    let failures = 0;
    let retryTimer = 0;
    let connectingTimer = 0;

    function connect() {
        clearTimeout(retryTimer);
        if (ws && ws.readyState <= 1) {
            return;
        }
        const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?key=${encodeURIComponent(accessKey)}`;
        const socket = new WebSocket(url);
        ws = socket;
        let opened = false;
        clearTimeout(connectingTimer);
        connectingTimer = setTimeout(() => {
            if (socket.readyState !== 1) {
                showNotice(failures >= 3 ? t('refused') : t('connecting'));
            }
        }, 1500);
        socket.addEventListener('open', () => {
            opened = true;
            failures = 0;
            if (!replacedHere) {
                hideNotice();
            }
            $('link').classList.add('ok');
            socket.send(JSON.stringify({ type: 'hello', version: VERSION }));
        });
        socket.addEventListener('message', ev => {
            let msg;
            try {
                msg = JSON.parse(String(ev.data));
            } catch {
                return;
            }
            if (msg.type === 'config') {
                grid = msg.grid || grid;
                $('name').textContent = msg.name || '';
                // the keypad shows only the name of the tablet, never a page
                $('padName').textContent = msg.name || '';
                document.title = msg.name ? `${msg.name} - Tiles` : 'Tiles';
                configured = true;
                if (noticeEl.dataset.kind !== 'empty') {
                    hideNotice();
                }
                report();
            } else if (msg.type === 'action') {
                onAction(String(msg.name), msg.data || {});
            }
        });
        socket.addEventListener('close', ev => {
            if (ws !== socket) {
                return;
            }
            $('link').classList.remove('ok');
            if (ev.code === UNKNOWN_KEY) {
                // the key is not known (the tablet was removed or renamed away): say so, look again now and then
                showNotice(t('outdated'), true);
                retryTimer = setTimeout(connect, 30_000);
                return;
            }
            if (ev.code === REPLACED) {
                // the same link opened in another window (a browser tab next to the installed app): taking it back
                // at once would make the two windows throw each other out every second, so wait for a tap
                replacedHere = true;
                showNotice(t('replaced'), true);
                return;
            }
            if (!opened) {
                failures++;
            }
            const delay = Math.min(15_000, 1000 * 2 ** Math.min(failures, 4));
            retryTimer = setTimeout(connect, opened ? 1000 : delay);
            if (opened) {
                connectingTimer = setTimeout(() => showNotice(t('connecting')), 1500);
            }
        });
    }

    // back from the background (iOS closes the connection with the screen): connect at once
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            lastTouch = Date.now();
            if (!replacedHere && (!ws || ws.readyState > 1)) {
                failures = 0;
                connect();
            }
            keepAwake();
        }
    });

    // ---- keep the screen on, offline shell ---------------------------------------------------------------------

    let wakeLock = null;
    async function keepAwake() {
        try {
            if ('wakeLock' in navigator && document.visibilityState === 'visible' && !wakeLock) {
                wakeLock = await navigator.wakeLock.request('screen');
                wakeLock.addEventListener('release', () => {
                    wakeLock = null;
                });
            }
        } catch {
            // not allowed (no secure context, battery saver): the screen goes dark by the settings of the tablet
        }
    }

    if ('serviceWorker' in navigator && window.isSecureContext) {
        navigator.serviceWorker.register('sw.js').catch(() => undefined);
    }

    if (!accessKey) {
        showNotice(t('noKey'), true);
    } else {
        connect();
        keepAwake();
    }
})();
