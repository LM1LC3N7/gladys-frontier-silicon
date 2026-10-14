// -----------------------------------------------------------------------------
// now_playing_changed: one event per transition, the first reading arms.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nowPlayingEvent, nowPlayingTransition } from '../src/triggers.js';

const DAB = { key: 4, id: 'DAB', label: 'DAB', selectable: true, source: 'dab' };
const IR = { key: 0, id: 'IR', label: 'Internetradio', selectable: true, source: 'internet_radio' };
const on = (name, text = '', mode = DAB) => ({
  online: true,
  power: true,
  playing: true,
  mode,
  name,
  text,
  artist: '',
  album: '',
});
const OFF = { online: true, power: false, playing: false };
const OFFLINE = { online: false, power: false, playing: false };

/** Feed readings, return the changes. */
function run(readings, quietAt = []) {
  let memory;
  return readings.map((reading, i) => {
    const step = nowPlayingTransition(memory, reading, { quiet: quietAt.includes(i) });
    memory = step.memory;
    return step.change;
  });
}

test('the first reading only arms, then one event per change', () => {
  assert.deepEqual(
    run([
      on('VRT Klara', 'Bach'),
      on('VRT Klara', 'Bach'),
      on('VRT Klara', 'Mozart'),
      on('VRT NWS', 'Nieuws'),
      on('VRT NWS', 'Nieuws', IR),
    ]),
    [null, null, 'track', 'station', 'station'],
  );
});

test('off, offline and empty readings', () => {
  assert.deepEqual(
    run([OFF, on('FIP'), OFFLINE, on('FIP'), on(''), on('FIP'), on('FIP', 'Miles Davis')]),
    [null, 'station', null, 'station', null, null, 'track'],
    'a radio turned on fires; buffering then the same station does not',
  );
  // Started while buffering: the first content only arms.
  assert.deepEqual(run([on(''), on('FIP'), on('FIP', 'x')]), [null, null, 'track']);
});

test('a change caused through Gladys arms silently', () => {
  assert.deepEqual(run([on('FIP'), on('TSF Jazz'), on('TSF Jazz', 'Monk')], [1]), [
    null,
    null,
    'track',
  ]);
});

test('the event: flat, bounded, every variable present', () => {
  const reading = { ...on('FIP', 'x'.repeat(1500), IR), artist: 'Miles Davis' };
  const event = nowPlayingEvent('ext:fs:radio:abc', 'Keukenradio', reading, 'track');
  assert.equal(event.key, 'now_playing_changed');
  assert.deepEqual(Object.keys(event.data).sort(), [
    'album',
    'artist',
    'change',
    'mode',
    'name',
    'radio',
    'radio_name',
    'source',
    'summary',
    'text',
  ]);
  assert.equal(event.data.source, 'internet_radio');
  assert.equal(event.data.mode, 'Internetradio');
  assert.equal(event.data.text.length, 1000);
  assert.ok(event.data.summary.startsWith('FIP — Miles Davis — xxx'));
  assert.ok(Object.values(event.data).every((v) => typeof v === 'string' && v.length <= 1000));
});
