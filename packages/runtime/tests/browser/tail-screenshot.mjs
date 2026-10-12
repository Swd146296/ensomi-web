/**
 * Screenshot of the inspector at its default visual speed around the long note that ends closest before the next head
 * in its lane, from the Adventure result that wheel.mjs replays (page-wasm-local.json and its chart in bulk/).
 * Run from packages/runtime with the built page served at ENSOMI_TEST_URL (default http://127.0.0.1:8087):
 *   node tests/browser/tail-screenshot.mjs <name>     writes docs/screenshots/inspector-tail-<name>.png
 */
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const runtime = resolve(import.meta.dirname, '../..'), out = join(runtime, 'artifacts/browser-test'), name = process.argv[2] ?? 'page';
const matrix = JSON.parse(await readFile(join(out, 'page-wasm-local.json'), 'utf8')), run = matrix.runs.find(r => r.song === 'adventure');
const chart = JSON.parse(await readFile(join(out, 'bulk/wasm-local-cold-adventure-chart.json'), 'utf8'));
const fixture = { loaded: matrix.loads[0].events.find(e => e.type === 'loaded'), result: { chart, receipt: { model_name: 'Ensomi R2', model_version: 'r2-1.0', seed: 0, star: 4.5, receipt_json: JSON.stringify(run.detail) }, osu: '' } };

// The long note with the smallest gap to the next head in its lane.
let closest;
for (const [i, o] of chart.objects.entries()) {
    const next = o.end_ms === undefined ? undefined : chart.objects.slice(i + 1).find(n => n.lane === o.lane);
    if (next && (!closest || next.start_ms - o.end_ms < closest.gap)) closest = { o, gap: next.start_ms - o.end_ms };
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
    await page.addInitScript(fixture => {
        window.Worker = class {
            onmessage;
            postMessage(data) { setTimeout(() => this.onmessage({ data: data.type === 'load' ? fixture.loaded : { type: 'result', result: { ...fixture.result, osz: new Uint8Array() } } }), 0); }
        };
    }, fixture);
    await page.goto(process.env.ENSOMI_TEST_URL ?? 'http://127.0.0.1:8087/');
    await page.locator('#load').click();
    await page.locator('#song').setInputFiles(resolve(runtime, '../../../ensomi-model/dataset/0/2202551/audio.ogg'));
    await page.locator('#generate-button').click();
    await page.locator('#result').waitFor();
    await page.locator('#lanes').scrollIntoViewIfNeeded();
    // Put the long note's end at mid-height of the lanes, paused, and crop to its lane.
    const speed = await page.evaluate(() => Number(document.querySelector('#speeds [aria-pressed="true"]').textContent));
    const box = await page.locator('#lanes').boundingBox(), laneW = Math.min(80, (box.width - 32) / 4), x0 = box.x + (box.width - 4 * laneW) / 2;
    await page.evaluate(t => { const a = document.querySelector('#audio'); a.pause(); a.currentTime = t / 1000; }, closest.o.end_ms - (0.82 - 0.5) * box.height / speed * 1000);
    await page.waitForTimeout(300);
    await page.screenshot({ path: resolve(runtime, `../../docs/screenshots/inspector-tail-${name}.png`), clip: { x: x0 + (closest.o.lane - 1) * laneW, y: box.y + box.height * 0.5 - 80, width: 3 * laneW, height: 240 } });
    console.log({ name, speed, lane: closest.o.lane, end: closest.o.end_ms, gapMs: closest.gap });
}
finally {
    await browser.close();
}
