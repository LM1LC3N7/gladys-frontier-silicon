// -----------------------------------------------------------------------------
// The "radio" dashboard widget. Pure: built from the last reading; the
// volume tile is bound to the device feature and follows the states live.
//
// Budget (8 components, 4 buttons): heading, volume tile, now playing text,
// status rows, then the power button and the presets - one button each when
// there are three or fewer, else the first two and a "Presets…" form with
// all of them.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { WIDGET_ACTIONS } from './constants.js';
import { FEATURE, ids } from './devices.js';
import { T } from './i18n.js';

const pick = (text, language) => (typeof text === 'string' ? text : (text[language] ?? text.en));
const both = (text) => ({ en: text, fr: text });

function nowPlayingText(reading, language) {
  const lines = [reading.name, reading.text];
  const extra = [reading.artist, reading.album].filter(Boolean).join(' · ');
  // On internet radio the artist is often already in the text ("Artist - Title").
  if (extra && !(reading.artist && reading.text.includes(reading.artist))) {
    lines.push(extra);
  }
  const text = lines.filter(Boolean).join('\n');
  return text ? text.slice(0, 300) : pick(T.widget.nothing, language);
}

function presetButtons(presets, modeId) {
  if (!presets?.length) {
    return [];
  }
  const button = (preset) => ({
    type: 'button',
    label: `${preset.number}. ${preset.name}`.slice(0, 24),
    icon: 'radio',
    style: 'secondary',
    action: {
      key: `${WIDGET_ACTIONS.PRESET}${preset.number}`,
      params: { preset: preset.number, mode: modeId },
    },
  });
  if (presets.length <= 3) {
    return presets.map(button);
  }
  return [
    ...presets.slice(0, 2).map(button),
    {
      type: 'button',
      label: T.widget.presets,
      icon: 'list',
      style: 'secondary',
      action: {
        key: WIDGET_ACTIONS.PRESET_FORM,
        params: { mode: modeId },
        fields: [
          {
            key: 'preset',
            type: 'select',
            required: true,
            label: T.widget.preset,
            options: presets.map((p) => ({
              value: String(p.number),
              label: both(`${p.number}. ${p.name}`.slice(0, 60)),
            })),
          },
        ],
      },
    },
  ];
}

/**
 * `state`: { reading, offline, pinRefused, presets: { modeId, list } }.
 */
export function radioWidget({ deviceId, name, state, language = 'en' }) {
  const components = [{ type: 'text', text: String(name).slice(0, 40), variant: 'heading' }];
  const reading = state?.reading;
  if (!reading && !state?.offline && !state?.pinRefused) {
    components.push({ type: 'text', text: T.widget.notLoaded, variant: 'body' });
    return { ttl_seconds: 15, components };
  }
  components.push({
    type: 'value',
    label: T.widget.volume,
    device_feature: ids.feature(deviceId, FEATURE.VOLUME),
    icon: 'volume-2',
  });
  const on = !state.offline && !state.pinRefused && reading?.power;
  let body;
  if (state.pinRefused) {
    body = T.widget.pinRefused;
  } else if (state.offline) {
    body = T.widget.offline;
  } else if (!on) {
    body = T.widget.standby;
  } else {
    body = nowPlayingText(reading, language);
  }
  components.push({ type: 'text', text: body, variant: 'body' });

  const items = [];
  if (state.offline || state.pinRefused) {
    items.push({
      label: T.widget.power,
      value: pick(T.widget.unreachable, language),
      icon: 'wifi-off',
      color: WIDGET_COLORS.DANGER,
    });
  } else {
    items.push({
      label: T.widget.power,
      value: pick(on ? T.widget.on : T.widget.off, language),
      icon: 'power',
      color: on ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
    });
  }
  if (on && reading.mode) {
    items.push({ label: T.widget.source, value: reading.mode.label.slice(0, 40), icon: 'radio' });
  }
  if (on && reading.status !== null && T.widget.status[reading.status]) {
    items.push({
      label: T.widget.playback,
      value: pick(T.widget.status[reading.status], language),
      icon: reading.playing ? 'play' : 'pause',
      color: reading.playing ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
    });
  }
  components.push({ type: 'status', items });

  if (!state.pinRefused) {
    components.push({
      type: 'button',
      label: on ? T.widget.turnOff : T.widget.turnOn,
      icon: 'power',
      style: on ? 'secondary' : 'primary',
      device_feature: ids.feature(deviceId, FEATURE.POWER),
      value: on ? 0 : 1,
    });
    components.push(...presetButtons(state.presets?.list, state.presets?.modeId));
  }
  return { ttl_seconds: on ? 30 : 60, components };
}
