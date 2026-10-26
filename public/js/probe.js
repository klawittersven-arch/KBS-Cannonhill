// Probespiel auf einem Gerät: zum Ausprobieren des Spielkerns, ohne Netz.

import { Spiel } from './spiel/spiel.js';
import { Zeichner, ladeBilder, steinTextur } from './spiel/zeichner.js';
import {
  BILDER_PRO_SEKUNDE, BILDER_PRO_TAKT, KANONE, KANONE_SENKRECHT, MUNITIONEN, M_SPLITTER, M_STEIN,
  M_RAKETE, M_GRANATE, M_SCHNEEBALL, M_FASS, MAX_LEBENSENERGIE, SPIELERFARBEN,
} from './spiel/regeln.js';
import { schuetzeVorZoomUndMarkieren } from './iphone.js';

schuetzeVorZoomUndMarkieren(); // iPhone: kein Doppeltipp-Zoom, kein Markieren beim Spielen

const $ = (id) => document.getElementById(id);
const NAMEN = ['Rot', 'Grün', 'Blau', 'Gelb', 'Orange', 'Lila', 'Türkis', 'Pink'];
const BILD_MS = 1000 / BILDER_PRO_SEKUNDE;

let bilder;
let spiel = null;
let zeichner = null;
let steuere = 0; // Index des Panzers, den dieses Gerät gerade steuert
let computer = true;
let wartend = new Map(); // nr → Eingabe für den nächsten Takt
let zuletzt = 0;
let uebrig = 0;
let messung = { bilder: 0, ms: 0, max: 0 };

// --- Start -----------------------------------------------------------------------

bilder = await ladeBilder();
$('einstellungen').showModal();
$('einstellungen').addEventListener('close', () => {
  if ($('einstellungen').returnValue === 'start') starteSpiel();
});
$('neu').addEventListener('click', () => $('einstellungen').showModal());
$('nochmal').addEventListener('click', starteSpiel);
$('info').addEventListener('click', () => ($('messwerte').hidden = !$('messwerte').hidden));

function starteSpiel() {
  const anzahl = Number($('opt-anzahl').value);
  computer = $('opt-computer').checked;
  spiel = new Spiel({
    seed: (Math.random() * 2 ** 32) >>> 0,
    spieler: Array.from({ length: anzahl }, (_, i) => ({ nr: i + 1, name: NAMEN[i] })),
    wind: $('opt-wind').checked,
    wetter: $('opt-wetter').checked,
    suddenDeath: $('opt-sudden').checked ? 120 : null,
    ende: $('opt-sudden').checked ? 130 : null,
    salve: $('opt-modus').value === 'salve' ? 3 : null,
    alleWaffen: $('opt-waffen').checked,
    steinTextur: steinTextur(bilder),
  });
  steuere = 0;
  wartend = new Map();
  zeichner = new Zeichner($('spiel'), bilder, { namenPx: 11, eigeneNr: spiel.panzer[0].nr });
  $('ende').hidden = true;
  $('feuer').hidden = spiel.salveAbstand != null;
  $('salve').hidden = spiel.salveAbstand == null;
  $('munition').hidden = !spiel.alleWaffen; // nur Raketen: nichts zu wählen
  baueSteuerung();
  zuletzt = performance.now();
  uebrig = 0;
}

// --- Spielschleife: 60 Bilder pro Sekunde, Eingaben an jeder Taktgrenze --------------

function schleife(jetzt) {
  requestAnimationFrame(schleife);
  if (!spiel) return;
  uebrig = Math.min(uebrig + (jetzt - zuletzt), 250);
  zuletzt = jetzt;
  while (uebrig >= BILD_MS) {
    if (spiel.bild % BILDER_PRO_TAKT === 0) taktgrenze();
    const start = performance.now();
    spiel.schritt();
    const dauer = performance.now() - start;
    messung.bilder++;
    messung.ms += dauer;
    messung.max = Math.max(messung.max, dauer);
    zeichner.nachBild(spiel);
    uebrig -= BILD_MS;
  }
  zeichner.zeichne(spiel);
  aktualisiereSteuerung();
}
requestAnimationFrame(schleife);

