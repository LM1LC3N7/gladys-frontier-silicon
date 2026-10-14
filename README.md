# gladys-frontier-silicon

[Gladys Assistant](https://gladysassistant.com) external integration for the
internet radios built on a **Frontier Silicon** module (Roberts, Hama,
Medion, Revo, Lenco, Auna... the radios the UNDOK app controls): power,
volume, mute, source, presets and now playing, on the local network, with a
scene trigger, scene actions and a dashboard widget. **Unofficial connector,
not affiliated with Frontier Smart Technologies nor with the radio brands.**

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

## How it works

```
Gladys ⇄ SDK ⇄ src/app.js (FrontierApp)
                 ├─ src/fsapi/client.js     GET / SET / LIST_GET_NEXT, one request at a time
                 ├─ src/fsapi/model.js      answers -> modes, presets, readings (pure)
                 ├─ src/fsapi/discovery.js  SSDP answers, descriptions, addresses (pure)
                 ├─ src/fsapi/xml.js        small hardened XML parser (pure)
                 ├─ src/devices.js          the radio device and its states (pure)
                 ├─ src/triggers.js         readings -> now_playing_changed (pure)
                 └─ src/widget.js           the "radio" widget (pure)
```

- **Discovery**: the core sends the SSDP search for the FSAPI targets
  (`network_discovery`), the integration reads each answering radio once
  (name, id, firmware, volume scale, modes), plus the addresses typed in the
  configuration.
- **Reading**: FSAPI over HTTP with the PIN, **no session** (a session would
  kick the UNDOK app out), one request at a time per radio; every 30 s by
  default, every 5 s for a minute after a command, once a minute while a
  radio is offline (some models leave the network in standby).
- **Triggers** come from two consecutive readings; the first one only arms,
  and the changes caused by Gladys itself fire nothing.

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npx github:GladysAssistant/integration-store .  # store admission checks
```

The XML fixtures in `test/fixtures/` are answers of a real radio, taken from
the test recordings of [afsapi](https://github.com/wlcrs/python-afsapi)
(Apache-2.0), the library of the Home Assistant integration. This first
version was built without a radio: see [TODO.md](TODO.md).

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release.

## License

Apache-2.0.
