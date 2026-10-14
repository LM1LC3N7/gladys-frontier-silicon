# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for
human contributors.

## What this is

A Gladys Assistant **external integration** of type `device`: a Node.js
service (Node 22+, ESM, no build step) in its own sandboxed Docker container,
talking to Gladys through `@gladysassistant/integration-sdk` (v0.15). It
drives the internet radios built on a **Frontier Silicon** module (Roberts,
Hama, Medion, Revo, Lenco, Auna... the UNDOK family) through FSAPI, their
HTTP + XML API on the LAN: one device per radio (power, volume, mute,
source, transport, playback state, now playing), a scene trigger, three
scene actions and a dashboard widget. Local only. Unofficial: not
affiliated with Frontier Smart Technologies.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run audit                             # npm audit --omit=dev
npx github:GladysAssistant/integration-store .   # store admission checks
```

Run `format:check`, `lint`, `test` and `audit` before every commit.

## Architecture

```
index.js              SDK wiring only (handlers registered before connect())
src/app.js            FrontierApp: discovery, the paced reading of the radios,
                      commands, scene trigger and actions, widget, buttons
src/fsapi/nodes.js    every FSAPI name: nodes, statuses, play status/control,
                      mode ids -> families, SSDP targets
src/fsapi/xml.js      the small hardened XML parser (pure)
src/fsapi/model.js    answers -> values, modes, presets, readings (pure)
src/fsapi/discovery.js SSDP answers, descriptions, FSAPI addresses (pure)
src/fsapi/client.js   one radio: GET / SET / LIST_GET_NEXT, one request at a
                      time, spacing, FsapiError
src/devices.js        the radio device, feature keys, external id, states (pure)
src/triggers.js       readings -> now_playing_changed (pure)
src/widget.js         the "radio" widget (pure)
src/config.js         config_schema normalized, the `hosts` grammar
src/constants.js      pacing, limits, manifest keys
src/i18n.js           runtime texts (en/fr)
src/http.js           the only network access (fetch, timeout, size cap,
                      no redirect, Connection: close)
test/fixtures/        answers of a real radio (the afsapi 1.0.2 recordings,
                      Apache-2.0, radio id anonymized), a description and an
                      SSDP answer shaped after the documentation
test/helpers/         a fake radio behind a fake fetch, fake timers; Gladys is
                      the SDK's fake
```

## The protocol, as built

- `GET <fsapi>/GET/<node>?pin=1234`, `SET/<node>?pin=&value=`,
  `LIST_GET_NEXT/<node>/<after key>?pin=&maxItems=50` (pages start at -1,
  each one after the last key received). Answers:
  `<fsapiResponse><status>FS_OK</status><value><u8>1</u8></value>...`,
  values typed `c8_array` (text) or `u8/u16/u32/s8/s16/s32/e8` (integers).
  HTTP 403 is a wrong PIN.
- **No session, on purpose.** `CREATE_SESSION` takes the radio's only
  session and kicks the UNDOK app out; `GET_NOTIFIES` (the long poll) needs
  that session, so it is not used: the radios are polled. afsapi (Home
  Assistant) reads and writes every node with the PIN alone too, and only
  opens a session to retry after an HTTP 404 or a timeout: this client has
  no such fallback (a 404 is reported, a timeout counts toward offline).
- The FSAPI address comes from the description the SSDP LOCATION points to
  (`<webfsapi>`), else `http://<ip>/device`, else `http://<ip>/fsapi`. The
  host is always the address the radio answered from (`fsapiBase`): a
  description never sends the PIN elsewhere.
- Presets need `netRemote.nav.state = 1` and depend on the mode; their keys
  start at 0, the radio shows them from 1 (`number`). The volume scale is
  `0 .. volumeSteps - 1` (afsapi recording: 33 steps, 0-32).

## Rules

- **Unofficial.** Every user-facing surface says "unofficial connector, not
  affiliated with Frontier Smart Technologies" (and the radio brands). Never
  use a Frontier, UNDOK or radio brand logo.
