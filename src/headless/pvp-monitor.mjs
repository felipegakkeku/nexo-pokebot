/**
 * Monitor de PvP: decide quando parar a fila ranqueada por causa de derrotas seguidas ou de prejuízo de PR.
 *
 * O jogo dá mais PR numa vitória do que tira numa derrota (hoje cerca de +13 e -9), então perder
 * não é problema por si só: o ponto de equilíbrio é uma taxa de vitória de L / (W + L) (cerca de 41%).
 * O que o monitor procura é o momento em que a sequência de resultados deixa de parecer sorte
 * (o time ficou fraco, o rival subiu de nível, o PR passou da faixa em que o time aguenta).
 *
 * Três regras, todas calculadas só com o que a própria sessão viu:
 *  1. Sequência: derrotas seguidas >= limite dinâmico. O limite é o menor k em que a chance de perder
 *     k seguidas, com a taxa de vitória que a conta tinha ANTES da sequência, cai abaixo de um alfa
 *     (5% no nível "equilibrado"). Quanto mais a conta vence, menos derrotas seguidas ela tolera (4 a 7).
 *  2. Janela: nas últimas 10 partidas (mínimo 6), a taxa de vitória está abaixo do equilíbrio e o saldo
 *     de PR passou de -2,5 derrotas médias.
 *  3. Queda: o saldo de PR da sessão caiu 6 derrotas médias abaixo do melhor ponto da sessão (pega a
 *     perda lenta, espalhada em mais de 10 partidas, que as outras duas regras não enxergam).
 *
 * Funções puras: o estado fica em `pvp` (o mesmo objeto da fila) e nada aqui fala com o jogo.
 */

export const PVP_DEFAULT_WIN_PR = 13;
export const PVP_DEFAULT_LOSS_PR = 9;
export const PVP_HISTORY_MAX = 60;
export const PVP_WINDOW = 10;
export const PVP_WINDOW_MIN = 6;
export const PVP_STREAK_MIN = 4;
export const PVP_STREAK_MAX = 7;
/** Quantas partidas "de mentira" o valor padrão vale na média de ganho e perda de PR. */
const PRIOR_PR_WEIGHT = 3;
/** Peso da crença inicial de 50% de vitória; some conforme a sessão acumula partidas. */
const PRIOR_WIN_WEIGHT = 8;

/** @type {Record<string, {label: string, alpha: number, windowLosses: number, dropLosses: number}>} */
export const PVP_MONITOR_LEVELS = Object.freeze({
    cauteloso: { label: 'Cauteloso', alpha: 0.10, windowLosses: 2, dropLosses: 5 },
    equilibrado: { label: 'Equilibrado', alpha: 0.05, windowLosses: 2.5, dropLosses: 6 },
    tolerante: { label: 'Tolerante', alpha: 0.02, windowLosses: 3.5, dropLosses: 9 },
});
export const PVP_MONITOR_DEFAULT_LEVEL = 'equilibrado';

/** @param {unknown} level */
export function normalizePvpMonitorLevel(level) {
    const key = String(level || '').toLowerCase();
    return Object.hasOwn(PVP_MONITOR_LEVELS, key) ? key : PVP_MONITOR_DEFAULT_LEVEL;
}

/**
 * Guarda uma partida no histórico da sessão e atualiza o saldo de PR.
 * O jogo manda o delta já com sinal; se vier positivo numa derrota (ou negativo numa vitória)
 * o sinal é corrigido, e sem delta vale o padrão (+13 / -9).
 * @param {object} pvp Estado da fila (mutado): history, netPr, peakPr.
 * @param {{venci?: boolean, delta?: number}} partida
 * @param {number} nowMs
 */
export function recordPvpMatch(pvp, partida, nowMs = Date.now()) {
    if (!pvp || !partida) return;
    const won = Boolean(partida.venci);
    const raw = Number(partida.delta);
    const known = Number.isFinite(raw) && raw !== 0;
    const magnitude = known ? Math.abs(raw) : (won ? PVP_DEFAULT_WIN_PR : PVP_DEFAULT_LOSS_PR);
    const delta = won ? magnitude : -magnitude;
    const history = Array.isArray(pvp.history) ? pvp.history : [];
    history.push({ won, delta, known, at: nowMs });
    if (history.length > PVP_HISTORY_MAX) history.splice(0, history.length - PVP_HISTORY_MAX);
    pvp.history = history;
    pvp.netPr = Number(pvp.netPr || 0) + delta;
    pvp.peakPr = Math.max(Number(pvp.peakPr || 0), pvp.netPr);
}

