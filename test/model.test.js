// -----------------------------------------------------------------------------
// The pure parts: FSAPI answers (the afsapi recordings of a real radio),
// modes, presets, readings, the discovery answers and the configuration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, parseHosts } from '../src/config.js';
import {
  checkedBase,
  fsapiBase,
  parseDescription,
  parseSsdpHeaders,
  ssdpRadio,
} from '../src/fsapi/discovery.js';
import {
  findMode,
  findPreset,
  modesOf,
  nowPlayingLine,
  parseAnswer,
  presetsOf,
  readingOf,
  sourceOf,
} from '../src/fsapi/model.js';
import { fixture } from './helpers/fakeRadio.js';

test('answers: integers, texts, empty texts and statuses', () => {
  assert.deepEqual(parseAnswer(fixture('power-off.xml')), {
    status: 'FS_OK',
    value: 0,
    items: [],
    listEnd: false,
  });
  assert.equal(parseAnswer(fixture('friendly-name.xml')).value, 'Keukenradio');
  assert.equal(parseAnswer(fixture('radio-id.xml')).value, '0022610A1B2C');
  assert.match(parseAnswer(fixture('version.xml')).value, /^ir-mmi-FS2026-/);
  assert.equal(parseAnswer(fixture('volume-steps.xml')).value, 33);
  assert.equal(parseAnswer(fixture('play-name-empty.xml')).value, '');
  assert.equal(parseAnswer(fixture('set-ok.xml')).value, undefined);
  assert.equal(parseAnswer(fixture('set-fail.xml')).status, 'FS_FAIL');
  assert.throws(() => parseAnswer('<html><body>Hello</body></html>'), /unexpected answer/);
});

test('modes: the recorded lists, ids, labels and families', () => {
  const modes = modesOf(parseAnswer(fixture('valid-modes.xml')).items);
  assert.equal(modes.length, 8);
  assert.deepEqual(modes[0], {
    key: 0,
    id: 'IR',
    label: 'Internetradio',
    selectable: true,
    source: 'internet_radio',
  });
  assert.equal(modes.find((m) => m.id === 'DMR').selectable, false);
  assert.deepEqual(
    modes.map((m) => m.source),
    ['internet_radio', 'spotify', 'music_player', 'music_player', 'dab', 'fm', 'bluetooth', 'aux'],
  );
  // Another firmware: Bluetooth is "SMTDEV", a mode without label, an empty field.
  const other = modesOf(parseAnswer(fixture('valid-modes-smtdev.xml')).items);
  assert.equal(other.find((m) => m.id === 'SMTDEV').source, 'bluetooth');
  assert.deepEqual(
    other.find((m) => m.id === 'NETWORK'),
    {
      key: 6,
      id: 'NETWORK',
      label: 'NETWORK',
      selectable: false,
      source: 'other',
    },
  );
  assert.equal(sourceOf('AIRABLE_TIDAL', 'TIDAL'), 'streaming');
  assert.equal(sourceOf('XYZ', 'Radio Internet'), 'internet_radio');
});

test('presets: the named slots, trimmed, numbered as the radio shows them', () => {
  const presets = presetsOf(parseAnswer(fixture('presets.xml')).items);
  assert.deepEqual(
    presets.map((p) => `${p.number}=${p.name}`),
    ['1=VRT Klara', '2=VRT NWS', '3=VRT StuBru', '4=VRT De Tijdloze', '5=VRT Continuo'],
  );
  assert.equal(presets[0].key, 0);
  assert.equal(findPreset(presets, '3').name, 'VRT StuBru');
  assert.equal(findPreset(presets, 'vrt nws').number, 2);
  assert.equal(findPreset(presets, 'tijdloze').number, 4);
  assert.equal(findPreset(presets, '9'), undefined);
  assert.equal(findPreset(presets, ''), undefined);
});

test('modes are found by id, label, family or a common name', () => {
  const modes = modesOf(parseAnswer(fixture('valid-modes.xml')).items);
  assert.equal(findMode(modes, 'DAB').key, 4);
  assert.equal(findMode(modes, 'fm').key, 5);
  assert.equal(findMode(modes, 'Muziekspeler').id, 'MP');
  assert.equal(findMode(modes, 'internet radio').id, 'IR');
  assert.equal(findMode(modes, 'Radio internet').id, 'IR');
  assert.equal(findMode(modes, 'aux').id, 'AUXIN');
  assert.equal(findMode(modes, 'bt').id, 'Bluetooth');
  assert.equal(findMode(modes, 'usb').id, 'MP', 'the selectable music player, not DMR');
  assert.equal(findMode(modes, 'cassette'), undefined);
});

