// -----------------------------------------------------------------------------
// FSAPI answers -> plain values, modes, presets and readings (pure).
//
// An answer:
//   <fsapiResponse><status>FS_OK</status><value><u8>1</u8></value></fsapiResponse>
// a list (LIST_GET_NEXT):
//   <fsapiResponse><status>FS_OK</status>
//     <item key="0"><field name="id"><c8_array>IR</c8_array></field>...</item>
//     <listend/></fsapiResponse>
// The value types: c8_array (text), u8/u16/u32/s8/s16/s32/e8 (integers).
// -----------------------------------------------------------------------------

import { MODE_FAMILIES, PLAY_STATUS, STATUS } from './nodes.js';
import { XmlError, childOf, childrenOf, firstElement, parseXml, textOf } from './xml.js';

const INTEGER_TYPES = new Set(['u8', 'u16', 'u32', 's8', 's16', 's32', 'e8']);

/** A typed value element (<u8>1</u8>, <c8_array>x</c8_array>) -> number | string | null. */
export function typedValue(el) {
  if (!el) {
    return null;
  }
  const raw = textOf(el);
  if (INTEGER_TYPES.has(el.name.toLowerCase())) {
    const text = raw.trim();
    return /^-?\d+$/.test(text) ? Number(text) : null;
  }
  return raw;
}

/** The fields of a list item -> { name: value } (an empty field is left out). */
function fieldsOf(item) {
  const fields = Object.create(null);
  for (const field of childrenOf(item, 'field')) {
    const name = field.attrs.name;
    const typed = firstElement(field);
    if (name && typed) {
      fields[name] = typedValue(typed);
    }
  }
  return fields;
}

/**
 * Parse an answer: { status, value, items, listEnd }. `value` is undefined
 * when the answer carries none (a SET), `items` empty when it is no list.
 * Throws an XmlError on something that is not an FSAPI answer.
 */
export function parseAnswer(xml) {
  const root = parseXml(xml);
  if (root.name !== 'fsapiResponse') {
    throw new XmlError(`unexpected answer <${root.name.slice(0, 40)}>`);
  }
  const status = textOf(childOf(root, 'status')).trim() || STATUS.FAIL;
  const valueEl = childOf(root, 'value');
  const items = childrenOf(root, 'item').map((item) => {
    const key = Number(item.attrs.key);
    return { key: Number.isInteger(key) ? key : -1, fields: fieldsOf(item) };
  });
  return {
    status,
    value: valueEl ? typedValue(firstElement(valueEl)) : undefined,
    items,
    listEnd: Boolean(childOf(root, 'listend')) || status === STATUS.LIST_END,
  };
}

const clean = (value, max = 300) =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';

