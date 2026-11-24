    // --- 13. HUD 3 Abas (Isolado com CSS contain + Dirty-Checking) ---
    const injectHudStyles = () => {
        document.getElementById(STYLE_ID)?.remove();
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            #${HUD_ID} {
                position: fixed; z-index: 99999; width: 304px;
                contain: layout style paint;
                font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
                font-size: 11.5px; color: #e8eef8;
                background: rgba(13, 18, 29, 0.94); backdrop-filter: blur(8px);
                border: 1px solid rgba(114, 152, 255, 0.38); border-radius: 10px;
                box-shadow: 0 10px 28px rgba(0, 0, 0, 0.58); user-select: none; overflow: hidden;
            }
            #${HUD_ID}.min { width: auto; min-width: 210px; }
            #${HUD_ID} .pb-head {
                display: flex; align-items: center; justify-content: space-between;
                padding: 7px 9px; background: rgba(34, 48, 78, 0.88); cursor: grab;
                border-bottom: 1px solid rgba(255,255,255,0.08);
            }
            #${HUD_ID} .pb-head:active { cursor: grabbing; }
            #${HUD_ID} .pb-title { display: flex; align-items: center; gap: 6px; font-weight: 700; }
            #${HUD_ID} .pb-dot { width: 8px; height: 8px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 6px #22c55e; }
            #${HUD_ID} .pb-dot.warn { background: #f59e0b; box-shadow: 0 0 6px #f59e0b; }
            #${HUD_ID} .pb-dot.shiny { background: #fde047; box-shadow: 0 0 8px #fde047; }
            #${HUD_ID} .pb-dot.off { background: #ef4444; box-shadow: none; }
            #${HUD_ID} .pb-head-btns { display: flex; gap: 4px; }
            #${HUD_ID} .pb-icon-btn {
                border: none; background: rgba(255,255,255,0.12); color: #e8eef8;
                width: 20px; height: 20px; border-radius: 5px; cursor: pointer; font-size: 12px; padding: 0;
            }
            #${HUD_ID} .pb-tabs { display: grid; grid-template-columns: repeat(4, 1fr); background: rgba(255,255,255,0.04); }
            #${HUD_ID} .pb-tab {
                border: none; background: transparent; color: #94a3b8; padding: 6px 4px;
                font-size: 11px; font-weight: 600; cursor: pointer; border-bottom: 2px solid transparent;
            }
            #${HUD_ID} .pb-tab.on { color: #ffffff; border-bottom-color: #60a5fa; background: rgba(59,130,246,0.14); }
            #${HUD_ID}.min .pb-tabs, #${HUD_ID}.min .pb-body { display: none; }
            #${HUD_ID} .pb-body { padding: 8px 9px; display: flex; flex-direction: column; gap: 7px; }
            #${HUD_ID} .pb-pane { display: none; flex-direction: column; gap: 7px; }
            #${HUD_ID} .pb-pane.on { display: flex; }
            #${HUD_ID} .pb-grid {
                display: grid; grid-template-columns: 1fr 1fr; gap: 4px 8px;
                background: rgba(255,255,255,0.04); padding: 6px 7px; border-radius: 6px;
            }
            #${HUD_ID} .pb-row { display: flex; justify-content: space-between; gap: 4px; }
            #${HUD_ID} .pb-lbl { color: #94a3b8; font-size: 10.5px; }
            #${HUD_ID} .pb-val { font-weight: 600; color: #f8fafc; font-size: 10.5px; text-align: right; }
            #${HUD_ID} .pb-span2 { grid-column: span 2; }
            #${HUD_ID} .pb-sec { font-size: 10px; text-transform: uppercase; color: #94a3b8; letter-spacing: 0.4px; }
            #${HUD_ID} .pb-modes { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
            #${HUD_ID} .pb-btn {
                border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.06);
                color: #dbe6f6; border-radius: 6px; padding: 5px 4px; font-size: 10.5px; font-weight: 600; cursor: pointer;
            }
            #${HUD_ID} .pb-btn:hover { background: rgba(114, 152, 255, 0.22); }
            #${HUD_ID} .pb-btn.on { background: rgba(59, 130, 246, 0.35); border-color: #60a5fa; color: #fff; }
            #${HUD_ID} .pb-toggles { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
            #${HUD_ID} .pb-tog {
                display: flex; align-items: center; justify-content: space-between;
                padding: 4px 6px; border-radius: 6px; background: rgba(255,255,255,0.04);
                border: 1px solid rgba(255,255,255,0.08); cursor: pointer; font-size: 10.5px;
            }
            #${HUD_ID} .pb-tog.on { border-color: rgba(34, 197, 94, 0.55); background: rgba(34, 197, 94, 0.13); }
            #${HUD_ID} .pb-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
            #${HUD_ID} .pb-actions3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }
            #${HUD_ID} .pb-actions4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
            #${HUD_ID} .pb-actions5 { display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px; }
            #${HUD_ID} .pb-grid-cfg {
                display: grid; grid-template-columns: 1fr 1fr; gap: 5px 6px;
                background: rgba(255,255,255,0.04); padding: 6px 7px; border-radius: 6px;
            }
            #${HUD_ID} .pb-cfg-field { display: flex; flex-direction: column; gap: 2px; }
            #${HUD_ID} .pb-form { display: grid; grid-template-columns: 1fr 74px 54px; gap: 4px; }
            #${HUD_ID} input, #${HUD_ID} select, #${HUD_ID} textarea {
                background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.15);
                color: #f8fafc; border-radius: 5px; padding: 4px 5px; font-size: 10.5px; width: 100%; box-sizing: border-box;
                user-select: text; -webkit-user-select: text; font-family: inherit;
            }
            #${HUD_ID} textarea { resize: vertical; min-height: 34px; max-height: 120px; }
            #${HUD_ID} .pb-list {
                max-height: 78px; overflow-y: auto; display: flex; flex-direction: column; gap: 3px;
                background: rgba(255,255,255,0.03); padding: 4px 5px; border-radius: 6px;
            }
            #${HUD_ID} .pb-chips { display: flex; flex-wrap: wrap; gap: 4px; }
            #${HUD_ID} .pb-chip {
                border: 1px solid rgba(96,165,250,0.45); background: rgba(59,130,246,0.18);
                color: #e0f2fe; border-radius: 5px; padding: 2px 6px; font-size: 10.5px; cursor: pointer;
            }
            #${HUD_ID} .pb-chip:hover { background: rgba(59,130,246,0.38); }
            #${HUD_ID} .pb-item { display: flex; justify-content: space-between; align-items: center; gap: 4px; font-size: 10.5px; }
            #${HUD_ID} .pb-del { border: none; background: rgba(239,68,68,0.22); color: #fca5a5; border-radius: 4px; cursor: pointer; padding: 1px 5px; font-size: 10px; }
            #${HUD_ID} .pb-note {
                font-size: 10px; color: #93c5fd; white-space: nowrap; overflow: hidden;
                text-overflow: ellipsis; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 5px;
            }
        `;
        document.head.appendChild(style);
    };

    const renderAlertList = () => {
        const alertList = state.hudEl?.querySelector('[data-pb="alertList"]');
        if (!alertList) return;
        alertList.innerHTML =
            CONFIG.radar.alerts.length === 0
                ? 'Nenhum alerta configurado.'
                : CONFIG.radar.alerts
                      .map(
                          (a, idx) =>
                              `<div class="pb-item"><span>${escapeHtml(a.nome)} ≤ ${a.maxPreco.toLocaleString('pt-BR')} ${escapeHtml(a.moeda)}</span><button class="pb-del" data-pb-del="${idx}">×</button></div>`
                      )
                      .join('');
    };

    const renderQuizCandidates = () => {
        const quizList = state.hudEl?.querySelector('[data-pb="quizList"]');
        if (!quizList) return;

        const sig = `${state.dexCatalog.length}|${state.miniGameMatches.join(',')}`;
        if (sig === state.lastQuizSigRendered) return;
        state.lastQuizSigRendered = sig;

        if (state.dexCatalog.length === 0) {
            quizList.textContent = 'Baixe o .csv na Pokedex e importe abaixo.';
        } else if (state.miniGameMatches.length === 0) {
            quizList.textContent = 'Abra o Mini Games durante uma rodada com pistas.';
        } else {
            quizList.innerHTML = `<div class="pb-chips">${state.miniGameMatches
                .map((name) => `<button class="pb-chip" data-pb-guess="${escapeHtml(name)}">${escapeHtml(name)}</button>`)
                .join('')}</div>`;
        }
    };

    const mountHud = () => {
        document.getElementById(HUD_ID)?.remove();
        injectHudStyles();
        state.hudCache = {};

        const hud = document.createElement('div');
        hud.id = HUD_ID;
        if (CONFIG.hud.minimized) hud.classList.add('min');
        hud.style.left = `${CONFIG.hud.left}px`;
        hud.style.top = `${CONFIG.hud.top}px`;

        hud.innerHTML = `
            <div class="pb-head" data-pb-drag="1">
                <div class="pb-title">
                    <span class="pb-dot" data-pb="dot"></span>
                    <span data-pb="headTitle">Nexo PokeBot v${VERSION}</span>
                </div>
                <div class="pb-head-btns">
                    <button class="pb-icon-btn" data-pb-act="min" title="Minimizar">—</button>
                    <button class="pb-icon-btn" data-pb-act="stop" title="Encerrar">×</button>
                </div>
            </div>
            <div class="pb-tabs">
                <button class="pb-tab" data-pb-tab="geral">Geral</button>
                <button class="pb-tab" data-pb-tab="modulos">Módulos</button>
                <button class="pb-tab" data-pb-tab="lives">Lives</button>
                <button class="pb-tab" data-pb-tab="radar">Radar/Quiz</button>
            </div>
            <div class="pb-body">
                <div class="pb-pane" data-pb-pane="geral">
                    <div class="pb-grid">
                        <div class="pb-row pb-span2"><span class="pb-lbl">Pokémon</span><span class="pb-val" data-pb="poke">-</span></div>
                        <div class="pb-row pb-span2"><span class="pb-lbl">Região</span><span class="pb-val" data-pb="regiao">-</span></div>
                        <div class="pb-row"><span class="pb-lbl">XP/h</span><span class="pb-val" data-pb="xpH">-</span></div>
                        <div class="pb-row"><span class="pb-lbl">Lucro/h</span><span class="pb-val" data-pb="lucroH">-</span></div>
                        <div class="pb-row"><span class="pb-lbl">Bônus / Dia</span><span class="pb-val" data-pb="xpBonus">-</span></div>
                        <div class="pb-row"><span class="pb-lbl">Fila /hunt</span><span class="pb-val" data-pb="huntQueue">0</span></div>
                        <div class="pb-row"><span class="pb-lbl">Capturas</span><span class="pb-val" data-pb="caps">0</span></div>
                        <div class="pb-row"><span class="pb-lbl">B/P/R</span><span class="pb-val" data-pb="inv">-</span></div>
                    </div>
                    <div class="pb-sec">Modo de Farm</div>
                    <div class="pb-modes">
                        <button class="pb-btn" data-pb-mode="xp">XP</button>
                        <button class="pb-btn" data-pb-mode="ouro">Ouro</button>
                        <button class="pb-btn" data-pb-mode="equilibrado">Equil.</button>
                        <button class="pb-btn" data-pb-mode="topcatch">Catch</button>
                    </div>
                    <div class="pb-actions3">
                        <button class="pb-btn" data-pb-act="syncGuide">Montar Fila</button>
                        <button class="pb-btn" data-pb-act="nextQueue">Próx. Fila</button>
                        <button class="pb-btn" data-pb-act="copyActiveSheet">Copiar Ficha</button>
                    </div>
                    <div class="pb-actions">
                        <button class="pb-btn" data-pb-act="copyHub">Ficha + abrir Hub</button>
                    </div>
                    <div class="pb-sec">Fila Manual (cole do Hub)</div>
                    <textarea id="pb-manual-queue" rows="2" placeholder="Kakuna Nv 10 &gt; Magnemite Nv 10 ..."></textarea>
                    <div class="pb-actions3">
                        <button class="pb-btn" data-pb-act="loadManual">Carregar</button>
                        <button class="pb-btn" data-pb-act="loadManualGo">Carregar e ir</button>
                        <button class="pb-btn" data-pb-act="clearQueue">Limpar</button>
                    </div>
                    <div class="pb-actions">
                        <button class="pb-btn" data-pb-act="optimize">Otimizar Mapa</button>
                        <button class="pb-btn" data-pb-act="hop">Próx. TopCatch</button>
                        <button class="pb-btn" data-pb-act="restock">Restock Agora</button>
                        <button class="pb-btn" data-pb-act="pause" data-pb="pauseBtn">Pausar</button>
                    </div>
                </div>

                <div class="pb-pane" data-pb-pane="modulos">
                    <div class="pb-toggles">
                        <div class="pb-tog" data-pb-tog="caidos"><span>Auto-Catch</span><b data-pb-tval="caidos">ON</b></div>
                        <div class="pb-tog" data-pb-tog="smartBall"><span>Bola Intelig.</span><b data-pb-tval="smartBall">ON</b></div>
                        <div class="pb-tog" data-pb-tog="shinyGuard"><span>Shiny Guard</span><b data-pb-tval="shinyGuard">ON</b></div>
                        <div class="pb-tog" data-pb-tog="restock"><span>Restock</span><b data-pb-tval="restock">ON</b></div>
                        <div class="pb-tog" data-pb-tog="upgradeBalls"><span>Upgrade Bola</span><b data-pb-tval="upgradeBalls">ON</b></div>
                        <div class="pb-tog" data-pb-tog="restockRevive"><span>Restock Revive</span><b data-pb-tval="restockRevive">OFF</b></div>
                        <div class="pb-tog" data-pb-tog="topCatchHop"><span>TopCatch Hop</span><b data-pb-tval="topCatchHop">OFF</b></div>
                        <div class="pb-tog" data-pb-tog="dailyPass"><span>Auto-Passe</span><b data-pb-tval="dailyPass">ON</b></div>
                        <div class="pb-tog" data-pb-tog="incubator"><span>Chocadeira</span><b data-pb-tval="incubator">OFF</b></div>
                        <div class="pb-tog" data-pb-tog="autoRegion"><span>Auto-Mapa</span><b data-pb-tval="autoRegion">ON</b></div>
                        <div class="pb-tog" data-pb-tog="evolve"><span>Auto-Evoluir</span><b data-pb-tval="evolve">OFF</b></div>
                        <div class="pb-tog" data-pb-tog="depotMode"><span>Depot</span><b data-pb-tval="depotMode">OFF</b></div>
                        <div class="pb-tog pb-span2" data-pb-tog="teamMode"><span>Equipe / Dia Sazonal</span><b data-pb-tval="teamMode">OFF</b></div>
                        <div class="pb-tog pb-span2" data-pb-tog="queueFallback"><span>Fila: Fallback Seguro</span><b data-pb-tval="queueFallback">ON</b></div>
                        <div class="pb-tog pb-span2" data-pb-tog="bossPriority"><span>Auto-Boss (Rotação)</span><b data-pb-tval="bossPriority">OFF</b></div>
                        <div class="pb-tog pb-span2" data-pb-tog="prey"><span>Auto-Prey (Caçada)</span><b data-pb-tval="prey">ON</b></div>
                    </div>
                    <div class="pb-sec">Configurações (Bola &amp; Restock)</div>
                    <div class="pb-grid-cfg">
                        <label class="pb-cfg-field">
                            <span class="pb-lbl">Bola</span>
                            <select data-pb-cfg="preferredBall">
                                <option value="auto">Auto Intelig.</option>
                                <option value="poke">Poke Ball</option>
                                <option value="great">Great Ball</option>
                                <option value="super">Super Ball</option>
                                <option value="ultra">Ultra Ball</option>
                                <option value="beast">Beast Ball</option>
                            </select>
                        </label>
                        <label class="pb-cfg-field">
                            <span class="pb-lbl">Nv p/ Ultra</span>
                            <input type="number" min="1" max="200" data-pb-cfg="highLevelUltraThreshold" />
                        </label>
                        <label class="pb-cfg-field">
                            <span class="pb-lbl">Alvo Bolas</span>
                            <input type="number" min="10" max="5000" step="10" data-pb-cfg="targetBalls" />
                        </label>
                        <label class="pb-cfg-field">
                            <span class="pb-lbl">Alvo Poções</span>
                            <input type="number" min="0" max="5000" step="10" data-pb-cfg="targetPotions" />
                        </label>
                        <label class="pb-cfg-field">
                            <span class="pb-lbl">Reserva Gold</span>
                            <input type="number" min="0" step="10000" data-pb-cfg="minGoldReserve" />
                        </label>
                    </div>
                    <div class="pb-sec">Executar Agora</div>
                    <div class="pb-actions5">
                        <button class="pb-btn" data-pb-act="runDepot">Depot</button>
                        <button class="pb-btn" data-pb-act="runPass">Passe</button>
                        <button class="pb-btn" data-pb-act="runPrey">Prey</button>
                        <button class="pb-btn" data-pb-act="runEggs">Ovos</button>
                        <button class="pb-btn" data-pb-act="runBoss">Boss</button>
                    </div>
                </div>

                <div class="pb-pane" data-pb-pane="lives">
                    <div class="pb-grid">
                        <div class="pb-row pb-span2"><span class="pb-lbl">Twitch</span><span class="pb-val" data-pb="liveTwitchInfo">-</span></div>
                        <div class="pb-row pb-span2"><span class="pb-lbl">Kick</span><span class="pb-val" data-pb="liveKickInfo">-</span></div>
                        <div class="pb-row pb-span2"><span class="pb-lbl">Pings / Baús / Resg.</span><span class="pb-val" data-pb="liveStatsInfo">0 / 0 / 0</span></div>
                    </div>
                    <div class="pb-toggles">
                        <div class="pb-tog pb-span2" data-pb-tog="liveEnabled"><span>Auto-Lives (Ping &amp; Resgate)</span><b data-pb-tval="liveEnabled">OFF</b></div>
                        <div class="pb-tog" data-pb-tog="liveWatchTwitch"><span>Twitch Leve</span><b data-pb-tval="liveWatchTwitch">ON</b></div>
                        <div class="pb-tog" data-pb-tog="liveWatchKick"><span>Kick Leve</span><b data-pb-tval="liveWatchKick">ON</b></div>
                        <div class="pb-tog" data-pb-tog="liveAutoClaimChest"><span>Baú +50 (TW)</span><b data-pb-tval="liveAutoClaimChest">ON</b></div>
                        <div class="pb-tog" data-pb-tog="liveAutoRedeem"><span>Auto-Resgatar</span><b data-pb-tval="liveAutoRedeem">ON</b></div>
                    </div>
                    <div class="pb-grid-cfg">
                        <label class="pb-cfg-field">
                            <span class="pb-lbl">Bônus Alvo</span>
                            <select data-pb-cfg="liveRewardType">
                                <option value="xp">XP (+15%)</option>
                                <option value="captura">Captura (+15%)</option>
                                <option value="shiny">Shiny Lure (+15%)</option>
                            </select>
                        </label>
                        <label class="pb-cfg-field">
                            <span class="pb-lbl">Guarda (min)</span>
                            <input type="number" min="0" max="600" data-pb-cfg="liveGuardThresholdMin" />
                        </label>
                        <label class="pb-cfg-field">
                            <span class="pb-lbl">Lives Twitch</span>
                            <input type="number" min="1" max="12" data-pb-cfg="liveMaxTwitchSlots" />
                        </label>
                        <label class="pb-cfg-field">
                            <span class="pb-lbl">Lives Kick</span>
                            <input type="number" min="1" max="12" data-pb-cfg="liveMaxKickSlots" />
                        </label>
                        <label class="pb-cfg-field pb-span2">
                            <span class="pb-lbl">Token Twitch (auth-token)</span>
                            <input type="password" data-pb-cfg="liveTwitchToken" placeholder="Auto (cookie) ou cole auth-token" />
                        </label>
                        <label class="pb-cfg-field pb-span2">
                            <span class="pb-lbl">Token Kick (session_token)</span>
                            <input type="password" data-pb-cfg="liveKickToken" placeholder="Auto (cookie) ou cole session_token" />
                        </label>
                        <label class="pb-cfg-field">
                            <span class="pb-lbl">Canais TW (extra)</span>
                            <input type="text" data-pb-cfg="liveCustomTwitch" placeholder="canal1, canal2" />
                        </label>
                        <label class="pb-cfg-field">
                            <span class="pb-lbl">Canais KK (extra)</span>
                            <input type="text" data-pb-cfg="liveCustomKick" placeholder="slug1, slug2" />
                        </label>
                    </div>
                    <div class="pb-actions">
                        <button class="pb-btn" data-pb-act="runLives">Rodar Lives Agora</button>
                        <button class="pb-btn" data-pb-act="syncLives">Ler Canais do Jogo</button>
                        <button class="pb-btn pb-span2" data-pb-act="copyHeadless">Copiar Sessão Headless</button>
                    </div>
                </div>

                <div class="pb-pane" data-pb-pane="radar">
                    <div class="pb-sec">Radar RMT (Mercado da Comunidade)</div>
                    <div class="pb-form">
                        <input type="text" data-pb-in="rName" placeholder="Ex: Garchomp" />
                        <input type="number" data-pb-in="rPrice" placeholder="Máx $" />
                        <select data-pb-in="rCur">
                            <option value="coins">Coins</option>
                            <option value="gemas">Gemas</option>
                        </select>
                    </div>
                    <button class="pb-btn" data-pb-act="addAlert">+ Adicionar Alerta RMT</button>
                    <div class="pb-list" data-pb="alertList">Nenhum alerta.</div>
                    <div class="pb-sec">Mini Games (<span data-pb="dexCount">0</span> espécies · clique p/ enviar)</div>
                    <div class="pb-tog" data-pb-tog="autoGuess"><span>Auto-Palpite (≤3 candid.)</span><b data-pb-tval="autoGuess">OFF</b></div>
                    <div class="pb-list" data-pb="quizList">Importe o .csv da Pokedex.</div>
                    <button class="pb-btn" data-pb-act="importDex">Importar Pokedex (.csv)</button>
                </div>

                <div class="pb-note" data-pb="note">Pronto</div>
            </div>
        `;

        document.body.appendChild(hud);
        state.hudEl = hud;

        const head = hud.querySelector('[data-pb-drag="1"]');
        let dragging = false;
        let offsetX = 0;
        let offsetY = 0;

        const onMouseDown = (e) => {
            if (e.target.closest('button')) return;
            dragging = true;
            const rect = hud.getBoundingClientRect();
            offsetX = e.clientX - rect.left;
            offsetY = e.clientY - rect.top;
        };
        const onMouseMove = (e) => {
            if (!dragging) return;
            const left = Math.max(4, Math.min(window.innerWidth - 60, e.clientX - offsetX));
            const top = Math.max(4, Math.min(window.innerHeight - 40, e.clientY - offsetY));
            hud.style.left = `${left}px`;
            hud.style.top = `${top}px`;
            CONFIG.hud.left = Math.round(left);
            CONFIG.hud.top = Math.round(top);
        };
        const onMouseUp = () => {
            if (!dragging) return;
            dragging = false;
            persistPrefs();
        };

        head.addEventListener('mousedown', onMouseDown);
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
        state.cleanupListeners.push(() => {
            head.removeEventListener('mousedown', onMouseDown);
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        });

        const onHudClick = (e) => {
            const tabBtn = e.target.closest('[data-pb-tab]');
            if (tabBtn) {
                CONFIG.hud.tab = tabBtn.getAttribute('data-pb-tab');
                persistPrefs();
                updateHud();
                return;
            }
            const modeBtn = e.target.closest('[data-pb-mode]');
            if (modeBtn) {
                setMode(modeBtn.getAttribute('data-pb-mode'), false);
                return;
            }
            const delBtn = e.target.closest('[data-pb-del]');
            if (delBtn) {
                removerAlertaRadar(parseInt(delBtn.getAttribute('data-pb-del'), 10));
                return;
            }
            const guessBtn = e.target.closest('[data-pb-guess]');
            if (guessBtn) {
                const name = guessBtn.getAttribute('data-pb-guess');
                if (name && applyMiniGameGuess(name, true)) {
                    state.roundTriedNames.add(cleanKey(name));
                    state.lastActionNote = `Palpite enviado: ${name}`;
                    renderQuizCandidates();
                    updateHud();
                }
                return;
            }
            const tog = e.target.closest('[data-pb-tog]');
            if (tog) {
                const key = tog.getAttribute('data-pb-tog');
                if (key === 'caidos') CONFIG.caidos.enabled = !CONFIG.caidos.enabled;
                if (key === 'smartBall') CONFIG.caidos.smartBallSelect = !CONFIG.caidos.smartBallSelect;
                if (key === 'shinyGuard') CONFIG.shinyGuard.enabled = !CONFIG.shinyGuard.enabled;
                if (key === 'restock') CONFIG.restock.enabled = !CONFIG.restock.enabled;
                if (key === 'upgradeBalls') CONFIG.restock.autoUpgradeBalls = !CONFIG.restock.autoUpgradeBalls;
                if (key === 'restockRevive') CONFIG.restock.restockRevive = !CONFIG.restock.restockRevive;
                if (key === 'topCatchHop') CONFIG.topCatchHop.enabled = !CONFIG.topCatchHop.enabled;
                if (key === 'dailyPass') CONFIG.dailyPass.enabled = !CONFIG.dailyPass.enabled;
                if (key === 'prey') CONFIG.prey.enabled = !CONFIG.prey.enabled;
                if (key === 'liveEnabled') CONFIG.live.enabled = !CONFIG.live.enabled;
                if (key === 'liveWatchTwitch') CONFIG.live.watchTwitch = !CONFIG.live.watchTwitch;
                if (key === 'liveWatchKick') CONFIG.live.watchKick = !CONFIG.live.watchKick;
                if (key === 'liveAutoClaimChest') CONFIG.live.autoClaimChest = !CONFIG.live.autoClaimChest;
                if (key === 'liveAutoRedeem') CONFIG.live.autoRedeem = !CONFIG.live.autoRedeem;
                if (key === 'incubator') {
                    CONFIG.incubator.enabled = !CONFIG.incubator.enabled;
                    state.nextIncubatorCheckAt = 0;
                }
                if (key === 'autoRegion') CONFIG.autoRegion.enabled = !CONFIG.autoRegion.enabled;
                if (key === 'evolve') CONFIG.evolve.enabled = !CONFIG.evolve.enabled;
                if (key === 'queueFallback') CONFIG.huntQueue.fallbackToSafeArea = !CONFIG.huntQueue.fallbackToSafeArea;
                if (key === 'autoGuess') CONFIG.minigame.autoGuess = !CONFIG.minigame.autoGuess;
                if (key === 'depotMode') {
                    CONFIG.depot.mode = DEPOT_MODES[(DEPOT_MODES.indexOf(CONFIG.depot.mode) + 1) % DEPOT_MODES.length];
                }
                if (key === 'teamMode') {
                    CONFIG.team.mode = TEAM_MODES[(TEAM_MODES.indexOf(CONFIG.team.mode) + 1) % TEAM_MODES.length];
                }
                if (key === 'bossPriority') {
                    CONFIG.boss.priority = BOSS_PRIORITIES[(BOSS_PRIORITIES.indexOf(CONFIG.boss.priority) + 1) % BOSS_PRIORITIES.length];
                }
                persistPrefs();
                updateHud();
                return;
            }
            const actBtn = e.target.closest('[data-pb-act]');
            if (!actBtn) return;
            const act = actBtn.getAttribute('data-pb-act');

            if (act === 'min') {
                CONFIG.hud.minimized = !CONFIG.hud.minimized;
                hud.classList.toggle('min', CONFIG.hud.minimized);
                persistPrefs();
            } else if (act === 'stop') {
                stop();
            } else if (act === 'pause') {
                state.paused ? retomar() : pausar();
            } else if (act === 'syncGuide') {
                syncHuntGuideQueue(true);
            } else if (act === 'nextQueue') {
                irProximaHuntGuia(true);
            } else if (act === 'copyActiveSheet') {
                copyActiveSheet();
            } else if (act === 'copyHub') {
                copyActiveSheet({ openSite: true });
            } else if (act === 'loadManual') {
                loadManualQueue(false);
            } else if (act === 'loadManualGo') {
                loadManualQueue(true);
            } else if (act === 'clearQueue') {
                limparFilaHunt();
            } else if (act === 'optimize') {
                otimizarRegiao({ modo: CONFIG.mode, force: true });
            } else if (act === 'hop') {
                hopNextTopCatchArea(true);
            } else if (act === 'restock') {
                smartRestock(true);
            } else if (act === 'runDepot') {
                if (CONFIG.depot.mode === 'off') {
                    state.lastActionNote = 'Selecione Venda, Oferenda ou Sacrifício';
                    updateHud();
                } else {
                    runDepotManager(true);
                }
            } else if (act === 'runPass') {
                checkDailyPass(true);
            } else if (act === 'runPrey') {
                checkPrey(true);
            } else if (act === 'runEggs') {
                checkIncubator(true);
            } else if (act === 'runBoss') {
                checkBosses(true);
            } else if (act === 'runLives') {
                checkLives(true);
            } else if (act === 'syncLives') {
                syncLives(true);
            } else if (act === 'copyHeadless') {
                exportarSessaoHeadless(true);
            } else if (act === 'importDex') {
                abrirSeletorCsvPokedex();
            } else if (act === 'addAlert') {
                const nameEl = hud.querySelector('[data-pb-in="rName"]');
                const priceEl = hud.querySelector('[data-pb-in="rPrice"]');
                const curEl = hud.querySelector('[data-pb-in="rCur"]');
                if (nameEl?.value && priceEl?.value) {
                    adicionarAlertaRadar({
                        nome: nameEl.value,
                        maxPreco: parseInt(priceEl.value, 10),
                        moeda: curEl?.value || 'coins',
                    });
                    nameEl.value = '';
                    priceEl.value = '';
                }
            }
        };

        hud.addEventListener('click', onHudClick);
        state.cleanupListeners.push(() => hud.removeEventListener('click', onHudClick));

        const onHudChange = (e) => {
            const cfgEl = e.target.closest('[data-pb-cfg]');
            if (!cfgEl) return;
            const key = cfgEl.getAttribute('data-pb-cfg');
            if (key === 'preferredBall' && BALL_PREF_OPTIONS.includes(cfgEl.value)) {
                CONFIG.caidos.preferredBall = cfgEl.value;
            } else if (key === 'shinyBall' && SHINY_BALL_OPTIONS.includes(cfgEl.value)) {
                CONFIG.caidos.shinyBall = cfgEl.value;
            } else if (key === 'highLevelUltraThreshold') {
                const v = parseInt(cfgEl.value, 10);
                if (!Number.isNaN(v)) CONFIG.caidos.highLevelUltraThreshold = Math.max(1, Math.min(200, v));
            } else if (key === 'targetBalls') {
                const v = parseInt(cfgEl.value, 10);
                if (!Number.isNaN(v)) CONFIG.restock.targetBalls = Math.max(10, Math.min(5000, v));
            } else if (key === 'targetPotions') {
                const v = parseInt(cfgEl.value, 10);
                if (!Number.isNaN(v)) CONFIG.restock.targetPotions = Math.max(0, Math.min(5000, v));
            } else if (key === 'minGoldReserve') {
                const v = parseInt(cfgEl.value, 10);
                if (!Number.isNaN(v)) CONFIG.restock.minGoldReserve = Math.max(0, v);
            } else if (key === 'liveRewardType' && LIVE_REWARD_TYPES.includes(cfgEl.value)) {
                CONFIG.live.rewardType = cfgEl.value;
            } else if (key === 'liveGuardThresholdMin') {
                const v = parseInt(cfgEl.value, 10);
                if (!Number.isNaN(v)) CONFIG.live.guardThresholdMin = Math.max(0, Math.min(600, v));
            } else if (key === 'liveMaxTwitchSlots') {
                const v = parseInt(cfgEl.value, 10);
                if (!Number.isNaN(v)) CONFIG.live.maxTwitchSlots = Math.max(1, Math.min(12, v));
            } else if (key === 'liveMaxKickSlots') {
                const v = parseInt(cfgEl.value, 10);
                if (!Number.isNaN(v)) CONFIG.live.maxKickSlots = Math.max(1, Math.min(12, v));
            } else if (key === 'liveTwitchToken') {
                CONFIG.live.twitchToken = cfgEl.value.trim();
            } else if (key === 'liveKickToken') {
                CONFIG.live.kickToken = cfgEl.value.trim();
            } else if (key === 'liveCustomTwitch') {
                CONFIG.live.customTwitchChannels = cfgEl.value.trim();
            } else if (key === 'liveCustomKick') {
                CONFIG.live.customKickChannels = cfgEl.value.trim();
            } else {
                return;
            }
            persistPrefs();
            updateHud();
        };
        hud.addEventListener('change', onHudChange);
        state.cleanupListeners.push(() => hud.removeEventListener('change', onHudChange));

        // Digitar/colar nos campos do HUD não deve disparar atalhos do jogo
        const stopKeys = (e) => {
            if (e.target.closest('input, textarea, select')) e.stopPropagation();
        };
        ['keydown', 'keyup', 'keypress'].forEach((evt) => hud.addEventListener(evt, stopKeys));
        state.cleanupListeners.push(() =>
            ['keydown', 'keyup', 'keypress'].forEach((evt) => hud.removeEventListener(evt, stopKeys))
        );

        renderAlertList();
        renderQuizCandidates();
    };

    const updateHud = () => {
        const hud = state.hudEl;
        if (!hud || !hud.isConnected) return;

        const native = readNativeSessionPanel();
        const poke = getActivePokemon();
        const inv = getInventorySnapshot();
        const farm = state.session ? computeSessionMetrics(state.session) : null;
        const dayType = getSeasonalDayType();

        const setText = (attr, val) => {
            const strVal = String(val);
            if (state.hudCache[attr] === strVal) return;
            state.hudCache[attr] = strVal;
            const el = hud.querySelector(`[data-pb="${attr}"]`);
            if (el) el.textContent = strVal;
        };

        const dotMode = state.paused
            ? 'off'
            : state.shinyAlertActive
            ? 'shiny'
            : state.modalLockOwner
            ? 'warn'
            : 'on';

        if (state.hudCache.__dot !== dotMode) {
            state.hudCache.__dot = dotMode;
            const dot = hud.querySelector('[data-pb="dot"]');
            if (dot) {
                dot.classList.remove('warn', 'off', 'shiny');
                if (dotMode !== 'on') dot.classList.add(dotMode);
            }
        }

        if (state.hudCache.__tab !== CONFIG.hud.tab) {
            state.hudCache.__tab = CONFIG.hud.tab;
            hud.querySelectorAll('[data-pb-tab]').forEach((b) =>
                b.classList.toggle('on', b.getAttribute('data-pb-tab') === CONFIG.hud.tab)
            );
            hud.querySelectorAll('[data-pb-pane]').forEach((p) =>
                p.classList.toggle('on', p.getAttribute('data-pb-pane') === CONFIG.hud.tab)
            );
        }

        setText('headTitle', `Nexo PokeBot v${VERSION} · ${state.shinyAlertActive ? '✨ SHINY!' : state.statusText}`);
        setText('poke', poke ? `${poke.name} Nv${poke.level ?? '?'} (${poke.types.join('/') || '-'})` : '-');
        setText('regiao', farm ? farm.regiao : '-');
        setText(
            'xpH',
            native ? `${native.xpPokemonH.toLocaleString('pt-BR')}/h` : `${((farm?.xpPokeMin ?? 0) * 60).toLocaleString('pt-BR')}/h`
        );
        setText(
            'lucroH',
            native ? `${native.lucroH.toLocaleString('pt-BR')}/h` : `${((farm?.lucroLiqMin ?? 0) * 60).toLocaleString('pt-BR')}/h`
        );
        setText('xpBonus', `${native ? native.xpBonusText : '-'} · ${dayType || '-'}`);
        setText(
            'huntQueue',
            state.huntQueue.length > 0
                ? `${Math.min(state.huntQueueIndex + 1, state.huntQueue.length)}/${state.huntQueue.length}`
                : '0'
        );
        setText('caps', native ? String(native.capturas) : String(state.stats.captures));
        setText(
            'inv',
            inv.panelOpen
                ? `${inv.totalBalls ?? '-'}/${inv.smallPotions ?? '-'}/${inv.totalRevives ?? '-'}`
                : 'Abra Auto!'
        );
        setText('pauseBtn', state.paused ? 'Retomar' : 'Pausar');
        setText('dexCount', String(state.dexCatalog.length));
        const fmtSiteStatus = (entries) => {
            const list = Object.entries(entries || {});
            if (list.length === 0) return '-';
            return list
                .map(([name, info]) => {
                    const pts = info.balance !== null && info.balance !== undefined ? `${info.balance}pts` : '?';
                    return `${name}:${info.live ? 'ON' : 'off'}(${pts})`;
                })
                .join(' · ');
        };
        setText('liveTwitchInfo', fmtSiteStatus(state.liveStatus?.twitch));
        setText('liveKickInfo', fmtSiteStatus(state.liveStatus?.kick));
        setText(
            'liveStatsInfo',
            `${state.stats.liveMinutesWatched}m / ${state.stats.liveChestsClaimed} / ${state.stats.liveRewardsRedeemed}`
        );
        setText('note', isInSpecialArena() ? 'Arena especial (protegido)' : state.lastActionNote);

        if (state.hudCache.__mode !== CONFIG.mode) {
            state.hudCache.__mode = CONFIG.mode;
            hud.querySelectorAll('[data-pb-mode]').forEach((btn) =>
                btn.classList.toggle('on', btn.getAttribute('data-pb-mode') === CONFIG.mode)
            );
        }

        const toggles = {
            caidos: [CONFIG.caidos.enabled, CONFIG.caidos.enabled ? 'ON' : 'OFF'],
            smartBall: [CONFIG.caidos.smartBallSelect, CONFIG.caidos.smartBallSelect ? 'ON' : 'OFF'],
            shinyGuard: [CONFIG.shinyGuard.enabled, CONFIG.shinyGuard.enabled ? 'ON' : 'OFF'],
            restock: [CONFIG.restock.enabled, CONFIG.restock.enabled ? 'ON' : 'OFF'],
            upgradeBalls: [CONFIG.restock.autoUpgradeBalls, CONFIG.restock.autoUpgradeBalls ? 'ON' : 'OFF'],
            restockRevive: [CONFIG.restock.restockRevive, CONFIG.restock.restockRevive ? 'ON' : 'OFF'],
            topCatchHop: [CONFIG.topCatchHop.enabled, CONFIG.topCatchHop.enabled ? 'ON' : 'OFF'],
            dailyPass: [CONFIG.dailyPass.enabled, CONFIG.dailyPass.enabled ? 'ON' : 'OFF'],
            prey: [CONFIG.prey.enabled, CONFIG.prey.enabled ? 'ON' : 'OFF'],
            liveEnabled: [CONFIG.live.enabled, CONFIG.live.enabled ? 'ON' : 'OFF'],
            liveWatchTwitch: [CONFIG.live.watchTwitch, CONFIG.live.watchTwitch ? 'ON' : 'OFF'],
            liveWatchKick: [CONFIG.live.watchKick, CONFIG.live.watchKick ? 'ON' : 'OFF'],
            liveAutoClaimChest: [CONFIG.live.autoClaimChest, CONFIG.live.autoClaimChest ? 'ON' : 'OFF'],
            liveAutoRedeem: [CONFIG.live.autoRedeem, CONFIG.live.autoRedeem ? 'ON' : 'OFF'],
            incubator: [CONFIG.incubator.enabled, CONFIG.incubator.enabled ? 'ON' : 'OFF'],
            autoRegion: [CONFIG.autoRegion.enabled, CONFIG.autoRegion.enabled ? 'ON' : 'OFF'],
            evolve: [CONFIG.evolve.enabled, CONFIG.evolve.enabled ? 'ON' : 'OFF'],
            queueFallback: [CONFIG.huntQueue.fallbackToSafeArea, CONFIG.huntQueue.fallbackToSafeArea ? 'ON' : 'OFF'],
            autoGuess: [CONFIG.minigame.autoGuess, CONFIG.minigame.autoGuess ? 'ON' : 'OFF'],
            depotMode: [CONFIG.depot.mode !== 'off', CONFIG.depot.mode.toUpperCase()],
            teamMode: [CONFIG.team.mode !== 'off', CONFIG.team.mode.toUpperCase()],
            bossPriority: [CONFIG.boss.priority !== 'off', CONFIG.boss.priority.toUpperCase()],
        };

        Object.entries(toggles).forEach(([key, [isOn, label]]) => {
            const sig = `${isOn}|${label}`;
            if (state.hudCache[`__t_${key}`] === sig) return;
            state.hudCache[`__t_${key}`] = sig;
            const box = hud.querySelector(`[data-pb-tog="${key}"]`);
            const val = hud.querySelector(`[data-pb-tval="${key}"]`);
            if (box) box.classList.toggle('on', isOn);
            if (val) val.textContent = label;
        });

        const cfgValues = {
            preferredBall: CONFIG.caidos.preferredBall,
            shinyBall: CONFIG.caidos.shinyBall,
            highLevelUltraThreshold: String(CONFIG.caidos.highLevelUltraThreshold),
            targetBalls: String(CONFIG.restock.targetBalls),
            targetPotions: String(CONFIG.restock.targetPotions),
            minGoldReserve: String(CONFIG.restock.minGoldReserve),
            liveRewardType: CONFIG.live.rewardType,
            liveGuardThresholdMin: String(CONFIG.live.guardThresholdMin),
            liveMaxTwitchSlots: String(CONFIG.live.maxTwitchSlots),
            liveMaxKickSlots: String(CONFIG.live.maxKickSlots),
            liveTwitchToken: CONFIG.live.twitchToken,
            liveKickToken: CONFIG.live.kickToken,
            liveCustomTwitch: CONFIG.live.customTwitchChannels,
            liveCustomKick: CONFIG.live.customKickChannels,
        };
        Object.entries(cfgValues).forEach(([key, val]) => {
            const el = hud.querySelector(`[data-pb-cfg="${key}"]`);
            if (el && document.activeElement !== el && el.value !== val) {
                el.value = val;
            }
        });

        renderQuizCandidates();
    };

    const unmountHud = () => {
        state.cleanupListeners.forEach((fn) => fn());
        state.cleanupListeners = [];
        document.getElementById(HUD_ID)?.remove();
        document.getElementById(STYLE_ID)?.remove();
        state.hudEl = null;
        state.hudCache = {};
    };
