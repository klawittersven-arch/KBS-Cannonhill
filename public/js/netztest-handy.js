import { verbinde, neueId, speicher } from './verbindung.js';
import {
  BREITE, HOEHE, LUFT, ERDE, GRAS,
  neueWelt, spieleTakt, pruefsumme, leistungstest, matheFingerabdruck,
} from './sim.js';
import { bewerte, median, perzentil } from './bewertung.js';
import { schuetzeVorZoomUndMarkieren } from './iphone.js';

schuetzeVorZoomUndMarkieren(); // iPhone: kein Doppeltipp-Zoom, kein Markieren beim Spielen

const $ = (id) => document.getElementById(id);
const ABSCHNITTE = ['anmeldung', 'lobby', 'test', 'fertig', 'meldung'];
const FARBEN = ['#e03131', '#1c7ed6', '#2b8a3e', '#f08c00', '#7048e8', '#0c8599', '#d6336c', '#5c940d'];
const NAME_MUSTER = /^\p{L}[\p{L}' -]{0,14}$/u;

const zustand = {
  raum: (new URLSearchParams(location.search).get('raum') || '').trim(),
  abschnitt: null,
  verbindung: null,
  id: null,
  nr: null,
  geraet: null,
  bench: null,
  pings: [],
  pingSperreBis: 0, // Pings während des Gerätetests zählen nicht
  letzteAntwort: 0,
  schonVerbunden: false,
  wachbleiben: 'offen',
  wachSperre: null,
};

/** Alles zum aktuellen Testdurchgang; wird bei jedem neuen Test neu angelegt. */
let lauf = null;

function zeige(abschnitt) {
  for (const id of ABSCHNITTE) $(id).hidden = id !== abschnitt;
  zustand.abschnitt = abschnitt;
  if (abschnitt === 'test') starteZeichnen();
}

function meldung(titel, text) {
  $('meldung-titel').textContent = titel;
  $('meldung-text').textContent = text;
  zeige('meldung');
}

function sende(nachricht) {
  return zustand.verbindung?.sende(nachricht) ?? false;
}

// --- Start und Anmeldung ---------------------------------------------------

async function start() {
  zustand.geraet = await erkenneGeraet();
  if (/^\d{4}$/.test(zustand.raum)) {
    $('raum-anzeige').textContent = `Raum ${zustand.raum}`;
    $('raum-feld').hidden = true;
  }
  $('feld-raum').value = zustand.raum;
  $('feld-vorname').value = speicher.lies('kbs-vorname') || '';
  $('feld-initial').value = speicher.lies('kbs-initial') || '';

  // Nach versehentlichem Neuladen direkt wieder rein – ohne erneute Eingabe.
  const gespeicherteId = /^\d{4}$/.test(zustand.raum) ? speicher.lies(`kbs-netztest-id-${zustand.raum}`) : null;
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
  zustand.id = speicher.lies(`kbs-netztest-id-${raum}`) || neueId();
  halteWach(); // hier mit Fingertipp – das brauchen manche Browser
  tritBei(vorname, initial);
});

function tritBei(vorname, initial) {
  speicher.schreib(`kbs-netztest-id-${zustand.raum}`, zustand.id);
  document.querySelectorAll('.mein-name').forEach((el) => (el.textContent = `${vorname} ${initial.toUpperCase()}.`));
  $('lobby-text').textContent = 'Verbinde …';
  zeige('lobby');
  zustand.verbindung?.beende();
  zustand.verbindung = verbinde({
    pfad: `/ws/${zustand.raum}`,
    beimOeffnen: () => {
      if (zustand.schonVerbunden && lauf && lauf.endTakt === null) lauf.abbrueche++;
      zustand.schonVerbunden = true;
      zustand.letzteAntwort = performance.now();
      sende({ typ: 'hallo', rolle: 'handy', id: zustand.id, vorname, initial, geraet: zustand.geraet });
    },
    beiNachricht: verarbeite,
    beiStatus: (status) => ($('verbindung').className = `punkt ${status}`),
  });
}

// --- Nachrichten vom Server -----------------------------------------------

