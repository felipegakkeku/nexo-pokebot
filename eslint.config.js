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
];
