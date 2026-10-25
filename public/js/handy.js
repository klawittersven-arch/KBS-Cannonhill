// Spieler-Seite: Anmeldung, Lobby, eigene Partie (Qualifying/Finale) und Ergebnisse.

import { verbinde, neueId, speicher } from './verbindung.js';
import { NetzSpiel } from './spiel/netzspiel.js';
import { Zeichner, ladeBilder, steinTextur } from './spiel/zeichner.js';
import { KANONE, MUNITIONEN, M_SPLITTER, MAX_LEBENSENERGIE, BILDER_PRO_SEKUNDE, SPIELERFARBEN } from './spiel/regeln.js';

const $ = (id) => document.getElementById(id);
const NAME_MUSTER = /^\p{L}[\p{L}' -]{0,14}$/u;
const FARBNAMEN = ['Rot', 'Grün', 'Blau', 'Gelb', 'Orange', 'Lila', 'Türkis', 'Pink'];

const zustand = {
  raum: (new URLSearchParams(location.search).get('raum') || '').trim(),
  id: null,
  nr: null,
  name: '',
  verbindung: null,
  letzteAntwort: 0,
  turnier: null, // letzte Nachricht 'turnier'
  netz: null, // laufende NetzSpiel-Partie
  ergebnis: null, // Ergebnis der eigenen Partie
  zeichner: null,
  wachSperre: null,
  eingabeGeplant: false,
};
const bilderLaden = ladeBilder().catch(() => null);

// --- Anmeldung -----------------------------------------------------------------------

function start() {
  if (/^\d{4}$/.test(zustand.raum)) {
    $('raum-anzeige').textContent = `Raum ${zustand.raum}`;
    $('raum-feld').hidden = true;
  }
  $('feld-raum').value = zustand.raum;
  $('feld-vorname').value = speicher.lies('kbs-vorname') || '';
  $('feld-initial').value = speicher.lies('kbs-initial') || '';
  const gespeicherteId = /^\d{4}$/.test(zustand.raum) ? speicher.lies(`kbs-id-${zustand.raum}`) : null;
  if (gespeicherteId && $('feld-vorname').value && $('feld-initial').value) {
    zustand.id = gespeicherteId;
    halteWach();
    tritBei($('feld-vorname').value, $('feld-initial').value);
  } else {
    zeige('anmeldung');
  }
}

$('anmelde-form').addEventListener('submit', (ereignis) => {
  ereignis.preventDefault();
  const raum = $('feld-raum').value.trim();
  const vorname = $('feld-vorname').value.replace(/\s+/g, ' ').trim();
  const initial = $('feld-initial').value.trim();
  const fehler = $('anmelde-fehler');
  if (!/^\d{4}$/.test(raum)) return void (fehler.textContent = 'Der Raumcode hat 4 Ziffern – er steht am Beamer.');
  if (!NAME_MUSTER.test(vorname)) return void (fehler.textContent = 'Bitte deinen Vornamen eingeben (nur Buchstaben).');
  if (!/^\p{L}$/u.test(initial)) return void (fehler.textContent = 'Bitte den ersten Buchstaben deines Nachnamens eingeben.');
  fehler.textContent = '';
  if (raum !== zustand.raum) {
    zustand.raum = raum;
    $('raum-anzeige').textContent = `Raum ${raum}`;
    history.replaceState(null, '', `?raum=${raum}`);
  }
  speicher.schreib('kbs-vorname', vorname);
  speicher.schreib('kbs-initial', initial);
  zustand.id = speicher.lies(`kbs-id-${raum}`) || neueId();
  if (vollbildApi) vollbildAn(); // der Fingertipp auf „Los geht's“ erlaubt das Vollbild
  halteWach();
  tritBei(vorname, initial);
});

function tritBei(vorname, initial) {
  speicher.schreib(`kbs-id-${zustand.raum}`, zustand.id);
  setzeName(`${vorname} ${initial.toUpperCase()}.`);
  $('lobby-text').textContent = 'Verbinde …';
  zeige('lobby');
  zustand.verbindung?.beende();
  zustand.verbindung = verbinde({
    pfad: `/spiel/${zustand.raum}`,
    beimOeffnen: () => {
      zustand.letzteAntwort = performance.now();
      sende({ typ: 'hallo', rolle: 'handy', id: zustand.id, vorname, initial });
    },
    beiNachricht: verarbeite,
    beiStatus: (status) => ($('verbindung').className = `punkt ${status}`),
  });
}

function sende(nachricht) {
  return zustand.verbindung?.sende(nachricht) ?? false;
}

function setzeName(name) {
  zustand.name = name;
  document.querySelectorAll('.mein-name').forEach((el) => (el.textContent = name));
}

// --- Nachrichten vom Server ---------------------------------------------------------

function verarbeite(n) {
  zustand.letzteAntwort = performance.now();
  switch (n.typ) {
    case 't':
      if (zustand.netz && n.s === zustand.netz.id) zustand.netz.takt(n.n, n.e);
      return;
    case 'willkommen':
      zustand.nr = n.nr;
      setzeName(n.name);
      $('lobby-text').textContent = 'Du bist drin. Gleich geht\'s los – schau auf den Beamer.';
      return;
    case 'turnier':
      zustand.turnier = n;
      return zeigePhase();
    case 'spiel':
      return starteSpiel(n);
    case 'ergebnis':
      if (zustand.netz && n.s === zustand.netz.id) zustand.ergebnis = n;
      return;
    case 'abgelehnt':
      zustand.verbindung?.beende();
      speicher.loesche(`kbs-id-${zustand.raum}`);
      $('anmelde-fehler').textContent = n.grund || 'Anmeldung nicht möglich.';
      return zeige('anmeldung');
    case 'entfernt':
      zustand.verbindung?.beende();
      speicher.loesche(`kbs-id-${zustand.raum}`);
      zustand.id = neueId();
      $('anmelde-fehler').textContent = 'Die Lehrkraft hat dich aus dem Raum genommen. Du kannst dich neu anmelden.';
      return zeige('anmeldung');
  }
}

/** Welche Ansicht passt zu Phase und Rolle? */
function zeigePhase() {
  const t = zustand.turnier;
  if (!t) return;
  if (t.phase === 'siegerehrung') {
    beendeSpiel();
    return t.ichBinSieger
      ? info('🏆', 'Du hast gewonnen!', 'Glückwunsch – du bist Turniersieger!')
      : info('🏆', `${t.sieger} gewinnt!`, 'Applaus für den Turniersieger! Schau auf den Beamer.');
  }
  if (t.phase === 'lobby') {
    beendeSpiel();
    $('lobby-text').textContent = 'Du bist drin. Gleich geht\'s los – schau auf den Beamer.';
    return zeige('lobby');
  }
  if (t.rolle === 'spieler') {
    if (zustand.netz && zustand.netz.id === t.partie) return zeige('spiel');
    $('lobby-text').textContent = 'Gleich geht\'s los …';
    return zeige('lobby');
  }
  beendeSpiel();
  if (t.phase === 'finale') return info('🏆', 'Finale!', 'Schau auf den Beamer – wer holt sich den Pokal?');
  return info('⏳', 'Das Turnier läuft schon', 'Beim nächsten Turnier bist du dabei. Schau solange auf den Beamer.');
}

function info(bild, titel, text) {
  $('info-bild').textContent = bild;
  $('info-titel').textContent = titel;
  $('info-text').textContent = text;
  zeige('info');
}

function zeige(ansicht) {
  const imSpiel = ansicht === 'spiel';
  document.body.classList.toggle('im-spiel', imSpiel);
  $('rahmen').hidden = imSpiel;
  $('spielansicht').hidden = !imSpiel;
  for (const id of ['anmeldung', 'lobby', 'info']) $(id).hidden = id !== ansicht;
  if (imSpiel) zustand.zeichner?.passeGroesseAn();
  zeigeVollbildKnoepfe();
  dreheQuer(imSpiel);
}

// --- Die eigene Partie ---------------------------------------------------------------

async function starteSpiel(daten) {
  const bilder = await bilderLaden;
  if (!bilder) return info('⚠️', 'Bilder konnten nicht laden', 'Bitte Seite neu laden.');
  const textur = steinTextur(bilder);
  if (!zustand.zeichner) zustand.zeichner = new Zeichner($('spiel'), bilder, { namenPx: 8 });
  zustand.zeichner.eigeneNr = zustand.nr;

  if (zustand.netz && zustand.netz.id === daten.s) {
    zustand.netz.baueAuf(daten); // Wiedereinstieg: alles nachrechnen
  } else {
    zustand.ergebnis = null;
    zustand.gewaehlteMunition = null;
    zustand.netz = new NetzSpiel(daten, {
      steinTextur: textur,
      beiEnde: (e) => sende({ typ: 'ende', s: daten.s, ...e }),
      nachTakt: (spiel, n) => {
        if (n % 20 === 0) sende({ typ: 'lage', s: daten.s, n, p: spiel.panzer.map((p) => [p.nr, p.energie, p.aktiv ? 1 : 0]) });
      },
      nachBild: (spiel) => zustand.zeichner.nachBild(spiel),
      lueckeEntdeckt: () => sende({ typ: 'nachholen', s: daten.s }),
    });
  }
  if (daten.ergebnis) zustand.ergebnis = { s: daten.s, art: daten.art, sieger: daten.ergebnis.sieger, name: daten.spieler.find((p) => p.nr === daten.ergebnis.sieger)?.name };
  zustand.startZeit = performance.now() + (daten.startInMs || 0);

  const spiel = zustand.netz.spiel;
  const ich = spiel.panzer.findIndex((p) => p.nr === zustand.nr);
  const p = spiel.panzer[ich];
  $('partie-name').textContent = daten.name;
  $('meine-farbe').textContent = ich >= 0 ? `Du bist ${FARBNAMEN[ich]}` : '';
  $('meine-farbe').style.setProperty('--farbe', ich >= 0 ? `rgb(${SPIELERFARBEN[ich].join(',')})` : 'transparent');
  if (p) {
    $('winkel').value = p.kanone;
    $('kraft').value = p.kraft;
  }
  baueMunition(spiel);
  // Erst umschalten, wenn der Server diese Partie auch als unsere meldet –
  // sonst räumt ein noch alter Stand (z. B. „Lobby“) das neue Spiel wieder ab.
  if (zustand.turnier?.partie === daten.s) zeigePhase();
}

function beendeSpiel() {
  zustand.netz = null;
  zustand.ergebnis = null;
}

function baueMunition(spiel) {
  const feld = $('munition');
  feld.hidden = !spiel.alleWaffen;
  if (!spiel.alleWaffen) return;
  feld.replaceChildren(
    ...MUNITIONEN.map((m, nr) => {
      if (nr === 0 || nr === M_SPLITTER) return '';
      const knopf = document.createElement('button');
      knopf.className = 'munknopf';
      knopf.dataset.mun = nr;
      knopf.title = m.name;
      const bild = document.createElement('span');
      bild.className = 'munbild';
      const zeile = m.name === 'Gewehr' || m.name === 'Säurefass' ? 8 : 0;
      bild.style.backgroundPosition = `${-m.bild * 30}px ${-zeile * 30}px`;
      const zahl = document.createElement('span');
      zahl.className = 'munzahl';
      knopf.append(bild, zahl);
      knopf.addEventListener('click', () => {
        zustand.gewaehlteMunition = nr;
        planeEingabe();
      });
      return knopf;
    }),
  );
}

// Eingaben höchstens zehnmal pro Sekunde senden
function planeEingabe() {
  if (zustand.eingabeGeplant) return;
  zustand.eingabeGeplant = true;
  setTimeout(() => {
    zustand.eingabeGeplant = false;
    const netz = zustand.netz;
    if (!netz) return;
    const nachricht = { typ: 'e', s: netz.id, w: Number($('winkel').value), k: Number($('kraft').value) };
    if (zustand.gewaehlteMunition) nachricht.m = zustand.gewaehlteMunition;
    sende(nachricht);
  }, 100);
}

$('winkel').addEventListener('input', planeEingabe);
$('kraft').addEventListener('input', planeEingabe);
document.querySelectorAll('[data-schritt]').forEach((knopf) => {
  knopf.addEventListener('click', () => {
    const feld = $(knopf.dataset.schritt);
    feld.value = Number(feld.value) + Number(knopf.dataset.wert);
    planeEingabe();
  });
});

// --- Anzeige ------------------------------------------------------------------------------

function schleife(jetzt) {
  requestAnimationFrame(schleife);
  const netz = zustand.netz;
  if (!netz || $('spielansicht').hidden) return;
  netz.laufe(jetzt);
  zustand.zeichner.zeichne(netz.spiel);
  aktualisiereAnzeige(netz.spiel);
}
requestAnimationFrame(schleife);

function aktualisiereAnzeige(spiel) {
  const p = spiel.panzer.find((q) => q.nr === zustand.nr);
  const [kx, ky] = KANONE[Number($('winkel').value)];
  $('winkel-wert').textContent = `${Math.round(Math.atan2(-ky, kx) * (180 / Math.PI))}°`;
  $('kraft-wert').textContent = $('kraft').value;
  $('energie-wert').textContent = p ? `${Math.round((Math.max(0, p.energie) / MAX_LEBENSENERGIE) * 100)} %` : '–';

  const vorStart = spiel.bild === 0;
  if (vorStart) {
    const sekunden = Math.max(0, Math.ceil((zustand.startZeit - performance.now()) / 1000));
    $('salve-zahl').textContent = sekunden ? String(sekunden) : '…';
  } else if (spiel.bilderBisSalve != null && spiel.phase === 'laeuft') {
    $('salve-zahl').textContent = (spiel.bilderBisSalve / BILDER_PRO_SEKUNDE).toFixed(1).replace('.', ',');
  } else {
    $('salve-zahl').textContent = '–';
  }

  if (spiel.alleWaffen && p) {
    for (const knopf of $('munition').children) {
      const nr = Number(knopf.dataset.mun);
      const anzahl = p.lager[nr];
      knopf.querySelector('.munzahl').textContent = anzahl === -1 ? '∞' : anzahl;
      knopf.hidden = anzahl === 0;
      knopf.classList.toggle('gewaehlt', nr === (zustand.gewaehlteMunition ?? p.munition));
    }
  }

  // Hinweise über dem Spielfeld
  $('hinweis-vollbild').hidden = !(vorStart && vollbildNoetig());
  const e = zustand.ergebnis;
  if (vorStart) {
    hinweis('🎯', 'Gleich geht\'s los!', 'Winkel und Kraft einstellen – alle 3 Sekunden wird automatisch gefeuert.');
  } else if (e) {
    const finale = e.art === 'finale';
    if (e.sieger === zustand.nr) hinweis('🏆', finale ? 'Du bist Turniersieger!' : 'Du hast gewonnen!', finale ? 'Glückwunsch!' : 'Du bist im Finale – schau gleich auf den Beamer.');
    else hinweis('🏆', `${e.name} gewinnt!`, finale ? 'Gleich kommt die Siegerehrung.' : 'Gleich kommt das Finale auf dem Beamer.');
  } else if (p && !p.aktiv) {
    hinweis('💥', 'Du bist raus', 'Schau zu, wer gewinnt.');
  } else {
    $('spiel-hinweis').hidden = true;
  }
}

function hinweis(bild, titel, text) {
  $('hinweis-bild').textContent = bild;
  $('hinweis-titel').textContent = titel;
  $('hinweis-text').textContent = text;
  $('spiel-hinweis').hidden = false;
}

// --- Vollbild -------------------------------------------------------------------------------
// Browser erlauben Vollbild nur nach einem Fingertipp. Android/Chrome: requestFullscreen.
// iPhone: Safari kann das nicht – dort hilft nur „Zum Home-Bildschirm“ (siehe manifest).

const vollbildApi = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
const alsApp = matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches || navigator.standalone === true;
const iPhone = /iPhone|iPod/.test(navigator.userAgent);

function imVollbild() {
  return alsApp || !!(document.fullscreenElement || document.webkitFullscreenElement);
}

function vollbildNoetig() {
  return !imVollbild() && (vollbildApi || iPhone);
}

/** Muss direkt aus einem Fingertipp heraus aufgerufen werden. */
function vollbildAn() {
  if (imVollbild()) return;
  if (!vollbildApi) {
    if (iPhone) $('iphone-hilfe').showModal();
    return;
  }
  const wurzel = document.documentElement;
  const anfrage = wurzel.requestFullscreen ? wurzel.requestFullscreen({ navigationUI: 'hide' }) : wurzel.webkitRequestFullscreen?.();
  Promise.resolve(anfrage)
    .then(() => dreheQuer(!$('spielansicht').hidden))
    .catch(() => {});
}

function zeigeVollbildKnoepfe() {
  const noetig = vollbildNoetig();
  document.querySelectorAll('[data-vollbild]').forEach((knopf) => {
    if (knopf.id !== 'hinweis-vollbild') knopf.hidden = !noetig;
  });
}

/** Im Spiel quer drehen (geht nur im Vollbild, z. B. auf Android). */
function dreheQuer(an) {
  try {
    if (an && document.fullscreenElement) screen.orientation?.lock?.('landscape')?.catch?.(() => {});
    else if (!an) screen.orientation?.unlock?.();
  } catch {
    // nicht unterstützt
  }
}

document.querySelectorAll('[data-vollbild]').forEach((knopf) => knopf.addEventListener('click', vollbildAn));
if (!vollbildApi && iPhone) {
  document.querySelectorAll('.vollbild-knopf').forEach((knopf) => (knopf.textContent = '⛶ Vollbild auf dem iPhone'));
}
document.addEventListener('fullscreenchange', zeigeVollbildKnoepfe);
document.addEventListener('webkitfullscreenchange', zeigeVollbildKnoepfe);

// --- Verbindung wach halten -----------------------------------------------------------

setInterval(() => {
  const verbindung = zustand.verbindung;
  if (!verbindung?.offen) return;
  sende({ typ: 'ping', t: performance.now() });
  if (performance.now() - zustand.letzteAntwort > 6000) verbindung.erneuern();
}, 1000);

async function halteWach() {
  if (!('wakeLock' in navigator)) return;
  if (zustand.wachSperre && !zustand.wachSperre.released) return;
  try {
    zustand.wachSperre = await navigator.wakeLock.request('screen');
  } catch {
    // dann eben ohne
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  zustand.verbindung?.jetztNeu();
  if (zustand.verbindung) halteWach();
});
document.addEventListener('pointerdown', () => zustand.verbindung && halteWach());
window.addEventListener('resize', () => zustand.zeichner?.passeGroesseAn());

start();
