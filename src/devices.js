// -----------------------------------------------------------------------------
// The Gladys device of a radio and its states. Pure.
//
// External id (forever):  radio:<radio id>  - the radioId the radio reports
// (else its MAC address, else its address), lower case, letters and digits.
//
// The mapping follows the author's Denon/Marantz integration: power, volume
// and mute in the `television` category (rendered as controls in the device
// list), the source as a `text` / `select` dropdown, the transport buttons
// and the playback state in `music` (Gladys' music box needs the playback
// state to render its buttons).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
} from '@gladysassistant/integration-sdk';
import { DEFAULT_VOLUME_STEPS } from './constants.js';
import { checkedBase } from './fsapi/discovery.js';
import { nowPlayingLine } from './fsapi/model.js';

export const FEATURE = {
  POWER: 'power',
  VOLUME: 'volume',
  MUTE: 'mute',
  MODE: 'mode',
  PLAY: 'play',
  PAUSE: 'pause',
  PREVIOUS: 'previous',
  NEXT: 'next',
  PLAYBACK_STATE: 'playback_state',
  NOW_PLAYING: 'now_playing',
};

export const ids = {
  radio: (gladys, radioId) => gladys.externalId(`radio:${radioId}`),
  feature: (deviceId, key) => `${deviceId}:${key}`,
};

/** "30589075DA80", "00:22:61:0a:1b:2c" -> "30589075da80", "0022610a1b2c". */
export function radioIdOf(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 40);
}

/** { kind: 'radio', id } | undefined. */
export function parseExternalId(externalId) {
  const match = /:radio:([a-z0-9-]{1,48})$/.exec(String(externalId ?? ''));
  return match ? { kind: 'radio', id: match[1] } : undefined;
}

/** The feature key of a feature external id ("...:radio:abc:volume" -> "volume"). */
export const featureKey = (featureExternalId) => String(featureExternalId).split(':').at(-1);

const control = (id, key, name, category, type, extra = {}) => ({
  name,
  external_id: ids.feature(id, key),
  category,
  type,
  min: 0,
  max: 1,
  read_only: false,
  has_feedback: true,
  keep_history: false,
  ...extra,
});

/** The volume scale of a radio: 0 to steps - 1 (the steps count the 0). */
export const volumeMaxOf = (steps) =>
  Number.isInteger(steps) && steps > 1 && steps <= 101 ? steps - 1 : DEFAULT_VOLUME_STEPS - 1;

/**
 * A radio device. `radio` is what discovery read:
 *   { radioId, host, baseUrl, name, version, volumeSteps, modes }
 * The address lives in the params: the poll path reads the device Gladys
 * hands back, so a new address (DHCP) arrives with a new Discovery scan.
 */
export function buildRadioDevice(gladys, radio) {
  const id = ids.radio(gladys, radio.radioId);
  const volumeMax = volumeMaxOf(radio.volumeSteps);
  const options = (radio.modes ?? [])
    .filter((m) => m.selectable)
    .map((m) => ({ value: m.id, label: m.label }));
  return {
    name: radio.name,
    external_id: id,
    features: [
      control(id, FEATURE.POWER, 'Power', C.TELEVISION, T.TELEVISION.BINARY, {
        keep_history: true,
      }),
      control(id, FEATURE.VOLUME, 'Volume', C.TELEVISION, T.TELEVISION.VOLUME, {
        max: volumeMax,
        keep_history: true,
      }),
      control(id, FEATURE.MUTE, 'Mute', C.TELEVISION, T.TELEVISION.VOLUME_MUTE),
      control(id, FEATURE.MODE, 'Source', C.TEXT, T.TEXT.SELECT, {
        supported_options: options,
      }),
      control(id, FEATURE.PLAY, 'Play', C.MUSIC, T.MUSIC.PLAY, { has_feedback: false }),
      control(id, FEATURE.PAUSE, 'Pause', C.MUSIC, T.MUSIC.PAUSE, { has_feedback: false }),
      control(id, FEATURE.PREVIOUS, 'Previous', C.MUSIC, T.MUSIC.PREVIOUS, {
        has_feedback: false,
      }),
      control(id, FEATURE.NEXT, 'Next', C.MUSIC, T.MUSIC.NEXT, { has_feedback: false }),
      control(id, FEATURE.PLAYBACK_STATE, 'Playback state', C.MUSIC, T.MUSIC.PLAYBACK_STATE, {
        read_only: true,
        has_feedback: false,
      }),
      control(id, FEATURE.NOW_PLAYING, 'Now playing', C.TEXT, T.TEXT.TEXT, {
        max: 0,
        read_only: true,
        has_feedback: false,
      }),
    ],
    params: [
      { name: 'host', value: radio.host },
      { name: 'fsapi_url', value: radio.baseUrl },
      { name: 'radio_id', value: radio.radioId },
      { name: 'volume_max', value: String(volumeMax) },
      ...(radio.version ? [{ name: 'firmware', value: radio.version.slice(0, 100) }] : []),
    ],
  };
}

/** What the poll path needs, from the device Gladys hands back. */
export function radioOfDevice(device) {
  const params = Object.fromEntries((device.params ?? []).map((p) => [p.name, p.value]));
  const host = String(params.host ?? '').trim();
  const max = Number(params.volume_max);
  return {
    externalId: device.external_id,
    name: device.name || host,
    host,
    baseUrl: host ? checkedBase(host, params.fsapi_url) : undefined,
    volumeMax: Number.isInteger(max) && max > 0 ? max : DEFAULT_VOLUME_STEPS - 1,
  };
}

const number = (deviceId, key, value) =>
  value === null || value === undefined
    ? []
    : [{ device_feature_external_id: ids.feature(deviceId, key), state: value }];
const text = (deviceId, key, value) =>
  value === null || value === undefined
    ? []
    : [{ device_feature_external_id: ids.feature(deviceId, key), text: value }];

/** The states of a reading. A radio in standby only says it is off. */
export function radioStates(deviceId, reading, volumeMax) {
  if (!reading?.online || !reading.power) {
    return [
      ...number(deviceId, FEATURE.POWER, 0),
      ...number(deviceId, FEATURE.PLAYBACK_STATE, 0),
      ...text(deviceId, FEATURE.NOW_PLAYING, '—'),
    ];
  }
  const volume =
    reading.volume === null ? null : Math.max(0, Math.min(volumeMax, Math.round(reading.volume)));
  return [
    ...number(deviceId, FEATURE.POWER, 1),
    ...number(deviceId, FEATURE.VOLUME, volume),
    ...number(deviceId, FEATURE.MUTE, reading.mute === null ? null : reading.mute ? 1 : 0),
    ...text(deviceId, FEATURE.MODE, reading.mode?.id ?? null),
    ...number(deviceId, FEATURE.PLAYBACK_STATE, reading.playing ? 1 : 0),
    ...text(deviceId, FEATURE.NOW_PLAYING, nowPlayingLine(reading) || '—'),
  ];
}
