/**
 * Timing against the Python release. Generates the four release songs through the served page (headless Chrome,
 * WebAssembly backend, seed 1; the grid does not depend on the seed) and compares each receipt's timing segments and
 * beat grid with the Python release receipt in ensomi-model/artifacts/runtime-ref. Beat grid: every beat of the
 * segments from 0 to the song's end, as the inspector draws them; each Python beat against the nearest browser beat.
 * Run from packages/runtime with a page served at ENSOMI_TEST_URL (default http://127.0.0.1:8087); ENSOMI_EXACT=1 turns
 * the page's Exact timing option on:
 *   node tests/browser/grid-drift.mjs <label>     writes artifacts/browser-test/grid-drift-<label>.json
 */
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const runtime = resolve(import.meta.dirname, '../..'), modelRepo = resolve(runtime, '../../../ensomi-model'), out = join(runtime, 'artifacts/browser-test');
const label = process.argv[2] ?? 'page', base = process.env.ENSOMI_TEST_URL ?? 'http://127.0.0.1:8087', exact = process.env.ENSOMI_EXACT === '1';
const songs = [['hesitation-snow', 'ogg', 2.5], ['saigetsu', 'mp3', 3.5], ['catch-the-moment', 'mp3', 3.5], ['adventure', 'ogg', 4.5]];

function beats(segments, end) {
    const all = [];
    segments.forEach(([offset, length], i) => {
        const until = segments[i + 1]?.[0] ?? end;
        for (let k = i === 0 ? -Math.floor(offset / length) : 0; offset + k * length < until; k++) all.push(offset + k * length);
    });
    return all;
}
function nearest(sorted, x) {
    let l = 0, r = sorted.length - 1;
    while (l < r) {
        const m = (l + r) >> 1;
        if (sorted[m] < x) l = m + 1;
        else r = m;
    }
    return Math.min(Math.abs(sorted[l] - x), l ? Math.abs(sorted[l - 1] - x) : Infinity);
}
function compare(python, browser, end) {
    const a = beats(python, end), b = beats(browser, end), d = a.map(x => nearest(b, x)).sort((x, y) => x - y);
    return {
        segments: [python.length, browser.length],
        offsetMs: python.map((s, i) => browser[i] ? browser[i][0] - s[0] : null),
        beatLengthMs: python.map((s, i) => browser[i] ? browser[i][1] - s[1] : null),
        beats: [a.length, b.length],
        beatMaxMs: d.at(-1),
        beatMedianMs: d[d.length >> 1],
        beatsOver1Ms: d.filter(x => x > 1).length,
    };
}

await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const report = { label, base, exact, chrome: browser.version(), started: new Date().toISOString(), songs: [] };
try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(() => {
        window.__results = [];
        const NativeWorker = window.Worker;
        window.Worker = class extends NativeWorker {
            constructor(...args) {
                super(...args);
                this.addEventListener('message', ({ data }) => {
                    if (data.type === 'result') window.__results.push(data.result);
                    else if (data.type === 'error') window.__results.push({ error: data.message });
                });
            }
        };
    });
    const page = await context.newPage();
    const url = new URL(base);
    url.searchParams.set('model', '/model/onnx/');
    url.searchParams.set('backend', 'wasm');
    await page.goto(url.href);
    if (exact) await page.locator('#exact').check();
    await page.locator('#load').click();
    await page.waitForFunction(() => /ready/.test(document.querySelector('#model-status').textContent) || !document.querySelector('#error').hidden, null, { timeout: 300000 });
    for (const [slug, ext, star] of songs) {
        const reference = join(modelRepo, 'artifacts/runtime-ref/bulk', slug, 'reference');
        await page.locator('#song').setInputFiles(join(reference, `audio.${ext}`));
        await page.waitForFunction(() => !document.querySelector('#song-status').textContent.startsWith('Decoding'), null, { timeout: 60000 });
        await page.locator('#star').fill(String(star));
        await page.locator('#seed').fill('1');
        const n = await page.evaluate(() => window.__results.length);
        await page.locator('#generate-button').click();
        await page.waitForFunction(n => window.__results.length > n, n, { timeout: 600000 });
        const result = await page.evaluate(n => {
            const r = window.__results[n];
            if (r.error) return r;
            const receipt = JSON.parse(r.receipt.receipt_json);
            return { segments: receipt.rows.segments, end: r.chart.duration_ms, pcmSeconds: receipt.seconds.pcm };
        }, n);
        const python = JSON.parse(await readFile(join(reference, 'receipt.json'), 'utf8')).rows.segments;
        const row = { song: slug, status: await page.locator('#song-status').textContent(), ...(result.error ? result : { python, browser: result.segments, pcmSeconds: result.pcmSeconds, ...compare(python, result.segments, result.end) }) };
        report.songs.push(row);
        console.log(slug, JSON.stringify({ segments: row.segments, offsetMs: row.offsetMs, beatMaxMs: row.beatMaxMs, beatMedianMs: row.beatMedianMs, pcmSeconds: row.pcmSeconds, error: row.error }));
    }
}
finally {
    await writeFile(join(out, `grid-drift-${label}.json`), JSON.stringify(report, null, 2));
    await browser.close();
}