- **Keys are forever**: the manifest keys and the widget action keys
  (`src/constants.js`), the trigger values (`SOURCES`, `CHANGES`), the
  feature keys (`FEATURE` in `src/devices.js`) and the external id shape
  `radio:<radio id>` (the radioId, else the MAC, else `ip-<address>`) are
  stored in user scenes and dashboards. Never rename them.
- **Local only, the PIN is a secret**: the client only talks to the radios'
  addresses on the LAN; the PIN travels in the query string FSAPI requires,
  so no URL ever reaches a log, an error or a status (`http.js` keeps the
  cause code only, `FsapiError` names the node).
- **Be gentle with the radios** (small single-threaded devices):
  - one request at a time per radio (`FsapiClient.exclusive`), 0.3 s after a
    write, 1 s after a slow one (power, mode, navigation, preset), as
    afsapi does; `Connection: close` frees the radio at once;
  - a 2 s scheduler tick sends nothing unless a radio is due; a radio is
    read every `poll_interval` (30 s by default, 10 s minimum): 1 request in
    standby, 10 when on; the modes once a day (or when an unknown mode
    shows up, at most once a minute);
  - after a command: read back after 2 s, then every 5 s for a minute;
  - two failed readings make a radio **offline** (some models leave the
    network in standby): it reads as off, one log line, retried once a
    minute; a refused PIN is retried every 10 minutes or on a new PIN;
  - the presets are read on demand only (widget, scene action, button),
    cached an hour per mode, never in the background poll (reading them
    switches the radio to navigation mode).
- **One event per transition** (`src/triggers.js`): the first reading only
  arms; buffering (on, nothing to show) changes nothing; off/offline then
  playing fires; a change caused by a command sent through Gladys arms
  silently (`quietUntil`): no scene loop through the radio. No
  `preset_selected` trigger: no node tells which preset plays, and the
  presets selected through Gladys would be loops.
- **Mute is a toggle**: Gladys renders `television` / `volume-mute` as a
  button (learned on the Denon integration): each press flips the mute.
- **Built blind**: no radio was at hand. Every FSAPI name lives in
  `src/fsapi/` so a tester's report fixes one place; `TODO.md` lists what
  to confirm.
- **Read-only rootfs**: write nothing on disk.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag.
- **Changelog**: every user-visible change adds a line under
  `## [Unreleased]` in `CHANGELOG.md`.
- **Manifest texts** are `{ en, fr }` objects; the catalog description holds
  10 to 100 characters per language; `test/manifest.test.js` ties the
  manifest to the code.
- **User-facing text** is bilingual, `docs/en.md` and `docs/fr.md` kept in
  sync. Comments explain why, in English.
- **Tests never touch the network** (`installRadios` replaces `fetch`); the
  widget contents pass the SDK's `validateWidgetContent`.

## CI and pushes

- Group the commits and push **at most once a day**, unless the maintainer
  explicitly asks otherwise: the GitHub Actions quota is limited.
- If every CI job fails in under 2 seconds, the quota is exhausted: it is
  not a bug in the code.
- The Docker image cannot be built in the Claude Code cloud container (no
  network for `apk` inside `docker build`): the CI builds it.

## Refreshing the fixtures

The XML answers come from the recordings of afsapi's tests (a real radio,
"Keukenradio"), in its source archive on PyPI: download and unpack it
outside the repository, then copy the response bodies of
`tests/cassettes/**.yaml` (read them, never run the library):

```bash
curl -s https://pypi.org/pypi/afsapi/json | python3 -I -c "import json,sys; print([u['url'] for u in json.load(sys.stdin)['urls'] if u['packagetype'] == 'sdist'][0])"
```

With a radio on the LAN:

```bash
R=http://192.168.1.20/fsapi PIN=1234
curl -s "$R/GET/netRemote.sys.power?pin=$PIN"
curl -s "$R/LIST_GET_NEXT/netRemote.sys.caps.validModes/-1?pin=$PIN&maxItems=50"
curl -s "http://192.168.1.20/device"
```

Anonymize the radio id and the MAC addresses before an answer becomes a
fixture.
