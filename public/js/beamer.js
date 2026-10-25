// Beamer-Seite der Lehrkraft: Lobby mit QR-Code, Qualifying-Übersicht,
// Finale im Großformat und Siegerehrung.

import { verbinde, neueId, speicher } from './verbindung.js';
import { qrcode } from './vendor/qrcode.mjs';
import { beschreibePlan, planeTurnier } from './gruppen.js';
import { NetzSpiel } from './spiel/netzspiel.js';
import { Zeichner, ladeBilder, steinTextur } from './spiel/zeichner.js';
import { MAX_LEBENSENERGIE, SPIELERFARBEN } from './spiel/regeln.js';

const $ = (id) => document.getElementById(id);
const RAUM_GUELTIG_MS = 4 * 60 * 60 * 1000;

let raum = ladeRaum();
let verbindung = null;
let stand = null;
let belegtVersuche = 0;
let finale = null; // NetzSpiel des Finales
let zeichner = null;
let letzteSignatur = '';
const bilderLaden = ladeBilder().catch(() => null);

// --- Raum ------------------------------------------------------------------------------

function ladeRaum() {
  try {
    const d = JSON.parse(speicher.lies('kbs-turnier') || 'null');
    if (d && /^\d{4}$/.test(d.code) && typeof d.token === 'string' && Date.now() - d.zeit < RAUM_GUELTIG_MS) return d;
  } catch {
    // neuer Raum
  }
  return neuerRaum();
}

function neuerRaum() {
  const d = { code: String(1000 + Math.floor(Math.random() * 9000)), token: neueId(), zeit: Date.now() };
  speicher.schreib('kbs-turnier', JSON.stringify(d));
  return d;
}

