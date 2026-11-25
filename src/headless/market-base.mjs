// Base local de mercado: vendas reais do histórico global do jogo, médias de 7 dias dos itens e o
// catálogo de espécies, guardados no PC e compartilhados entre as contas (pasta raiz do Hub).
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

export const MARKET_BASE_FILE = '.pokebot-market-base.json';
export const SPECIES_CACHE_FILE = '.pokebot-species-cache.json';
/** Arquivo pequeno com a hora da última leitura do mercado: as contas consultam sem abrir a base inteira. */
export const MARKET_SYNC_FILE = '.pokebot-market-sync.json';
export const MARKET_WINDOW_DAYS = 30;
const MAX_SALES = 150_000;

/** Pasta raiz compartilhada (fora de .pokebot-accounts/<n>). */
export function resolveSharedRoot(cwd) {
    const abs = resolve(cwd || process.cwd());
    const parent = dirname(abs);
    return basename(parent) === '.pokebot-accounts' ? dirname(parent) : abs;
}

function readJson(path) {
    try {
        return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
    } catch {
        return null;
    }
}

const mtimeOf = (path) => {
    try {
        return statSync(path).mtimeMs;
    } catch {
        return 0;
    }
};

function writeJsonAtomic(path, data) {
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(data));
    renameSync(tmp, path);
}

const ivSum = (f) => {
    const iv = f?.iv ?? f?.ivTotal ?? (f?.ivs ? Object.values(f.ivs).reduce((s, v) => s + (Number(v) || 0), 0) : null);
    return iv == null || !Number.isFinite(Number(iv)) ? null : Math.round(Number(iv));
};

/** Converte uma linha do histórico global do jogo numa venda compacta. Depósito e saque ficam de fora. */
export function compactSale(l) {
    if (!l || (l.tipo !== 'pokemon' && l.tipo !== 'item')) return null;
    const em = Number(l.em) || 0;
    const pr = Number(l.bruto ?? l.preco ?? l.valor) || 0;
    if (!em || pr <= 0) return null;
    const m = l.moeda === 'orb' ? 'orb' : 'gold';
    if (l.tipo === 'pokemon') {
        const f = l.ficha || {};
        const sp = Number(f.speciesId ?? l.speciesId) || 0;
        if (!sp) return null;
        return {
            k: `p|${em}|${l.pokemonId ?? f.id ?? sp}|${pr}|${l.vendedor ?? ''}`,
            t: 'p', em, sp, lv: Number(f.level) || 1, sh: f.shiny ? 1 : 0,
            iv: ivSum(f), q: Number(f.quality ?? f.qualidade) || null, pot: Number(f.potencia) || null,
            ...(f.refino ? { rf: f.refino } : {}),
            pr, m,
        };
    }
    const id = Number(l.itemId ?? l.item?.id) || 0;
    const qt = Math.max(1, Number(l.qtd) || 1);
    return {
        k: `i|${em}|${id || l.descricao || ''}|${pr}|${qt}|${l.vendedor ?? ''}`,
        t: 'i', em, id: id || null, d: id ? undefined : String(l.descricao || '').slice(0, 60),
        qt, pr, m,
    };
}

