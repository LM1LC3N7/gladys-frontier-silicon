// -----------------------------------------------------------------------------
// The integration itself: discovery (SSDP through the core + typed
// addresses), the paced reading of every radio the user created, the
// commands, the scene trigger and actions, the widget and the buttons.
// index.js only wires the SDK handlers to it.
//
// Pace (see CLAUDE.md): a 2 s scheduler tick that sends nothing unless a
// radio is due; each radio read every `poll_interval` seconds (30 by
// default, never below 10), every 5 s for a minute after a command, once a
// minute while it is offline. One request at a time per radio (FsapiClient).
// The presets are read on demand only (widget, scene action, button).
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { PACING, SCAN_TIMEOUT_SECONDS, WIDGET_ACTIONS, WIDGETS } from './constants.js';
import {
  FEATURE,
  buildRadioDevice,
  featureKey,
  ids,
  parseExternalId,
  radioIdOf,
  radioOfDevice,
  radioStates,
} from './devices.js';
import { FsapiClient, FsapiError, createQueue } from './fsapi/client.js';
import { fsapiBase, ssdpRadio, urlHost } from './fsapi/discovery.js';
import {
  findMode,
  findPreset,
  modesOf,
  nowPlayingLine,
  presetsOf,
  readingOf,
} from './fsapi/model.js';
import { DEVICE_PATH, NODES, PLAY_CONTROL, PLAY_STATUS } from './fsapi/nodes.js';
import { T } from './i18n.js';
import { nowPlayingEvent, nowPlayingTransition } from './triggers.js';
import { radioWidget } from './widget.js';

const defaultTimers = { setTimeout, clearTimeout, setInterval, clearInterval };

