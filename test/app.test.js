// -----------------------------------------------------------------------------
// The integration against the SDK's fake Gladys and fake radios.
// -----------------------------------------------------------------------------

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { FrontierApp } from '../src/app.js';
import { ACTIONS, PACING, SCENE_ACTIONS, WIDGETS } from '../src/constants.js';
import { MODE_KEYS, createRadio, fixture, installRadios, radioState } from './helpers/fakeRadio.js';
import { createFakeTimers } from './helpers/fakeTimers.js';

const manifest = JSON.parse(
  readFileSync(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

let fake;
afterEach(() => fake?.restore());

const T0 = Date.parse('2026-10-14T08:00:00Z');
const RADIO = 'ext:fs:radio:0022610a1b2c';
const f = (key) => `${RADIO}:${key}`;

/** A radio device as Gladys hands it back once created. */
const created = (host = '192.168.1.183') => ({
  external_id: RADIO,
  name: 'Keukenradio',
  params: [
    { name: 'host', value: host },
    { name: 'fsapi_url', value: `http://${host}:80/fsapi` },
    { name: 'radio_id', value: '0022610a1b2c' },
    { name: 'volume_max', value: '32' },
  ],
});

async function setup({ config = {}, devices = [created()], radios, ssdp = [] } = {}) {
  const radio = createRadio();
  const all = radios ?? [radio];
  fake = installRadios(all);
  const gladys = createFakeGladys({ selector: 'fs', config, devices, scanResults: { ssdp } });
  const logs = [];
  const logger = Object.fromEntries(
    ['debug', 'info', 'warn', 'error'].map((level) => [
      level,
      (...args) => logs.push(`${level} ${args.join(' ')}`),
    ]),
  );
  const timers = createFakeTimers();
  const clock = { now: T0 };
  const app = new FrontierApp({
    gladys,
    logger,
    now: () => clock.now,
    timers,
    sleep: async () => {},
  });
  gladys.onScanRequest(() => app.publishDevices());
  gladys.onDeviceCreated((device) => app.deviceCreated(device));
  gladys.onSetValue((device, feature, value) => app.setValue(device, feature, value));
  gladys.onSceneAction(SCENE_ACTIONS.PLAY_PRESET, (fields) => app.playPreset(fields));
  gladys.onSceneAction(SCENE_ACTIONS.SET_MODE, (fields) => app.setMode(fields));
  gladys.onSceneAction(SCENE_ACTIONS.NOW_PLAYING, (fields) => app.getNowPlaying(fields));
  gladys.onWidgetGet(WIDGETS.RADIO, (request) => app.getWidget(WIDGETS.RADIO, request));
  gladys.onWidgetAction(WIDGETS.RADIO, (key, params, context) =>
    app.widgetAction(WIDGETS.RADIO, key, params, context),
  );
  gladys.onAction(ACTIONS.TEST, () => app.testConnection());
  gladys.onAction(ACTIONS.PRESETS, (fields) => app.listPresets(fields));
  await gladys.connect();
  /** Move the clock and run the scheduler tick. */
  const advance = async (ms) => {
    clock.now += ms;
    await timers.runIntervals();
  };
  return { app, gladys, radio, timers, clock, logs, advance };
}

const device = (gladys) => gladys.fake.devices.find((d) => d.external_id === RADIO);
const feature = (key) => ({ external_id: f(key) });

test('discovery: SSDP answers and typed addresses, read once each', async () => {
  const second = createRadio({
    host: '192.168.1.184',
    state: radioState({
      friendlyName: 'Bedroom',
      radioId: '',
      missing: ['netRemote.sys.info.radioId'],
    }),
  });
  second.describes = false; // no /device: the default /fsapi is tried
  const locked = createRadio({ host: '192.168.1.185', pin: '0000' });
  const { app, gladys } = await setup({
    devices: [],
    radios: [createRadio(), second, locked],
    config: { hosts: '192.168.1.184, 192.168.1.185, 192.168.1.199' },
    ssdp: [
      { source_ip: '192.168.1.183', source_port: 1900, headers: fixture('ssdp-answer.txt') },
      { source_ip: '192.168.1.9', headers: 'HTTP/1.1 200 OK\r\nST: upnp:rootdevice\r\n' },
    ],
  });
  await app.start({ hosts: '192.168.1.184, 192.168.1.185, 192.168.1.199' });
  assert.deepEqual(
    gladys.fake.scans.map((s) => s.type),
    ['ssdp'],
  );
  const devices = gladys.fake.discoveredDevices;
  assert.deepEqual(
    devices.map((d) => [d.name, d.external_id]),
    [
      ['Keukenradio', RADIO],
      ['Bedroom', 'ext:fs:radio:ip-192-168-1-184'],
    ],
  );
  const kitchen = devices[0];
  assert.deepEqual(Object.fromEntries(kitchen.params.map((p) => [p.name, p.value])), {
    host: '192.168.1.183',
    fsapi_url: 'http://192.168.1.183/fsapi',
    radio_id: '0022610a1b2c',
    volume_max: '32',
    firmware: 'ir-mmi-FS2026-0500-0515-Stream94i_V2.14.35c.EX86167-V1.04',
  });
  const byKey = Object.fromEntries(
    kitchen.features.map((x) => [x.external_id.split(':').at(-1), x]),
  );
  assert.equal(byKey.volume.max, 32);
  assert.deepEqual(
    byKey.mode.supported_options.map((o) => o.value),
    ['IR', 'Spotify', 'MP', 'DAB', 'FM', 'Bluetooth', 'AUXIN'],
  );
  assert.equal(byKey.mode.supported_options[0].label, 'Internetradio');
  // The LOCATION of the SSDP answer was read, on the radio itself.
  assert.ok(fake.calls.some((c) => c.host === '192.168.1.183' && c.path === '/dd.xml'));
  // The radio refusing the PIN is said in the status.
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /192\.168\.1\.185 refused the PIN/);
});

test('a created radio is read at start: states, no event, the pace of the polls', async () => {
  const { app, gladys, radio, advance } = await setup();
  await app.start({});
  assert.equal(gladys.fake.lastState(f('power')), 1);
  assert.equal(gladys.fake.lastState(f('volume')), 10);
  assert.equal(gladys.fake.lastState(f('mute')), 0);
  assert.equal(gladys.fake.lastState(f('mode')), 'DAB');
  assert.equal(gladys.fake.lastState(f('playback_state')), 1);
  assert.equal(gladys.fake.lastState(f('now_playing')), 'VRT Klara — Bach - Cello Suite No. 1');
  assert.equal(gladys.fake.sceneEvents.length, 0, 'the first reading fires nothing');
  assert.match(gladys.fake.connectionStatus.message.en, /1 radio answers/);
  const first = fake.fsapi().filter((c) => !c.includes('friendlyName'));
  assert.deepEqual(first.slice(0, 11), [
    'GET netRemote.sys.power',
    'GET netRemote.sys.audio.volume',
    'GET netRemote.sys.audio.mute',
    'GET netRemote.sys.mode',
    'GET netRemote.play.status',
    'GET netRemote.play.info.name',
    'GET netRemote.play.info.text',
    'GET netRemote.play.info.artist',
    'GET netRemote.play.info.album',
    'GET netRemote.play.info.graphicUri',
    'LIST_GET_NEXT netRemote.sys.caps.validModes',
  ]);
  fake.reset();
  await advance(10_000);
  assert.equal(fake.calls.length, 0, 'nothing before the 30 s');
  await advance(20_000);
  assert.equal(fake.fsapi().length, 10, 'one poll, the modes are kept');
  // In standby, a poll is one request.
  radio.state.power = 0;
  fake.reset();
  await advance(30_000);
  assert.deepEqual(fake.fsapi(), ['GET netRemote.sys.power']);
  assert.equal(gladys.fake.lastState(f('power')), 0);
  assert.equal(gladys.fake.lastState(f('now_playing')), '—');
  app.stop();
});

test('now playing changes fire one event each; a change made through Gladys none', async () => {
  const { app, gladys, radio, advance } = await setup();
  await app.start({});
  radio.state.text = 'Mozart - Requiem';
  await advance(30_000);
  await advance(30_000); // same reading: nothing more
  radio.state.name = 'VRT NWS';
  radio.state.text = 'Het nieuws';
  await advance(30_000);
  const events = gladys.fake.sceneEvents;
  assert.deepEqual(
    events.map((e) => [e.key, e.data.change, e.data.text]),
    [
      ['now_playing_changed', 'track', 'Mozart - Requiem'],
      ['now_playing_changed', 'station', 'Het nieuws'],
    ],
  );
  assert.equal(events[0].data.radio, RADIO);
  assert.equal(events[0].data.source, 'dab');
  assert.equal(events[0].data.radio_name, 'Keukenradio');
  // A preset played from a scene changes the station: no event, no loop.
  const played = await gladys.fake.sceneAction(SCENE_ACTIONS.PLAY_PRESET, {
    radio: RADIO,
    preset: 'StuBru',
  });
  assert.equal(played.success, true);
  await advance(PACING.SETTLE);
  assert.equal(radio.state.name, 'VRT StuBru');
  assert.equal(gladys.fake.lastState(f('now_playing')), 'VRT StuBru');
  assert.equal(gladys.fake.sceneEvents.length, 2);
  app.stop();
});

test('commands: power, volume, mute toggle, source, transport; then a fast read-back', async () => {
  const { app, gladys, radio, advance } = await setup();
  await app.start({});
  const d = device(gladys);
  fake.reset();
  assert.equal((await gladys.fake.setValue(d, feature('volume'), 45)).success, true);
  assert.equal(radio.state.volume, 32, 'clamped to the scale of the radio');
  assert.equal(gladys.fake.lastState(f('volume')), 32);
  await gladys.fake.setValue(d, feature('mute'), 1);
  assert.equal(radio.state.mute, 1);
  await gladys.fake.setValue(d, feature('mute'), 1);
  assert.equal(radio.state.mute, 0, 'VOLUME_MUTE is a button: each press toggles');
  await gladys.fake.setValue(d, feature('mode'), 'FM');
  assert.equal(radio.state.mode, MODE_KEYS.FM);
  assert.equal(gladys.fake.lastState(f('mode')), 'FM');
  radio.state.status = 6; // stopped: "play" restarts with 0
  await advance(PACING.SETTLE);
  await gladys.fake.setValue(d, feature('play'), 1);
  assert.ok(fake.fsapi().includes('SET netRemote.play.control=0'));
  await gladys.fake.setValue(d, feature('power'), 0);
  assert.equal(radio.state.power, 0);
  assert.equal(gladys.fake.lastState(f('power')), 0);
  const next = await gladys.fake.setValue(d, feature('next'), 1);
  assert.equal(next.success, false);
  assert.match(next.error, /Keukenradio refused the command \(FS_FAIL\)/);
  const readOnly = await gladys.fake.setValue(d, feature('now_playing'), 1);
  assert.match(readOnly.error, /read only/);
  // Read back after 2 s, every 5 s for a minute, then every 30 s again.
  fake.reset();
  await advance(PACING.SETTLE);
  assert.equal(fake.fsapi().length, 1, 'read back (in standby: the power only)');
  fake.reset();
  await advance(PACING.FAST_INTERVAL);
  assert.equal(fake.fsapi().length, 1);
  await advance(PACING.FAST_WINDOW);
  fake.reset();
  await advance(10_000);
  assert.equal(fake.fsapi().length, 0, 'back to the normal pace');
  await advance(20_000);
  assert.equal(fake.fsapi().length, 1);
  app.stop();
});

test('scene actions: play a preset in another source, change the source, now playing', async () => {
  const { app, gladys, radio } = await setup();
  radio.state.power = 0;
  await app.start({});
  const played = await gladys.fake.sceneAction(SCENE_ACTIONS.PLAY_PRESET, {
    radio: RADIO,
    preset: '2',
    mode: 'internet radio',
  });
  assert.deepEqual(played.data.outputs, { preset: 2, preset_name: 'FIP', mode: 'Internetradio' });
  assert.equal(radio.state.power, 1, 'turned on first');
  assert.equal(radio.state.mode, MODE_KEYS.IR);
  assert.equal(radio.state.name, 'FIP');
  const missing = await gladys.fake.sceneAction(SCENE_ACTIONS.PLAY_PRESET, {
    radio: RADIO,
    preset: '9',
  });
  assert.equal(missing.success, false);
  assert.match(missing.error, /No preset "9".*1\. France Inter, 2\. FIP/);
  const mode = await gladys.fake.sceneAction(SCENE_ACTIONS.SET_MODE, { radio: RADIO, mode: 'dab' });
  assert.deepEqual(mode.data.outputs, { mode: 'DAB', mode_id: 'DAB', source: 'dab' });
  const unknown = await gladys.fake.sceneAction(SCENE_ACTIONS.SET_MODE, {
    radio: RADIO,
    mode: 'cassette',
  });
  assert.match(unknown.error, /Unknown mode "cassette".*Internetradio, Spotify/);
  radio.state.name = 'VRT Klara';
  radio.state.artist = 'J.S. Bach';
  const now = await gladys.fake.sceneAction(SCENE_ACTIONS.NOW_PLAYING, { radio: RADIO });
  const outputs = now.data.outputs;
  assert.deepEqual(
    Object.keys(outputs).sort(),
    manifest.scene_actions
      .find((a) => a.key === SCENE_ACTIONS.NOW_PLAYING)
      .outputs.map((o) => o.key)
      .sort(),
  );
  assert.equal(outputs.power, true);
  assert.equal(outputs.mode, 'DAB');
  assert.equal(outputs.name, 'VRT Klara');
  assert.equal(outputs.summary, 'VRT Klara — J.S. Bach');
  const wrong = await gladys.fake.sceneAction(SCENE_ACTIONS.NOW_PLAYING, { radio: 'ext:fs:x' });
  assert.equal(wrong.success, false);
  app.stop();
});

test('widget: now playing and preset buttons; a tap plays the preset', async () => {
  const { app, gladys, radio } = await setup();
  await app.start({});
  const content = (
    await gladys.fake.widgetGet(WIDGETS.RADIO, {
      settings: { radio: RADIO },
      language: 'en',
    })
  ).data.content;
  const buttons = content.components.filter((c) => c.type === 'button');
  assert.deepEqual(
    buttons.map((b) => b.label),
    [{ en: 'Standby', fr: 'Veille' }, '1. VRT Klara', '2. VRT NWS', '3. VRT StuBru'],
  );
  const tap = await gladys.fake.widgetAction(WIDGETS.RADIO, 'preset_3', buttons[3].action.params, {
    settings: { radio: RADIO },
  });
  assert.equal(tap.success, true);
  assert.equal(radio.state.name, 'VRT StuBru');
  const none = (await gladys.fake.widgetGet(WIDGETS.RADIO, { settings: {} })).data.content;
  assert.match(none.components[0].text.en, /Pick a radio/);
  // The presets are read once, then cached.
  const lists = fake.fsapi().filter((c) => c === 'LIST_GET_NEXT netRemote.nav.presets').length;
  await gladys.fake.widgetGet(WIDGETS.RADIO, { settings: { radio: RADIO }, language: 'fr' });
  assert.equal(
    fake.fsapi().filter((c) => c === 'LIST_GET_NEXT netRemote.nav.presets').length,
    lists,
  );
  app.stop();
});

test('a radio leaving the network: offline calmly, read once a minute, back again', async () => {
  const { app, gladys, radio, advance, logs } = await setup();
  await app.start({});
  radio.offline = true;
  await advance(30_000);
  assert.equal(gladys.fake.lastState(f('power')), 1, 'one failure is not offline yet');
  await advance(30_000);
  assert.equal(gladys.fake.lastState(f('power')), 0, 'offline reads as off');
  assert.match(gladys.fake.connectionStatus.message.en, /0 of 1 radios answer/);
  assert.equal(gladys.fake.connectionStatus.connected, true, 'not an error');
  fake.reset();
  for (let i = 0; i < 10; i += 1) {
    await advance(6_000);
  }
  assert.equal(fake.calls.length, 1, 'once a minute');
  assert.equal(logs.filter((l) => l.startsWith('warn') || l.startsWith('error')).length, 0);
  assert.equal(logs.filter((l) => /is offline/.test(l)).length, 1);
  const widget = (
    await gladys.fake.widgetGet(WIDGETS.RADIO, {
      settings: { radio: RADIO },
      language: 'en',
    })
  ).data.content;
  assert.match(widget.components[2].text.en, /Offline/);
  radio.offline = false;
  await advance(PACING.OFFLINE_RETRY);
  assert.equal(gladys.fake.lastState(f('power')), 1);
  assert.match(gladys.fake.connectionStatus.message.en, /1 radio answers/);
  assert.equal(gladys.fake.sceneEvents.length, 1, 'playing again after being away');
  app.stop();
});

test('a wrong PIN: status in red, slow retries, and the PIN never shows', async () => {
  const radio = createRadio({ pin: '2468' });
  const { app, gladys, advance, logs } = await setup({ radios: [radio] });
  await app.start({ pin: '1357' });
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.fr, /Keukenradio refuse le code PIN/);
  fake.reset();
  await advance(5 * 60_000);
  assert.equal(fake.calls.length, 0, 'not retried before 10 minutes');
  const test = await gladys.fake.action(ACTIONS.TEST);
  assert.match(test.data.message.en, /Keukenradio \(192\.168\.1\.183\): PIN refused/);
  const action = await gladys.fake.sceneAction(SCENE_ACTIONS.SET_MODE, {
    radio: RADIO,
    mode: 'FM',
  });
  assert.match(action.error, /refused the PIN/);
  const everything = JSON.stringify([
    logs,
    gladys.fake.connectionStatuses,
    gladys.fake.states,
    test,
    action,
  ]);
  assert.ok(!everything.includes('1357') && !everything.includes('2468'));
  // The right PIN in the configuration: read at once.
  await app.start({ pin: '2468' });
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(gladys.fake.lastState(f('power')), 1);
  app.stop();
});

test('buttons: test the radios, list the presets', async () => {
  const other = createRadio({
    host: '192.168.1.190',
    state: radioState({ friendlyName: 'Salon' }),
  });
  const { app, gladys } = await setup({ radios: [createRadio(), other] });
  await app.start({ hosts: '192.168.1.190, 192.168.1.250' });
  const test = (await gladys.fake.action(ACTIONS.TEST)).data.message;
  assert.match(test.en, /Keukenradio \(192\.168\.1\.183\): on, DAB, volume 10\./);
  assert.match(test.en, /192\.168\.1\.190: Salon answers; add it from Discovery\./);
  assert.match(test.fr, /192\.168\.1\.250 : aucune radio \(.*ECONNREFUSED/);
  const presets = (await gladys.fake.action(ACTIONS.PRESETS, { radio: RADIO })).data.message;
  assert.equal(presets.en, 'Keukenradio, DAB:\n1. VRT Klara\n2. VRT NWS\n3. VRT StuBru');
  app.stop();
});
