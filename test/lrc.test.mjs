import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseLrc } from '../lib/fnos/lrc.js';

test('parses timed LRC with offset and end times', () => {
  const doc = parseLrc('[ti:Demo]\n[00:01.00]Hello\n[00:03.50]World', 500);
  assert.equal(doc.timed, true);
  assert.equal(doc.offsetMs, 500);
  assert.equal(doc.lines.length, 2);
  assert.equal(doc.lines[0].timeMs, 1500);
  assert.equal(doc.lines[0].text, 'Hello');
  assert.equal(doc.lines[0].endMs, 4000);
  assert.equal(doc.lines[1].timeMs, 4000);
});

test('duplicate timestamp becomes a bilingual translation', () => {
  const doc = parseLrc('[00:01.00]Hello\n[00:01.00]你好\n[00:02.00]Bye');
  assert.equal(doc.lines.length, 2);
  assert.equal(doc.lines[0].translation, '你好');
  assert.equal(doc.lines[1].text, 'Bye');
});

test('enhanced LRC word tags are preserved', () => {
  const doc = parseLrc('[00:01.00]<00:01.00>Hello <00:01.50>world');
  assert.equal(doc.lines.length, 1);
  assert.equal(doc.lines[0].text, 'Hello world');
  assert.deepEqual(doc.lines[0].words?.map((word) => word.text), ['Hello', 'world']);
  assert.equal(doc.lines[0].words?.[1].timeMs, 1500);
});

test('multiple leading timestamps repeat the line', () => {
  const doc = parseLrc('[00:01.00][00:05.00]Same');
  assert.equal(doc.lines.length, 2);
  assert.deepEqual(doc.lines.map((line) => line.timeMs), [1000, 5000]);
});

test('untimed plain lyrics degrade without throwing', () => {
  const doc = parseLrc('Plain one\nPlain two');
  assert.equal(doc.timed, false);
  assert.equal(doc.lines.length, 2);
  assert.equal(doc.lines[0].timeMs, 0);
});

test('content offset tag and maxLines are applied', () => {
  const doc = parseLrc('[offset:250]\n[00:01.00]One\n[00:02.00]Two', 0, 1);
  assert.equal(doc.lines.length, 1);
  assert.equal(doc.lines[0].timeMs, 1250);
});

test('malformed or empty input is safe', () => {
  assert.equal(parseLrc('').lines.length, 0);
  assert.equal(parseLrc('[bad]').lines.length, 0);
  assert.equal(parseLrc('[00:01.00]').lines.length, 0);
});
