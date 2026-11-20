// Funções puras (sem DOM nem estado): fonte única, usada pelos módulos e, via PokeBotModules.pure, pelo código legado.
export const normalizeText = (str) =>
    (str || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();

export const cleanKey = (str) => normalizeText(str).replace(/[^a-z0-9]/g, '');

export const parseNumber = (text) => {
    const digits = (text || '').replace(/\D/g, '');
    if (!digits) return null;
    const n = parseInt(digits, 10);
    return Number.isNaN(n) ? null : n;
};

export const parseSignedNumber = (text) => {
    const raw = (text || '').trim();
    const negative = raw.startsWith('-') || raw.startsWith('−');
    const n = parseNumber(raw);
    if (n === null) return null;
    return negative ? -n : n;
};

// "Kakuna Nv 10 38,1 mil XP/h ✓ 6%" -> { name: 'Kakuna', level: 10 }; "Viridian Forest" -> { name: 'Viridian Forest', level: null }
export const parseQueueEntry = (rawText, mode = null) => {
    const raw = String(rawText || '').trim();
    const m = raw.match(/^(.*?)\s+(?:n[ií]vel|nv\.?|lv\.?)\s*(\d+)\b/i);
    const name = (m ? m[1] : raw).trim();
    const level = m ? parseInt(m[2], 10) : null;
    return { name, level, raw, mode };
};

// Aceita texto colado do Hub: quebra de linha, ">" ou "|" separam itens; vírgula só separa se não for decimal (38,1 / 1,600)
export const parseQueueText = (rawText, mode = null) => {
    const seen = new Set();
    const out = [];
    String(rawText || '')
        .split(/[\n>|]+/)
        .flatMap((chunk) => chunk.split(/,(?!\d)/))
        .forEach((piece) => {
            const cleaned = piece
                .replace(/[✓✗✔✘⚠☠]/g, '')
                .replace(/^[\s\d.)\-•*]+/, '')
                .replace(/\s+/g, ' ')
                .trim();
            if (cleaned.length < 3) return;
            const entry = parseQueueEntry(cleaned, mode);
            if (!/[a-zà-ÿ]{3,}/i.test(entry.name)) return;
            const key = `${normalizeText(entry.name)}|${entry.level ?? ''}`;
            if (seen.has(key)) return;
            seen.add(key);
            out.push(entry);
        });
    return out;
};

export const looksLikeSheet = (text) => /ficha do poke\s*idle/i.test(text || '') && (text || '').length > 300;
