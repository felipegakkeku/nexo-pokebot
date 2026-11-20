import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Carrega src/05-pure.js (funções sem DOM) num contexto isolado e devolve as funções.
export const loadPure = (config = { mode: 'equilibrado' }) => {
    const code = readFileSync(join(root, 'src', '05-pure.js'), 'utf8');
    const names = ['normalizeText', 'cleanKey', 'parseNumber', 'parseSignedNumber', 'parseQueueEntry', 'parseQueueText', 'looksLikeSheet'];
    const sandbox = { CONFIG: config };
    vm.createContext(sandbox);
    return vm.runInContext(`${code}\n({ ${names.join(', ')} })`, sandbox);
};
