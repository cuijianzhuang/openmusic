import test from 'node:test';
import assert from 'node:assert/strict';
import { getBufferedAheadSeconds, isAudioBufferedForPlayback } from './audioReadiness.ts';
(globalThis as { HTMLMediaElement?: { HAVE_FUTURE_DATA: number } }).HTMLMediaElement = { HAVE_FUTURE_DATA: 3 };

function audio(readyState: number, currentTime: number, ranges: Array<[number, number]>) {
  return { readyState, currentTime, buffered: { length: ranges.length, start: (i: number) => ranges[i][0], end: (i: number) => ranges[i][1] } } as unknown as HTMLAudioElement;
}

test('requires future data and enough buffered audio', () => {
  assert.equal(getBufferedAheadSeconds(audio(1, 0, [[0, 5]])), 5);
  assert.equal(isAudioBufferedForPlayback(audio(1, 0, [[0, 5]])), false);
  assert.equal(isAudioBufferedForPlayback(audio(3, 0, [[0, 0.5]])), false);
  assert.equal(isAudioBufferedForPlayback(audio(3, 0, [[0, 1.2]])), true);
});

test('uses the buffered range containing currentTime', () => {
  assert.equal(getBufferedAheadSeconds(audio(3, 10, [[0, 2], [9.5, 11.25]])), 1.25);
});
