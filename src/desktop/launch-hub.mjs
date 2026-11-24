// Inicia o Nexo PokeBot usando o binario renomeado do runtime Electron para identificacao correta no Windows.
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareBrandedElectronRuntime } from './brand-runtime.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');

const { runtimeExe } = prepareBrandedElectronRuntime({ rootDir: ROOT });
const mainScript = join(ROOT, 'src', 'electron', 'main.mjs');

const child = spawn(runtimeExe, [mainScript, ...process.argv.slice(2)], {
    cwd: ROOT,
    stdio: 'inherit',
});

child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 0);
});
