// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { BOUNDS, DEFAULTS } from '../src/config.js';
import {
  ACTIONS,
  CHANGES,
  SCENE_ACTIONS,
  SCENE_TRIGGERS,
  SOURCES,
  WIDGETS,
} from '../src/constants.js';
import { FEATURE, buildRadioDevice } from '../src/devices.js';
import { SSDP_TARGETS } from '../src/fsapi/nodes.js';
import { nowPlayingEvent } from '../src/triggers.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const index = read('index.js');

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, item] of node.entries()) {
      yield* texts(item, `${path}[${i}]`);
    }
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      yield* texts(value, `${path}.${key}`);
    }
  }
}

test('the store basics', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.match(manifest.gladys_version, />=5\.1\.0/);
  assert.equal(
    manifest.docker_image,
    `ghcr.io/lm1lc3n7/gladys-frontier-silicon:${manifest.version}`,
  );
  assert.equal(manifest.version, JSON.parse(read('package.json')).version);
  assert.deepEqual(manifest.transports, ['local']);
  assert.equal(manifest.location, undefined, 'no house location needed');
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    assert.ok(read(`docs/${lang}.md`).length >= 300, `docs/${lang}.md is too short for the store`);
  }
  assert.match(manifest.description.en, /Unofficial/);
  assert.match(manifest.description.fr, /non officiel/);
  assert.match(manifest.config_schema[0].description.en, /not affiliated with Frontier/);
});

test('every text is bilingual', () => {
  for (const [path, text] of texts(manifest)) {
    assert.ok(text.en?.trim() && text.fr?.trim(), `${path} needs en and fr`);
  }
});

test('discovery asks the core for the SSDP targets of the radios', () => {
  assert.deepEqual(
    manifest.network_discovery,
    SSDP_TARGETS.map((st) => ({ type: 'ssdp', st })),
  );
  assert.ok(index.includes('onScanRequest('));
});

test('the configuration matches the code', () => {
  const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));
  for (const [key, value] of Object.entries(DEFAULTS)) {
    assert.equal(fields[key].default, value, key);
  }
  assert.equal(fields.poll_interval.min, BOUNDS.poll_interval.min);
  assert.equal(fields.poll_interval.max, BOUNDS.poll_interval.max);
  assert.equal(fields.pin.type, 'secret');
  assert.equal(fields.pin.default, undefined, 'a secret takes no default (1234 in the code)');
});

test('the keys of the manifest are the keys of the code', () => {
  assert.deepEqual(manifest.actions.map((a) => a.key).sort(), Object.values(ACTIONS).sort());
  assert.deepEqual(
    manifest.scene_actions.map((a) => a.key).sort(),
    Object.values(SCENE_ACTIONS).sort(),
  );
  assert.deepEqual(
    manifest.scene_triggers.map((t) => t.key).sort(),
    Object.values(SCENE_TRIGGERS).sort(),
  );
  assert.deepEqual(manifest.widgets.map((w) => w.key).sort(), Object.values(WIDGETS).sort());
  for (const name of Object.keys(SCENE_ACTIONS)) {
    assert.ok(index.includes(`onSceneAction(SCENE_ACTIONS.${name}`), name);
  }
  for (const name of Object.keys(ACTIONS)) {
    assert.ok(index.includes(`onAction(ACTIONS.${name}`), name);
  }
  const trigger = manifest.scene_triggers[0];
  const options = (key) => trigger.fields.find((f) => f.key === key).options.map((o) => o.value);
  assert.deepEqual(options('source'), SOURCES);
  assert.deepEqual(options('change'), Object.values(CHANGES));
  // Every field and variable of the trigger is a key of the event.
  const event = nowPlayingEvent('ext:fs:radio:x', 'Radio', { name: 'x' }, 'track');
  for (const key of [...trigger.fields, ...trigger.variables].map((v) => v.key)) {
    assert.ok(key in event.data, `${key} is not in the event`);
  }
});

test('the device: the feature keys and Gladys categories', async () => {
  const gladys = createFakeGladys({ selector: 'fs' });
  const device = buildRadioDevice(gladys, {
    radioId: 'abc',
    host: '192.168.1.2',
    baseUrl: 'http://192.168.1.2/fsapi',
    name: 'Radio',
    volumeSteps: 21,
    modes: [
      { key: 0, id: 'IR', label: 'Internet radio', selectable: true, source: 'internet_radio' },
    ],
  });
  assert.deepEqual(
    device.features.map((f) => f.external_id.split(':').at(-1)),
    Object.values(FEATURE),
  );
  assert.equal(device.features.find((f) => f.external_id.endsWith(':volume')).max, 20);
  // The fake host API validates categories, types and ids like Gladys.
  await gladys.publishDiscoveredDevices([device]);
  assert.equal(gladys.fake.discoveredDevices.length, 1);
});
