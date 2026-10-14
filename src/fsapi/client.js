// -----------------------------------------------------------------------------
// The FSAPI client of ONE radio: GET / SET / LIST_GET_NEXT over HTTP with the
// PIN, one request at a time, a pause after each write.
//
// No session, on purpose. CREATE_SESSION takes the radio's only session and
// kicks the UNDOK app out; GET_NOTIFIES (the long poll) needs that session.
// Plain PIN calls need none: afsapi (and so Home Assistant) reads and writes
// every node that way, and only creates a session to retry after an HTTP 404
// or a timeout - a fallback this client deliberately does not have (a 404
// is reported, a timeout means the radio is asleep or gone).
// -----------------------------------------------------------------------------

import { HTTP_TIMEOUT, LIST_PAGE, MAX_LIST_ITEMS, SLOW_TIMEOUT, SPACING } from '../constants.js';
import { HttpError, getText } from '../http.js';
import { parseDescription } from './discovery.js';
import { parseAnswer } from './model.js';
import { NODES, NOW_NODES, STATUS } from './nodes.js';

/**
 * A failed call. `code`:
 *   status   - the radio answered with an FS_ status other than FS_OK (`status`)
 *   pin      - HTTP 403: the PIN is wrong
 *   http     - another HTTP status (`status`), 404 included
 *   protocol - the answer is not an FSAPI answer
 *   timeout, network, too_large, redirect - from src/http.js
 * The message names the node, never the URL (it carries the PIN).
 */
export class FsapiError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = 'FsapiError';
    this.code = code;
    this.status = status;
  }

  /** The radio did not answer at all (asleep, unplugged, wrong address). */
  get unreachable() {
    return ['timeout', 'network', 'redirect'].includes(this.code);
  }
}

/** Status answers a read treats as "no value here" rather than a failure. */
const SOFT_STATUSES = new Set([
  STATUS.NODE_DOES_NOT_EXIST,
  STATUS.NODE_BLOCKED,
  STATUS.FAIL,
  STATUS.PACKET_BAD,
]);

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The queue of one radio. Every client of the same radio (the poll, a
 * discovery, a command) shares it, so the radio never sees two requests.
 */
export const createQueue = () => ({ tail: Promise.resolve(), notBefore: 0 });

export class FsapiClient {
  constructor({ baseUrl, pin, sleep = defaultSleep, now = Date.now, queue = createQueue() }) {
    this.baseUrl = baseUrl;
    this.pin = String(pin);
    this.sleep = sleep;
    this.now = now;
    this.queue = queue;
  }

  /** Run `job` after every queued call, then hold the radio `spacing` ms. */
  exclusive(job, spacing) {
    const queue = this.queue;
    const run = queue.tail.then(async () => {
      const wait = queue.notBefore - this.now();
      if (wait > 0) {
        await this.sleep(wait);
      }
      try {
        return await job();
      } finally {
        queue.notBefore = this.now() + spacing;
      }
    });
    queue.tail = run.catch(() => {});
    return run;
  }

  /** Read a device description through the queue of the radio. */
  describe(url) {
    return this.exclusive(() => fetchDescription(url), SPACING.READ);
  }

  url(path, params = {}) {
    const search = new URLSearchParams({ pin: this.pin, ...params });
    return `${this.baseUrl}/${path}?${search}`;
  }

  /** One call -> the parsed answer (FS_OK or FS_LIST_END), else an FsapiError. */
  async call(path, params, { node, timeout = HTTP_TIMEOUT, spacing = SPACING.READ } = {}) {
    return this.exclusive(async () => {
      let answer;
      try {
        answer = await getText(this.url(path, params), { timeout });
      } catch (err) {
        if (err instanceof HttpError) {
          throw new FsapiError(err.code, `${node}: ${err.message}`);
        }
        throw err;
      }
      if (answer.status === 403) {
        throw new FsapiError('pin', 'the radio refused the PIN (HTTP 403)', 403);
      }
      if (answer.status !== 200) {
        throw new FsapiError('http', `${node}: HTTP ${answer.status}`, answer.status);
      }
      let parsed;
      try {
        parsed = parseAnswer(answer.text);
      } catch (err) {
        throw new FsapiError('protocol', `${node}: not an FSAPI answer (${err.message})`);
      }
      if (parsed.status !== STATUS.OK && parsed.status !== STATUS.LIST_END) {
        throw new FsapiError('status', `${node}: ${parsed.status}`, parsed.status);
      }
      return parsed;
    }, spacing);
  }