export class FrontierApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'frontier-silicon' }),
    now = Date.now,
    timers = defaultTimers,
    sleep,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.timers = timers;
    this.sleep = sleep ?? ((ms) => new Promise((resolve) => this.timers.setTimeout(resolve, ms)));
    this.config = normalizeConfig();
    /** external id -> the runtime state of a radio (see stateOf) */
    this.radios = new Map();
    /** host -> the request queue of that radio, shared by all its clients */
    this.queues = new Map();
    this.tickTimer = undefined;
    this.ticking = undefined;
    this.lastStatus = undefined;
    this.generation = 0;
    this.discoveredAt = 0;
    this.discoveryKey = undefined;
    /** Addresses of the radios that refused the PIN during the last discovery. */
    this.discoveryRefused = [];
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(raw = {}) {
    this.stop();
    const generation = ++this.generation;
    this.config = normalizeConfig(raw);
    // A new PIN or address list: new clients, and the triggers re-arm.
    this.radios.clear();
    if (this.config.invalidHosts.length > 0) {
      this.logger.warn(`Ignored addresses at position ${this.config.invalidHosts.join(', ')}`);
    }
    this.tickTimer = this.timers.setInterval(
      () => this.tick().catch((err) => this.logger.warn(`Tick failed: ${err.message}`)),
      PACING.TICK,
    );
    await this.tick();
    const key = JSON.stringify([this.config.pin, this.config.hosts]);
    const stale = this.now() - this.discoveredAt >= PACING.DISCOVERY_TTL;
    if (generation === this.generation && (stale || key !== this.discoveryKey)) {
      await this.publishDevices().catch((err) =>
        this.logger.warn(`Discovery failed: ${err.message}`),
      );
    }
  }

  stop() {
    this.generation += 1;
    this.timers.clearInterval(this.tickTimer);
    this.tickTimer = undefined;
    // A tick of the previous run must not hold back the first one of the next.
    this.ticking = undefined;
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  async updateStatus(devices = this.createdRadios()) {
    if (devices.length === 0 && this.discoveryRefused.length === 0) {
      await this.setStatus(true, T.noRadio);
      return;
    }
    const refused = devices.filter((d) => this.stateOf(d).pinRefused).map((d) => d.name);
    const hosts = new Set(devices.map((d) => radioOfDevice(d).host));
    refused.push(...this.discoveryRefused.filter((host) => !hosts.has(host)));
    if (refused.length > 0) {
      await this.setStatus(false, T.pinRefused(refused));
    } else if (this.config.invalidHosts.length > 0) {
      await this.setStatus(true, T.invalidHosts(this.config.invalidHosts));
    } else {
      const online = devices.filter((d) => !this.stateOf(d).offline).length;
      await this.setStatus(
        true,
        devices.length ? T.ok({ total: devices.length, online }) : T.noRadio,
      );
    }
  }

  refreshWidget() {
    try {
      this.gladys.requestWidgetRefresh(WIDGETS.RADIO);
    } catch (err) {
      this.logger.debug?.(`Widget refresh failed: ${err.message}`);
    }
  }

  // --- Radios ----------------------------------------------------------------------

  /** The radio devices the user created. */
  createdRadios() {
    return (this.gladys.devices ?? []).filter((d) => parseExternalId(d.external_id));
  }

  stateOf(device) {
    let state = this.radios.get(device.external_id);
    if (!state) {
      state = {
        nextAt: 0,
        failures: 0,
        offline: false,
        pinRefused: false,
        fastUntil: 0,
        quietUntil: 0,
        reading: undefined,
        memory: undefined,
        modes: undefined,
        modesAt: 0,
        presets: new Map(),
        client: undefined,
        clientKey: undefined,
        inflight: undefined,
        /** The presets the widget showed last: { modeId, list } */
        shownPresets: undefined,
        /** Commands sent, and the count the last reading started after. */
        commands: 0,
        readAfter: 0,
      };
      this.radios.set(device.external_id, state);
    }
    return state;
  }

  /** A client for a radio, on the request queue of its host. */
  newClient(baseUrl, host) {
    if (!this.queues.has(host)) {
      this.queues.set(host, createQueue());
    }
    return new FsapiClient({
      baseUrl,
      pin: this.config.pin,
      sleep: this.sleep,
      now: this.now,
      queue: this.queues.get(host),
    });
  }

  /** The client of a radio, kept while its address stays. */
  clientOf(state, radio) {
    if (state.clientKey !== radio.baseUrl) {
      state.client = this.newClient(radio.baseUrl, radio.host);
      state.clientKey = radio.baseUrl;
    }
    return state.client;
  }

  /** A created radio by external id -> { device, radio, state, client }. */
  target(externalId) {
    const device = this.createdRadios().find((d) => d.external_id === externalId);
    if (!device) {
      throw new Error(T.errors.unknownRadio);
    }
    const radio = radioOfDevice(device);
    if (!radio.baseUrl) {
      throw new Error(T.errors.unknownRadio);
    }
    const state = this.stateOf(device);
    return { device, radio, state, client: this.clientOf(state, radio) };
  }

  // --- Reading ---------------------------------------------------------------------

  tick() {
    if (!this.ticking) {
      const run = this.doTick().finally(() => {
        if (this.ticking === run) {
          this.ticking = undefined;
        }
      });
      this.ticking = run;
    }
    return this.ticking;
  }

  async doTick() {
    const now = this.now();
    const devices = this.createdRadios();
    const due = devices.filter((d) => this.stateOf(d).nextAt <= now);
    await Promise.all(due.map((d) => this.readRadio(d)));
    await this.updateStatus(devices);
  }

  /** Read one radio now (single-flight per radio). Never throws. */
  readRadio(device) {
    const state = this.stateOf(device);
    if (!state.inflight) {
      state.inflight = this.doRead(device, state).finally(() => {
        state.inflight = undefined;
      });
    }
    return state.inflight;
  }

  async doRead(device, state) {
    const generation = this.generation;
    const radio = radioOfDevice(device);
    if (!radio.baseUrl) {
      state.nextAt = this.now() + this.config.pollInterval * 1000;
      return;
    }
    const client = this.clientOf(state, radio);
    const commands = state.commands;
    try {
      const raw = await client.readState();
      if (raw.power === 1) {
        await this.ensureModes(state, client, raw.modeKey);
      }
      if (generation !== this.generation) {
        return;
      }
      if (state.offline || state.pinRefused) {
        this.logger.info(`${radio.name} answers again`);
      }
      state.failures = 0;
      state.offline = false;
      state.pinRefused = false;
      state.readAfter = commands;
      await this.applyReading(radio, state, readingOf(raw, state.modes ?? [], this.now()));
    } catch (err) {
      if (generation !== this.generation) {
        return;
      }
      await this.readFailed(radio, state, err);
    }
    state.nextAt = this.now() + this.delayOf(state);
  }

  delayOf(state) {
    if (state.pinRefused) {
      return PACING.PIN_RETRY;
    }
    if (state.offline) {
      return PACING.OFFLINE_RETRY;
    }
    return this.now() < state.fastUntil ? PACING.FAST_INTERVAL : this.config.pollInterval * 1000;
  }

  /** The modes of a radio: read once a day, or when an unknown mode shows up. */
  async ensureModes(state, client, modeKey) {
    const now = this.now();
    const unknown =
      Number.isInteger(modeKey) && !(state.modes ?? []).some((m) => m.key === modeKey);
    const stale = !state.modes || now - state.modesAt >= PACING.MODES_TTL;
    // An unknown key is re-read at most once a minute, not at every poll.
    if (!stale && !(unknown && now - state.modesAt >= 60_000)) {
      return state.modes;
    }
    try {
      state.modes = modesOf(await client.list(NODES.VALID_MODES));
    } catch (err) {
      if (err instanceof FsapiError && (err.unreachable || err.code === 'pin')) {
        throw err;
      }
      this.logger.debug?.(`Modes unavailable: ${err.message}`);
      state.modes ??= [];
    }
    state.modesAt = now;
    return state.modes;
  }

  async applyReading(radio, state, reading) {
    const previous = state.reading;
    state.reading = reading;
    await this.gladys
      .publishChangedStates(radioStates(radio.externalId, reading, radio.volumeMax), {
        heartbeat: 30 * 60_000,
      })
      .catch((err) => this.logger.warn(`States of ${radio.name} failed: ${err.message}`));
    const { memory, change } = nowPlayingTransition(state.memory, reading, {
      quiet: this.now() < state.quietUntil,
    });
    state.memory = memory;
    if (change) {
      const event = nowPlayingEvent(radio.externalId, radio.name, reading, change);
      await this.gladys
        .publishSceneEvent(event.key, event.data)
        .catch((err) => this.logger.warn(`Scene event ${event.key} failed: ${err.message}`));
    }
    if (shown(previous) !== shown(reading)) {
      this.refreshWidget();
    }
  }

  async readFailed(radio, state, err) {
    if (err instanceof FsapiError && err.code === 'pin') {
      if (!state.pinRefused) {
        this.logger.warn(`${radio.name} refused the PIN`);
      }
      state.pinRefused = true;
      this.refreshWidget();
      return;
    }
    state.failures += 1;
    if (state.offline) {
      return; // calm: already reported
    }
    if (state.failures < PACING.OFFLINE_AFTER) {
      this.logger.debug?.(`${radio.name}: reading failed (${err.message})`);
      return;
    }
    // Some models leave the network in standby: an offline radio reads as off.
    this.logger.info(`${radio.name} is offline (${err.message}); trying again every minute`);
    state.offline = true;
    await this.applyReading(radio, state, { online: false, power: false, playing: false });
  }

  /** A device was just created (or updated): read it now. */
  async deviceCreated(device) {
    if (!parseExternalId(device.external_id)) {
      return;
    }
    this.stateOf(device).nextAt = 0;
    await this.readRadio(device);
    await this.updateStatus();
  }

  async deviceDeleted(device) {
    this.radios.delete(device?.external_id);
    await this.updateStatus();
  }

  // --- Discovery -------------------------------------------------------------------

  async publishDevices() {
    const devices = await this.discover();
    await this.gladys.publishDiscoveredDevices(devices);
    // Gladys updates the params (a new address) of the created radios
    // silently: read the devices back so the poll uses the new address.
    await this.gladys
      .getDevices()
      .catch((err) => this.logger.warn(`Reading the devices failed: ${err.message}`));
    this.discoveredAt = this.now();
    this.discoveryKey = JSON.stringify([this.config.pin, this.config.hosts]);
    await this.updateStatus();
    return devices;
  }

  /** The radios answering SSDP and the typed addresses, read once each. */
  async discover() {
    const candidates = new Map();
    try {
      const results = await this.gladys.scanNetwork('ssdp', {
        timeoutSeconds: SCAN_TIMEOUT_SECONDS,
      });
      for (const result of Array.isArray(results) ? results : []) {
        const found = ssdpRadio(result);
        if (found && !candidates.has(found.host)) {
          candidates.set(found.host, found);
        }
      }
    } catch (err) {
      this.logger.warn(`SSDP scan unavailable (${err.message}): only the typed addresses are read`);
    }
    for (const { host, port } of this.config.hosts) {
      const key = port ? `${host}:${port}` : host;
      if (!candidates.has(key)) {
        candidates.set(key, { host, port });
      }
    }
    const refused = [];
    const radios = await Promise.all(
      [...candidates.values()].map((candidate) =>
        this.probe(candidate).catch((err) => {
          if (err instanceof FsapiError && err.code === 'pin') {
            refused.push(candidate.host);
          }
          this.logger.warn(`No radio read at ${candidate.host}: ${err.message}`);
          return undefined;
        }),
      ),
    );
    this.discoveryRefused = refused;
    const devices = new Map();
    for (const radio of radios) {
      if (radio && !devices.has(radio.radioId)) {
        devices.set(radio.radioId, buildRadioDevice(this.gladys, radio));
      }
    }
    this.logger.info(`Discovery: ${devices.size} radio(s) found`);
    return [...devices.values()];
  }

  /**
   * Find the FSAPI address of a candidate (its SSDP description, then
   * /device, then the default /fsapi) and read what a device needs.
   */
  async probe({ host, port, location, name }) {
    const origin = `http://${urlHost(host)}${port ? `:${port}` : ''}`;
    const describer = this.newClient(`${origin}/fsapi`, host);
    const bases = [];
    for (const url of [location, `${origin}${DEVICE_PATH}`]) {
      if (!url) continue;
      try {
        const description = await describer.describe(url);
        if (description.webfsapi) {
          bases.push(fsapiBase(host, description.webfsapi));
          break;
        }
      } catch (err) {
        this.logger.debug?.(`${host}: no description at ${new URL(url).pathname} (${err.message})`);
      }
    }
    bases.push(fsapiBase(host, `${origin}/fsapi`));
    let failure;
    for (const baseUrl of [...new Set(bases)]) {
      try {
        return await this.readInfo(baseUrl, host, name);
      } catch (err) {
        if (err instanceof FsapiError && err.code === 'pin') {
          throw err;
        }
        failure = err;
      }
    }
    throw failure;
  }

  async readInfo(baseUrl, host, hint) {
    const client = this.newClient(baseUrl, host);
    const friendlyName = await client.get(NODES.FRIENDLY_NAME);
    let radioId = '';
    for (const node of [NODES.RADIO_ID, NODES.WLAN_MAC, NODES.WIRED_MAC]) {
      const id = radioIdOf(await client.tryGet(node));
      if (id && !/^0+$/.test(id)) {
        radioId = id;
        break;
      }
    }
    const version = await client.tryGet(NODES.VERSION);
    const steps = await client.tryGet(NODES.VOLUME_STEPS);
    let modes = [];
    try {
      modes = modesOf(await client.list(NODES.VALID_MODES));
    } catch (err) {
      this.logger.debug?.(`${host}: modes unavailable (${err.message})`);
    }
    const name =
      String(friendlyName ?? '')
        .trim()
        .slice(0, 60) ||
      hint ||
      `Radio ${host}`;
    return {
      radioId: radioId || `ip-${host.replace(/[^a-z0-9]/gi, '-').toLowerCase()}`,
      host,
      baseUrl,
      name,
      version: typeof version === 'string' ? version : undefined,
      volumeSteps: steps,
      modes,
    };
  }

  // --- Commands --------------------------------------------------------------------

  /** Error from the radio -> a message for Gladys (never the URL nor the PIN). */
  commandError(radio, err) {
    if (err instanceof FsapiError) {
      if (err.code === 'pin') return new Error(T.errors.pin(radio.name));
      if (err.unreachable) return new Error(T.errors.unreachable(radio.name, err.message));
      if (err.code === 'status') return new Error(T.errors.refused(radio.name, err.status));
    }
    return err;
  }

  /**
   * Run a command on a radio. `quiet`: the "now playing" change it causes
   * fires no scene event. Then the radio is read soon, and often for a minute.
   */
  async command({ radio, state }, job, { quiet = true } = {}) {
    if (quiet) {
      state.quietUntil = this.now() + PACING.FAST_WINDOW;
    }
    try {
      return await job();
    } catch (err) {
      throw this.commandError(radio, err);
    } finally {
      state.commands += 1;
      state.fastUntil = this.now() + PACING.FAST_WINDOW;
      state.nextAt = Math.min(state.nextAt, this.now() + PACING.SETTLE);
    }
  }

  async publishNow(states) {
    await this.gladys
      .publishChangedStates(states)
      .catch((err) => this.logger.warn(`States failed: ${err.message}`));
  }

  async ensurePower(client) {
    if ((await client.get(NODES.POWER)) !== 1) {
      await client.set(NODES.POWER, 1, { slow: true });
    }
  }

  async modesOf(state, client) {
    return (await this.ensureModes(state, client, null)) ?? [];
  }

  async currentMode(state, client) {
    const key = await client.tryGet(NODES.MODE);
    const modes = await this.ensureModes(state, client, key);
    return (modes ?? []).find((m) => m.key === key);
  }

  /** The presets of a mode, from the cache when recent. */
  async presetsFor(state, client, modeId, { fresh = false } = {}) {
    const cached = state.presets.get(modeId);
    if (!fresh && cached && this.now() - cached.at < PACING.PRESETS_TTL) {
      return cached.list;
    }
    const list = presetsOf(await client.readPresets());
    state.presets.set(modeId, { list, at: this.now() });
    return list;
  }

  async setValue(device, feature, value) {
    const t = this.target(device.external_id);
    const id = t.device.external_id;
    const key = featureKey(feature.external_id);
    const state = (k, v) => ({ device_feature_external_id: ids.feature(id, k), state: v });
    switch (key) {
      case FEATURE.POWER: {
        const on = Number(value) === 1 ? 1 : 0;
        await this.command(t, () => t.client.set(NODES.POWER, on, { slow: true }));
        await this.publishNow([state(FEATURE.POWER, on)]);
        return;
      }
      case FEATURE.VOLUME: {
        const volume = Math.max(0, Math.min(t.radio.volumeMax, Math.round(Number(value) || 0)));
        await this.command(t, () => t.client.set(NODES.VOLUME, volume), { quiet: false });
        await this.publishNow([state(FEATURE.VOLUME, volume)]);
        return;
      }
      case FEATURE.MUTE: {
        // Gladys renders VOLUME_MUTE as a button: each press toggles.
        const muted = await this.command(
          t,
          async () => {
            const current = t.state.reading?.mute ?? (await t.client.tryGet(NODES.MUTE)) === 1;
            await t.client.set(NODES.MUTE, current ? 0 : 1);
            return !current;
          },
          { quiet: false },
        );
        if (t.state.reading) {
          t.state.reading.mute = muted;
        }
        await this.publishNow([state(FEATURE.MUTE, muted ? 1 : 0)]);
        return;
      }
      case FEATURE.MODE: {
        const mode = await this.switchMode(t, String(value));
        await this.publishNow([
          state(FEATURE.POWER, 1),
          { device_feature_external_id: ids.feature(id, FEATURE.MODE), text: mode.id },
        ]);
        return;
      }
      case FEATURE.PLAY:
      case FEATURE.PAUSE:
      case FEATURE.NEXT:
      case FEATURE.PREVIOUS: {
        let control = {
          [FEATURE.PLAY]: PLAY_CONTROL.PLAY,
          [FEATURE.PAUSE]: PLAY_CONTROL.PAUSE,
          [FEATURE.NEXT]: PLAY_CONTROL.NEXT,
          [FEATURE.PREVIOUS]: PLAY_CONTROL.PREVIOUS,
        }[key];
        // "Play" only resumes a paused stream; a stopped one restarts with
        // "stop" (observed by Home Assistant's integration).
        if (key === FEATURE.PLAY && t.state.reading?.status === PLAY_STATUS.STOPPED) {
          control = PLAY_CONTROL.STOP;
        }
        await this.command(t, () => t.client.set(NODES.PLAY_CONTROL, control));
        return;
      }
      default:
        throw new Error(T.errors.readOnly(key));
    }
  }

  /** A mode the radio lets select (not "DMR", the remote playback), else an error. */
  selectableMode(modes, query) {
    const mode = findMode(modes, query);
    if (!mode?.selectable) {
      const names = modes.filter((m) => m.selectable).map((m) => m.label);
      throw new Error(T.errors.unknownMode(query, names));
    }
    return mode;
  }

  /** Power the radio on if needed and select a mode (id, label or family). */
  async switchMode(t, query) {
    return this.command(t, async () => {
      const modes = await this.modesOf(t.state, t.client);
      const mode = this.selectableMode(modes, query);
      await this.ensurePower(t.client);
      await t.client.set(NODES.MODE, mode.key, { slow: true });
      return mode;
    });
  }

  // --- Scene actions ---------------------------------------------------------------

  async setMode(fields = {}) {
    const t = this.target(fields.radio);
    const query = String(fields.mode ?? '').trim();
    if (!query) {
      throw new Error(T.errors.noMode);
    }
    const mode = await this.switchMode(t, query);
    return { mode: mode.label, mode_id: mode.id, source: mode.source };
  }

  async playPreset(fields = {}) {
    const t = this.target(fields.radio);
    const query = String(fields.preset ?? '').trim();
    if (!query) {
      throw new Error(T.errors.noPreset);
    }
    const wanted = String(fields.mode ?? '').trim();
    return this.command(t, async () => {
      const modes = await this.modesOf(t.state, t.client);
      await this.ensurePower(t.client);
      let mode = await this.currentMode(t.state, t.client);
      if (wanted) {
        const target = this.selectableMode(modes, wanted);
        if (target.key !== mode?.key) {
          await t.client.set(NODES.MODE, target.key, { slow: true });
          mode = target;
        }
      }
      const presets = await this.presetsFor(t.state, t.client, mode?.id ?? '');
      const preset = findPreset(presets, query);
      if (!preset) {
        throw new Error(
          T.errors.unknownPreset(
            query,
            presets.map((p) => `${p.number}. ${p.name}`),
          ),
        );
      }
      await t.client.selectPreset(preset.key);
      return { preset: preset.number, preset_name: preset.name, mode: mode?.label ?? '' };
    });
  }

  async getNowPlaying(fields = {}) {
    const t = this.target(fields.radio);
    // A recent reading is reused, unless a command was sent since.
    const recent =
      t.state.reading?.at &&
      this.now() - t.state.reading.at < PACING.FRESH &&
      t.state.readAfter === t.state.commands;
    if (!recent || t.state.offline) {
      await this.readRadio(t.device);
    }
    if (t.state.pinRefused) {
      throw new Error(T.errors.pin(t.radio.name));
    }
    const r = t.state.reading ?? { online: false, power: false, playing: false };
    const on = Boolean(r.online && r.power);
    return {
      online: Boolean(r.online),
      power: on,
      playing: on && Boolean(r.playing),
      mode: on ? (r.mode?.label ?? '') : '',
      source: on ? (r.mode?.source ?? 'other') : '',
      name: on ? r.name : '',
      text: on ? r.text : '',
      artist: on ? r.artist : '',
      album: on ? r.album : '',
      summary: nowPlayingLine(r),
      volume: on && r.volume !== null ? r.volume : null,
      artwork_url: on ? r.graphic : '',
    };
  }

  // --- Widget ----------------------------------------------------------------------

  async getWidget(_key, { settings = {}, language } = {}) {
    const device = this.createdRadios().find((d) => d.external_id === settings.radio);
    if (!device) {
      return {
        ttl_seconds: 300,
        components: [{ type: 'text', text: T.widget.chooseRadio, variant: 'body' }],
      };
    }
    const state = this.stateOf(device);
    const reading = state.reading;
    if (reading?.power && !state.offline && !state.pinRefused) {
      const modeId = reading.mode?.id ?? '';
      try {
        const { client } = this.target(device.external_id);
        state.shownPresets = { modeId, list: await this.presetsFor(state, client, modeId) };
      } catch (err) {
        this.logger.debug?.(`Presets of ${device.name} unavailable: ${err.message}`);
      }
    }
    return radioWidget({
      deviceId: device.external_id,
      name: device.name,
      state: {
        reading,
        offline: state.offline,
        pinRefused: state.pinRefused,
        presets: state.shownPresets,
      },
      language: language === 'fr' ? 'fr' : 'en',
    });
  }

  async widgetAction(_key, actionKey, params = {}, { settings = {}, values } = {}) {
    const key = String(actionKey);
    if (key !== WIDGET_ACTIONS.PRESET_FORM && !key.startsWith(WIDGET_ACTIONS.PRESET)) {
      return T.widget.failed(`unknown action ${key.slice(0, 40)}`);
    }
    try {
      const played = await this.playPreset({
        radio: settings.radio,
        preset: values?.preset ?? params.preset,
        mode: params.mode,
      });
      return T.widget.playing(`${played.preset}. ${played.preset_name}`);
    } catch (err) {
      return T.widget.failed(err.message);
    } finally {
      this.refreshWidget();
    }
  }

  // --- Configuration screen buttons --------------------------------------------------

  async testConnection() {
    const lines = { en: [], fr: [] };
    const devices = this.createdRadios();
    for (const device of devices) {
      const state = this.stateOf(device);
      await this.readRadio(device);
      const { host } = radioOfDevice(device);
      const r = state.reading;
      if (state.pinRefused) {
        lines.en.push(`${device.name} (${host}): PIN refused.`);
        lines.fr.push(`${device.name} (${host}) : code PIN refusé.`);
      } else if (state.offline || !r?.online) {
        lines.en.push(`${device.name} (${host}): no answer (standby, unplugged or new address).`);
        lines.fr.push(
          `${device.name} (${host}) : pas de réponse (veille, débranchée ou nouvelle adresse).`,
        );
      } else if (!r.power) {
        lines.en.push(`${device.name} (${host}): answers, in standby.`);
        lines.fr.push(`${device.name} (${host}) : répond, en veille.`);
      } else {
        const detail = [r.mode?.label, r.volume === null ? '' : `volume ${r.volume}`]
          .filter(Boolean)
          .join(', ');
        lines.en.push(`${device.name} (${host}): on, ${detail}.`);
        lines.fr.push(`${device.name} (${host}) : allumée, ${detail}.`);
      }
    }
    const created = new Set(devices.map((d) => radioOfDevice(d).host));
    for (const { host, port } of this.config.hosts.filter((h) => !created.has(h.host))) {
      try {
        const radio = await this.probe({ host, port });
        lines.en.push(`${host}: ${radio.name} answers; add it from Discovery.`);
        lines.fr.push(`${host} : ${radio.name} répond ; ajoutez-la depuis Découverte.`);
      } catch (err) {
        const pin = err instanceof FsapiError && err.code === 'pin';
        lines.en.push(`${host}: ${pin ? 'PIN refused' : `no radio answers (${err.message})`}.`);
        lines.fr.push(`${host} : ${pin ? 'code PIN refusé' : `aucune radio (${err.message})`}.`);
      }
    }
    await this.updateStatus();
    if (lines.en.length === 0) {
      return T.test.none;
    }
    return { en: lines.en.join('\n'), fr: lines.fr.join('\n') };
  }

  async listPresets(fields = {}) {
    const t = this.target(fields.radio);
    try {
      const mode = await this.currentMode(t.state, t.client);
      const presets = await this.presetsFor(t.state, t.client, mode?.id ?? '', { fresh: true });
      if (presets.length === 0) {
        return T.presets.none(t.radio.name, mode?.label);
      }
      const list = presets.map((p) => `${p.number}. ${p.name}`).join('\n');
      return {
        en: `${t.radio.name}, ${mode?.label ?? 'current mode'}:\n${list}`,
        fr: `${t.radio.name}, ${mode?.label ?? 'mode actuel'} :\n${list}`,
      };
    } catch (err) {
      throw this.commandError(t.radio, err);
    }
  }
}

/** What the widget shows of a reading, to nudge it only when that changed. */
function shown(reading) {
  if (!reading) {
    return '';
  }
  return JSON.stringify([
    reading.online,
    reading.power,
    reading.mode?.id,
    reading.status,
    reading.name,
    reading.text,
    reading.artist,
    reading.album,
  ]);
}
