// -----------------------------------------------------------------------------
// Constants of the Frontier Silicon integration. The FSAPI names themselves
// (nodes, status codes) live in src/fsapi/nodes.js.
// -----------------------------------------------------------------------------

export const USER_AGENT =
  'gladys-frontier-silicon/0.1 (+https://github.com/LM1LC3N7/gladys-frontier-silicon)';

/** The PIN every radio ships with (Settings > Network > NetRemote PIN). */
export const DEFAULT_PIN = '1234';

/** A plain read: the radios answer in well under a second when awake. */
export const HTTP_TIMEOUT = 5_000;
/** Power, mode, navigation and preset changes can take a few seconds. */
export const SLOW_TIMEOUT = 10_000;
/** An FSAPI answer is a few KB; a description a few hundred bytes. */
export const MAX_BYTES = 256 * 1024;

/**
 * The radios are slow and single-threaded: one request at a time per radio,
 * and a pause after a write before the next request (the values of afsapi's
 * throttler, which Home Assistant uses).
 */
export const SPACING = { READ: 0, SET: 300, SLOW_SET: 1_000 };

export const PACING = {
  /** The scheduler looks at the radios this often; no request unless one is due. */
  TICK: 2_000,
  /** After a command, the radio is read this often... */
  FAST_INTERVAL: 5_000,
  /** ...for this long. */
  FAST_WINDOW: 60_000,
  /** The first read-back after a command. */
  SETTLE: 2_000,
  /** Consecutive failed readings before a radio is called offline. */
  OFFLINE_AFTER: 2,
  /** An offline radio (standby, unplugged) is tried once a minute. */
  OFFLINE_RETRY: 60_000,
  /** A radio refusing the PIN is retried every 10 minutes (or on a new PIN). */
  PIN_RETRY: 10 * 60_000,
  /** The list of modes (sources) of a radio, read again once a day. */
  MODES_TTL: 24 * 60 * 60_000,
  /** The presets of a mode, read again after an hour (on demand only). */
  PRESETS_TTL: 60 * 60_000,
  /** A scene action reuses a reading this recent instead of asking the radio. */
  FRESH: 10_000,
  /** The automatic discovery at (re)connection, at most once an hour. */
  DISCOVERY_TTL: 60 * 60_000,
};

/** Seconds the core listens for the SSDP answers. */
export const SCAN_TIMEOUT_SECONDS = 5;
/** The pages of a list (LIST_GET_NEXT), as afsapi asks them. */
export const LIST_PAGE = 50;
export const MAX_LIST_ITEMS = 200;
/** Manual addresses accepted in the configuration. */
export const MAX_HOSTS = 20;
/** Volume steps assumed when a radio does not say (0-32, the common scale). */
export const DEFAULT_VOLUME_STEPS = 33;

/** Manifest keys (forever: stored in user scenes and dashboards). */
export const ACTIONS = { TEST: 'test_connection', PRESETS: 'list_presets' };
export const SCENE_TRIGGERS = { NOW_PLAYING: 'now_playing_changed' };
export const SCENE_ACTIONS = {
  PLAY_PRESET: 'play_preset',
  SET_MODE: 'set_mode',
  NOW_PLAYING: 'get_now_playing',
};
export const WIDGETS = { RADIO: 'radio' };
/**
 * The action keys of the widget buttons; a content needs a distinct key per
 * button: `preset_<number>` for a preset button, `presets` for the form.
 */
export const WIDGET_ACTIONS = { PRESET: 'preset_', PRESET_FORM: 'presets' };

/** Values of the `change` field of now_playing_changed (forever). */
export const CHANGES = { STATION: 'station', TRACK: 'track' };

/**
 * Values of the `source` field of now_playing_changed (forever): the family
 * of the radio mode, whatever the id or the label the firmware gives it.
 */
export const SOURCES = [
  'internet_radio',
  'dab',
  'fm',
  'spotify',
  'bluetooth',
  'aux',
  'music_player',
  'streaming',
  'other',
];