function taktgrenze() {
  if (computer) computerZuege();
  const eingaben = [...wartend.values()].sort((a, b) => a.nr - b.nr);
  wartend.clear();
  for (const e of eingaben) spiel.wendeAn(e);
}

function merke(eingabe) {
  const p = spiel.panzer[steuere];
  const bisher = wartend.get(p.nr) || { nr: p.nr };
  wartend.set(p.nr, { ...bisher, ...eingabe });
}

// --- Computergegner (einfach: grob in Richtung eines Gegners) ------------------------

function computerZuege() {
  const salve = spiel.salveAbstand != null;
  spiel.panzer.forEach((p, i) => {
    if (i === steuere || !p.aktiv) return;
    // in der Salve kurz vorher neu zielen, sonst ab und zu selbst schießen
    if (salve ? spiel.bilderBisSalve !== BILDER_PRO_TAKT * 4 : p.schussAktiv || Math.random() > 0.03) return;
    const gegner = spiel.panzer.filter((q) => q.aktiv && q !== p);
    if (!gegner.length) return;
    const ziel = gegner[Math.floor(Math.random() * gegner.length)];
    const rechts = ziel.x > p.x;
    const steil = 6 + Math.floor(Math.random() * 26); // 6–31 Stellungen weg von der Senkrechten
    const w = rechts ? KANONE_SENKRECHT + steil : KANONE_SENKRECHT - steil;
    const entfernung = Math.abs(ziel.x - p.x);
    const k = Math.max(12, Math.min(50, Math.round(14 + entfernung / 14 + (Math.random() * 10 - 5))));
    const vorrat = [M_RAKETE, M_GRANATE, M_SCHNEEBALL, M_FASS].filter((m) => p.lager[m] > 0);
    let m = M_RAKETE;
    if (spiel.alleWaffen) m = vorrat.length && Math.random() < 0.35 ? vorrat[Math.floor(Math.random() * vorrat.length)] : M_STEIN;
    wartend.set(p.nr, { nr: p.nr, w, k, m, f: salve ? 0 : 1 });
  });
}

// --- Steuerung -----------------------------------------------------------------------

function baueSteuerung() {
  $('panzerwahl').replaceChildren(
    ...spiel.panzer.map((p, i) => {
      const knopf = document.createElement('button');
      knopf.className = 'panzerknopf';
      knopf.style.setProperty('--farbe', `rgb(${SPIELERFARBEN[i].join(',')})`);
      knopf.textContent = p.name;
      knopf.addEventListener('click', () => {
        steuere = i;
        zeichner.eigeneNr = p.nr;
      });
      return knopf;
    }),
  );
  $('munition').replaceChildren(
    ...MUNITIONEN.map((m, nr) => {
      if (nr === 0 || nr === M_SPLITTER) return '';
      const knopf = document.createElement('button');
      knopf.className = 'munknopf';
      knopf.dataset.mun = nr;
      knopf.title = m.name;
      const bild = document.createElement('span');
      bild.className = 'munbild';
      // Gewehr und Fass haben im Original eigene Symbole in Zeile 8
      const zeile = m.name === 'Gewehr' || m.name === 'Säurefass' ? 8 : 0;
      bild.style.backgroundPosition = `${-m.bild * 30}px ${-zeile * 30}px`;
      const zahl = document.createElement('span');
      zahl.className = 'munzahl';
      knopf.append(bild, zahl);
      knopf.addEventListener('click', () => merke({ m: nr }));
      return knopf;
    }),
  );
}

$('winkel').addEventListener('input', () => merke({ w: Number($('winkel').value) }));
$('kraft').addEventListener('input', () => merke({ k: Number($('kraft').value) }));
$('feuer').addEventListener('click', () => merke({ f: 1, k: Number($('kraft').value) }));
document.querySelectorAll('[data-schritt]').forEach((knopf) => {
  knopf.addEventListener('click', () => {
    const feld = $(knopf.dataset.schritt);
    feld.value = Number(feld.value) + Number(knopf.dataset.wert);
    feld.dispatchEvent(new Event('input'));
  });
});

