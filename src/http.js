// -----------------------------------------------------------------------------
// The only place that talks to the network: one GET on the LAN, with a
// timeout, a size cap and no redirect. The tests replace `fetch` with
// `setFetch()`.
//
// The radios are single-threaded: `Connection: close` frees the radio as
// soon as it answered (afsapi does the same), so the UNDOK app or another
// controller is never kept waiting behind an idle keep-alive socket.
//
// The FSAPI URLs carry the PIN in their query string: an HttpError never
// contains the URL, the caller names the radio and the node itself.
// -----------------------------------------------------------------------------

import { HTTP_TIMEOUT, MAX_BYTES, USER_AGENT } from './constants.js';

let fetchImpl = (...args) => globalThis.fetch(...args);

/** Replace the fetch implementation (tests only). Returns the previous one. */
export function setFetch(impl) {
  const previous = fetchImpl;
  fetchImpl = impl;
  return previous;
}

/** A failed request. `code`: timeout, network, too_large, redirect. */
export class HttpError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'HttpError';
    this.code = code;
  }
}

async function readCapped(body, maxBytes) {
  if (!body) {
    return '';
  }
  const reader = body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new HttpError('too_large', `answer over ${Math.round(maxBytes / 1024)} KB`);
    }
    chunks.push(value);
  }
  // The radios answer UTF-8; a stray byte becomes U+FFFD, as afsapi does.
  return new TextDecoder('utf-8').decode(Buffer.concat(chunks, total));
}

/** GET `url`; resolves { status, text } for any HTTP status. Throws an HttpError. */
export async function getText(url, { timeout = HTTP_TIMEOUT, maxBytes = MAX_BYTES } = {}) {
  const signal = AbortSignal.timeout(Math.max(1, timeout));
  try {
    const response = await fetchImpl(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/xml, application/xml;q=0.9, */*;q=0.1',
        Connection: 'close',
      },
      redirect: 'manual',
      signal,
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => {});
      throw new HttpError('redirect', `HTTP ${response.status} redirect refused`);
    }
    return { status: response.status, text: await readCapped(response.body, maxBytes) };
  } catch (err) {
    if (err instanceof HttpError) {
      throw err;
    }
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError' || signal.aborted) {
      throw new HttpError('timeout', `no answer within ${Math.round(timeout / 1000)} s`);
    }
    // The cause code only (ECONNREFUSED, EHOSTUNREACH...): undici's messages
    // can quote the address, and the address carries the PIN.
    const code = err?.cause?.code ?? err?.code;
    throw new HttpError('network', code ? `network error (${code})` : 'network error');
  }
}
