# TODO

## Before announcing

- [ ] Test on a real Gladys 5.1+ with at least one radio (testers wanted on
      the forum): discovery by SSDP, a typed address, every command, the
      widget, the three scene actions, the trigger during an evening of
      internet radio and of DAB.
- [ ] Ask for reports model by model (Roberts, Hama, Medion, Revo, Lenco,
      Auna...): firmware (`firmware` param), what works, what does not.
- [ ] Add the `gladys-assistant-integration` topic to publish in the store.
- [ ] Turn on "Private vulnerability reporting" (SECURITY.md points there).

## To confirm (built blind)

- [ ] The SSDP answer: is `ST` one of the two declared targets
      (`undok:fsapi:1`, `fs_reference:fsapi:1`) on older and newer radios?
      Does the core send one M-SEARCH per declared `st` and merge them?
      Does the LOCATION point to a description holding `<webfsapi>` (port
      8080 `dd.xml`, or `/device`)?
- [ ] `play.status` on DAB and FM: 2 (playing) while tuned, or 0 (idle)?
      The playback state feature relies on it.
- [ ] `play.info.text` on DAB: how often the scrolling text changes (the
      `track` events), and whether `artist` / `album` are filled on
      internet radio or only on Spotify / the music player.
- [ ] `netRemote.nav.state = 1` while the user browses the radio's own
      menu: does reading the presets disturb it?
- [ ] Selecting a preset of another mode: is the mode switch + 1 s pause
      enough, or does the radio need longer before `nav.presets`?
- [ ] Pause on internet radio (live streams): FS_FAIL, or a real pause? Next
      / previous on DAB and FM (afsapi's recording: FS_FAIL in standby).
- [ ] The radios that drop off the network in standby: does a command
      (power on) ever reach them, or only the remote / the knob?
- [ ] `netRemote.sys.info.radioId` on every model (else the MAC is the id).
- [ ] The rendering in Gladys of `television` / `volume` with the radio's
      own scale (0-32) and of the `text` / `select` source list.

## Ideas

- `GET_MULTIPLE` (one request for all the "now playing" nodes) where the
  firmware supports it, with a fallback to single GETs.
- The station artwork (`graphicUri`) as the widget image, fetched by the
  integration (needs care: an address chosen by the radio's stream).
- The equalizer presets and the sleep timer (`sys.caps.eqPresets`,
  `sys.sleep`), an alarm clock view.
- Browsing the radio's menus (`nav.list`) from a widget form.
- A per-radio PIN when several radios have different PINs.
- An SSDP scan when a created radio stays offline, to follow a new address
  without a manual Discovery.