export function createMarketBase({ cwd, nowFn = Date.now } = {}) {
    const root = resolveSharedRoot(cwd);
    const basePath = join(root, MARKET_BASE_FILE);
    const speciesPath = join(root, SPECIES_CACHE_FILE);
    const syncPath = join(root, MARKET_SYNC_FILE);
    let data = { v: 1, lastSyncAt: 0, syncBy: null, medias: null, sales: [] };
    let keys = new Set();
    let dirty = false;
    let version = 0;
    let loaded = false;
    let diskMtime = 0; // mtime da base na última vez que lemos ou gravamos

    const prune = () => {
        const cut = nowFn() - MARKET_WINDOW_DAYS * 86_400_000;
        data.sales = data.sales.filter((s) => s && s.em >= cut);
        if (data.sales.length > MAX_SALES) data.sales = data.sales.slice(-MAX_SALES);
        keys = new Set(data.sales.map((s) => s.k));
    };

    /** Lê a base do disco uma vez; chamadas seguintes só releem se outro processo gravou depois. */
    const load = ({ force = false } = {}) => {
        const mt = mtimeOf(basePath);
        if (loaded && !force && mt === diskMtime) return data;
        loaded = true;
        diskMtime = mt;
        const disk = readJson(basePath);
        if (disk && Array.isArray(disk.sales)) {
            // Junta com o que já está em memória (outra conta pode ter gravado antes).
            const merged = new Map(disk.sales.map((s) => [s.k, s]));
            for (const s of data.sales) if (!merged.has(s.k)) merged.set(s.k, s);
            data = {
                ...data,
                ...disk,
                lastSyncAt: Math.max(Number(disk.lastSyncAt) || 0, data.lastSyncAt || 0),
                medias: (disk.medias?.em || 0) >= (data.medias?.em || 0) ? disk.medias : data.medias,
                sales: [...merged.values()].sort((a, b) => a.em - b.em),
            };
            prune();
            version++;
        }
        return data;
    };

    const save = () => {
        if (!dirty) return false;
        try {
            // Só junta com o disco se outro processo gravou desde a nossa última leitura.
            const mt = mtimeOf(basePath);
            const disk = mt && mt !== diskMtime ? readJson(basePath) : null;
            if (disk && Array.isArray(disk.sales)) {
                for (const s of disk.sales) if (s && !keys.has(s.k)) { data.sales.push(s); keys.add(s.k); }
                data.sales.sort((a, b) => a.em - b.em);
                if ((disk.medias?.em || 0) > (data.medias?.em || 0)) data.medias = disk.medias;
                data.lastSyncAt = Math.max(Number(disk.lastSyncAt) || 0, data.lastSyncAt);
            }
            prune();
            writeJsonAtomic(basePath, data);
            diskMtime = mtimeOf(basePath);
            dirty = false;
            return true;
        } catch {
            return false;
        }
    };

    /** @returns {number} quantas vendas novas entraram */
    const ingestHistory = (linhas) => {
        let added = 0;
        for (const l of linhas || []) {
            const s = compactSale(l);
            if (!s || keys.has(s.k)) continue;
            data.sales.push(s);
            keys.add(s.k);
            added++;
        }
        if (added) {
            dirty = true;
            version++;
        }
        return added;
    };

    const setMedias = (medias, dias = 7) => {
        if (!medias || typeof medias !== 'object') return;
        data.medias = { em: nowFn(), dias: Number(dias) || 7, itens: medias };
        dirty = true;
        version++;
    };

    const markSynced = (who) => {
        data.lastSyncAt = nowFn();
        data.syncBy = who ?? null;
        dirty = true;
        try {
            writeJsonAtomic(syncPath, { lastSyncAt: data.lastSyncAt, syncBy: data.syncBy });
        } catch {
            // sem o arquivo pequeno, vale o horário em memória
        }
    };

    /** Outra conta sincronizou há pouco? Aí esta pula a rodada. Lê só o arquivo pequeno. */
    const syncedRecently = (ms) => {
        const side = readJson(syncPath);
        const last = Math.max(Number(side?.lastSyncAt) || 0, data.lastSyncAt || 0);
        return nowFn() - last < ms;
    };

    let bySpeciesCache = null;
    let bySpeciesVersion = -1;
    const salesBySpecies = () => {
        if (bySpeciesCache && bySpeciesVersion === version) return bySpeciesCache;
        const map = new Map();
        for (const s of data.sales) {
            if (s.t !== 'p') continue;
            if (!map.has(s.sp)) map.set(s.sp, []);
            map.get(s.sp).push(s);
        }
        bySpeciesCache = map;
        bySpeciesVersion = version;
        return map;
    };

    let statsCache = null;
    let statsVersion = -1;
    const stats = () => {
        if (statsCache && statsVersion === version && statsCache.lastSyncAt === (data.lastSyncAt || 0)) return statsCache;
        let pokemon = 0;
        let item = 0;
        let oldest = 0;
        for (const s of data.sales) {
            if (s.t === 'p') pokemon++;
            else item++;
            if (!oldest || s.em < oldest) oldest = s.em;
        }
        statsCache = { total: data.sales.length, pokemon, item, oldest, lastSyncAt: data.lastSyncAt || 0, mediasAt: data.medias?.em || 0 };
        statsVersion = version;
        return statsCache;
    };

    const readSpeciesCache = () => readJson(speciesPath);
    const writeSpeciesCache = (catalogData) => {
        try {
            writeJsonAtomic(speciesPath, { v: SPECIES_CACHE_VERSION, em: nowFn(), creatures: catalogData.creatures || [], itemNames: catalogData.itemNames || {} });
            return true;
        } catch {
            return false;
        }
    };

    return {
        basePath,
        speciesPath,
        get loaded() { return loaded; },
        load,
        save,
        ingestHistory,
        setMedias,
        markSynced,
        syncedRecently,
        salesBySpecies,
        stats,
        hasKey: (k) => keys.has(k),
        getMedias: () => data.medias,
        get version() { return version; },
        readSpeciesCache,
        writeSpeciesCache,
        /** Nota das vendas é calculada depois, quando o catálogo de espécies chega. */
        annotateNotas: (notaFn) => {
            let changed = 0;
            for (const s of data.sales) {
                if (s.t !== 'p' || s.nota !== undefined) continue;
                const n = notaFn(s);
                s.nota = n == null ? null : n;
                changed++;
            }
            if (changed) version++;
            return changed;
        },
    };
}

