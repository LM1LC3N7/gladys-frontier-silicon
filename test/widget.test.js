// -----------------------------------------------------------------------------
// The "radio" widget: every content passes the SDK's validator untouched
// (budget, vocabulary, button forms).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { radioWidget } from '../src/widget.js';

const ID = 'ext:fs:radio:0022610a1b2c';
const DAB = { key: 4, id: 'DAB', label: 'DAB', selectable: true, source: 'dab' };
const reading = {
  online: true,
  power: true,
  volume: 10,
  mute: false,
  mode: DAB,
  status: 2,
  playing: true,
  name: 'VRT Klara',
  text: 'Bach - Cello Suite No. 1',
  artist: '',
  album: '',
  graphic: '',
};
const presets = (n) =>
  Array.from({ length: n }, (_, i) => ({ key: i, number: i + 1, name: `Station ${i + 1}` }));

const build = (state, language = 'fr') =>
  radioWidget({ deviceId: ID, name: 'Keukenradio', state, language });

test('playing: now playing, volume tile, status, power and one button per preset', () => {
  const content = build({ reading, presets: { modeId: 'DAB', list: presets(3) } });
  assert.deepEqual(validateWidgetContent(content), []);
  const types = content.components.map((c) => c.type);
  assert.deepEqual(types, [
    'text',
    'value',
    'text',
    'status',
    'button',
    'button',
    'button',
    'button',
  ]);
  assert.equal(content.components[1].device_feature, `${ID}:volume`);
  assert.equal(content.components[2].text, 'VRT Klara\nBach - Cello Suite No. 1');
  const status = content.components[3].items.map((i) => i.value);
  assert.deepEqual(status, ['Allumée', 'DAB', 'Lecture']);
  const power = content.components[4];
  assert.deepEqual([power.device_feature, power.value], [`${ID}:power`, 0]);
  assert.deepEqual(content.components[5].action, {
    key: 'preset_1',
    params: { preset: 1, mode: 'DAB' },
  });
});

test('many presets: the first two, then a form listing them all', () => {
  const content = build({ reading, presets: { modeId: 'DAB', list: presets(12) } }, 'en');
  assert.deepEqual(validateWidgetContent(content), []);
  const buttons = content.components.filter((c) => c.type === 'button');
  assert.equal(buttons.length, 4);
  const form = buttons[3].action;
  assert.equal(form.key, 'presets');
  assert.deepEqual(form.params, { mode: 'DAB' });
  assert.equal(form.fields[0].options.length, 12);
  assert.deepEqual(form.fields[0].options[11], {
    value: '12',
    label: { en: '12. Station 12', fr: '12. Station 12' },
  });
});

test('standby, offline, PIN refused and not read yet', () => {
  const standby = build({ reading: { online: true, power: false, playing: false } }, 'en');
  assert.deepEqual(validateWidgetContent(standby), []);
  assert.equal(standby.components[2].text.en, 'Standby');
  assert.equal(standby.components.at(-1).value, 1, 'a "Turn on" button');
  const offline = build({ reading: undefined, offline: true });
  assert.deepEqual(validateWidgetContent(offline), []);
  assert.equal(offline.components[3].items[0].color, 'danger');
  const pin = build({ reading: undefined, pinRefused: true });
  assert.deepEqual(validateWidgetContent(pin), []);
  assert.ok(!pin.components.some((c) => c.type === 'button'));
  const waiting = build(undefined);
  assert.deepEqual(validateWidgetContent(waiting), []);
  assert.equal(waiting.components.length, 2);
});
