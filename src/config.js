// -----------------------------------------------------------------------------
// The configuration the user fills (manifest `config_schema`), normalized.
// -----------------------------------------------------------------------------

import { DEFAULT_PIN, MAX_HOSTS } from './constants.js';

// Defaults: they MUST match the `default` values of the manifest. The PIN
// is a `secret` field, which takes no default: empty means DEFAULT_PIN.
export const DEFAULTS = {
  hosts: '',
  poll_interval: 30,
};

export const BOUNDS = { poll_interval: { min: 10, max: 300 } };

const number = (value, fallback, { min, max }) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};

/**
 * The `hosts` field: addresses separated by commas, spaces or new lines,
 * each a host name or an IP with an optional port ("192.168.1.20",
 * "radio.lan:8080", "[fd00::20]"). An entry with a path, credentials or
 * another scheme than http is refused (reported by its position only).
 *   -> { hosts: [{ host, port }], invalid: [positions] }
 */
export function parseHosts(text) {
  const hosts = [];
  const invalid = [];
  const seen = new Set();
  const entries = String(text ?? '')
    .split(/[\s,;]+/)
    .filter(Boolean);
  entries.forEach((entry, index) => {
    let url;
    try {
      url = new URL(/^[a-z]+:\/\//i.test(entry) ? entry : `http://${entry}`);
    } catch {
      invalid.push(index + 1);
      return;
    }
    if (
      url.protocol !== 'http:' ||
      url.username ||
      url.password ||
      (url.pathname !== '/' && url.pathname !== '') ||
      url.search ||
      !url.hostname
    ) {
      invalid.push(index + 1);
      return;
    }
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const key = `${host}:${url.port}`;
    if (!seen.has(key) && hosts.length < MAX_HOSTS) {
      seen.add(key);
      hosts.push({ host, port: url.port ? Number(url.port) : undefined });
    }
  });
  return { hosts, invalid };
}

export function normalizeConfig(raw = {}) {
  const pin = typeof raw.pin === 'string' || typeof raw.pin === 'number' ? String(raw.pin) : '';
  const { hosts, invalid } = parseHosts(raw.hosts ?? DEFAULTS.hosts);
  return {
    pin: pin.trim() || DEFAULT_PIN,
    hosts,
    invalidHosts: invalid,
    pollInterval: number(raw.poll_interval, DEFAULTS.poll_interval, BOUNDS.poll_interval),
  };
}