function verarbeite(n) {
  zustand.letzteAntwort = performance.now();
  switch (n.typ) {
    case 't':
      return takt(n);
    case 'pong':
      return pong(n);
    case 'willkommen':
      zustand.nr = n.nr;
      document.querySelectorAll('.mein-name').forEach((el) => (el.textContent = n.name));
      $('lobby-text').textContent = 'Du bist drin. Schau auf den Beamer – gleich startet der Test.';
      if (zustand.abschnitt === 'anmeldung' || zustand.abschnitt === 'meldung') zeige('lobby');
      if (zustand.bench) sende({ typ: 'bench', daten: zustand.bench });
      else setTimeout(pruefeGeraet, 300);
      return;
    case 'test':
      return testStand(n);
    case 'lobby':
      if (zustand.abschnitt === 'meldung') zeige('lobby');
      return;
    case 'abgelehnt':
      zustand.verbindung?.beende();
      speicher.loesche(`kbs-netztest-id-${zustand.raum}`);
      $('anmelde-fehler').textContent = n.grund || 'Anmeldung nicht möglich.';
      return zeige('anmeldung');
    case 'entfernt':
      zustand.verbindung?.beende();
      speicher.loesche(`kbs-netztest-id-${zustand.raum}`);
      zustand.id = neueId();
      $('anmelde-fehler').textContent = 'Die Lehrkraft hat dich aus dem Raum genommen. Du kannst dich neu anmelden.';
      return zeige('anmeldung');
  }
}

function pong(n) {
  if (typeof n.t !== 'number' || n.t < zustand.pingSperreBis) return;
  zustand.pings.push(performance.now() - n.t);
  if (zustand.pings.length > 120) zustand.pings.shift();
}

// Ping jede Sekunde; antwortet der Server 6 Sekunden lang nicht, Verbindung neu aufbauen.
setInterval(() => {
  const verbindung = zustand.verbindung;
  if (!verbindung?.offen) return;
  sende({ typ: 'ping', t: performance.now() });
  if (performance.now() - zustand.letzteAntwort > 6000) verbindung.erneuern();
}, 1000);

// Messwerte alle 2 Sekunden an den Server (für die Beamer-Anzeige).
setInterval(() => {
  if (zustand.verbindung?.offen) sende({ typ: 'werte', daten: sammleWerte() });
  zeigeWerte();
}, 2000);

// --- Gerätetest -----------------------------------------------------------

function pruefeGeraet() {
  if (zustand.bench) return;
  const ergebnis = leistungstest();
  zustand.bench = { ...ergebnis, mathe: matheFingerabdruck() };
  zustand.pingSperreBis = performance.now();
  $('lobby-bench').textContent = ergebnis.korrekt
    ? `✓ ${formatiere(ergebnis.msProSchritt, 1)} ms`
    : '⚠ rechnet abweichend';
  sende({ typ: 'bench', daten: zustand.bench });
}

// --- Gleichtakt-Test -------------------------------------------------------

function neuerLauf(gruppe) {
  const farben = new Map();
  gruppe.mitglieder.forEach((m, i) => farben.set(m.nr, FARBEN[i % FARBEN.length]));
  return {
    seed: gruppe.seed,
    gruppe,
    farben,
    welt: null,
    verarbeitet: 0,
    endTakt: null,
    nachholen: false,
    ergebnisGesendet: false,
    endeZeit: 0,
    zuletztGesehen: new Map(),
    gesendet: new Map(),
    folge: 0,
    zielX: Math.floor(Math.random() * BREITE),
    letzterTipp: 0,
    eingabeZeitgeber: null,
    verzoegerungen: [],
    ankunft: null,
    intervalle: [],
    haenger: 0,
    maxLuecke: 0,
    fehlend: 0,
    taktAnzahl: 0,
    warVersteckt: false,
    versteckt: 0,
    abbrueche: 0,
    fpsWerte: [],
    blitze: [],
    neuZeichnen: true,
  };
}

