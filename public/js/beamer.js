import { verbinde, neueId, speicher } from './verbindung.js';
import { qrcode } from './vendor/qrcode.mjs';
import { beschreibePlan } from './gruppen.js';
import { bewerte, empfehlung, median, GRENZEN } from './bewertung.js';

const $ = (id) => document.getElementById(id);
const RAUM_GUELTIG_MS = 4 * 60 * 60 * 1000;

let raum = ladeRaum();
let verbindung = null;
let stand = null;
let belegtVersuche = 0;
let letzteSignatur = '';
let meldungZeitgeber = null;

// --- Raum ------------------------------------------------------------------

function ladeRaum() {
  try {
    const daten = JSON.parse(speicher.lies('kbs-beamer') || 'null');
    if (daten && /^\d{4}$/.test(daten.code) && typeof daten.token === 'string' && Date.now() - daten.zeit < RAUM_GUELTIG_MS) {
      return daten;
    }
  } catch {
    // dann neuer Raum
  }
  return neuerRaum();
}

function neuerRaum() {
  const daten = { code: String(1000 + Math.floor(Math.random() * 9000)), token: neueId(), zeit: Date.now() };
  speicher.schreib('kbs-beamer', JSON.stringify(daten));
  return daten;
}

function oeffneRaum() {
  verbindung?.beende();
  stand = null;
  letzteSignatur = '';
  zeigeBeitritt();
  zeichne();
  verbindung = verbinde({
    pfad: `/ws/${raum.code}`,
    beimOeffnen: () => verbindung.sende({ typ: 'hallo', rolle: 'beamer', token: raum.token }),
    beiNachricht: verarbeite,
    beiStatus: (status, code) => {
      $('verbindung').className = `punkt ${status}`;
      if (code === 4002) zeigeMeldung('Die Beamer-Ansicht ist jetzt in einem anderen Fenster offen.', true);
    },
  });
}

function verarbeite(n) {
  switch (n.typ) {
    case 'belegt':
      // Code gehört schon einer anderen Lehrkraft – einfach einen neuen nehmen.
      if (++belegtVersuche > 5) return zeigeMeldung('Kein freier Raum gefunden. Bitte Seite neu laden.', true);
      raum = neuerRaum();
      return oeffneRaum();
    case 'willkommen':
      belegtVersuche = 0;
      raum.zeit = Date.now();
      speicher.schreib('kbs-beamer', JSON.stringify(raum));
      return;
    case 'stand':
      stand = n;
      return zeichne();
    case 'meldung':
      return zeigeMeldung(n.text);
  }
}

