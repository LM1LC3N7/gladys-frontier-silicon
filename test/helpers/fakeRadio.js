// -----------------------------------------------------------------------------
// A fake Frontier Silicon radio behind a fake `fetch`: it answers GET / SET /
// LIST_GET_NEXT on its FSAPI path with the XML a radio sends (the shapes of
// the afsapi recordings), its description on /device and /dd.xml, checks the
// PIN, and can go offline. Every call is recorded. No test touches the
// network: an unknown address fails loudly.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { setFetch } from '../../src/http.js';

setFetch(async (url) => {
  throw new Error(`Network call without a fake radio in a test: ${url}`);
});

export const fixture = (name) =>
  readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');

const escape = (text) =>
  String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const answer = (status, inner = '') =>
  `<fsapiResponse>\n<status>${status}</status>\n${inner}</fsapiResponse>\n`;
const typed = (value) =>
  typeof value === 'number' ? `<u8>${value}</u8>` : `<c8_array>${escape(value)}</c8_array>`;
export const valueAnswer = (value) => answer('FS_OK', `<value>${typed(value)}</value>\n`);

export const xml = (body, status = 200) =>
  new Response(body, { status, headers: { 'content-type': 'text/xml' } });

/** The modes of the radio recorded by afsapi (a Dutch "Keukenradio"). */
export const MODES = [
  { id: 'IR', label: 'Internetradio', selectable: 1 },
  { id: 'Spotify', label: 'Spotify', selectable: 1 },
  { id: 'DMR', label: 'Local Music', selectable: 0 },
  { id: 'MP', label: 'Muziekspeler', selectable: 1 },
  { id: 'DAB', label: 'DAB', selectable: 1 },
  { id: 'FM', label: 'FM', selectable: 1 },
  { id: 'Bluetooth', label: 'Bluetooth', selectable: 1 },
  { id: 'AUXIN', label: 'AUX (extra ingang)', selectable: 1 },
];

export const MODE_KEYS = Object.fromEntries(MODES.map((m, key) => [m.id, key]));

/** A radio's state; every field can be overridden. */
export function radioState(overrides = {}) {
  return {
    friendlyName: 'Keukenradio',
    radioId: '0022610A1B2C',
    version: 'ir-mmi-FS2026-0500-0515-Stream94i_V2.14.35c.EX86167-V1.04',
    steps: 33,
    power: 1,
    volume: 10,
    mute: 0,
    mode: MODE_KEYS.DAB,
    status: 2,
    name: 'VRT Klara',
    text: 'Bach - Cello Suite No. 1',
    artist: '',
    album: '',
    graphic: '',
    navState: 0,
    modes: MODES,
    // Preset names per mode key, with the padding the radios add.
    presets: {
      [MODE_KEYS.DAB]: ['VRT Klara       ', 'VRT NWS         ', 'VRT StuBru      ', '', ''],
      [MODE_KEYS.IR]: ['France Inter', 'FIP', 'Radio Nova', 'TSF Jazz', 'BBC Radio 3', ''],
    },
    missing: [], // nodes answered FS_NODE_DOES_NOT_EXIST
    ...overrides,
  };
}

const GETTERS = {
  'netRemote.sys.power': (s) => s.power,
  'netRemote.sys.mode': (s) => s.mode,
  'netRemote.sys.audio.volume': (s) => s.volume,
  'netRemote.sys.caps.volumeSteps': (s) => s.steps,
  'netRemote.sys.audio.mute': (s) => s.mute,
  'netRemote.sys.info.friendlyName': (s) => s.friendlyName,
  'netRemote.sys.info.radioId': (s) => s.radioId,
  'netRemote.sys.info.version': (s) => s.version,
  'netRemote.play.status': (s) => s.status,
  'netRemote.play.info.name': (s) => s.name,
  'netRemote.play.info.text': (s) => s.text,
  'netRemote.play.info.artist': (s) => s.artist,
  'netRemote.play.info.album': (s) => s.album,
  'netRemote.play.info.graphicUri': (s) => s.graphic,
  'netRemote.nav.state': (s) => s.navState,
};

function listItems(node, s) {
  if (node === 'netRemote.sys.caps.validModes') {
    return s.modes.map((m, key) => ({
      key,
      fields: `<field name="id">${typed(m.id)}</field>\n<field name="selectable"><u8>${m.selectable}</u8></field>\n<field name="label">${typed(m.label)}</field>\n<field name="streamable"><u8>0</u8></field>\n`,
    }));
  }
  if (node === 'netRemote.nav.presets') {
    if (s.navState !== 1) {
      return 'FS_NODE_BLOCKED';
    }
    const names = s.presets[s.mode];
    if (!names) {
      return 'FS_NODE_BLOCKED';
    }
    return names.map((name, key) => ({
      key,
      fields: `<field name="name">${typed(name)}</field>\n<field name="type"><c8_array></c8_array></field>\n`,
    }));
  }
  return 'FS_NODE_DOES_NOT_EXIST';
}