function testStand(n) {
  if (n.phase === 'zuschauen') {
    if (!lauf || lauf.endTakt !== null) {
      meldung('Test läuft gerade', 'Beim nächsten Durchgang bist du dabei. Schau solange auf den Beamer.');
    }
    return;
  }

  // Nur die Ende-Markierung (ohne Gruppe): ausrechnen, sobald alle Takte da sind.
  if (!n.gruppe) {
    if (!lauf) return;
    lauf.endTakt = n.n;
    if (lauf.verarbeitet === n.n) pruefeEnde();
    else fordereNachholen();
    return;
  }

  if (!lauf || lauf.seed !== n.gruppe.seed) {
    beendeEingaben();
    lauf = neuerLauf(n.gruppe);
    zustand.pings = [];
  } else {
    lauf.gruppe = n.gruppe;
  }
  baueNeu(n.verlauf);
  lauf.nachholen = false;
  zeigeMitglieder();

  if (n.phase === 'laeuft') {
    lauf.endeZeit = performance.now() + (n.restMs || 0);
    $('gruppenname').textContent = n.gruppe.name;
    zeige('test');
    if (lauf.verarbeitet > 0) starteEingaben();
  } else {
    lauf.endTakt = n.n;
    pruefeEnde();
  }
}

/** Baut die Landschaft aus Startwert und Schuss-Verlauf neu auf (Einstieg, Nachholen). */
function baueNeu(verlauf) {
  const welt = neueWelt(lauf.seed);
  const schuesse = new Map();
  for (const [takt, liste] of verlauf?.feuer || []) schuesse.set(takt, liste);
  const bis = verlauf?.bis || 0;
  for (let t = 1; t <= bis; t++) spieleTakt(welt, schuesse.get(t) || []);
  lauf.welt = welt;
  lauf.verarbeitet = bis;
  lauf.neuZeichnen = true;
}

function fordereNachholen() {
  if (!lauf || lauf.nachholen) return;
  lauf.nachholen = true;
  sende({ typ: 'nachholen' });
}

function takt(n) {
  if (!lauf || !lauf.welt) return;
  const jetzt = performance.now();
  if (lauf.ankunft !== null && !lauf.warVersteckt) {
    const abstand = jetzt - lauf.ankunft;
    lauf.intervalle.push(abstand);
    if (abstand > 250) lauf.haenger++;
    if (abstand > lauf.maxLuecke) lauf.maxLuecke = abstand;
  }
  lauf.warVersteckt = false;
  lauf.ankunft = jetzt;
  lauf.taktAnzahl++;

  if (n.n <= lauf.verarbeitet || lauf.nachholen) return;
  if (n.n !== lauf.verarbeitet + 1) {
    lauf.fehlend += n.n - lauf.verarbeitet - 1;
    fordereNachholen();
    return;
  }

  const schuesse = [];
  for (const [nr, folge, x, feuer] of n.e) {
    lauf.zuletztGesehen.set(nr, jetzt);
    if (nr === zustand.nr && lauf.gesendet.has(folge)) {
      lauf.verzoegerungen.push(jetzt - lauf.gesendet.get(folge));
      lauf.gesendet.delete(folge);
    }
    if (feuer === 1) schuesse.push([nr, x]);
  }
  for (const [nr, x, y] of spieleTakt(lauf.welt, schuesse)) lauf.blitze.push({ nr, x, y, zeit: jetzt });
  lauf.verarbeitet = n.n;
  lauf.neuZeichnen = true;

  if (n.n % 100 === 0) sende({ typ: 'pz', n: n.n, h: pruefsumme(lauf.welt) });
  starteEingaben();
  if (lauf.endTakt !== null) pruefeEnde();
}

function pruefeEnde() {
  if (!lauf || lauf.endTakt === null || lauf.ergebnisGesendet || lauf.verarbeitet !== lauf.endTakt) return;
  lauf.ergebnisGesendet = true;
  beendeEingaben();
  sende({ typ: 'ergebnis', n: lauf.endTakt, h: pruefsumme(lauf.welt) });
  sende({ typ: 'werte', daten: sammleWerte() });
  zeigeFertig();
}

