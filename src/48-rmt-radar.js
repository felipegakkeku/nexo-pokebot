    // --- 9. Radar RMT ---
    const parseRmtPriceEl = (priceEl) => {
        if (!priceEl) return null;
        const isGems =
            priceEl.classList.contains('orb') ||
            Boolean(priceEl.querySelector('img[src*="moeda-gema"]'));
        const value = parseNumber(priceEl.textContent);
        if (!value || value <= 0) return null;
        return { value, currency: isGems ? 'gemas' : 'coins' };
    };

    const scanMarketRadar = () => {
        if (!state.running || !CONFIG.radar.enabled || CONFIG.radar.alerts.length === 0) return;

        const title = normalizeText(document.getElementById('modal-titulo')?.textContent);
        if (!title.includes('mercado da comunidade')) return;

        const corpo = document.getElementById('modal-corpo');
        if (!corpo || !isVisible(corpo)) return;

        const hits = [];

        corpo.querySelectorAll('.cm-card').forEach((card) => {
            if (!isVisible(card)) return;
            const nameText = card.querySelector('.cm-nome-txt')?.textContent?.trim() || '';
            const priceInfo = parseRmtPriceEl(card.querySelector('.cm-rodape .cm-preco'));
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
                    if (CONFIG.radar.soundAlert) playBeep(960, 0.18);
                    state.lastActionNote = `RMT! ${nameText} por ${priceInfo.value.toLocaleString('pt-BR')} ${priceInfo.currency}`;
                }

                if (rule.autoComprar) {
                    const buyBtn = card.querySelector('button.cm-btn.comprar');
                    if (buyBtn && isInteractable(buyBtn) && !buyBtn.classList.contains('cm-retido')) {
                        buyBtn.click();
                        state.lastActionNote = `Compra RMT: ${nameText}`;
                    }
                }
            }
        });

        corpo.querySelectorAll('button.cmi-linha').forEach((row) => {
            if (!isVisible(row)) return;
            const itemName = row.querySelector('.cmi-nome b')?.textContent?.trim() || '';
            if (!itemName) return;

            const normName = normalizeText(itemName);
            const priceNodes = Array.from(row.querySelectorAll('.cmi-precos .cmi-de:not(.nada) .cm-preco'));

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
                        if (CONFIG.radar.soundAlert) playBeep(960, 0.18);
                        state.lastActionNote = `RMT Item! ${itemName} por ${priceInfo.value.toLocaleString('pt-BR')} ${priceInfo.currency}`;
                    }
                }
            }
        });

        state.radarHits = hits;
    };

    const adicionarAlertaRadar = ({ nome, maxPreco, moeda = 'coins', autoComprar = false }) => {
        if (!nome || !maxPreco) return false;
        CONFIG.radar.alerts.push({
            nome: String(nome).trim(),
            maxPreco: Number(maxPreco),
            moeda: normalizeText(moeda),
            autoComprar: Boolean(autoComprar),
        });
        persistPrefs();
        renderAlertList();
        return true;
    };

    const removerAlertaRadar = (index) => {
        if (index < 0 || index >= CONFIG.radar.alerts.length) return;
        CONFIG.radar.alerts.splice(index, 1);
        persistPrefs();
        renderAlertList();
    };