test('a reading and its one-line summary', () => {
  const modes = modesOf(parseAnswer(fixture('valid-modes.xml')).items);
  const raw = {
    power: 1,
    volume: 12,
    mute: 0,
    modeKey: 0,
    status: 2,
    name: 'FIP  ',
    text: 'Miles Davis - So What',
    artist: null,
    album: null,
    graphic: 'http://img.example/fip.png',
  };
  const reading = readingOf(raw, modes, 1000);
  assert.equal(reading.mode.label, 'Internetradio');
  assert.equal(reading.playing, true);
  assert.equal(reading.mute, false);
  assert.equal(reading.name, 'FIP');
  assert.equal(nowPlayingLine(reading), 'FIP — Miles Davis - So What');
  assert.equal(readingOf({ ...raw, graphic: 'javascript:alert(1)' }, modes).graphic, '');
  assert.equal(readingOf({ ...raw, modeKey: 42 }, modes).mode.id, '42');
  assert.deepEqual(readingOf({ power: 0 }, modes, 5), {
    online: true,
    power: false,
    playing: false,
    at: 5,
  });
  assert.equal(nowPlayingLine(readingOf({ power: 0 }, modes)), '');
});

test('SSDP answers: the raw text, the radios only, the LOCATION on the radio only', () => {
  const headers = fixture('ssdp-answer.txt');
  assert.equal(parseSsdpHeaders(headers)['speaker-name'], 'Keukenradio');
  assert.deepEqual(ssdpRadio({ source_ip: '192.168.1.183', headers }), {
    host: '192.168.1.183',
    location: 'http://192.168.1.183:8080/dd.xml',
    name: 'Keukenradio',
  });
  // Headers as an object work too; a LOCATION on another host is dropped.
  assert.deepEqual(
    ssdpRadio({
      source_ip: '192.168.1.50',
      headers: {
        ST: 'urn:schemas-frontier-silicon-com:fs_reference:fsapi:1',
        LOCATION: 'http://203.0.113.9/dd.xml',
      },
    }),
    { host: '192.168.1.50', location: undefined, name: undefined },
  );
  const sonos =
    'HTTP/1.1 200 OK\r\nST: upnp:rootdevice\r\nLOCATION: http://192.168.1.9:1400/xml\r\n';
  assert.equal(ssdpRadio({ source_ip: '192.168.1.9', headers: sonos }), undefined);
});

test('descriptions and FSAPI addresses: the host is always the radio', () => {
  assert.deepEqual(parseDescription(fixture('device.xml')), {
    webfsapi: 'http://192.168.1.183:80/fsapi',
    friendlyName: 'Keukenradio',
    version: 'ir-mmi-FS2026-0500-0515-Stream94i_V2.14.35c.EX86167-V1.04',
  });
  assert.equal(parseDescription(fixture('dd-upnp.xml')).webfsapi, 'http://192.168.1.183:80/fsapi');
  assert.equal(
    fsapiBase('192.168.1.183', 'http://192.168.1.183:80/fsapi'),
    'http://192.168.1.183/fsapi',
  );
  assert.equal(fsapiBase('192.168.1.7', 'http://evil.example:8080/x'), 'http://192.168.1.7:8080/x');
  assert.equal(fsapiBase('192.168.1.7', 'ftp://x/y'), 'http://192.168.1.7/fsapi');
  assert.equal(fsapiBase('192.168.1.7', 'http://x/a?b=c#d'), 'http://192.168.1.7/a');
  assert.equal(fsapiBase('fd00::7', undefined), 'http://[fd00::7]/fsapi');
  assert.equal(
    checkedBase('192.168.1.7', 'http://192.168.1.7:80/fsapi'),
    'http://192.168.1.7/fsapi',
  );
  assert.equal(checkedBase('192.168.1.7', 'http://192.168.1.8/fsapi'), 'http://192.168.1.7/fsapi');
});

test('configuration: the PIN, the addresses and the bounds', () => {
  assert.deepEqual(
    parseHosts('192.168.1.20, radio.lan:8080\n[fd00::20] 192.168.1.20 x/y ftp://a'),
    {
      hosts: [
        { host: '192.168.1.20', port: undefined },
        { host: 'radio.lan', port: 8080 },
        { host: 'fd00::20', port: undefined },
      ],
      invalid: [5, 6],
    },
  );
  const config = normalizeConfig({ pin: ' 4321 ', poll_interval: 2 });
  assert.equal(config.pin, '4321');
  assert.equal(config.pollInterval, 10);
  assert.equal(normalizeConfig({}).pin, '1234');
  assert.equal(normalizeConfig({ poll_interval: 'x' }).pollInterval, 30);
  assert.equal(normalizeConfig({ pin: 5555 }).pin, '5555');
});
