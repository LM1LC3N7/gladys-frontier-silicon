// -----------------------------------------------------------------------------
// Finding the radios (pure): the raw SSDP answers relayed by the core, the
// device description they point to, and the FSAPI address of a radio.
//
// An SSDP answer of a radio (built blind, shaped after Home Assistant's
// discovery and netdisco's filter):
//   HTTP/1.1 200 OK
//   LOCATION: http://192.168.1.20:8080/dd.xml
//   ST: urn:schemas-frontier-silicon-com:undok:fsapi:1
//   USN: uuid:3dcc7100-...::urn:schemas-frontier-silicon-com:undok:fsapi:1
//   SPEAKER-NAME: Kitchen radio
// The description (afsapi reads it at http://<ip>/device too) holds the
// FSAPI address: <netRemote>...<webfsapi>http://192.168.1.20:80/fsapi</webfsapi>
//
// The radio's own answers never choose where the PIN goes: the FSAPI
// address always keeps the host the radio answered from (fsapiBase).
// -----------------------------------------------------------------------------

import { DEFAULT_FSAPI_PATH } from './nodes.js';
import { findDeep, parseXml, textOf } from './xml.js';

/** The raw headers (text, or an object) -> { lower-case name: value }. */
export function parseSsdpHeaders(headers) {
  const out = Object.create(null);
  if (headers && typeof headers === 'object') {
    for (const [key, value] of Object.entries(headers)) {
      out[key.toLowerCase()] = String(value ?? '').trim();
    }
    return out;
  }
  for (const line of String(headers ?? '')
    .slice(0, 8192)
    .split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon > 0) {
      const key = line.slice(0, colon).trim().toLowerCase();
      if (key && !(key in out)) {
        out[key] = line.slice(colon + 1).trim();
      }
    }
  }
  return out;
}

const isFrontier = (text) => /urn:schemas-frontier-silicon-com:/i.test(text) && /fsapi/i.test(text);

/**
 * One SSDP result -> { host, location, name } when it is a Frontier Silicon
 * radio, else undefined. The LOCATION is kept only on the responder's host.
 */
export function ssdpRadio(result) {
  const host = String(result?.source_ip ?? '').trim();
  if (!host) {
    return undefined;
  }
  const headers = parseSsdpHeaders(result.headers);
  const target = `${headers.st ?? ''} ${headers.nt ?? ''} ${headers.usn ?? ''}`;
  if (!isFrontier(target)) {
    return undefined;
  }
  let location;
  try {
    const url = new URL(headers.location);
    if ((url.protocol === 'http:' || url.protocol === 'https:') && url.hostname === host) {
      location = url.href;
    }
  } catch {
    // no usable LOCATION: the radio is still tried on its default paths
  }
  const name = (headers['speaker-name'] ?? '').slice(0, 60) || undefined;
  return { host, location, name };
}

/** A device description -> { webfsapi, friendlyName, version } (any may be missing). */
export function parseDescription(xml) {
  const root = parseXml(xml);
  const read = (name) => textOf(findDeep(root, name) ?? (root.name === name ? root : undefined));
  return {
    webfsapi: read('webfsapi').trim() || undefined,
    friendlyName: read('friendlyName').replace(/\s+/g, ' ').trim().slice(0, 60) || undefined,
    version: read('version').trim().slice(0, 100) || undefined,
  };
}

/** Format a host for a URL (an IPv6 address needs brackets). */
export function urlHost(host) {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

/**
 * The FSAPI base URL of a radio: the port and path the radio announced, on
 * the host we reached it at. http only (the radios serve no https).
 */
export function fsapiBase(host, webfsapi) {
  let port = '';
  let path = DEFAULT_FSAPI_PATH;
  try {
    const url = new URL(webfsapi);
    if (url.protocol === 'http:') {
      port = url.port;
      path = url.pathname.replace(/\/+$/, '') || DEFAULT_FSAPI_PATH;
    }
  } catch {
    // keep the defaults
  }
  if (!/^\/[A-Za-z0-9._~/-]{0,100}$/.test(path)) {
    path = DEFAULT_FSAPI_PATH;
  }
  return `http://${urlHost(host)}${port ? `:${port}` : ''}${path}`;
}

/** A device param `fsapi_url` checked against its `host` param, else the default. */
export function checkedBase(host, stored) {
  try {
    const url = new URL(stored);
    if (url.protocol === 'http:' && url.hostname.replace(/^\[|\]$/g, '') === host) {
      return fsapiBase(host, stored);
    }
  } catch {
    // fall through
  }
  return fsapiBase(host, undefined);
}
