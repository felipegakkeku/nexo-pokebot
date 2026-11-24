// Modo Ultra-Eco: roda as 4 contas em 1 unico processo Node (~60 MB RAM, zero Chromium/Electron/GPU).
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startGuiServer } from './gui-server.mjs';
import { createHeadlessHuntGuideEvaluator } from './hunt-guide.mjs';

const ACCOUNT_IDS = [1, 2, 3, 4];

/**
 * Inicia todas as contas configuradas em um unico processo Node compartilhando o motor /hunt headless.
 * @param {object} [options] Opcoes de diretorio raiz, contas, portas e logger.
 * @returns {Promise<{ accounts: Map<number, object>, close: () => Promise<void> }>} Instancia do daemon.
 */
export async function startMultiAccountDaemon(options = {}) {
    const rootDir = resolve(options.rootDir || process.cwd());
    const accountIds = Array.isArray(options.accountIds) && options.accountIds.length
        ? options.accountIds
        : ACCOUNT_IDS;
    const basePort = Number.isInteger(options.basePort) ? options.basePort : 17890;
    const useRandomPort = options.port === 0;
    const autoStart = options.autoStart !== false;
    const logger = options.log || ((msg) => console.log(msg));
    const sharedHuntGuide = options.headlessHuntGuide !== undefined
        ? options.headlessHuntGuide
        : createHeadlessHuntGuideEvaluator({ cwd: rootDir });

    const accounts = new Map();

    for (const acc of accountIds) {
        const isPrimary = acc === 1;
        const cwd = isPrimary ? rootDir : resolve(rootDir, '.pokebot-accounts', String(acc));
        const port = useRandomPort ? 0 : (basePort + (acc - 1));
        const opts = {
            port,
            host: '127.0.0.1',
            cwd,
            useExistingBrowser: isPrimary,
            enableBrowserProfilePicker: true,
            useEmbeddedBrowser: false,
            isolatedAccount: !isPrimary,
            autoStart: false,
            autoLoginOnMissingSession: false,
            headlessHuntGuide: sharedHuntGuide,
        };

        let instance;
        try {
            instance = await startGuiServer(opts);
        } catch (err) {
            if (err?.code === 'EADDRINUSE') {
                instance = await startGuiServer({ ...opts, port: 0 });
            } else {
                throw err;
            }
        }

        const rawSess = instance.controller.getRawSession();
        const hasSession = Boolean(rawSess?.token && rawSess?.nick);
        if (autoStart && hasSession) {
            instance.controller.start();
        }
        accounts.set(acc, { account: acc, instance, port: instance.port, hasSession, nick: rawSess?.nick || null });
        logger(
            `[Nexo PokeBot Eco] Conta ${acc} (${rawSess?.nick || 'sem sessao'}): ` +
            `${hasSession && autoStart ? 'FARMANDO' : 'STANDBY'} · http://127.0.0.1:${instance.port}`
        );
    }

    const close = async () => {
        const closing = [...accounts.values()].map((entry) => entry.instance.close().catch(() => {}));
        accounts.clear();
        await Promise.allSettled(closing);
        if (options.headlessHuntGuide === undefined) {
            try { sharedHuntGuide?.dispose?.(); } catch { /* ignore */ }
        }
    };

    return { accounts, close };
}

const isCliEntry = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isCliEntry) {
    const daemon = await startMultiAccountDaemon();
    console.log('[Nexo PokeBot Eco] 1 unico processo Node ativo. Pressione Ctrl+C para encerrar todas as contas.');

    let exiting = false;
    const shutdown = async () => {
        if (exiting) return;
        exiting = true;
        console.log('\n[Nexo PokeBot Eco] Encerrando contas...');
        await daemon.close();
        process.exit(0);
    };
    process.on('SIGINT', () => void shutdown());
    process.on('SIGTERM', () => void shutdown());
}
