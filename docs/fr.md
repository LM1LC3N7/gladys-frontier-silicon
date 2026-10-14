# Radios Frontier Silicon

**Connecteur non officiel, sans lien avec Frontier Smart Technologies ni avec
les marques des radios.** Il fait entrer dans Gladys les radios internet
équipées d'un module Frontier Silicon : Roberts, Hama, Medion, Revo, Lenco,
Auna et bien d'autres, en général celles que pilote l'application **UNDOK**.
Tout reste sur votre réseau local : ni compte, ni cloud.

**Testeurs recherchés** : cette première version a été écrite sans radio
sous la main, d'après le protocole tel que l'intégration Home Assistant
l'utilise. Dites-nous sur le forum ce qui marche sur votre modèle, et ce qui
ne marche pas.

## Ce que vous obtenez

| Surface                     | Contenu                                                                                                                                                                                                                                                  |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Un appareil par **radio**   | alimentation, volume (l'échelle de la radio, 0-32 sur la plupart des modèles), sourdine, source (DAB, FM, radio internet, Spotify, Bluetooth, AUX… telles que la radio les liste), lecture, pause, précédent, suivant, état de lecture, lecture en cours |
| Déclencheur de scène        | **la lecture a changé** : la radio s'est mise à jouer, a changé de station ou de source, ou son titre a changé ; filtre sur la radio, sur « station » ou « titre », sur la source                                                                        |
| Actions de scène            | **jouer un préréglage** (son numéro sur la radio ou son nom, éventuellement sur une autre source d'abord), **changer de source**, **lecture en cours** (station, texte, artiste, album, volume…)                                                         |
| Widget                      | **Radio internet** : lecture en cours, volume, alimentation, et les préréglages en boutons                                                                                                                                                               |
| Boutons de la configuration | **Tester les radios**, **Lister les préréglages** d'une radio                                                                                                                                                                                            |

## Mise en route

1. Installez l'intégration et ouvrez **Découverte** : les radios qui
   répondent sur votre réseau sont listées (Gladys les interroge en SSDP).
   Ajoutez la vôtre.
2. Une radio manque ? Son adresse va dans **Adresses des radios** (une IP ou
   un nom d'hôte, plusieurs séparées par des virgules), puis relancez la
   recherche. Donnez une adresse fixe à vos radios dans votre box : une radio
   qui a changé d'adresse est retrouvée par une nouvelle recherche dans
   Découverte.
3. Le **code PIN** : les radios sortent d'usine avec 1234 ; laissez alors le
   champ vide. Si vous l'avez changé (menu Réglages > Réseau > Configuration
   PIN NetRemote), saisissez-le ici.
4. Placez le widget **Radio internet** sur un tableau de bord et choisissez
   une radio.

Chaque radio est lue toutes les 30 secondes (option **Intervalle de
rafraîchissement**), toutes les 5 secondes pendant une minute après une
commande. Certains modèles quittent le réseau en veille : ils apparaissent
**hors ligne** (et éteints) et sont réessayés une fois par minute, sans bruit.

## Scènes

- **La lecture a changé** : choisissez une radio (ou aucune pour toutes), et
  éventuellement ce qui a changé (**la station ou la source**, ou **le titre
  sur la même station**) et la source. Variables : le nom de la radio, la
  station ou le titre (`name`), le texte (le morceau en radio internet, le
  texte défilant en DAB), l'artiste, l'album, la source et un résumé sur une
  ligne. Les changements faits depuis Gladys (un préréglage joué par une
  scène, une source choisie depuis le tableau de bord) ne le déclenchent
  pas : une scène ne peut jamais boucler à travers la radio. En DAB, le texte
  défilant change souvent : filtrez sur « station » si seule la station vous
  intéresse.
- **Jouer un préréglage** : la radio, le préréglage (`3` comme sur la radio,
  ou un nom comme `France Inter`), et éventuellement la source à prendre
  d'abord (`DAB`, `FM`, `radio internet`… : chaque source a ses propres
  préréglages). La radio est allumée si besoin. Le bouton **Lister les
  préréglages** montre ce qu'une radio a enregistré.
- **Changer de source** : la radio et la source, par le nom que la radio
  affiche ou `DAB`, `FM`, `radio internet`, `Spotify`, `Bluetooth`, `AUX`.
- **Lecture en cours** donne `{{power}}`, `{{playing}}`, `{{name}}`,
  `{{text}}`, `{{artist}}`, `{{summary}}`, `{{volume}}`… pour un message ou
  une condition.

L'action générique **Contrôler un appareil** pilote aussi l'alimentation, le
volume, la source et les boutons de lecture. **Sourdine** est affichée par
Gladys comme un bouton : chaque appui active ou coupe la sourdine.

## Bon à savoir

- Aucune session n'est ouverte sur la radio : l'application UNDOK continue de
  fonctionner à côté de Gladys (une session l'expulserait, les radios n'en
  acceptent qu'une).
- Les préréglages ne sont lus qu'au besoin (le widget, une scène, le bouton),
  jamais en tâche de fond : les lire met la radio en mode « navigation »,
  comme le fait l'application UNDOK.
- Les radios traitent une requête à la fois : Gladys n'en envoie jamais deux
  en même temps, et attend un instant après chaque changement.

## Dépannage

- **Aucune radio dans Découverte** : la recherche demande un réseau qui
  laisse passer le multicast (pas de VLAN entre Gladys et la radio) ;
  saisissez plutôt l'adresse de la radio dans la configuration. Vérifiez qu'elle répond : **Tester les
  radios**.
- **« refuse le code PIN »** : saisissez le PIN de la radio dans la
  configuration.
- **Hors ligne** : la radio est débranchée, en veille profonde (certains
  modèles coupent leur Wi-Fi ; cherchez une option « veille réseau » ou
  « garder le réseau connecté » dans leur menu), ou elle a changé d'adresse :
  relancez la recherche dans Découverte.
- Journaux : le niveau de log de l'intégration se règle avec la variable
  `LOG_LEVEL`. Le code PIN n'y apparaît jamais.

## Confidentialité

L'intégration ne parle qu'à vos radios, sur votre réseau local. Rien ne
quitte votre maison.
