// -----------------------------------------------------------------------------
// Readings -> the now_playing_changed scene event. Pure.
//
// One event per transition, through a small memory per radio:
//   { playing, known }  playing: { station, track } last seen, null when the
//                       radio was off or offline; known: a real previous
//                       state was seen.
// - the first reading only arms (nothing fires after a restart);
// - a radio seen off then playing fires (it started playing);
// - an empty reading of a radio that is on (buffering, tuning) changes
//   nothing: the same station coming back does not fire twice;
// - `quiet`: a change caused by a command sent through Gladys arms silently,
//   so a scene bound to the event can never loop through the integration.
// -----------------------------------------------------------------------------

import { CHANGES, SCENE_TRIGGERS } from './constants.js';
import { nowPlayingLine } from './fsapi/model.js';

const lower = (parts) => parts.map((part) => String(part ?? '').toLowerCase()).join('\n');

/**
 * What a reading plays: null (off or offline), 'empty' (on, nothing to show
 * yet) or { station: mode + name, track: text + artist + album }.
 */
export function contentOf(reading) {
  if (!reading?.online || !reading.power) {
    return null;
  }
  if (!reading.name && !reading.text && !reading.artist && !reading.album) {
    return 'empty';
  }
  return {
    station: lower([reading.mode?.id, reading.name]),
    track: lower([reading.text, reading.artist, reading.album]),
  };
}

const same = (a, b) => a !== null && b !== null && a.station === b.station && a.track === b.track;

/** -> { memory, change } where change is null, 'station' or 'track'. */
export function nowPlayingTransition(memory, reading, { quiet = false } = {}) {
  const content = contentOf(reading);
  if (memory === undefined) {
    return {
      memory: { playing: content === 'empty' ? null : content, known: content !== 'empty' },
      change: null,
    };
  }
  if (content === null) {
    return { memory: { playing: null, known: true }, change: null };
  }
  if (content === 'empty' || same(memory.playing, content)) {
    return { memory, change: null };
  }
  const next = { playing: content, known: true };
  if (!memory.known || quiet) {
    return { memory: next, change: null };
  }
  const change =
    memory.playing && memory.playing.station === content.station ? CHANGES.TRACK : CHANGES.STATION;
  return { memory: next, change };
}

const bound = (text) => String(text ?? '').slice(0, 1000);

/** The event of a change, flat and bounded. */
export function nowPlayingEvent(deviceId, radioName, reading, change) {
  return {
    key: SCENE_TRIGGERS.NOW_PLAYING,
    data: {
      radio: deviceId,
      radio_name: bound(radioName),
      change,
      source: reading.mode?.source ?? 'other',
      mode: bound(reading.mode?.label ?? ''),
      name: bound(reading.name),
      text: bound(reading.text),
      artist: bound(reading.artist),
      album: bound(reading.album),
      summary: bound(nowPlayingLine(reading)),
    },
  };
}