function mean(values, fallback, priorWeight) {
    return (values.reduce((a, b) => a + b, 0) + fallback * priorWeight) / (values.length + priorWeight);
}

/**
 * Números do monitor a partir do histórico. Sem efeito colateral.
 * @param {object} pvp
 * @param {string} [level]
 */
export function computePvpMonitor(pvp, level = PVP_MONITOR_DEFAULT_LEVEL) {
    const cfg = PVP_MONITOR_LEVELS[normalizePvpMonitorLevel(level)];
    const history = Array.isArray(pvp?.history) ? pvp.history : [];
    const games = history.length;
    const wins = history.filter((h) => h.won).length;
    const losses = games - wins;
    let lossStreak = 0;
    for (let i = history.length - 1; i >= 0 && !history[i].won; i--) lossStreak++;

    const avgWin = mean(history.filter((h) => h.won && h.known).map((h) => h.delta), PVP_DEFAULT_WIN_PR, PRIOR_PR_WEIGHT);
    const avgLoss = mean(history.filter((h) => !h.won && h.known).map((h) => -h.delta), PVP_DEFAULT_LOSS_PR, PRIOR_PR_WEIGHT);
    const breakEvenWinRate = avgLoss / (avgWin + avgLoss);
    // A sequência é o que está sendo testado, então a taxa de vitória vem das partidas antes dela.
    const baseGames = games - lossStreak;
    const winRate = (wins + PRIOR_WIN_WEIGHT / 2) / (baseGames + PRIOR_WIN_WEIGHT);
    const rawWinRate = games > 0 ? wins / games : null;

    const streakLimit = Math.min(
        PVP_STREAK_MAX,
        Math.max(PVP_STREAK_MIN, Math.ceil(Math.log(cfg.alpha) / Math.log(Math.max(1e-6, 1 - winRate)))),
    );

    const recent = history.slice(-PVP_WINDOW);
    const recentWins = recent.filter((h) => h.won).length;
    const recentNet = recent.reduce((a, h) => a + h.delta, 0);
    const recentWinRate = recent.length > 0 ? recentWins / recent.length : null;
    const windowFloor = -cfg.windowLosses * avgLoss;

    const netPr = Number(pvp?.netPr || 0);
    const peakPr = Math.max(Number(pvp?.peakPr || 0), netPr);
    const drawdown = peakPr - netPr;
    const drawdownLimit = cfg.dropLosses * avgLoss;

    return {
        games, wins, losses, lossStreak, streakLimit,
        avgWin, avgLoss, breakEvenWinRate, winRate, rawWinRate,
        recentGames: recent.length, recentWins, recentNet, recentWinRate, windowFloor,
        netPr, peakPr, drawdown, drawdownLimit,
    };
}

/**
 * Decide se a fila deve parar agora.
 * @param {object} pvp
 * @param {string} [level] cauteloso | equilibrado | tolerante
 * @returns {{stop: boolean, rule: ('sequencia'|'janela'|'queda'|null), reason: string|null, metrics: object}}
 */
export function evaluatePvpMonitor(pvp, level = PVP_MONITOR_DEFAULT_LEVEL) {
    const m = computePvpMonitor(pvp, level);
    const pct = (v) => `${Math.round(v * 100)}%`;
    const pr = (v) => `${v >= 0 ? '+' : ''}${Math.round(v)}`;
    if (m.lossStreak >= m.streakLimit) {
        return {
            stop: true, rule: 'sequencia', metrics: m,
            reason: `${m.lossStreak} derrotas seguidas (limite ${m.streakLimit} para uma taxa de vitória estimada de ${pct(m.winRate)}).`,
        };
    }
    if (m.recentGames >= PVP_WINDOW_MIN && m.recentWinRate < m.breakEvenWinRate && m.recentNet <= m.windowFloor) {
        return {
            stop: true, rule: 'janela', metrics: m,
            reason: `${m.recentWins}V em ${m.recentGames} partidas (${pct(m.recentWinRate)}, equilíbrio ${pct(m.breakEvenWinRate)}), saldo de ${pr(m.recentNet)} PR.`,
        };
    }
    if (m.drawdown >= m.drawdownLimit) {
        return {
            stop: true, rule: 'queda', metrics: m,
            reason: `o saldo da sessão caiu ${Math.round(m.drawdown)} PR abaixo do melhor ponto (limite ${Math.round(m.drawdownLimit)}).`,
        };
    }
    return { stop: false, rule: null, reason: null, metrics: m };
}
