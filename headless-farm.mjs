#!/usr/bin/env node
// Entrypoint CLI do motor headless WebSocket do PokeBot.
import { runHeadlessFarm } from './src/headless/cli-runner.mjs';

try {
    const code = await runHeadlessFarm(process.argv.slice(2));
    process.exit(typeof code === 'number' ? code : 0);
} catch (err) {
    console.error('[Headless] Erro fatal:', err?.message || err);
    process.exit(1);
}
