/** The song's timing prepared before Generate, and the play button across a new result. Run from packages/runtime with
 * the page served at ENSOMI_TEST_URL (default http://127.0.0.1:8087) with the release model at /model/:
 * node tests/browser/prepare-play.mjs [webgpu|wasm]. Writes artifacts/browser-test/prepare-play-<backend>.json.
 *
 * - Model loaded and Catch the Moment chosen: the page sends the worker `prepare` and no `generate`, and after `prepared`
 *   shows Prepare and Timing done and the status asks for the conditions.
 * - Generate (star 3.5, seed 1) sends `generate` and no new `prepare`. The chart is compared with the same song, star
 *   and seed in page-<backend>-local.json when that report exists.
 * - A newly generated result starts at its visual preview time, or 0 when that would skip less than 3 s.
 * - Generate again while the result plays: the audio stops at that preview time and the button reads Play again.
 * - Exact timing on prepares again at the song's rate; that result shows the Timing fact and the Exact-timing decode.
 * - Adventure chosen and Generate pressed before its timing is done: the generation waits for it.
 */
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
const runtime = resolve(import.meta.dirname, '../..'), modelRepo = resolve(runtime, '../../../ensomi-model'), out = join(runtime, 'artifacts/browser-test');
const backend = process.argv[2] || 'webgpu', base = process.env.ENSOMI_TEST_URL ?? 'http://127.0.0.1:8087';
const browser = await chromium.launch({ channel: 'chrome', headless: !process.env.ENSOMI_HEADED, args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addInitScript(() => {
    window.__test = { events: [], sent: [], results: [] };
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
        constructor(...args) {
            super(...args);
            this.addEventListener('message', ({ data }) => {
                if (data.type === 'result') window.__test.results.push(data.result);
                if (data.type !== 'file') window.__test.events.push({ type: data.type, id: data.id, phase: data.phase });
            });
        }
        postMessage(data, ...rest) {
            window.__test.sent.push({ type: data.type, id: data.id, rate: data.rate });
            return super.postMessage(data, ...rest);
        }
    };
});
const page = await context.newPage();
const report = { backend, chromeVersion: browser.version(), started: new Date().toISOString(), checks: {}, errors: [] };
page.on('pageerror', e => report.errors.push(e.message));
const check = (name, pass, detail = {}) => {
    report.checks[name] = { pass, ...detail };
    console.log(pass ? 'PASS' : 'FAIL', name, JSON.stringify(detail).slice(0, 400));
    if (!pass) process.exitCode = 1;
};
const state = () => page.evaluate(() => ({
    sent: __test.sent.map(s => s.type), events: __test.events.map(e => e.type), results: __test.results.length,
    status: document.querySelector('#run-status').textContent, error: document.querySelector('#error').hidden ? null : document.querySelector('#error').textContent,
    phases: [...document.querySelectorAll('#phases li')].map(li => `${li.className || '-'}:${li.textContent}`),
    play: document.querySelector('#play').textContent, pressed: document.querySelector('#play').getAttribute('aria-pressed'),
    paused: document.querySelector('#audio').paused, time: document.querySelector('#audio').currentTime,
}));
const previewStartMs = () => page.evaluate(() => {
    const chart = __test.results.at(-1)?.chart, first = chart?.objects[0]?.start_ms;
    const lanes = document.querySelector('#lanes'), speed = Number(document.querySelector('#speeds [aria-pressed="true"]').textContent);
    const at = first === undefined ? 0 : first - .82 * lanes.clientHeight / speed * 1000;
    return at >= 3000 ? at : 0;
});
const count = (list, type) => list.filter(x => x === type).length;
const phaseClasses = s => s.phases.map(p => p.split(':')[0]);
async function chooseSong(id, ext) {
    await page.locator('#song').setInputFiles(join(modelRepo, `dataset/0/${id}/audio.${ext}`));
    await page.waitForFunction(() => !document.querySelector('#song-status').textContent.includes('Decoding'), null, { timeout: 60000 });
}
const waitPrepared = n => page.waitForFunction(n => __test.events.filter(e => e.type === 'prepared' || e.type === 'error').length > n, n, { timeout: 300000 });
async function generate() {
    const n = await page.evaluate(() => __test.results.length);
    await page.locator('#generate-button').click();
    await page.waitForFunction(n => __test.results.length > n || __test.events.some(e => e.type === 'error'), n, { timeout: 600000 });
    return page.evaluate(n => __test.results[n] && { chart: __test.results[n].chart, receipt: __test.results[n].receipt.receipt_json }, n);
}
const sha = chart => createHash('sha256').update(JSON.stringify(chart)).digest('hex');

try {
    const url = new URL(base);
    url.searchParams.set('model', '/model/onnx/');
    if (backend === 'wasm') url.searchParams.set('backend', 'wasm');
    await page.goto(url.href);
    await page.locator('#load').click();
    await page.waitForFunction(() => __test.events.some(e => ['loaded', 'error'].includes(e.type)), null, { timeout: 300000 });

    await chooseSong('576112', 'mp3');
    await waitPrepared(0);
    await page.waitForTimeout(1000);
    let s = await state();
    check('prepared on song load, nothing generated', count(s.sent, 'prepare') === 1 && count(s.sent, 'generate') === 0 && s.results === 0 && !s.error
        && /Set the conditions/.test(s.status) && phaseClasses(s).join() === 'done,done,-,-,-', s);

    await page.locator('#star').fill('3.5');
    await page.locator('#seed').fill('1');
    const first = await generate();
    const initialPreviewMs = await previewStartMs();
    await page.waitForFunction(expected => Math.abs(document.querySelector('#audio').currentTime * 1000 - expected) < 50, initialPreviewMs, { timeout: 5000 });
    s = await state();
    const firstHash = first && sha(first.chart), detail = first && JSON.parse(first.receipt);
    check('Generate uses the prepared timing', Boolean(first) && count(s.sent, 'prepare') === 1 && count(s.sent, 'generate') === 1 && phaseClasses(s).every(c => c === 'done')
        && detail.seconds.beatthis === undefined && detail.seconds.rows >= 0, { ...s, receiptSeconds: detail?.seconds });
    check('new result starts at visual preview time', Math.abs(s.time * 1000 - initialPreviewMs) < 50, { expectedMs: initialPreviewMs, actualMs: s.time * 1000 });
    const earlier = await readFile(join(out, `page-${backend}-local.json`), 'utf8').then(JSON.parse, () => undefined);
    const reference = earlier?.runs.find(r => r.song === 'catch-the-moment' && r.seed === 1 && !r.section && r.star === 3.5);
    report.chart = { sha256: firstHash, objects: first?.chart.objects.length, reference: reference && { sha256: reference.chartSha256, runtime: reference.detail?.runtime?.version, started: earlier.started } };
    if (reference) check('same chart as the page-matrix run', firstHash === reference.chartSha256, report.chart);

    await page.locator('#play').click();
    await page.waitForFunction(() => document.querySelector('#audio').currentTime > 0.5, null, { timeout: 10000 });
    s = await state();
    check('playing before regenerating', !s.paused && s.play === 'Pause' && s.pressed === 'true', s);
    const again = await generate();
    const regeneratedPreviewMs = await previewStartMs();
    const stopped = await page.waitForFunction(() => document.querySelector('#play').textContent === 'Play', null, { timeout: 2000 }).then(() => true, () => false);
    s = await state();
    check('regenerating while playing stops at the preview time and shows Play', stopped && s.paused && Math.abs(s.time * 1000 - regeneratedPreviewMs) < 50 && s.pressed === 'false' && count(s.sent, 'prepare') === 1 && again && sha(again.chart) === firstHash,
        { ...s, expectedMs: regeneratedPreviewMs, actualMs: s.time * 1000 });
    await page.locator('#play').click();
    await page.waitForFunction(() => document.querySelector('#audio').currentTime > 0.2, null, { timeout: 10000 });
    s = await state();
    check('Play after the new result plays it', !s.paused && s.play === 'Pause', s);
    await page.locator('#play').click();

    await page.locator('#exact').check();
    await waitPrepared(1);
    s = await state();
    const exactSent = await page.evaluate(() => __test.sent.filter(x => x.type === 'prepare').at(-1));
    check('Exact timing prepares again at the song rate', count(s.sent, 'prepare') === 2 && exactSent.rate > 0 && count(s.sent, 'generate') === 2, { ...s, exactSent });
    const exact = await generate();
    const shown = await page.evaluate(() => ({ timing: [...document.querySelectorAll('#receipt dt')].find(d => d.textContent === 'Timing')?.nextElementSibling.textContent, table: [...document.querySelectorAll('#times tr')].map(x => [...x.cells].map(c => c.textContent).join('\t')) }));
    check('exact result shows its timing', Boolean(exact) && /exact/.test(shown.timing ?? '') && shown.table.some(r => r.startsWith('Exact-timing decode')) && shown.table.some(r => r.startsWith('BeatThis and beat grid')), shown);
    await page.locator('#exact').uncheck();
    await waitPrepared(2);

    await chooseSong('2202551', 'ogg');
    const before = await page.evaluate(() => __test.events.filter(e => e.type === 'prepared').length);
    const waited = await generate();
    s = await state();
    const order = await page.evaluate(() => __test.events.map(e => e.type).filter(t => t === 'prepared' || t === 'result').slice(-2));
    check('Generate during preparation waits for the timing', Boolean(waited) && order.join() === 'prepared,result' && before === 3 && !s.error, { ...s, order, before });
    report.finished = new Date().toISOString();
}
catch (e) {
    process.exitCode = 1;
    report.failure = String(e);
    console.error(e);
}
finally {
    if (report.errors.length) process.exitCode = 1;
    await writeFile(join(out, `prepare-play-${backend}.json`), JSON.stringify(report, null, 2) + '\n');
    await browser.close();
}
