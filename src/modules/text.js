// Texto sem acento e em minúsculas, para comparar nomes do jogo (cópia do normalizeText do núcleo, sem depender dele).
export const normalizeText = (str) =>
    (str || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
