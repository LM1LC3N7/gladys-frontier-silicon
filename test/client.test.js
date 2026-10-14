// -----------------------------------------------------------------------------
// The FSAPI client against a fake radio: the URLs, the PIN, one request at a
// time with a pause after the writes, the lists in pages, the errors (which
// never carry the PIN).
// -----------------------------------------------------------------------------

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { FsapiClient, FsapiError } from '../src/fsapi/client.js';
import { setFetch } from '../src/http.js';
import { MODES, createRadio, installRadios, radioState, xml } from './helpers/fakeRadio.js';

let fake;
afterEach(() => fake?.restore());

const BASE = 'http://192.168.1.183/fsapi';

function client({ pin = '1234', sleeps = [] } = {}) {
  let now = 0;
  return new FsapiClient({
    baseUrl: BASE,
    pin,
    now: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
  });
}

test('GET, SET and LIST_GET_NEXT carry the PIN, close the connection, read the values', async () => {
  const radio = createRadio();
  fake = installRadios([radio]);
  const c = client();
  assert.equal(await c.get('netRemote.sys.info.friendlyName'), 'Keukenradio');
  await c.set('netRemote.sys.audio.volume', 12);
  assert.equal(radio.state.volume, 12);
  assert.equal(
    fake.calls[0].url,
    'http://192.168.1.183/fsapi/GET/netRemote.sys.info.friendlyName?pin=1234',
  );
  assert.equal(
    fake.calls[1].url,
    'http://192.168.1.183/fsapi/SET/netRemote.sys.audio.volume?pin=1234&value=12',
  );
  assert.equal(fake.calls[0].init.headers.Connection, 'close');
  assert.match(fake.calls[0].init.headers['User-Agent'], /^gladys-frontier-silicon\//);
  assert.equal(fake.calls[0].init.redirect, 'manual');
  const raw = await c.readState();
  assert.deepEqual(Object.keys(raw), [
    'power',
    'volume',
    'mute',
    'modeKey',
    'status',
    'name',
    'text',
    'artist',
    'album',
    'graphic',
  ]);
  radio.state.power = 0;
  assert.deepEqual(await c.readState(), { power: 0 });
});

test('one request at a time per radio, and a pause after each write', async () => {
  const radio = createRadio();
  let running = 0;
  let most = 0;
  fake = installRadios([radio], {
    delay: async () => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setImmediate(resolve));
      running -= 1;
    },
  });
  const sleeps = [];
  const c = client({ sleeps });
  await Promise.all([
    c.set('netRemote.sys.power', 1, { slow: true }),
    c.get('netRemote.sys.power'),
    c.set('netRemote.sys.audio.mute', 1),
    c.get('netRemote.sys.audio.mute'),
  ]);
  assert.equal(most, 1);
  assert.deepEqual(sleeps, [1000, 300], 'afsapi spacing: 1 s after a slow write, 0.3 s after one');
});

test('lists come in pages, each one after the last key received', async () => {
  const modes = Array.from({ length: 70 }, (_, i) => ({
    id: `M${i}`,
    label: `Mode ${i}`,
    selectable: 1,
  }));
  const radio = createRadio({ state: radioState({ modes }) });
  fake = installRadios([radio]);
  const items = await client().list('netRemote.sys.caps.validModes');
  assert.equal(items.length, 70);
  assert.deepEqual(
    fake.calls.map((c) => c.path),
    [
      '/fsapi/LIST_GET_NEXT/netRemote.sys.caps.validModes/-1',
      '/fsapi/LIST_GET_NEXT/netRemote.sys.caps.validModes/49',
    ],
  );
  assert.equal(fake.calls[0].params.maxItems, '50');
  // The presets need the navigation mode, switched on once.
  radio.state.modes = MODES;
  const presets = await client().readPresets();
  assert.equal(presets.length, 5);
  assert.equal(radio.state.navState, 1);
});

test('errors: statuses, PIN, HTTP, timeouts, garbage; never the PIN in a message', async () => {
  const radio = createRadio({ pin: '9876' });
  fake = installRadios([radio]);
  const good = client({ pin: '9876' });
  assert.equal(await good.tryGet('netRemote.sys.net.wlan.macAddress'), null);
  await assert.rejects(
    good.set('netRemote.sys.audio.volume', 99),
    (err) => err instanceof FsapiError && err.code === 'status' && err.status === 'FS_FAIL',
  );
  const wrong = client({ pin: '1234' });
  await assert.rejects(wrong.get('netRemote.sys.power'), (err) => err.code === 'pin');
  radio.offline = true;
  await assert.rejects(good.get('netRemote.sys.power'), (err) => {
    assert.equal(err.unreachable, true);
    assert.equal(err.message, 'netRemote.sys.power: network error (EHOSTUNREACH)');
    return true;
  });
  fake.restore();
  fake = undefined;
  const messages = [];
  for (const respond of [
    () => xml('Not found', 404),
    () => xml('<html>router login</html>'),
    () => {
      throw Object.assign(new Error('The operation was aborted due to timeout'), {
        name: 'TimeoutError',
      });
    },
    () => new Response('', { status: 302, headers: { location: 'http://evil.example/' } }),
  ]) {
    const previous = setFetch(async () => respond());
    const err = await good.get('netRemote.sys.power').catch((e) => e);
    setFetch(previous);
    messages.push(`${err.code}: ${err.message}`);
  }
  assert.deepEqual(messages, [
    'http: netRemote.sys.power: HTTP 404',
    'protocol: netRemote.sys.power: not an FSAPI answer (unexpected answer <html>)',
    'timeout: netRemote.sys.power: no answer within 5 s',
    'redirect: netRemote.sys.power: HTTP 302 redirect refused',
  ]);
  assert.ok(messages.every((m) => !m.includes('9876')));
});