  /** GET a node -> its value (number, string or null). */
  async get(node) {
    const answer = await this.call(`GET/${node}`, {}, { node });
    return answer.value ?? null;
  }

  /** GET a node, null when the radio has no value for it in this mode. */
  async tryGet(node) {
    try {
      return await this.get(node);
    } catch (err) {
      if (err instanceof FsapiError && err.code === 'status' && SOFT_STATUSES.has(err.status)) {
        return null;
      }
      throw err;
    }
  }

  /** SET a node. `slow` for the writes the radio takes seconds to apply. */
  async set(node, value, { slow = false } = {}) {
    await this.call(
      `SET/${node}`,
      { value: String(value) },
      {
        node,
        timeout: slow ? SLOW_TIMEOUT : HTTP_TIMEOUT,
        spacing: slow ? SPACING.SLOW_SET : SPACING.SET,
      },
    );
  }

  /**
   * A whole list (LIST_GET_NEXT pages from -1, each starting after the last
   * key received) -> [{ key, fields }], at most MAX_LIST_ITEMS.
   */
  async list(node) {
    const items = [];
    let start = -1;
    while (items.length < MAX_LIST_ITEMS) {
      let answer;
      try {
        answer = await this.call(
          `LIST_GET_NEXT/${node}/${start}`,
          { maxItems: String(LIST_PAGE) },
          { node, timeout: SLOW_TIMEOUT },
        );
      } catch (err) {
        // FS_FAIL past the end of a list (afsapi's OutOfRangeError).
        if (err instanceof FsapiError && err.status === STATUS.FAIL && items.length > 0) {
          break;
        }
        throw err;
      }
      const fresh = answer.items.filter((item) => item.key > start);
      items.push(...fresh);
      if (answer.listEnd || fresh.length === 0) {
        break;
      }
      start = fresh[fresh.length - 1].key;
    }
    return items.slice(0, MAX_LIST_ITEMS);
  }

  // --- The reads the integration needs ------------------------------------------

  /** One poll: the power, then the "now playing" nodes when the radio is on. */
  async readState() {
    const raw = { power: await this.get(NODES.POWER) };
    if (raw.power === 1) {
      for (const [key, node] of Object.entries(NOW_NODES)) {
        raw[key] = await this.tryGet(node);
      }
    }
    return raw;
  }

  /** The presets of the current mode; the radio must be in navigation mode. */
  async readPresets() {
    await this.enableNavigation();
    try {
      return await this.list(NODES.PRESETS);
    } catch (err) {
      // A mode without presets (Bluetooth, AUX) blocks or lacks the node.
      if (err instanceof FsapiError && err.code === 'status' && SOFT_STATUSES.has(err.status)) {
        return [];
      }
      throw err;
    }
  }

  async enableNavigation() {
    if ((await this.tryGet(NODES.NAV_STATE)) !== 1) {
      await this.set(NODES.NAV_STATE, 1, { slow: true });
    }
  }

  async selectPreset(key) {
    await this.enableNavigation();
    await this.set(NODES.SELECT_PRESET, key, { slow: true });
  }
}

/** Read a device description (no PIN involved) -> { webfsapi, friendlyName, version }. */
export async function fetchDescription(url) {
  let answer;
  try {
    answer = await getText(url, { timeout: HTTP_TIMEOUT });
  } catch (err) {
    throw new FsapiError(err.code ?? 'network', `description: ${err.message}`);
  }
  if (answer.status !== 200) {
    throw new FsapiError('http', `description: HTTP ${answer.status}`, answer.status);
  }
  try {
    return parseDescription(answer.text);
  } catch (err) {
    throw new FsapiError('protocol', `description: ${err.message}`);
  }
}
