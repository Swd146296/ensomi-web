/** Warm WebGPU generation times of Adventure (96 kHz) and Catch the Moment (44.1 kHz) on the built page with the Exact
 * timing option off and on, to read its cost: the second decode at the file's own rate (the times table's
 * `Exact-timing decode`) and the core's rate conversion (receipt stage `pcm`). Run on bings-mac from packages/runtime
 * with the page served at ENSOMI_TEST_URL (default http://127.0.0.1:8087) and nothing else running, or through
 * pcm-timing.sh. Per round, song and setting: reload (warm load), generate, then generate again in the same page.
 * Writes artifacts/browser-test/pcm-timing.json.
 */
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
const runtime = resolve(import.meta.dirname, '../..'), modelRepo = resolve(runtime, '../../../ensomi-model'), out = join(runtime, 'artifacts/browser-test/pcm-timing.json');
const base = process.env.ENSOMI_TEST_URL ?? 'http://127.0.0.1:8087';
const songs = [['adventure', '2202551', 'ogg', 4.5], ['catch-the-moment', '576112', 'mp3', 3.5]], rounds = 3;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addInitScript(() => {
    window.__test = { events: [], results: [] };
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker { constructor(...args) { super(...args); this.addEventListener('message', ({ data }) => { if (data.type === 'result') window.__test.results.push(data.result); else window.__test.events.push(data); }); } };
});
const page = await context.newPage();
const report = { chromeVersion: browser.version(), started: new Date().toISOString(), loads: [], runs: [] };
async function load(warm, exact) {
    await page.goto(`${base}/?model=/model/onnx/`);
    if (exact) await page.locator('#exact').check();
    await page.locator('#load').click();
    await page.waitForFunction(() => __test.events.some(e => ['loaded', 'error'].includes(e.type)), null, { timeout: 300000 });
    const status = await page.locator('#model-status').textContent();
    report.loads.push({ warm, exact, status }); console.log('LOAD', warm, exact, status);
}
async function generate([slug, id, ext, star], round, exact, repeat) {
    await page.locator('#song').setInputFiles(join(modelRepo, `dataset/0/${id}/audio.${ext}`));
    await page.waitForFunction(() => !document.querySelector('#song-status').textContent.includes('Decoding'), null, { timeout: 60000 });
    await page.locator('#star').fill(String(star)); await page.locator('#seed').fill('1'); await page.locator('#title').fill(slug);
    const index = await page.evaluate(() => __test.results.length), started = performance.now();
    await page.locator('#generate-button').click();
    await page.waitForFunction(i => __test.results.length > i || __test.events.some(e => e.type === 'error'), index, { timeout: 600000 });
    const wallSeconds = (performance.now() - started) / 1000;
    const r = await page.evaluate(i => ({ receipt: __test.results[i]?.receipt?.receipt_json, songStatus: document.querySelector('#song-status').textContent, table: [...document.querySelectorAll('#times tr')].map(x => [...x.cells].map(c => c.textContent).join('\t')), error: document.querySelector('#error').hidden ? null : document.querySelector('#error').textContent }), index);
    const seconds = r.receipt ? JSON.parse(r.receipt).seconds : null, decode = r.table.find(row => row.startsWith('Exact-timing decode'));
    const row = { song: slug, round, exact, repeat, wallSeconds, songStatus: r.songStatus, error: r.error, exactDecode: decode, seconds, table: r.table };
    report.runs.push(row);
    console.log('RUN', slug, `round=${round}`, exact ? 'exact' : 'off', repeat ? 'same-page' : 'first-after-reload', `pcm=${seconds?.pcm?.toFixed(3)}`, `total=${seconds?.total?.toFixed(3)}`, `wall=${wallSeconds.toFixed(3)}`, '|', decode ?? '', r.error ?? '');
}
try {
    await load(false, false);
    for (let round = 1; round <= rounds; round++)
        for (const song of songs)
            for (const exact of [false, true]) { await load(true, exact); await generate(song, round, exact, false); await generate(song, round, exact, true); }
} finally {
    report.finished = new Date().toISOString();
    await writeFile(out, JSON.stringify(report, null, 2) + '\n');
    await browser.close();
}