/** Lower case, no accents, letters and digits only: "Radio Internet" ~ "radiointernet". */
export function fold(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/** A mode id and label -> the family of SOURCES (src/constants.js). */
export function sourceOf(id, label = '') {
  const key = String(id ?? '').toUpperCase();
  if (Object.hasOwn(MODE_FAMILIES, key)) {
    return MODE_FAMILIES[key];
  }
  if (key.startsWith('AIRABLE') || key.includes('DEEZER') || key.includes('TIDAL')) {
    return 'streaming';
  }
  const words = fold(`${id} ${label}`);
  if (words.includes('bluetooth')) return 'bluetooth';
  if (words.includes('spotify')) return 'spotify';
  if (words.includes('dab')) return 'dab';
  if (/(^|[^a-z])fm/.test(String(label).toLowerCase()) || words === 'fm') return 'fm';
  if (words.includes('internet') || words.includes('webradio')) return 'internet_radio';
  if (words.includes('aux')) return 'aux';
  return 'other';
}

/** validModes items -> [{ key, id, label, selectable, source }]. */
export function modesOf(items) {
  return items
    .filter((item) => item.key >= 0 && typeof item.fields.id === 'string' && item.fields.id)
    .map((item) => {
      const id = clean(item.fields.id, 40);
      const label = clean(item.fields.label, 60) || id;
      return {
        key: item.key,
        id,
        label,
        selectable: item.fields.selectable !== 0,
        source: sourceOf(id, label),
      };
    });
}

/**
 * nav.presets items -> [{ key, number, name }]: the named slots only. The
 * keys start at 0, the radio shows them from 1: `number` is what the user
 * sees. The radios pad the names with spaces ("VRT Klara       ").
 */
export function presetsOf(items) {
  return items
    .filter((item) => item.key >= 0)
    .map((item) => ({ key: item.key, number: item.key + 1, name: clean(item.fields.name, 60) }))
    .filter((preset) => preset.name);
}

// Common names of a family, folded, besides the family key itself.
const FAMILY_ALIASES = {
  internet: 'internet_radio',
  webradio: 'internet_radio',
  radiointernet: 'internet_radio',
  netradio: 'internet_radio',
  dabplus: 'dab',
  bt: 'bluetooth',
  auxin: 'aux',
  linein: 'aux',
  usb: 'music_player',
  musicplayer: 'music_player',
  lecteur: 'music_player',
};

/** Find a mode by id, label, family or a common name ("internet radio", "aux"). */
export function findMode(modes, query) {
  const wanted = fold(query);
  if (!wanted) {
    return undefined;
  }
  const exact =
    modes.find((m) => fold(m.id) === wanted) ?? modes.find((m) => fold(m.label) === wanted);
  if (exact) {
    return exact;
  }
  const family =
    FAMILY_ALIASES[wanted] ?? modes.find((m) => fold(m.source) === wanted)?.source ?? undefined;
  return family
    ? (modes.find((m) => m.source === family && m.selectable) ??
        modes.find((m) => m.source === family))
    : undefined;
}

/** Find a preset by the number the radio shows ("3") or by name. */
export function findPreset(presets, query) {
  const text = String(query ?? '').trim();
  if (/^\d{1,3}$/.test(text)) {
    return presets.find((p) => p.number === Number(text));
  }
  const wanted = fold(text);
  if (!wanted) {
    return undefined;
  }
  return (
    presets.find((p) => fold(p.name) === wanted) ??
    presets.find((p) => fold(p.name).includes(wanted))
  );
}

const PLAYING = new Set([PLAY_STATUS.BUFFERING, PLAY_STATUS.PLAYING, PLAY_STATUS.REBUFFERING]);

/**
 * The raw values of a poll (src/fsapi/client.js readState) -> a reading:
 * { online, power, volume, mute, mode, status, playing, name, text, artist,
 *   album, graphic, at }. `mode` is the entry of `modes`, or a stub when the
 * key is unknown.
 */
export function readingOf(raw, modes = [], at = Date.now()) {
  const power = raw.power === 1;
  if (!power) {
    return { online: true, power: false, playing: false, at };
  }
  const modeKey = Number.isInteger(raw.modeKey) ? raw.modeKey : null;
  const mode =
    modeKey === null
      ? null
      : (modes.find((m) => m.key === modeKey) ?? {
          key: modeKey,
          id: String(modeKey),
          label: String(modeKey),
          selectable: false,
          source: 'other',
        });
  const status = Number.isInteger(raw.status) ? raw.status : null;
  const graphic = clean(raw.graphic, 1000);
  return {
    online: true,
    power: true,
    volume: Number.isInteger(raw.volume) ? raw.volume : null,
    mute: raw.mute === null || raw.mute === undefined ? null : raw.mute === 1,
    mode,
    status,
    playing: PLAYING.has(status),
    name: clean(raw.name),
    text: clean(raw.text),
    artist: clean(raw.artist),
    album: clean(raw.album),
    graphic: /^https?:\/\//i.test(graphic) ? graphic : '',
    at,
  };
}

/** "France Inter — Le 7/9" : the distinct non-empty parts, at most 300 characters. */
export function nowPlayingLine(reading) {
  if (!reading?.power) {
    return '';
  }
  const parts = [];
  for (const part of [reading.name, reading.artist, reading.text]) {
    if (part && !parts.some((p) => p.toLowerCase() === part.toLowerCase())) {
      parts.push(part);
    }
  }
  return parts.join(' — ').slice(0, 300);
}
