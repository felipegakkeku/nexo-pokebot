// Medidor de desempenho do Hub: atraso do processo principal, custo do snapshot e CPU por processo.
// Leve de propósito: um timer de 500 ms e contas simples; o painel só pede os números quando está aberto.

export const PERF_BUDGETS = Object.freeze({
    gpuCpuPct: 15, // CPU do processo de GPU (% de um núcleo)
    mainCpuPct: 10,
    rendererCpuPct: 15,
    lagP95Ms: 20, // atraso do event loop do processo principal
    snapshotMs: 10, // montar os snapshots das contas
    snapshotKb: 120,
    renderMs: 8, // renderAll no Hub
    mutationsPerSec: 150,
});

/** Percentil simples (p entre 0 e 1). */
export function percentile(values, p) {
    const arr = (values || []).filter(Number.isFinite).sort((a, b) => a - b);
    if (!arr.length) return 0;
    const idx = Math.min(arr.length - 1, Math.max(0, Math.ceil(p * arr.length) - 1));
    return arr[idx];
}

/** Janela circular de amostras numéricas. */
export function createRing(size = 120) {
    const buf = [];
    return {
        push(v) {
            buf.push(v);
            if (buf.length > size) buf.shift();
        },
        values: () => buf.slice(),
        get length() { return buf.length; },
    };
}

/** CPU somada por tipo de processo a partir de app.getAppMetrics(). */
export function cpuByType(metrics, { hubPid = 0 } = {}) {
    const out = {};
    for (const m of metrics || []) {
        const key = m.type === 'Tab' ? (hubPid && m.pid === hubPid ? 'Hub' : 'Webview') : m.type;
        const pct = Number(m.cpu?.percentCPUUsage) || 0;
        out[key] = Math.round(((out[key] || 0) + pct) * 10) / 10;
    }
    return out;
}

/** Marca cada métrica como ok ou acima da meta. */
export function rateAgainstBudgets(values, budgets = PERF_BUDGETS) {
    const rows = [];
    for (const [key, budget] of Object.entries(budgets)) {
        const v = values[key];
        if (v == null || !Number.isFinite(v)) continue;
        rows.push({ key, value: Math.round(v * 10) / 10, budget, ok: v <= budget });
    }
    return rows;
}

/**
 * Amostrador do processo principal.
 * @param {{getMetrics?:()=>Array, getHubPid?:()=>number, now?:()=>number}} deps
 */
export function createPerfSampler({ getMetrics = () => [], getHubPid = () => 0, now = () => performance.now() } = {}) {
    const lag = createRing(240);
    const snapMs = createRing(120);
    const snapKb = createRing(30);
    let expected = now() + 500;
    let calls = 0;
    const timer = setInterval(() => {
        const t = now();
        lag.push(Math.max(0, t - expected));
        expected = t + 500;
    }, 500);
    timer.unref?.();

    /** Envolve a montagem dos snapshots: mede o tempo sempre e o tamanho a cada 20 chamadas. */
    const measureSnapshots = (build) => {
        const t0 = now();
        const out = build();
        snapMs.push(now() - t0);
        if (calls++ % 20 === 0) {
            try {
                snapKb.push(JSON.stringify(out).length / 1024);
            } catch { /* objeto circular: ignora */ }
        }
        return out;
    };

    const read = () => {
        const cpu = cpuByType(getMetrics(), { hubPid: getHubPid() });
        const lagVals = lag.values();
        return {
            at: Date.now(),
            cpu,
            values: {
                gpuCpuPct: cpu.GPU ?? null,
                mainCpuPct: cpu.Browser ?? null,
                rendererCpuPct: cpu.Hub ?? null,
                lagP95Ms: percentile(lagVals, 0.95),
                snapshotMs: percentile(snapMs.values(), 0.95),
                snapshotKb: snapKb.length ? Math.max(...snapKb.values()) : null,
            },
            lagMaxMs: lagVals.length ? Math.max(...lagVals) : 0,
            budgets: PERF_BUDGETS,
        };
    };

    return { measureSnapshots, read, stop: () => clearInterval(timer) };
}