function oeffneRaum() {
  verbindung?.beende();
  stand = null;
  finale = null;
  zeigeBeitritt();
  verbindung = verbinde({
    pfad: `/spiel/${raum.code}`,
    beimOeffnen: () => verbindung.sende({ typ: 'hallo', rolle: 'beamer', token: raum.token }),
    beiNachricht: verarbeite,
    beiStatus: (status, code) => {
      $('verbindung').className = `punkt ${status}`;
      if (code === 4002) meldung('Die Turnier-Ansicht ist jetzt in einem anderen Fenster offen.', true);
    },
  });
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

function sende(nachricht) {
  verbindung?.sende(nachricht);
}

function meldung(text, dauerhaft = false) {
  for (const el of document.querySelectorAll('.meldung')) {
    el.textContent = text;
    el.hidden = false;
  }
  if (!dauerhaft) setTimeout(() => document.querySelectorAll('.meldung').forEach((el) => (el.hidden = true)), 6000);
}

// --- Nachrichten -------------------------------------------------------------------------

function verarbeite(n) {
  switch (n.typ) {
    case 't':
      if (finale && n.s === finale.id) finale.takt(n.n, n.e);
      return;
    case 'belegt':
      if (++belegtVersuche > 5) return meldung('Kein freier Raum gefunden. Bitte Seite neu laden.', true);
      raum = neuerRaum();
      return oeffneRaum();
    case 'willkommen':
      belegtVersuche = 0;
      raum.zeit = Date.now();
      speicher.schreib('kbs-turnier', JSON.stringify(raum));
      if (spielzeit) sende({ typ: 'optionen', optionen: { ende: spielzeit } });
      return;
    case 'stand':
      stand = n;
      return zeichneStand();
    case 'spiel':
      return starteFinalAnsicht(n);
    case 'meldung':
      return meldung(n.text);
  }
}

// --- Steuerung ------------------------------------------------------------------------------

// Nur zum Ausprobieren: /beamer?spielzeit=20 verkürzt jede Partie auf 20 Sekunden.
const spielzeit = Number(new URLSearchParams(location.search).get('spielzeit')) || null;

function sendeOptionen() {
  const optionen = { alleWaffen: $('opt-waffen').checked, wind: $('opt-wind').checked, wetter: $('opt-wetter').checked, modus: $('opt-modus').value };
  if (spielzeit) optionen.ende = spielzeit;
  sende({ typ: 'optionen', optionen });
}
for (const id of ['opt-waffen', 'opt-wind', 'opt-wetter', 'opt-modus']) $(id).addEventListener('change', sendeOptionen);
$('start').addEventListener('click', () => sende({ typ: 'starte' }));
$('finale-start').addEventListener('click', () => sende({ typ: 'finale' }));
document.querySelectorAll('.abbrechen').forEach((knopf) =>
  knopf.addEventListener('click', () => {
    if (confirm('Turnier abbrechen und zurück zur Lobby?')) sende({ typ: 'abbrechen' });
  }),
);
$('neues-turnier').addEventListener('click', () => sende({ typ: 'neu' }));
// Vollbild für den Beamer (statt F11)
const imVollbild = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
document.querySelectorAll('[data-vollbild]').forEach((knopf) =>
  knopf.addEventListener('click', () => {
    const wurzel = document.documentElement;
    if (imVollbild()) document.exitFullscreen?.();
    else (wurzel.requestFullscreen ? wurzel.requestFullscreen() : wurzel.webkitRequestFullscreen?.())?.catch?.(() => {});
  }),
);
document.addEventListener('fullscreenchange', () =>
  document.querySelectorAll('[data-vollbild]').forEach((k) => (k.textContent = imVollbild() ? '⛶ Vollbild aus' : '⛶ Vollbild')),
);
$('sperre').addEventListener('click', () => sende({ typ: 'sperre', wert: !stand?.gesperrt }));
$('aufraeumen').addEventListener('click', () => sende({ typ: 'aufraeumen' }));
$('neuer-raum').addEventListener('click', () => {
  if (!confirm('Neuen Raum öffnen? Alle müssen dann den neuen QR-Code scannen.')) return;
  raum = neuerRaum();
  oeffneRaum();
});
$('spielerliste').addEventListener('click', (ereignis) => {
  const kachel = ereignis.target.closest('.kachel');
  const spieler = stand?.spieler.find((s) => s.id === kachel?.dataset.id);
  if (spieler && confirm(`${spieler.name} aus dem Raum nehmen?`)) sende({ typ: 'entferne', id: spieler.id });
});

// --- Anzeige je Phase -------------------------------------------------------------------------

function zeigeAnsicht(name) {
  for (const a of ['lobby', 'quali', 'finale', 'sieger']) $(`ansicht-${a}`).hidden = a !== name;
  document.body.classList.toggle('vollbild', name === 'finale' || name === 'sieger');
}

function zeichneStand() {
  const s = stand;
  if (s.phase === 'lobby') {
    finale = null;
    zeigeAnsicht('lobby');
    zeichneLobby(s);
  } else if (s.phase === 'qualifying') {
    finale = null;
    zeigeAnsicht('quali');
    zeichneQualifying(s);
  } else if (s.phase === 'finale') {
    zeigeAnsicht('finale');
    if (!finale) sende({ typ: 'nachholen' });
  } else if (s.phase === 'siegerehrung') {
    finale = null;
    if ($('ansicht-sieger').hidden) starteKonfetti();
    zeigeAnsicht('sieger');
    $('sieger-name').textContent = s.sieger?.name ?? '';
  }
}

function zeichneLobby(s) {
  const verbunden = s.spieler.filter((sp) => sp.verbunden);
  $('anzahl').textContent = verbunden.length;
  const o = s.optionen;
  $('opt-waffen').checked = o.alleWaffen;
  $('opt-wind').checked = o.wind;
  $('opt-wetter').checked = o.wetter;
  $('opt-modus').value = o.modus;
  $('sperre').textContent = s.gesperrt ? 'Raum entsperren' : 'Raum sperren';
  const plan = planeTurnier(verbunden.length, o.modus);
  $('plan').textContent = `Plan: ${beschreibePlan(verbunden.length, o.modus)}${plan.hinweis ? ` – ${plan.hinweis}` : ''}`;
  $('start').disabled = plan.art === 'zuwenig';
  $('start').textContent = plan.art === 'qualifying' ? 'Qualifying starten' : 'Finale starten';

  const signatur = JSON.stringify(s.spieler);
  if (signatur === letzteSignatur) return;
  letzteSignatur = signatur;
  if (!s.spieler.length) {
    $('spielerliste').innerHTML = '<p class="leer">Noch niemand da – QR-Code scannen!</p>';
    return;
  }
  $('spielerliste').replaceChildren(
    ...s.spieler.map((sp) => {
      const k = document.createElement('button');
      k.type = 'button';
      k.className = `kachel gut${sp.verbunden ? '' : ' getrennt'}`;
      k.dataset.id = sp.id;
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = sp.name;
      const zeile = document.createElement('span');
      zeile.className = 'geraet';
      zeile.textContent = sp.verbunden ? 'bereit' : 'getrennt';
      k.append(name, zeile);
      return k;
    }),
  );
}

function zeichneQualifying(s) {
  letzteSignatur = '';
  const nachId = new Map(s.spieler.map((sp) => [sp.id, sp]));
  const quali = s.partien.filter((p) => p.art === 'quali');
  const fertig = quali.filter((p) => p.ergebnis || p.abgebrochen).length;
  $('quali-stand').textContent = `${fertig} von ${quali.length} Gruppen entschieden`;
  $('finale-start').disabled = !s.qualifyingFertig || s.finalisten.length < 1;
  $('finale-start').textContent = s.qualifyingFertig ? `Finale starten (${s.finalisten.length})` : 'Finale starten';

  $('finalisten').replaceChildren(
    ...(s.finalisten.length ? [Object.assign(document.createElement('span'), { className: 'finalisten-titel', textContent: 'Im Finale:' })] : []),
    ...s.finalisten.map((id) => Object.assign(document.createElement('span'), { className: 'finalist', textContent: nachId.get(id)?.name ?? '?' })),
  );

  $('gruppen').replaceChildren(
    ...quali.map((p) => {
      const karte = document.createElement('section');
      karte.className = `karte gruppe-karte${p.ergebnis ? ' entschieden' : ''}`;
      const kopf = document.createElement('h2');
      const sekunden = Math.floor(p.takt / 20);
      const zeit = p.takt ? `${Math.floor(sekunden / 60)}:${String(sekunden % 60).padStart(2, '0')}` : 'startet …';
      kopf.innerHTML = `<span></span><small>${p.abgebrochen ? 'ohne Ergebnis' : p.ergebnis ? 'entschieden' : zeit}</small>`;
      kopf.firstChild.textContent = p.name;
      karte.append(kopf);
      const liste = document.createElement('ul');
      liste.className = 'mitspieler';
      const lage = new Map((p.lage?.p ?? []).map(([nr, energie, aktiv]) => [nr, { energie, aktiv }]));
      p.mitglieder.forEach((id, i) => {
        const sp = nachId.get(id);
        const l = lage.get(sp?.nr);
        const eintrag = document.createElement('li');
        const istSieger = p.ergebnis && p.ergebnis.sieger === sp?.nr;
        if (istSieger) eintrag.classList.add('sieger');
        else if (l && !l.aktiv) eintrag.classList.add('raus'); // der Sieger wird nie durchgestrichen
        const farbe = document.createElement('span');
        farbe.className = 'farbe';
        farbe.style.background = `rgb(${SPIELERFARBEN[i].join(',')})`;
        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = (p.ergebnis && p.ergebnis.sieger === sp?.nr ? '🏆 ' : '') + (sp?.name ?? '?');
        const balken = document.createElement('span');
        balken.className = 'balken';
        const fuellung = document.createElement('span');
        fuellung.style.width = `${l ? Math.max(0, (l.energie / MAX_LEBENSENERGIE) * 100) : 100}%`;
        balken.append(fuellung);
        eintrag.append(farbe, name, balken);
        liste.append(eintrag);
      });
      karte.append(liste);
      if (p.abweichung) {
        const warnung = document.createElement('p');
        warnung.className = 'fehler';
        warnung.textContent = 'Handys rechneten unterschiedlich – Ergebnis bitte prüfen.';
        karte.append(warnung);
      }
      return karte;
    }),
  );
}

// --- Finale im Großformat ------------------------------------------------------------------

async function starteFinalAnsicht(info) {
  const bilder = await bilderLaden;
  if (!bilder) return meldung('Bilder konnten nicht geladen werden.');
  if (!zeichner) zeichner = new Zeichner($('finale'), bilder, { namenPx: 8, kraftAnzeige: 'keine' });
  if (finale && finale.id === info.s) {
    finale.baueAuf(info);
  } else {
    finale = new NetzSpiel(info, {
      steinTextur: steinTextur(bilder),
      nachBild: (spiel) => zeichner.nachBild(spiel),
      lueckeEntdeckt: () => sende({ typ: 'nachholen' }),
    });
  }
  $('finale-namen').textContent = info.spieler.map((p) => p.name).join(' · ');
  zeigeAnsicht('finale');
  zeichner.passeGroesseAn();
}

function schleife(jetzt) {
  requestAnimationFrame(schleife);
  if (!finale || $('ansicht-finale').hidden) return;
  finale.laufe(jetzt);
  zeichner.zeichne(finale.spiel);
  $('finale-hinweis').hidden = finale.spiel.bild > 0;
}
requestAnimationFrame(schleife);

// Läuft der Tab im Hintergrund, rechnet das Finale trotzdem weiter
setInterval(() => {
  if (finale && document.hidden) finale.laufeAlles();
}, 500);
window.addEventListener('resize', () => zeichner?.passeGroesseAn());

// --- Siegerehrung ---------------------------------------------------------------------------

function starteKonfetti() {
  const farben = ['#ff6b6b', '#ffd43b', '#69db7c', '#4dabf7', '#da77f2', '#ff922b'];
  $('konfetti').replaceChildren(
    ...Array.from({ length: 90 }, () => {
      const teil = document.createElement('span');
      teil.style.left = `${Math.random() * 100}%`;
      teil.style.background = farben[Math.floor(Math.random() * farben.length)];
      teil.style.animationDelay = `${Math.random() * 3}s`;
      teil.style.animationDuration = `${3 + Math.random() * 3}s`;
      return teil;
    }),
  );
}

oeffneRaum();