// Zehnmal pro Sekunde eine Eingabe – so viel wie beim Zielen im echten Spiel.
function starteEingaben() {
  if (!lauf || lauf.endTakt !== null || lauf.eingabeZeitgeber) return;
  lauf.eingabeZeitgeber = setInterval(() => {
    if (!lauf || document.hidden) return;
    lauf.zielX = (lauf.zielX + Math.floor(Math.random() * 21) - 10 + BREITE) % BREITE;
    sendeEingabe(lauf.zielX, lauf.folge % 30 === 29 ? 1 : 0);
  }, 100);
}

function beendeEingaben() {
  if (lauf?.eingabeZeitgeber) clearInterval(lauf.eingabeZeitgeber);
  if (lauf) lauf.eingabeZeitgeber = null;
}

function sendeEingabe(x, feuer) {
  lauf.folge++;
  if (!sende({ typ: 'e', s: lauf.folge, x, f: feuer })) return;
  lauf.gesendet.set(lauf.folge, performance.now());
  if (lauf.gesendet.size > 100) lauf.gesendet.delete(lauf.gesendet.keys().next().value);
}

$('landschaft').addEventListener('pointerdown', (ereignis) => {
  if (!lauf || lauf.endTakt !== null || lauf.verarbeitet === 0) return;
  const jetzt = performance.now();
  if (jetzt - lauf.letzterTipp < 300) return;
  lauf.letzterTipp = jetzt;
  const flaeche = ereignis.currentTarget.getBoundingClientRect();
  const x = Math.floor(((ereignis.clientX - flaeche.left) / flaeche.width) * BREITE);
  sendeEingabe(Math.max(0, Math.min(BREITE - 1, x)), 1);
});

// --- Anzeige ---------------------------------------------------------------

function zeigeMitglieder() {
  const liste = $('mitglieder');
  liste.replaceChildren(
    ...lauf.gruppe.mitglieder.map((m) => {
      const eintrag = document.createElement('li');
      eintrag.dataset.nr = m.nr;
      if (m.nr === zustand.nr) eintrag.classList.add('ich');
      const farbe = document.createElement('span');
      farbe.className = 'farbe';
      farbe.style.background = lauf.farben.get(m.nr);
      eintrag.append(farbe, m.name);
      return eintrag;
    }),
  );
}

// Countdown und "wer ist still?" viermal pro Sekunde aktualisieren.
setInterval(() => {
  if (!lauf || zustand.abschnitt !== 'test') return;
  const rest = Math.max(0, Math.ceil((lauf.endeZeit - performance.now()) / 1000));
  $('countdown').textContent = lauf.verarbeitet === 0 ? 'gleich …' : `${rest} s`;
  const jetzt = performance.now();
  for (const eintrag of $('mitglieder').children) {
    const gesehen = lauf.zuletztGesehen.get(Number(eintrag.dataset.nr));
    eintrag.classList.toggle('still', lauf.verarbeitet > 20 && (!gesehen || jetzt - gesehen > 1000));
  }
}, 250);

function zeigeWerte() {
  const w = sammleWerte();
  const ping = w.ping.med === null ? '–' : `${w.ping.med} ms`;
  $('lobby-ping').textContent = ping;
  $('test-ping').textContent = ping;
  $('test-verz').textContent = w.eingabe?.med != null ? `${w.eingabe.med} ms` : '–';
  $('test-fps').textContent = w.fps ? `${w.fps.schnitt}` : '–';
}

function zeigeFertig() {
  const werte = sammleWerte();
  const { stufe, gruende } = bewerte({ bench: zustand.bench, werte });
  const texte = {
    gut: 'Grün: Handy und Verbindung sind bereit.',
    mittel: 'Gelb: Geht, mit kleinen Verzögerungen.',
    schlecht: 'Rot: Hier hakte es.',
    offen: 'Noch keine Messwerte.',
  };
  $('fertig-punkt').className = `punkt ${stufe}`;
  $('fertig-text').textContent = texte[stufe] + (gruende.length ? ` (${gruende.join(', ')})` : '');
  const felder = [
    ['Ping', werte.ping.med != null ? `${werte.ping.med} ms` : '–'],
    ['Verzögerung', werte.eingabe?.med != null ? `${werte.eingabe.med} ms` : '–'],
    ['Hänger', werte.takt ? String(werte.takt.haenger) : '–'],
    ['Bilder/s', werte.fps ? `${werte.fps.min}–${werte.fps.schnitt}` : '–'],
  ];
  $('fertig-werte').replaceChildren(
    ...felder.map(([titel, wert]) => {
      const div = document.createElement('div');
      const dt = document.createElement('dt');
      const dd = document.createElement('dd');
      dt.textContent = titel;
      dd.textContent = wert;
      div.append(dt, dd);
      return div;
    }),
  );
  zeige('fertig');
}

