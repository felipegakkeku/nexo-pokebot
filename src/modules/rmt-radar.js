// Radar RMT: varre o Mercado da Comunidade aberto, destaca ofertas dentro dos alertas e (se pedido) compra.
// Comportamento idêntico ao da v6.5; só mudou de lugar.
import { normalizeText, parseNumber } from './pure.js';

const SEL_LOCAL = {
    modalTitulo: '#modal-titulo',
    modalCorpo: '#modal-corpo',
    card: '.cm-card',
    cardNome: '.cm-nome-txt',
    cardPreco: '.cm-rodape .cm-preco',
    cardComprar: 'button.cm-btn.comprar',
    itemLinha: 'button.cmi-linha',
    itemNome: '.cmi-nome b',
    itemPrecos: '.cmi-precos .cmi-de:not(.nada) .cm-preco',
    gemaImg: 'img[src*="moeda-gema"]',
};

export const parseRmtPriceEl = (priceEl) => {
    if (!priceEl) return null;
    const isGems =
        priceEl.classList.contains('orb') ||
        Boolean(priceEl.querySelector(SEL_LOCAL.gemaImg));
    const value = parseNumber(priceEl.textContent);
    if (!value || value <= 0) return null;
    return { value, currency: isGems ? 'gemas' : 'coins' };
};

const scan = (ctx) => {
    const { CONFIG, state, dom } = ctx;
    if (!state.running || !CONFIG.radar.enabled || CONFIG.radar.alerts.length === 0) return;

    const title = normalizeText(dom.$(SEL_LOCAL.modalTitulo)?.textContent);
    if (!title.includes('mercado da comunidade')) return;

    const corpo = dom.$(SEL_LOCAL.modalCorpo);
    if (!corpo || !dom.isVisible(corpo)) return;

    const hits = [];

    corpo.querySelectorAll(SEL_LOCAL.card).forEach((card) => {
        if (!dom.isVisible(card)) return;
        const nameText = card.querySelector(SEL_LOCAL.cardNome)?.textContent?.trim() || '';
        const priceInfo = parseRmtPriceEl(card.querySelector(SEL_LOCAL.cardPreco));
        if (!nameText || !priceInfo) return;

        const normName = normalizeText(nameText);
        for (const rule of CONFIG.radar.alerts) {
            if (!normName.includes(normalizeText(rule.nome))) continue;
            if (rule.moeda !== 'todas' && rule.moeda !== priceInfo.currency) continue;
            if (priceInfo.value > rule.maxPreco) continue;

            card.style.outline = '2px solid #22c55e';
            card.style.boxShadow = '0 0 12px rgba(34,197,94,0.55)';

            const hitKey = `pk_${normName}_${priceInfo.value}_${priceInfo.currency}`;
            hits.push({ nome: nameText, preco: priceInfo.value, moeda: priceInfo.currency });

            if (!state.radarNotifiedKeys.has(hitKey)) {
                state.radarNotifiedKeys.add(hitKey);
                if (CONFIG.radar.soundAlert) dom.playBeep(960, 0.18);
                state.lastActionNote = `RMT! ${nameText} por ${priceInfo.value.toLocaleString('pt-BR')} ${priceInfo.currency}`;
            }

            if (rule.autoComprar) {
                const buyBtn = card.querySelector(SEL_LOCAL.cardComprar);
                if (buyBtn && dom.isInteractable(buyBtn) && !buyBtn.classList.contains('cm-retido')) {
                    buyBtn.click();
                    state.lastActionNote = `Compra RMT: ${nameText}`;
                }
            }
        }
    });

    corpo.querySelectorAll(SEL_LOCAL.itemLinha).forEach((row) => {
        if (!dom.isVisible(row)) return;
        const itemName = row.querySelector(SEL_LOCAL.itemNome)?.textContent?.trim() || '';
        if (!itemName) return;

        const normName = normalizeText(itemName);
        const priceNodes = Array.from(row.querySelectorAll(SEL_LOCAL.itemPrecos));

        for (const pNode of priceNodes) {
            const priceInfo = parseRmtPriceEl(pNode);
            if (!priceInfo) continue;

            for (const rule of CONFIG.radar.alerts) {
                if (!normName.includes(normalizeText(rule.nome))) continue;
                if (rule.moeda !== 'todas' && rule.moeda !== priceInfo.currency) continue;
                if (priceInfo.value > rule.maxPreco) continue;

                row.style.outline = '2px solid #22c55e';
                row.style.boxShadow = '0 0 12px rgba(34,197,94,0.55)';

                const hitKey = `it_${normName}_${priceInfo.value}_${priceInfo.currency}`;
                hits.push({ nome: itemName, preco: priceInfo.value, moeda: priceInfo.currency });

                if (!state.radarNotifiedKeys.has(hitKey)) {
                    state.radarNotifiedKeys.add(hitKey);
                    if (CONFIG.radar.soundAlert) dom.playBeep(960, 0.18);
                    state.lastActionNote = `RMT Item! ${itemName} por ${priceInfo.value.toLocaleString('pt-BR')} ${priceInfo.currency}`;
                }
            }
        }
    });

    state.radarHits = hits;
};

const addAlert = ({ CONFIG, storage, hud }, { nome, maxPreco, moeda = 'coins', autoComprar = false }) => {
    if (!nome || !maxPreco) return false;
    CONFIG.radar.alerts.push({
        nome: String(nome).trim(),
        maxPreco: Number(maxPreco),
        moeda: normalizeText(moeda),
        autoComprar: Boolean(autoComprar),
    });
    storage.persistPrefs();
    hud.renderAlertList();
    return true;
};

const removeAlert = ({ CONFIG, storage, hud }, index) => {
    if (index < 0 || index >= CONFIG.radar.alerts.length) return;
    CONFIG.radar.alerts.splice(index, 1);
    storage.persistPrefs();
    hud.renderAlertList();
};

export const rmtRadar = {
    id: 'rmtRadar',
    everyMs: (ctx) => ctx.CONFIG.radar.checkIntervalMs,
    tick: scan,
    addAlert,
    removeAlert,
};
