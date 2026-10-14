// -----------------------------------------------------------------------------
// Runtime texts shown in Gladys (connection status, buttons, widget, errors).
// -----------------------------------------------------------------------------

const plural = (n, one, many) => (n === 1 ? one : many);

export const T = {
  ok: ({ total, online }) =>
    online === total
      ? {
          en: `${total} ${plural(total, 'radio answers', 'radios answer')} on the local network.`,
          fr: `${total} ${plural(total, 'radio répond', 'radios répondent')} sur le réseau local.`,
        }
      : {
          en: `${online} of ${total} radios answer; the others are asleep or unplugged (some models leave the network in standby).`,
          fr: `${online} radio(s) sur ${total} répondent ; les autres sont en veille profonde ou débranchées (certains modèles quittent le réseau en veille).`,
        },
  noRadio: {
    en: 'No radio yet: open Discovery (radios answering SSDP, plus the addresses typed in the configuration) and add yours.',
    fr: 'Aucune radio pour l’instant : ouvrez Découverte (radios qui répondent en SSDP, plus les adresses saisies dans la configuration) et ajoutez la vôtre.',
  },
  pinRefused: (names) => ({
    en: `${names.join(', ')} refused the PIN: set the radio's PIN (Settings > Network > NetRemote PIN, 1234 by default) in the configuration.`,
    fr: `${names.join(', ')} refuse le code PIN : saisissez le PIN de la radio (Réglages > Réseau > NetRemote PIN, 1234 par défaut) dans la configuration.`,
  }),
  invalidHosts: (positions) => ({
    en: `Ignored address(es) in the configuration, position ${positions.join(', ')}: type an IP or a host name, with an optional :port.`,
    fr: `Adresse(s) ignorée(s) dans la configuration, position ${positions.join(', ')} : saisissez une IP ou un nom d'hôte, avec un :port facultatif.`,
  }),
  errors: {
    unknownRadio: 'Unknown radio: pick a radio device of this integration',
    readOnly: (key) => `${key} is read only`,
    unreachable: (name, message) => `${name} does not answer (${message}): is it plugged in?`,
    pin: (name) => `${name} refused the PIN: check it in the configuration`,
    noMode: 'No mode given',
    unknownMode: (query, modes) =>
      `Unknown mode "${query}" on this radio; available: ${modes.join(', ') || 'none'}`,
    noPreset: 'No preset given',
    unknownPreset: (query, presets) =>
      `No preset "${query}" in this mode; presets: ${presets.join(', ') || 'none'}`,
    refused: (name, message) => `${name} refused the command (${message})`,
  },
  test: {
    none: {
      en: 'No radio to test: create one from Discovery, or type its address in the configuration.',
      fr: 'Aucune radio à tester : créez-en une depuis Découverte, ou saisissez son adresse dans la configuration.',
    },
  },
  presets: {
    none: (name, mode) => ({
      en: `${name}: no preset stored in ${mode || 'this mode'}.`,
      fr: `${name} : aucun préréglage enregistré en ${mode || 'ce mode'}.`,
    }),
  },
  widget: {
    chooseRadio: {
      en: 'Pick a radio in the widget settings',
      fr: 'Choisissez une radio dans les réglages du widget',
    },
    notLoaded: { en: 'Waiting for the first reading…', fr: 'En attente de la première lecture…' },
    standby: { en: 'Standby', fr: 'En veille' },
    offline: {
      en: 'Offline: asleep, unplugged or out of reach',
      fr: 'Hors ligne : en veille profonde, débranchée ou injoignable',
    },
    pinRefused: { en: 'The radio refuses the PIN', fr: 'La radio refuse le code PIN' },
    nothing: { en: 'Nothing playing', fr: 'Rien en cours' },
    power: { en: 'Power', fr: 'Alimentation' },
    on: { en: 'On', fr: 'Allumée' },
    off: { en: 'Standby', fr: 'En veille' },
    unreachable: { en: 'Offline', fr: 'Hors ligne' },
    source: { en: 'Source', fr: 'Source' },
    playback: { en: 'Playback', fr: 'Lecture' },
    volume: { en: 'Volume', fr: 'Volume' },
    turnOn: { en: 'Turn on', fr: 'Allumer' },
    turnOff: { en: 'Standby', fr: 'Veille' },
    presets: { en: 'Presets…', fr: 'Préréglages…' },
    preset: { en: 'Preset', fr: 'Préréglage' },
    playing: (name) => ({ en: `Playing ${name}`, fr: `Lecture de ${name}` }),
    failed: (message) => ({ en: `Failed: ${message}`, fr: `Échec : ${message}` }),
    status: {
      0: { en: 'Idle', fr: 'Inactive' },
      1: { en: 'Buffering', fr: 'Chargement' },
      2: { en: 'Playing', fr: 'Lecture' },
      3: { en: 'Paused', fr: 'En pause' },
      4: { en: 'Buffering', fr: 'Chargement' },
      5: { en: 'Error', fr: 'Erreur' },
      6: { en: 'Stopped', fr: 'Arrêtée' },
      7: { en: 'Error', fr: 'Erreur' },
    },
  },
};
