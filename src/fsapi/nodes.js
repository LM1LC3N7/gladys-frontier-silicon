// -----------------------------------------------------------------------------
// The FSAPI vocabulary: every node path, status code and enum value of the
// Frontier Silicon API lives here, so a field reported wrong by a tester is
// fixed in one place. Source: the afsapi library (1.0.2, the one Home
// Assistant uses) and its recordings of a real radio.
// -----------------------------------------------------------------------------

export const NODES = {
  POWER: 'netRemote.sys.power',
  MODE: 'netRemote.sys.mode',
  VALID_MODES: 'netRemote.sys.caps.validModes',
  VOLUME: 'netRemote.sys.audio.volume',
  VOLUME_STEPS: 'netRemote.sys.caps.volumeSteps',
  MUTE: 'netRemote.sys.audio.mute',
  FRIENDLY_NAME: 'netRemote.sys.info.friendlyName',
  RADIO_ID: 'netRemote.sys.info.radioId',
  VERSION: 'netRemote.sys.info.version',
  WLAN_MAC: 'netRemote.sys.net.wlan.macAddress',
  WIRED_MAC: 'netRemote.sys.net.wired.macAddress',
  PLAY_STATUS: 'netRemote.play.status',
  PLAY_CONTROL: 'netRemote.play.control',
  INFO_NAME: 'netRemote.play.info.name',
  INFO_TEXT: 'netRemote.play.info.text',
  INFO_ARTIST: 'netRemote.play.info.artist',
  INFO_ALBUM: 'netRemote.play.info.album',
  INFO_GRAPHIC: 'netRemote.play.info.graphicUri',
  NAV_STATE: 'netRemote.nav.state',
  PRESETS: 'netRemote.nav.presets',
  SELECT_PRESET: 'netRemote.nav.action.selectPreset',
};

/** The "now playing" nodes read on every poll of a radio that is on. */
export const NOW_NODES = {
  volume: NODES.VOLUME,
  mute: NODES.MUTE,
  modeKey: NODES.MODE,
  status: NODES.PLAY_STATUS,
  name: NODES.INFO_NAME,
  text: NODES.INFO_TEXT,
  artist: NODES.INFO_ARTIST,
  album: NODES.INFO_ALBUM,
  graphic: NODES.INFO_GRAPHIC,
};

/** The `<status>` of an answer. */
export const STATUS = {
  OK: 'FS_OK',
  LIST_END: 'FS_LIST_END',
  FAIL: 'FS_FAIL',
  PACKET_BAD: 'FS_PACKET_BAD',
  NODE_BLOCKED: 'FS_NODE_BLOCKED',
  NODE_DOES_NOT_EXIST: 'FS_NODE_DOES_NOT_EXIST',
  TIMEOUT: 'FS_TIMEOUT',
};

/** netRemote.play.status */
export const PLAY_STATUS = {
  IDLE: 0,
  BUFFERING: 1,
  PLAYING: 2,
  PAUSED: 3,
  REBUFFERING: 4,
  ERROR: 5,
  STOPPED: 6,
  ERROR_POPUP: 7,
};

/** netRemote.play.control: 0 stops (and restarts a stopped stream). */
export const PLAY_CONTROL = { STOP: 0, PLAY: 1, PAUSE: 2, NEXT: 3, PREVIOUS: 4 };

/**
 * Mode ids seen in the field -> the family exposed to the scenes. The ids
 * differ between firmwares (Bluetooth is "SMTDEV" on some), hence the label
 * fallback in sourceOf() (src/fsapi/model.js).
 */
export const MODE_FAMILIES = {
  IR: 'internet_radio',
  DAB: 'dab',
  FM: 'fm',
  SPOTIFY: 'spotify',
  BLUETOOTH: 'bluetooth',
  SMTDEV: 'bluetooth',
  BT: 'bluetooth',
  AUXIN: 'aux',
  AUX: 'aux',
  MP: 'music_player',
  DMR: 'music_player',
  USB: 'music_player',
  CD: 'music_player',
};

/** The SSDP search targets the Frontier Silicon radios answer. */
export const SSDP_TARGETS = [
  'urn:schemas-frontier-silicon-com:undok:fsapi:1',
  'urn:schemas-frontier-silicon-com:fs_reference:fsapi:1',
];

/** Paths tried on a radio when the description gives no FSAPI address. */
export const DEVICE_PATH = '/device';
export const DEFAULT_FSAPI_PATH = '/fsapi';