// Tastatur: ←/→ Winkel, ↑/↓ Kraft, Leertaste Feuer, Tab nächster Panzer
document.addEventListener('keydown', (e) => {
  if (!spiel || $('einstellungen').open) return;
  const schritt = (id, d) => {
    const feld = $(id);
    feld.value = Number(feld.value) + d;
    feld.dispatchEvent(new Event('input'));
  };
  if (e.key === 'ArrowLeft') schritt('winkel', -1);
  else if (e.key === 'ArrowRight') schritt('winkel', 1);
  else if (e.key === 'ArrowUp') schritt('kraft', 1);
  else if (e.key === 'ArrowDown') schritt('kraft', -1);
  else if (e.key === ' ') $('feuer').click();
  else if (e.key === 'Tab') {
    const lebend = spiel.panzer.map((p, i) => (p.aktiv ? i : -1)).filter((i) => i >= 0);
    steuere = lebend[(lebend.indexOf(steuere) + 1) % lebend.length] ?? steuere;
    zeichner.eigeneNr = spiel.panzer[steuere].nr;
  } else return;
  e.preventDefault();
});

function aktualisiereSteuerung() {
  const p = spiel.panzer[steuere];
  const offen = wartend.get(p.nr) || {};
  // Regler nicht verstellen, während jemand sie bedient
  if (document.activeElement !== $('winkel')) $('winkel').value = offen.w ?? p.kanone;
  if (document.activeElement !== $('kraft')) $('kraft').value = offen.k ?? p.kraft;
  const [kx, ky] = KANONE[Number($('winkel').value)];
  const grad = Math.round(Math.atan2(-ky, kx) * (180 / Math.PI));
  $('winkel-wert').textContent = `${grad}°`;
  $('kraft-wert').textContent = $('kraft').value;
  $('energie-wert').textContent = `${Math.round((p.energie / MAX_LEBENSENERGIE) * 100)} %`;

  [...$('panzerwahl').children].forEach((knopf, i) => {
    knopf.classList.toggle('gewaehlt', i === steuere);
    knopf.classList.toggle('tot', !spiel.panzer[i].aktiv);
  });
  const gewaehlt = offen.m ?? p.munition;
  for (const knopf of $('munition').children) {
    const nr = Number(knopf.dataset.mun);
    const anzahl = p.lager[nr];
    knopf.querySelector('.munzahl').textContent = anzahl === -1 ? '∞' : anzahl;
    knopf.hidden = anzahl === 0; // leere Munition ausblenden (der Ballon kann neue bringen)
    knopf.classList.toggle('gewaehlt', nr === gewaehlt);
  }
  if (spiel.salveAbstand != null) {
    $('salve-zahl').textContent = (spiel.bilderBisSalve / BILDER_PRO_SEKUNDE).toFixed(1).replace('.', ',');
  } else {
    $('feuer').disabled = !p.aktiv || p.schussAktiv;
  }

  if (spiel.phase === 'ende' && $('ende').hidden) {
    const sieger = spiel.panzer.find((q) => q.nr === spiel.sieger);
    const grund = { zeit: ' (Zeit abgelaufen)', gleichzeitig: ' (knapp!)' }[spiel.siegGrund] || '';
    $('ende-text').textContent = `${sieger.name} gewinnt${grund}!`;
    $('ende').hidden = false;
  }

  if (!$('messwerte').hidden && messung.bilder >= 60) {
    let aktiv = 0;
    for (const z of spiel.welt.bereichZahl) aktiv += z;
    $('messwerte').textContent =
      `Physik Ø ${(messung.ms / messung.bilder).toFixed(2)} ms, max ${messung.max.toFixed(1)} ms pro Bild · ` +
      `${aktiv} aktive Pixel · ${zeichner.teilchen.length} Effekte · Prüfsumme ${spiel.pruefsumme()}`;
    messung = { bilder: 0, ms: 0, max: 0 };
  }
}

window.addEventListener('resize', () => zeichner?.passeGroesseAn());