function sammleWerte() {
  const pings = zustand.pings;
  const werte = {
    ping: { med: rund(median(pings)), p95: rund(perzentil(pings, 95)), n: pings.length },
    wachbleiben: zustand.wachbleiben,
  };
  if (lauf) {
    const v = lauf.verzoegerungen;
    werte.eingabe = { med: rund(median(v)), p95: rund(perzentil(v, 95)), n: v.length };
    werte.takt = {
      n: lauf.taktAnzahl,
      haenger: lauf.haenger,
      maxLuecke: Math.round(lauf.maxLuecke),
      jitter: rund(median(lauf.intervalle.map((i) => Math.abs(i - 50)))),
      fehlend: lauf.fehlend,
    };
    const fps = lauf.fpsWerte.slice(2); // die ersten Sekunden sind Anlaufzeit
    if (fps.length) {
      werte.fps = { schnitt: Math.round(fps.reduce((a, b) => a + b, 0) / fps.length), min: Math.round(Math.min(...fps)) };
    }
    werte.versteckt = lauf.versteckt;
    werte.abbrueche = lauf.abbrueche;
  }
  return werte;
}

// --- Zeichnen ----------------------------------------------------------------

const leinwand = $('landschaft');
const pinsel = leinwand.getContext('2d');
const bild = pinsel.createImageData(BREITE, HOEHE);
const pixel = new Uint32Array(bild.data.buffer);
const rgba = (r, g, b) => ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
const himmel = Array.from({ length: HOEHE }, (_, y) => {
  const t = y / HOEHE;
  return rgba(150 + 80 * t, 205 + 40 * t, 255);
});
const erde = [rgba(122, 75, 35), rgba(134, 85, 42), rgba(110, 66, 30)];
const gras = [rgba(61, 143, 55), rgba(76, 160, 66)];
const fels = [rgba(125, 135, 144), rgba(108, 117, 125)];
let zeichnetGerade = false;
let bilder = 0;
let fpsStart = 0;
let sekundeVersteckt = false;

function starteZeichnen() {
  if (zeichnetGerade) return;
  zeichnetGerade = true;
  bilder = 0;
  fpsStart = performance.now();
  requestAnimationFrame(zeichne);
}

function zeichne(zeit) {
  if (zustand.abschnitt !== 'test' || !lauf) {
    zeichnetGerade = false;
    return;
  }
  requestAnimationFrame(zeichne);

  bilder++;
  if (zeit - fpsStart >= 1000) {
    if (!sekundeVersteckt && lauf.verarbeitet > 0 && lauf.endTakt === null) {
      lauf.fpsWerte.push((bilder * 1000) / (zeit - fpsStart));
    }
    bilder = 0;
    fpsStart = zeit;
    sekundeVersteckt = false;
  }

  if (!lauf.welt || (!lauf.neuZeichnen && !lauf.blitze.length)) return;
  const feld = lauf.welt.feld;
  for (let y = 0, i = 0; y < HOEHE; y++) {
    for (let x = 0; x < BREITE; x++, i++) {
      const art = feld[i];
      pixel[i] = art === LUFT ? himmel[y] : art === ERDE ? erde[(x * 7 + y * 13) % 3] : art === GRAS ? gras[(x + y) & 1] : fels[(x * 3 + y) & 1];
    }
  }
  pinsel.putImageData(bild, 0, 0);

  const jetzt = performance.now();
  lauf.blitze = lauf.blitze.filter((b) => jetzt - b.zeit < 450);
  for (const blitz of lauf.blitze) {
    const t = (jetzt - blitz.zeit) / 450;
    pinsel.globalAlpha = 1 - t;
    pinsel.fillStyle = lauf.farben.get(blitz.nr) || '#ffffff';
    pinsel.beginPath();
    pinsel.arc(blitz.x + 0.5, blitz.y, 4 + t * 10, 0, Math.PI * 2);
    pinsel.fill();
  }
  pinsel.globalAlpha = 1;
  lauf.neuZeichnen = false;
}

