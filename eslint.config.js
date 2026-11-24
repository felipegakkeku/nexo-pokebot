// Só pega variável não declarada (no-undef) e sobra de código (no-unused-vars) nos módulos ES:
// se um módulo usar algo que não veio por import nem por ctx, o `npm run lint` acusa antes do bot quebrar no jogo.
import globals from 'globals';

export default [
    {
        files: ['src/modules/**/*.js'],
        languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.browser } },
        rules: {
            'no-undef': 'error',
            'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
        },
    },
    {
        files: ['src/headless/**/*.mjs', 'src/desktop/**/*.mjs', 'src/electron/**/*.mjs', 'headless-farm.mjs'],
        languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.node } },
        rules: {
            'no-undef': 'error',
            'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
        },
    },
    {
        files: ['src/electron/**/*.cjs'],
        languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: { ...globals.node, ...globals.browser } },
        rules: {
            'no-undef': 'error',
            'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
        },
    },
    {
        files: ['src/electron/renderer.js', 'src/electron/icons.js', 'src/electron/minihud.js'],
        languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: { ...globals.browser } },
        rules: {
            'no-undef': 'error',
            'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
        },
    },
    {
        // hub-ui.js roda depois do renderer.js e usa os globais dele
        files: ['src/electron/hub-ui.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'script',
            globals: {
                ...globals.browser,
                ...Object.fromEntries([
                    'snapshots', 'activeAccount', 'viewMode', 'gridState', 'webviews', 'ACCOUNTS', 'STATUS_LABELS',
                    'dirtyByAcc', 'currentUpdateState', 'BUFF_KINDS', '$', 'fmtNum', 'escapeHtml', 'pokemonSpriteUrl',
                    'resolvePokemonSpriteDex', 'setPokemonSpriteImg',
                    'selectAccount', 'setViewMode', 'setSubtab', 'sendAction', 'claimTwitchChest', 'isAccountMuted',
                    'setAccountMuted', 'renderActiveAccountPanel', 'renderAll', 'saveConfig', 'readConfigForm',
                    'applyConfigTo', 'applyGridLayout', 'renderGridToolbar', 'requestLivesRefresh',
                ].map((name) => [name, 'readonly'])),
            },
        },
        rules: {
            'no-undef': 'error',
            'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
        },
    },
];