function zeigeBeitritt() {
  const url = `${location.origin}/handy?raum=${raum.code}`;
  const qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  $('qr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true, alt: `QR-Code: ${url}` });
  $('beitritt-url').textContent = `${location.host}/handy`;
  $('raumcode').textContent = raum.code;
}

function zeigeMeldung(text, dauerhaft = false) {
  clearTimeout(meldungZeitgeber);
  $('meldung').textContent = text;
  $('meldung').hidden = false;
  if (!dauerhaft) meldungZeitgeber = setTimeout(() => ($('meldung').hidden = true), 6000);
}

// --- Steuerung ---------------------------------------------------------------

$('start').addEventListener('click', () => verbindung?.sende({ typ: 'starte', dauer: Number($('dauer').value) }));
$('stopp').addEventListener('click', () => {
  if (confirm('Test wirklich abbrechen?')) verbindung?.sende({ typ: 'stoppe' });
});
$('modus').addEventListener('change', () => verbindung?.sende({ typ: 'modus', wert: $('modus').value }));
$('sperre').addEventListener('click', () => verbindung?.sende({ typ: 'sperre', wert: !stand?.gesperrt }));
$('aufraeumen').addEventListener('click', () => verbindung?.sende({ typ: 'aufraeumen' }));
$('neuer-raum').addEventListener('click', () => {
  if (!confirm('Neuen Raum öffnen? Alle müssen dann den neuen QR-Code scannen.')) return;
  raum = neuerRaum();
  oeffneRaum();
});
$('spielerliste').addEventListener('click', (ereignis) => {
  const kachel = ereignis.target.closest('.kachel');
  const spieler = stand?.spieler.find((s) => s.id === kachel?.dataset.id);
  if (spieler && confirm(`${spieler.name} aus dem Raum nehmen?`)) verbindung?.sende({ typ: 'entferne', id: spieler.id });
});

$('bericht').addEventListener('click', () => {
  $('bericht-text').value = erstelleBericht();
  $('bericht-dialog').showModal();
});
$('bericht-schliessen').addEventListener('click', () => $('bericht-dialog').close());
$('bericht-kopieren').addEventListener('click', async () => {
  const feld = $('bericht-text');
  try {
    await navigator.clipboard.writeText(feld.value);
    $('bericht-kopieren').textContent = 'Kopiert ✓';
  } catch {
    feld.select();
    document.execCommand('copy');
  }
  setTimeout(() => ($('bericht-kopieren').textContent = 'Kopieren'), 2000);
});
$('bericht-laden').addEventListener('click', () => {
  const datei = new Blob([$('bericht-text').value], { type: 'text/plain;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(datei);
  link.download = `netztest-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.txt`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
});

// --- Anzeige -------------------------------------------------------------------

function zeichne() {
  const s = stand;
  const verbunden = s ? s.spieler.filter((sp) => sp.verbunden) : [];
  const test = s?.test;
  const laeuft = !!test?.laeuft;

  $('anzahl').textContent = verbunden.length;
  $('start').hidden = laeuft;
  $('stopp').hidden = !laeuft;
  $('start').disabled = verbunden.length < 2;
  $('modus').disabled = laeuft;
  $('dauer').disabled = laeuft;
  if (s) {
    $('modus').value = s.modus;
    $('sperre').textContent = s.gesperrt ? 'Raum entsperren' : 'Raum sperren';
  }

  if (laeuft) {
    $('plan').textContent = test.art === 'direktfinale' ? 'Test läuft – alle in einer Gruppe' : `Test läuft – ${test.gruppen.length} Gruppen`;
    $('rest').textContent = test.takt === 0 ? 'gleich …' : `${Math.ceil(test.restMs / 1000)} s`;
    $('server-takt').textContent = serverTaktText(test.serverTakt);
  } else {
    $('plan').textContent = s ? `Turnier-Plan: ${beschreibePlan(verbunden.length, s.modus)}` : 'Verbinde …';
  }
  $('test-anzeige').hidden = !laeuft;

  zeichneEmpfehlung();
  zeichneSpieler();
}

function serverTaktText(st) {
  if (!st?.anzahl) return '';
  return `Server-Takt Ø ${zahl(st.schnittMs, 1)} ms · max ${st.maxMs} ms`;
}

/** Messwerte mit den vom Server gezählten Abbrüchen (zuverlässiger als die des Handys). */
function messwerte(spieler) {
  return { bench: spieler.bench, werte: spieler.werte ? { ...spieler.werte, abbrueche: spieler.abbruecheTest } : null };
}

function testGruppen() {
  const test = stand?.test;
  if (!test) return [];
  const nachId = new Map(stand.spieler.map((s) => [s.id, s]));
  return test.gruppen.map((g) => ({ name: g.name, mitglieder: g.mitglieder.map((id) => nachId.get(id)).filter(Boolean) }));
}

/** Haben alle Handys einer Gruppe dieselbe Landschaft berechnet? */
function syncStatus(mitglieder, laeuft) {
  if (!laeuft) {
    const ergebnisse = mitglieder.map((s) => s.ergebnis).filter((e) => e?.h);
    if (!ergebnisse.length) return { klasse: '', text: 'warte auf Ergebnisse …', ok: null };
    const gleich = ergebnisse.every((e) => e.h === ergebnisse[0].h && e.n === ergebnisse[0].n);
    if (!gleich) return { klasse: 'nein', text: '✗ auseinandergelaufen', ok: false };
    const fehlen = mitglieder.length - ergebnisse.length;
    return { klasse: 'ja', text: fehlen ? `✓ synchron (${ergebnisse.length} von ${mitglieder.length})` : '✓ synchron', ok: true };
  }
  const nachTakt = new Map();
  for (const z of mitglieder.map((s) => s.zwischen).filter((z) => z?.h)) {
    if (!nachTakt.has(z.n)) nachTakt.set(z.n, []);
    nachTakt.get(z.n).push(z.h);
  }
  const vergleichbar = [...nachTakt.entries()].filter(([, hs]) => hs.length > 1).sort((a, b) => b[0] - a[0]);
  if (!vergleichbar.length) return { klasse: '', text: 'läuft …', ok: null };
  if (vergleichbar.some(([, hs]) => hs.some((h) => h !== hs[0]))) return { klasse: 'nein', text: '✗ auseinandergelaufen', ok: false };
  return { klasse: 'ja', text: '✓ synchron', ok: true };
}

function auswertung() {
  const test = stand?.test;
  if (!test || test.laeuft) return null;
  const gruppen = testGruppen();
  const teilnehmer = gruppen.flatMap((g) => g.mitglieder);
  const bewertungen = teilnehmer.map((s) => bewerte(messwerte(s)));
  const syncs = gruppen.map((g) => syncStatus(g.mitglieder, false));
  const alleSynchron = syncs.every((s) => s.ok !== false);
  const zaehle = (stufe) => bewertungen.filter((b) => b.stufe === stufe).length;
  const verzoegerungen = teilnehmer.map((s) => s.werte?.eingabe?.p95).filter((v) => typeof v === 'number');
  return {
    gruppen,
    syncs,
    teilnehmer,
    bewertungen,
    empfehlung: empfehlung(bewertungen, alleSynchron),
    gut: zaehle('gut'),
    mittel: zaehle('mittel'),
    schlecht: zaehle('schlecht'),
    verzoegerungMedian: median(verzoegerungen),
  };
}

function zeichneEmpfehlung() {
  const a = auswertung();
  const kasten = $('empfehlung');
  if (!a?.empfehlung) {
    kasten.hidden = true;
    return;
  }
  kasten.hidden = false;
  kasten.className = `karte empfehlung ${a.empfehlung.art}`;
  $('empfehlung-titel').textContent = a.empfehlung.text;
  const teile = [`${a.gut} grün · ${a.mittel} gelb · ${a.schlecht} rot`];
  if (a.verzoegerungMedian != null) teile.push(`typische Verzögerung ${a.verzoegerungMedian} ms`);
  const st = serverTaktText(stand.test.serverTakt);
  if (st) teile.push(st);
  $('empfehlung-details').textContent = teile.join(' · ');
}

function zeichneSpieler() {
  const liste = $('spielerliste');
  if (!stand) return;
  const test = stand.test;
  const abschnitte = [];
  if (test) {
    const imTest = new Set();
    for (const g of testGruppen()) {
      g.mitglieder.forEach((s) => imTest.add(s.id));
      abschnitte.push({ titel: g.name, sync: syncStatus(g.mitglieder, test.laeuft), spieler: g.mitglieder });
    }
    const rest = stand.spieler.filter((s) => !imTest.has(s.id));
    if (rest.length) abschnitte.push({ titel: test.laeuft ? 'Warten auf den nächsten Durchgang' : 'Nicht im letzten Test', sync: null, spieler: rest });
  } else if (stand.spieler.length) {
    abschnitte.push({ titel: null, sync: null, spieler: stand.spieler });
  }

  // Nur neu aufbauen, wenn sich etwas geändert hat – sonst gehen Klicks verloren.
  const signatur = JSON.stringify(abschnitte.map((a) => [a.titel, a.sync, a.spieler]));
  if (signatur === letzteSignatur) return;
  letzteSignatur = signatur;

  if (!abschnitte.length) {
    liste.innerHTML = '<p class="leer">Noch niemand da – QR-Code scannen!</p>';
    return;
  }
  liste.replaceChildren(
    ...abschnitte.map((a) => {
      const bereich = document.createElement('section');
      bereich.className = 'gruppe';
      if (a.titel) {
        const kopf = document.createElement('h3');
        kopf.textContent = a.titel;
        if (a.sync) {
          const sync = document.createElement('span');
          sync.className = `sync ${a.sync.klasse}`;
          sync.textContent = a.sync.text;
          kopf.append(sync);
        }
        bereich.append(kopf);
      }
      const kacheln = document.createElement('div');
      kacheln.className = 'kacheln';
      kacheln.append(...a.spieler.map(kachel));
      bereich.append(kacheln);
      return bereich;
    }),
  );
}

function kachel(spieler) {
  const { stufe, gruende } = bewerte(messwerte(spieler));
  const knopf = document.createElement('button');
  knopf.type = 'button';
  knopf.className = `kachel ${stufe}${spieler.verbunden ? '' : ' getrennt'}`;
  knopf.dataset.id = spieler.id;

  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = spieler.name;

  const geraet = document.createElement('span');
  geraet.className = 'geraet';
  const g = spieler.geraet || {};
  geraet.textContent = [g.modell, g.system, g.browser].filter(Boolean).join(' · ') + (spieler.verbunden ? '' : ' · getrennt');

  const messung = document.createElement('span');
  messung.className = 'messung';
  const w = spieler.werte || {};
  const teile = [];
  if (w.ping?.med != null) teile.push(`Ping ${w.ping.med} ms`);
  if (w.eingabe?.p95 != null) teile.push(`Verz. ${w.eingabe.p95} ms`);
  if (w.takt?.n) teile.push(`Hänger ${w.takt.haenger}`);
  if (w.fps?.min != null) teile.push(`${w.fps.min} B/s`);
  if (spieler.bench?.msProSchritt != null) teile.push(`Physik ${zahl(spieler.bench.msProSchritt, 1)} ms`);
  messung.textContent = teile.join(' · ') || 'Messung läuft …';

  knopf.append(name, geraet, messung);
  if (gruende.length) {
    const grund = document.createElement('span');
    grund.className = 'gruende';
    grund.textContent = gruende.join(', ');
    knopf.append(grund);
  }
  return knopf;
}

// --- Bericht (ohne Namen) --------------------------------------------------------

function erstelleBericht() {
  if (!stand) return 'Noch keine Daten.';
  const zeilen = [];
  const jetzt = new Date();
  const a = auswertung();
  const test = stand.test;

  zeilen.push('KBS-Cannonhill – Netztest-Ergebnis');
  zeilen.push(`Zeit: ${jetzt.toLocaleString('de-DE')} · Adresse: ${location.host}`);
  zeilen.push(`Handys im Raum: ${stand.spieler.length} (verbunden: ${stand.spieler.filter((s) => s.verbunden).length})`);
  if (test) {
    zeilen.push(`Test: ${test.laeuft ? 'läuft noch' : 'beendet'} · Dauer ${test.dauerMs / 1000} s · Einteilung ${test.art} · ${test.gruppen.length} Gruppe(n)`);
    if (test.hinweis) zeilen.push(`Hinweis: ${test.hinweis}`);
    const st = serverTaktText(test.serverTakt);
    if (st) zeilen.push(`${st} · ${test.serverTakt.anzahl} Takte`);
  } else {
    zeilen.push('Test: noch nicht gestartet');
  }
  if (a) {
    zeilen.push(`Empfehlung: ${a.empfehlung?.text ?? '–'} (${a.gut} grün, ${a.mittel} gelb, ${a.schlecht} rot)`);
    a.gruppen.forEach((g, i) => zeilen.push(`  ${g.name}: ${g.mitglieder.length} Handys, ${a.syncs[i].text}`));
  }

  // Mathe-Varianten: gleiche Buchstaben = Kommazahl-Funktionen rechnen gleich
  const varianten = new Map();
  for (const s of stand.spieler) {
    const m = s.bench?.mathe;
    if (m) varianten.set(m, (varianten.get(m) || 0) + 1);
  }
  const buchstaben = new Map([...varianten.entries()].sort((x, y) => y[1] - x[1]).map(([m], i) => [m, String.fromCharCode(65 + i)]));
  if (buchstaben.size) {
    zeilen.push(`Mathe-Varianten: ${[...buchstaben.entries()].map(([m, b]) => `${b} = ${m} (${varianten.get(m)}×)`).join(', ')}`);
  }

  zeilen.push('');
  zeilen.push('| Gerät | Gruppe | System | Browser | Modell | Ping Ø/95 | Verz. Ø/95 | Takte | Hänger | max. Lücke | Jitter | Abbrüche | versteckt | B/s min/Ø | Physik ms | Physik ok | Mathe | wach | Ampel | Gründe |');
  zeilen.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  const gruppeVon = new Map();
  if (test) test.gruppen.forEach((g) => g.mitglieder.forEach((id) => gruppeVon.set(id, g.name)));
  const sortiert = stand.spieler.slice().sort((x, y) => (gruppeVon.get(x.id) || '~').localeCompare(gruppeVon.get(y.id) || '~') || x.nr - y.nr);
  sortiert.forEach((s, i) => {
    const g = s.geraet || {};
    const w = s.werte || {};
    const b = s.bench || {};
    const { stufe, gruende } = bewerte(messwerte(s));
    zeilen.push(`| ${String(i + 1).padStart(2, '0')} | ${gruppeVon.get(s.id) || '–'} | ${g.system ?? '–'} | ${g.browser ?? '–'} | ${g.modell ?? '–'} | ${paar(w.ping)} | ${paar(w.eingabe)} | ${w.takt?.n ?? '–'} | ${w.takt?.haenger ?? '–'} | ${w.takt?.maxLuecke ?? '–'} | ${w.takt?.jitter ?? '–'} | ${s.abbruecheTest} | ${w.versteckt ?? '–'} | ${w.fps ? `${w.fps.min}/${w.fps.schnitt}` : '–'} | ${b.msProSchritt ?? '–'} | ${b.korrekt === undefined ? '–' : b.korrekt ? 'ja' : 'NEIN'} | ${buchstaben.get(b.mathe) ?? '–'} | ${w.wachbleiben ?? '–'} | ${stufe} | ${gruende.join(', ')} |`);
  });
  zeilen.push('');
  zeilen.push(`Grenzen (gut/mittel): Verzögerung 95% ≤ ${GRENZEN.eingabeP95.join('/')} ms · Hänger/min ≤ ${GRENZEN.haengerProMinute.join('/')} · Abbrüche ≤ ${GRENZEN.abbrueche.join('/')} · Physik ≤ ${GRENZEN.msProSchritt.join('/')} ms · B/s ≥ ${GRENZEN.fpsMin.join('/')}`);
  return zeilen.join('\n');
}

function paar(messung) {
  return messung?.med != null ? `${messung.med}/${messung.p95}` : '–';
}

function zahl(wert, stellen) {
  return wert == null ? '–' : wert.toLocaleString('de-DE', { minimumFractionDigits: stellen, maximumFractionDigits: stellen });
}

oeffneRaum();
