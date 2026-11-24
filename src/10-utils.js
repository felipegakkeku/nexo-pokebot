    // --- Utilitários ---
    const isInsideHud = (el) => Boolean(el && el.closest && el.closest(`#${HUD_ID}`));
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const randomDelay = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

    const scheduleIdle = (fn) => {
        if (typeof window.requestIdleCallback === 'function') {
            window.requestIdleCallback(() => fn(), { timeout: 1000 });
        } else {
            setTimeout(fn, 0);
        }
    };

    const gmFetch = (url, options = {}) => {
        const gmReq = typeof GM_xmlhttpRequest === 'function' ? GM_xmlhttpRequest : window.GM_xmlhttpRequest;
        if (typeof gmReq === 'function') {
            return new Promise((resolve, reject) => {
                gmReq({
                    method: options.method || 'GET',
                    url,
                    headers: options.headers || {},
                    data: options.body ?? undefined,
                    timeout: options.timeoutMs || 15000,
                    onload: (res) => {
                        const textVal = res.responseText ?? '';
                        const headers = Object.create(null);
                        for (const line of String(res.responseHeaders || '').split(/\r?\n/)) {
                            const colon = line.indexOf(':');
                            if (colon > 0) headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
                        }
                        resolve({
                            ok: res.status >= 200 && res.status < 300,
                            status: res.status,
                            headers,
                            text: async () => textVal,
                            json: async () => JSON.parse(textVal),
                        });
                    },
                    onerror: (err) => reject(new Error(err?.error || 'GM_xmlhttpRequest failed')),
                    ontimeout: () => reject(new Error('GM_xmlhttpRequest timeout')),
                });
            });
        }
        return fetch(url, options);
    };

    const gmReadCookie = (domain, name) => {
        const gmCookie = typeof GM_cookie !== 'undefined' ? GM_cookie : window.GM_cookie;
        if (!gmCookie || typeof gmCookie.list !== 'function') return Promise.resolve(null);
        return new Promise((resolve) => {
            try {
                gmCookie.list({ domain, name }, (cookies, err) => {
                    if (err || !Array.isArray(cookies) || cookies.length === 0) {
                        resolve(null);
                        return;
                    }
                    resolve(cookies[0]?.value || null);
                });
            } catch {
                resolve(null);
            }
        });
    };

    const escapeHtml = (str) =>
        String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');

    const getDirectText = (el) => {
        if (!el) return 'Desconhecido';
        let text = '';
        for (const node of el.childNodes) {
            if (node.nodeType === Node.TEXT_NODE) text += node.textContent;
        }
        return text.trim() || 'Desconhecido';
    };

    const playBeep = (freq = 880, dur = 0.14) => {
        try {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return;
            const ctx = new Ctx();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = freq;
            gain.gain.value = 0.08;
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + dur);
        } catch {
            // Ignora bloqueio de áudio
        }
    };

    const isVisible = (el) => {
        if (!el || !el.isConnected || isInsideHud(el)) return false;
        if (el.offsetParent === null) {
            const style = window.getComputedStyle(el);
            if (style.position !== 'fixed' || style.display === 'none' || style.visibility === 'hidden') {
                return false;
            }
        }
        return true;
    };

    const isInteractable = (el) => {
        if (!isVisible(el)) return false;
        if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
        const style = window.getComputedStyle(el);
        return style.pointerEvents !== 'none' && parseFloat(style.opacity) >= 0.45;
    };

    const findClickableByText = (text, root = document, exact = false) => {
        const target = normalizeText(text);
        const matchFn = (el) => {
            const txt = normalizeText(el.textContent);
            return exact ? txt === target : txt.includes(target);
        };

        const primary = Array.from(root.querySelectorAll('button, a, [role="button"]')).filter(
            (el) => matchFn(el) && isInteractable(el)
        );
        if (primary.length > 0) {
            primary.sort((a, b) => (a.textContent || '').length - (b.textContent || '').length);
            return primary[0];
        }

        const fallback = Array.from(root.querySelectorAll('div, li, label')).filter((el) => {
            if (!isInteractable(el) || el.children.length > 4) return false;
            const style = window.getComputedStyle(el);
            return style.cursor === 'pointer' && matchFn(el);
        });
        fallback.sort((a, b) => (a.textContent || '').length - (b.textContent || '').length);
        return fallback[0] || null;
    };

    const findMenuButtonByImg = (srcPart) =>
        Array.from(document.querySelectorAll('button')).find(
            (btn) => isInteractable(btn) && Boolean(btn.querySelector(`img[src*="${srcPart}"]`))
        ) || null;

    const waitFor = async (conditionFn, timeoutMs = 4000, pollMs = 90) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            if (!state.running) return null;
            const res = conditionFn();
            if (res) return res;
            await sleep(pollMs);
        }
        return null;
    };

    const setStatus = (label, note = null) => {
        state.statusText = label;
        if (note) state.lastActionNote = note;
        updateHud();
    };

    const getVisibleModal = () => {
        const modals = Array.from(document.querySelectorAll('.modal-caixa, .modal')).filter(isVisible);
        return modals[modals.length - 1] || null;
    };

    const closeActiveModal = async () => {
        const closeById = document.getElementById('modal-fechar');
        if (closeById && isInteractable(closeById)) {
            closeById.click();
            await waitFor(() => !getVisibleModal(), 1400);
            await sleep(randomDelay(160, 240));
            return;
        }

        const modal = getVisibleModal();
        if (!modal) return;

        const closeBtn =
            modal.querySelector('.modal-acoes button') ||
            Array.from(modal.querySelectorAll('button, a')).find((btn) => {
                if (!isInteractable(btn)) return false;
                const txt = normalizeText(btn.textContent);
                const aria = normalizeText(btn.getAttribute('aria-label'));
                return (
                    txt === 'x' ||
                    txt === '×' ||
                    txt === '✕' ||
                    txt === 'fechar' ||
                    aria.includes('fechar') ||
                    aria.includes('close')
                );
            });

        if (closeBtn && isInteractable(closeBtn)) {
            closeBtn.click();
        } else {
            document.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true })
            );
        }

        await waitFor(() => !getVisibleModal(), 1400);
        await sleep(randomDelay(160, 240));
    };

    const confirmModalDialog = async (keywords = ['confirmar', 'vender', 'oferendar', 'sacrificar', 'evoluir', 'sim']) => {
        await sleep(randomDelay(220, 360));
        const directConfirm = document.getElementById('confirmar-sim');
        if (directConfirm && isInteractable(directConfirm)) {
            directConfirm.click();
            await sleep(randomDelay(260, 420));
            return true;
        }

        const topModal = getVisibleModal();
        if (!topModal) return false;

        const btn = Array.from(topModal.querySelectorAll('button')).find((b) => {
            if (!isInteractable(b)) return false;
            const txt = normalizeText(b.textContent);
            return keywords.some((kw) => txt === kw || txt.includes(kw));
        });
        if (btn) {
            btn.click();
            await sleep(randomDelay(260, 420));
            return true;
        }
        return false;
    };