function setNode(node, value, s) {
  const n = Number(value);
  switch (node) {
    case 'netRemote.sys.power':
      s.power = n ? 1 : 0;
      return 'FS_OK';
    case 'netRemote.sys.audio.volume':
      if (n < 0 || n >= s.steps) return 'FS_FAIL';
      s.volume = n;
      return 'FS_OK';
    case 'netRemote.sys.audio.mute':
      s.mute = n ? 1 : 0;
      return 'FS_OK';
    case 'netRemote.sys.mode':
      if (!s.modes[n]?.selectable) return 'FS_FAIL';
      s.mode = n;
      s.navState = 0;
      s.name = '';
      s.text = '';
      return 'FS_OK';
    case 'netRemote.nav.state':
      s.navState = n;
      return 'FS_OK';
    case 'netRemote.nav.action.selectPreset': {
      if (s.navState !== 1) return 'FS_NODE_BLOCKED';
      const name = s.presets[s.mode]?.[n]?.trim();
      if (!name) return 'FS_FAIL';
      s.name = name;
      s.text = '';
      return 'FS_OK';
    }
    case 'netRemote.play.control':
      if (!s.power || n === 3 || n === 4) return 'FS_FAIL';
      s.status = n === 2 ? 3 : 2;
      return 'FS_OK';
    default:
      return 'FS_NODE_DOES_NOT_EXIST';
  }
}

/**
 * A radio: { host, port (FSAPI), pin, path, state, offline, descriptions }.
 * `handle(url)` returns the Response, or throws like an unreachable host.
 */
export function createRadio({
  host = '192.168.1.183',
  pin = '1234',
  path = '/fsapi',
  state = radioState(),
} = {}) {
  const radio = { host, pin, path, state, offline: false, describes: true };
  radio.handle = (url) => {
    if (radio.offline) {
      throw Object.assign(new TypeError('fetch failed'), {
        cause: { code: 'EHOSTUNREACH', message: `connect EHOSTUNREACH ${url}` },
      });
    }
    const port = url.port || '80';
    const description = `<?xml version="1.0"?>\n<netRemote>\n<friendlyName>${escape(state.friendlyName)}</friendlyName>\n<version>${escape(state.version)}</version>\n<webfsapi>http://${host}:80${path}</webfsapi>\n</netRemote>\n`;
    if (url.pathname === '/device' || url.pathname === '/dd.xml') {
      return radio.describes ? xml(description) : xml('Not found', 404);
    }
    if (port !== '80' || !url.pathname.startsWith(`${path}/`)) {
      return xml('Not found', 404);
    }
    if (url.searchParams.get('pin') !== radio.pin) {
      return xml('Forbidden', 403);
    }
    const [verb, ...rest] = url.pathname.slice(path.length + 1).split('/');
    const node = rest[0];
    if (verb === 'GET') {
      if (state.missing.includes(node) || !GETTERS[node]) {
        return xml(answer('FS_NODE_DOES_NOT_EXIST'));
      }
      return xml(valueAnswer(GETTERS[node](state)));
    }
    if (verb === 'SET') {
      return xml(answer(setNode(node, url.searchParams.get('value'), state)));
    }
    if (verb === 'LIST_GET_NEXT') {
      const items = listItems(node, state);
      if (typeof items === 'string') {
        return xml(answer(items));
      }
      const start = Number(rest[1]);
      const max = Number(url.searchParams.get('maxItems')) || 50;
      const page = items.filter((i) => i.key > start).slice(0, max);
      const end = page.length === 0 || page[page.length - 1].key === items[items.length - 1].key;
      const body = page.map((i) => `<item key="${i.key}">\n${i.fields}</item>\n`).join('');
      return xml(answer('FS_OK', `${body}${end ? '<listend/>\n' : ''}`));
    }
    return xml('Not found', 404);
  };
  return radio;
}

/** Install a fake fetch serving these radios; records every call. */
export function installRadios(radios, { delay } = {}) {
  const calls = [];
  const previous = setFetch(async (href, init = {}) => {
    const url = new URL(href);
    const call = {
      url: href,
      host: url.hostname,
      path: url.pathname,
      params: Object.fromEntries(url.searchParams),
      init,
    };
    calls.push(call);
    if (delay) {
      await delay(call);
    }
    const radio = radios.find((r) => r.host === url.hostname);
    if (!radio) {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    }
    return radio.handle(url);
  });
  return {
    calls,
    /** The FSAPI calls only, as "GET netRemote.sys.power" / "SET ...=1". */
    fsapi: () =>
      calls
        .filter((c) => /\/(GET|SET|LIST_GET_NEXT)\//.test(c.path))
        .map((c) => {
          const [, verb, node] = /\/(GET|SET|LIST_GET_NEXT)\/([^/]+)/.exec(c.path);
          return verb === 'SET' ? `SET ${node}=${c.params.value}` : `${verb} ${node}`;
        }),
    reset: () => {
      calls.length = 0;
    },
    restore: () => setFetch(previous),
  };
}
