# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Fixed

- Docs: the outputs of the scene actions come from the variable list
  (`{{<step>.<action>.<key>}}`), not `{{<key>}}`.

## [0.1.1] - 2026-10-14

### Added

- One device per Frontier Silicon radio (Roberts, Hama, Medion, Revo,
  Lenco...), found in Discovery through SSDP or typed by address: power,
  volume on the radio's own scale, mute, source (the modes the radio lists:
  DAB, FM, internet radio, Spotify, Bluetooth, AUX...), play, pause,
  previous, next, playback state and now playing.
- Local only, FSAPI with the radio's PIN and without a session, so the
  UNDOK app keeps working; one request at a time per radio, read every 30 s
  (every 5 s for a minute after a command), calm "offline" state for the
  radios that leave the network in standby.
- Scene trigger "now playing changed" (filters: radio, station or title,
  source), silent for the changes made through Gladys.
- Scene actions "play a preset" (by number or name, optionally in another
  source first), "change the source" and "now playing".
- Dashboard widget "Internet radio": now playing, volume, power and the
  presets as buttons.
- "Test the radios" and "List the presets" buttons.

[Unreleased]: https://github.com/LM1LC3N7/gladys-frontier-silicon/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/LM1LC3N7/gladys-frontier-silicon/releases/tag/v0.1.1
