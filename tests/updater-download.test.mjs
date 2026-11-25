import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { downloadFileWithProgress } from '../src/desktop/updater.mjs';

const DATA = Buffer.from('0123456789'.repeat(100)); // 1000 bytes

function streamOf(buf, { stallAfter = -1, signal } = {}) {
    let sent = 0;
    return {
        getReader() {
            return {
                read() {
                    if (stallAfter >= 0 && sent >= stallAfter) {
                        // conexao parada: so resolve quando o downloader aborta
                        return new Promise((_, rej) => signal?.addEventListener('abort', () => rej(new Error('aborted'))));
                    }
                    if (sent >= buf.length) return Promise.resolve({ done: true });
                    const part = buf.subarray(sent, Math.min(sent + 250, buf.length));
                    sent += part.length;
                    return Promise.resolve({ done: false, value: new Uint8Array(part) });
                },
            };
        },
    };
}

test('download parado retoma com Range e termina completo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nexo-dl-'));
    const calls = [];
    const fetchImpl = async (url, { headers, signal }) => {
        calls.push(headers.Range || null);
        if (!headers.Range) {
            return { ok: true, status: 200, headers: new Map([['content-length', String(DATA.length)]]), body: streamOf(DATA, { stallAfter: 500, signal }) };
        }
        const start = Number(/bytes=(\d+)-/.exec(headers.Range)[1]);
        return {
            ok: true,
            status: 206,
            headers: new Map([['content-length', String(DATA.length - start)], ['content-range', `bytes ${start}-${DATA.length - 1}/${DATA.length}`]]),
            body: streamOf(DATA.subarray(start), { signal }),
        };
    };
    try {
        const dest = join(dir, 'f.bin');
        const r = await downloadFileWithProgress('https://x/f', dest, { fetchImpl, stallMs: 50, retries: 2 });
        assert.equal(r.downloadedBytes, DATA.length);
        assert.deepEqual(readFileSync(dest), DATA);
        assert.equal(calls.length, 2);
        assert.equal(calls[1], 'bytes=500-');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('download que nunca responde falha com mensagem clara', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nexo-dl-'));
    const fetchImpl = async (url, { signal }) => ({ ok: true, status: 200, headers: new Map([['content-length', '1000']]), body: streamOf(DATA, { stallAfter: 0, signal }) });
    try {
        await assert.rejects(
            downloadFileWithProgress('https://x/f', join(dir, 'f.bin'), { fetchImpl, stallMs: 30, retries: 1 }),
            /parou de responder/,
        );
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
