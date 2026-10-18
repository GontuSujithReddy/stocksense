import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const source = await readFile(new URL('./barcode-scanner.ts', import.meta.url), 'utf8');
const compiled = stripTypeScriptTypes(source);
const { startBarcodeScanner, cameraErrorMessage } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const tick = () => new Promise(resolve => setTimeout(resolve, 10));
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const camera = () => {
  const track = { stopped: false, stop() { this.stopped = true; } };
  const stream = { getTracks: () => [track] };
  const video = { srcObject: null, readyState: 4, videoWidth: 1280, paused: false, play: async () => {}, pause() { this.paused = true; } };
  const result = [];
  const errors = [];
  return { stream, track, video, result, errors, callbacks: { onDetected: text => result.push(text), onReady() {}, onError: message => errors.push(message) } };
};
test('native detection preserves leading zeros, returns once, and releases camera before the result', async () => {
  const c = camera();
  const session = startBarcodeScanner(c.video, {
    ...c.callbacks,
    onDetected: text => { assert.equal(c.track.stopped, true); c.result.push(text); },
  }, {
    getStream: async () => c.stream,
    getDetector: async () => ({ detect: async () => [{ rawValue: '001234560099' }, { rawValue: 'OTHER' }] }),
    startFallback: async () => { throw new Error('Must use native detector'); },
  });
  await tick();
  assert.deepEqual(c.result, ['001234560099']);
  assert.equal(c.video.srcObject, null);
  session.stop();
  assert.equal(c.result.length, 1);
});
test('cancel while permission is pending stops the late stream without starting decoding', async () => {
  const c = camera(), permission = deferred();
  const session = startBarcodeScanner(c.video, c.callbacks, {
    getStream: () => permission.promise,
    getDetector: async () => { assert.fail('Decoder must not start after close'); },
    startFallback: async () => { assert.fail('Decoder must not start after close'); },
  });
  session.stop();
  permission.resolve(c.stream);
  await tick();
  assert.equal(c.track.stopped, true);
  assert.deepEqual(c.result, []);
  assert.deepEqual(c.errors, []);
});
test('cancel during native detection ignores a late barcode and clears the video', async () => {
  const c = camera(), detection = deferred();
  const session = startBarcodeScanner(c.video, c.callbacks, {
    getStream: async () => c.stream,
    getDetector: async () => ({ detect: () => detection.promise }),
    startFallback: async () => { assert.fail('Unexpected fallback'); },
  });
  await tick();
  session.stop();
  detection.resolve([{ rawValue: 'LATE-CODE' }]);
  await tick();
  assert.deepEqual(c.result, []);
  assert.equal(c.track.stopped, true);
  assert.equal(c.video.srcObject, null);
});
test('fallback detection is used without native support and stops late decoder controls', async () => {
  const c = camera(), controls = deferred();
  let onDetected, decoderStopped = false;
  startBarcodeScanner(c.video, c.callbacks, {
    getStream: async () => c.stream,
    getDetector: async () => null,
    startFallback: async (_stream, _video, callback) => { onDetected = callback; return controls.promise; },
  });
  await tick();
  onDetected('000012345678');
  onDetected('SECOND-CODE');
  controls.resolve({ stop: () => { decoderStopped = true; } });
  await tick();
  assert.deepEqual(c.result, ['000012345678']);
  assert.equal(c.track.stopped, true);
  assert.equal(decoderStopped, true);
});
test('a failed native detector switches to the real fallback path', async () => {
  const c = camera();
  startBarcodeScanner(c.video, c.callbacks, {
    getStream: async () => c.stream,
    getDetector: async () => ({ detect: async () => { throw new Error('Native detector unavailable'); } }),
    startFallback: async (_stream, _video, detected) => { detected('CODE-128-001'); return { stop() {} }; },
  });
  await tick();
  assert.deepEqual(c.result, ['CODE-128-001']);
  assert.equal(c.track.stopped, true);
  assert.deepEqual(c.errors, []);
});
test('permission refusal reports an actionable error without changing a code', async () => {
  const c = camera();
  startBarcodeScanner(c.video, c.callbacks, {
    getStream: async () => { throw new DOMException('Denied', 'NotAllowedError'); },
    getDetector: async () => null,
    startFallback: async () => { assert.fail('No camera acquired'); },
  });
  await tick();
  assert.deepEqual(c.result, []);
  assert.match(c.errors[0], /Allow camera access/);
  assert.match(cameraErrorMessage(new DOMException('Missing', 'NotFoundError')), /No usable camera/);
});