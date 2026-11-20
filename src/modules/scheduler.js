// Agendador central: um laço só (tickMs) que dispara tarefas quando chega a hora de cada uma.
// Cada tarefa tem período, prioridade (maior começa primeiro quando várias vencem juntas) e uma trava
// própria: se a rodada anterior ainda não terminou, a próxima é pulada (sem sobreposição).
// Relógio e timers são injetáveis para testar sem esperar.
export const createScheduler = ({
    now = () => Date.now(),
    setIntervalFn = (fn, ms) => setInterval(fn, ms),
    clearIntervalFn = (id) => clearInterval(id),
    tickMs = 100,
    onError = (id, err) => console.error(`[PokeBot] tarefa "${id}" falhou:`, err),
} = {}) => {
    const tasks = new Map();
    let timer = null;
    let paused = false;
    let disposed = false;

    const add = ({ id, everyMs, run, priority = 0, enabled = () => true, runImmediately = false }) => {
        if (disposed) return false;
        if (tasks.has(id)) throw new Error(`tarefa duplicada: ${id}`);
        tasks.set(id, { id, everyMs, run, priority, enabled, busy: false, nextAt: now() + (runImmediately ? 0 : everyMs) });
        return true;
    };

    const remove = (id) => tasks.delete(id);

    const runTask = async (task) => {
        task.busy = true;
        try {
            await task.run();
        } catch (err) {
            onError(task.id, err);
        } finally {
            task.busy = false;
        }
    };

    // Dispara o que venceu; devolve uma Promise que termina quando essas rodadas acabam (útil nos testes)
    const tick = () => {
        if (disposed || paused) return Promise.resolve();
        const t = now();
        const due = [...tasks.values()]
            .filter((task) => !task.busy && task.nextAt <= t)
            .sort((a, b) => b.priority - a.priority || a.nextAt - b.nextAt);
        const started = [];
        for (const task of due) {
            task.nextAt = t + task.everyMs;
            if (!task.enabled()) continue;
            started.push(runTask(task));
        }
        return Promise.all(started);
    };

    const start = () => {
        if (disposed || timer !== null) return;
        timer = setIntervalFn(tick, tickMs);
    };

    const dispose = () => {
        disposed = true;
        if (timer !== null) clearIntervalFn(timer);
        timer = null;
        tasks.clear();
    };

    return {
        add,
        remove,
        tick,
        start,
        dispose,
        pause: () => { paused = true; },
        resume: () => { paused = false; },
        isPaused: () => paused,
        list: () => [...tasks.keys()],
    };
};