// --- Bildschirm wach halten, Wiederkehr nach Sperrbildschirm ---------------

async function halteWach() {
  if (!('wakeLock' in navigator)) {
    zustand.wachbleiben = 'nein';
    return;
  }
  if (zustand.wachSperre && !zustand.wachSperre.released) return;
  try {
    zustand.wachSperre = await navigator.wakeLock.request('screen');
    zustand.wachbleiben = 'ja';
  } catch {
    zustand.wachbleiben = 'fehler';
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    sekundeVersteckt = true;
    if (lauf && lauf.endTakt === null) {
      lauf.versteckt++;
      lauf.warVersteckt = true;
    }
    return;
  }
  zustand.verbindung?.jetztNeu();
  if (zustand.verbindung) halteWach();
});

// Falls das Wachhalten ohne Fingertipp nicht klappte: beim nächsten Tippen nochmal.
document.addEventListener('pointerdown', () => {
  if (zustand.verbindung && zustand.wachbleiben !== 'ja') halteWach();
});

// --- Hilfen ------------------------------------------------------------------

function rund(wert) {
  return wert == null ? null : Math.round(wert);
}

function formatiere(zahl, stellen) {
  return zahl.toLocaleString('de-DE', { minimumFractionDigits: stellen, maximumFractionDigits: stellen });
}

async function erkenneGeraet() {
  const ua = navigator.userAgent;
  let system = 'unbekannt';
  let browser = 'unbekannt';
  let modell = null;
  let m;
  if ((m = ua.match(/(?:iPhone|iPad|iPod).*? OS (\d+)[_.](\d+)/))) system = `iOS ${m[1]}.${m[2]}`;
  else if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) system = 'iPadOS';
  else if ((m = ua.match(/Android (\d+(?:\.\d+)?)/))) system = `Android ${m[1]}`;
  else if (/Windows/.test(ua)) system = 'Windows';
  else if (/Mac OS X/.test(ua)) system = 'macOS';
  else if (/Linux/.test(ua)) system = 'Linux';

  if ((m = ua.match(/SamsungBrowser\/(\d+)/))) browser = `Samsung ${m[1]}`;
  else if ((m = ua.match(/(?:EdgA|EdgiOS|Edg)\/(\d+)/))) browser = `Edge ${m[1]}`;
  else if ((m = ua.match(/(?:OPR|OPT)\/(\d+)/))) browser = `Opera ${m[1]}`;
  else if ((m = ua.match(/(?:Firefox|FxiOS)\/(\d+)/))) browser = `Firefox ${m[1]}`;
  else if ((m = ua.match(/(?:CriOS|Chrome)\/(\d+)/))) browser = `Chrome ${m[1]}`;
  else if ((m = ua.match(/Version\/(\d+(?:\.\d+)?).*Safari/))) browser = `Safari ${m[1]}`;

  // Chrome verrät die genaue Android-Version nur auf Nachfrage.
  try {
    const daten = await Promise.race([
      navigator.userAgentData?.getHighEntropyValues(['platformVersion', 'model']),
      new Promise((ok) => setTimeout(ok, 300)),
    ]);
    if (daten?.platformVersion && system.startsWith('Android')) system = `Android ${daten.platformVersion.split('.')[0]}`;
    if (daten?.model) modell = daten.model.slice(0, 30);
  } catch {
    // dann eben ohne
  }

  return {
    system,
    browser,
    modell,
    bildschirm: `${screen.width}×${screen.height}`,
    dpr: window.devicePixelRatio || 1,
    kerne: navigator.hardwareConcurrency || null,
    speicher: navigator.deviceMemory || null,
  };
}

start();
