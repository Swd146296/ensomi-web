import assert from 'node:assert/strict';
import test from 'node:test';

const { getPreviewStartMs } = await import('./player.ts');

test('starts when the first note enters the top of the lanes when that skips at least three seconds', () => {
    assert.equal(getPreviewStartMs?.(10_000, 576, 720), 10_000 - (0.82 * 576 / 720 * 1000));
});

test('starts at zero when the visual lead would skip less than three seconds', () => {
    assert.equal(getPreviewStartMs?.(3_500, 576, 720), 0);
});

test('starts at zero when the first note is within one second', () => {
    assert.equal(getPreviewStartMs?.(1_500, 576, 720), 0);
});

test('starts at zero for an empty chart', () => {
    assert.equal(getPreviewStartMs?.(undefined, 576, 720), 0);
});
