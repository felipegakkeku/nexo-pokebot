    // --- Funções puras: a fonte única é src/modules/pure.js (testada em tests/pure.test.mjs) ---
    const { normalizeText, cleanKey, parseNumber, parseSignedNumber, looksLikeSheet } = PokeBotModules.pure;
    // As de fila carregam o modo atual da CONFIG
    const parseQueueEntry = (rawText) => PokeBotModules.pure.parseQueueEntry(rawText, CONFIG.mode);
    const parseQueueText = (rawText) => PokeBotModules.pure.parseQueueText(rawText, CONFIG.mode);