export const SPECIES_CACHE_VERSION = 2;
const sharedBases = new Map();
/**
 * Uma base só por pasta dentro do mesmo processo: as 4 contas do Hub rodam juntas no processo principal,
 * então dividem a mesma memória e a mesma leitura do disco.
 */
export function getSharedMarketBase({ cwd, nowFn = Date.now } = {}) {
    const key = join(resolveSharedRoot(cwd), MARKET_BASE_FILE);
    if (!sharedBases.has(key)) sharedBases.set(key, createMarketBase({ cwd, nowFn }));
    return sharedBases.get(key);
}

const SPECIES_FIELDS = ['pokeId', 'name', 'rarity', 'type1', 'type2', 'baseHp', 'baseAtk', 'baseDef', 'baseSpAtk', 'baseSpDef', 'baseSpeed',
    'huntLevel', 'evolvesToId', 'evolveLevel', 'priceNpc', 'sellValue'];

/** Baixa os catálogos públicos do jogo (espécies e nomes de itens) só com os campos que o consultor usa. */
export async function fetchSpeciesCatalog(fetchImpl, origin = 'https://pokeidle.io') {
    const files = ['/assets/creatures.json', '/assets/creatures-novos.json', '/assets/creatures-outland-novos.json'];
    const byId = new Map();
    for (const f of files) {
        try {
            const r = await fetchImpl(`${origin}${f}`);
            if (!r?.ok) continue;
            const j = await r.json();
            for (const c of j?.creatures || []) {
                if (!c || !Number.isInteger(c.pokeId) || byId.has(c.pokeId)) continue;
                const slim = {};
                for (const k of SPECIES_FIELDS) if (c[k] !== undefined) slim[k] = c[k];
                byId.set(c.pokeId, slim);
            }
        } catch {
            // arquivo extra pode não existir; segue com o que veio
        }
    }
    const itemNames = {};
    try {
        const r = await fetchImpl(`${origin}/assets/items.json`);
        if (r?.ok) {
            const j = await r.json();
            for (const it of j?.items || []) if (it && Number.isInteger(it.id) && it.name) itemNames[it.id] = String(it.name);
        }
    } catch {
        // sem nomes, o consultor usa os do catálogo do mercado
    }
    return { creatures: [...byId.values()], itemNames };
}
