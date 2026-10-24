import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Spiel, zufallsgenerator } from '../public/js/spiel/spiel.js';
import {
  BREITE, HOEHE, KANONE, LUFT, SCHNEE, STEIN, MAX_LEBENSENERGIE, M_RAKETE, M_STEIN, M_SCHILD, BILDER_PRO_SEKUNDE, BILDER_PRO_TAKT,
} from '../public/js/spiel/regeln.js';

const spieler = (n) => Array.from({ length: n }, (_, i) => ({ nr: i + 1, name: `S${i + 1}` }));

/** Spielt eine Partie mit zufälligen, aber reproduzierbaren Eingaben. */
function spiele(seed, takte, optionen = {}) {
  const spiel = new Spiel({ seed, spieler: spieler(4), alleWaffen: true, ...optionen });
  const r = zufallsgenerator(seed ^ 0x5eed);
  const verlauf = [];
  for (let t = 0; t < takte; t++) {
    const eingaben = [];
    if (t % 15 === 0) {
      for (const p of spiel.panzer) eingaben.push({ nr: p.nr, w: r() % KANONE.length, k: 10 + (r() % 41), m: [1, 3, 4, 7, 12][r() % 5], f: 1 });
    }
    verlauf.push(eingaben);
    spiel.takt(eingaben);
  }
  return { spiel, verlauf };
}

test('gleicher Startwert und gleiche Eingaben ergeben bit-genau dieselbe Partie', () => {
  for (const seed of [1, 7, 123456]) {
    const a = spiele(seed, 400);
    const b = spiele(seed, 400);
    assert.equal(a.spiel.pruefsumme(), b.spiel.pruefsumme(), `Seed ${seed}`);
  }
});

test('Nachspielen aus dem Eingabe-Verlauf ergibt dieselbe Partie (Wiedereinstieg)', () => {
  const { spiel, verlauf } = spiele(99, 300, { salve: null });
  const nach = new Spiel({ seed: 99, spieler: spieler(4), salve: null, alleWaffen: true });
  for (const eingaben of verlauf) nach.takt(eingaben);
  assert.equal(nach.pruefsumme(), spiel.pruefsumme());
});

test('verschiedene Startwerte ergeben verschiedene Landschaften', () => {
  const a = new Spiel({ seed: 1, spieler: spieler(2) });
  const b = new Spiel({ seed: 2, spieler: spieler(2) });
  assert.notEqual(a.pruefsumme(), b.pruefsumme());
});

test('Landschaft: Schnee oben, Stein unten, Panzer stehen auf der Oberfläche', () => {
  const spiel = new Spiel({ seed: 5, spieler: spieler(8) });
  const { welt } = spiel;
  for (const x of [0, 100, BREITE / 2, BREITE - 1]) {
    const y = welt.oberflaeche(x);
    assert.equal(welt.artBei(x, y), SCHNEE);
    assert.equal(welt.artBei(x, HOEHE - 1), STEIN);
  }
  for (const p of spiel.panzer) {
    assert.equal(welt.artBei(p.x, p.y), LUFT);
    assert.notEqual(welt.artBei(p.x, p.y + 1), LUFT);
  }
});

/** Ein Geschoss direkt über einem Panzer explodieren lassen. */
function treffe(spiel, ziel, typ, schuetze) {
  const p = spiel.panzer[ziel];
  const s = spiel.freierPlatz();
  spiel.belegePlatz(spiel.mun[s], typ, p.x, p.y - 4, 0, 1, schuetze);
  for (let i = 0; i < 3; i++) spiel.schritt();
}

test('eine Rakete zieht 300 Energie ab, die zweite zerstört den Panzer', () => {
  const spiel = new Spiel({ seed: 3, spieler: spieler(3), salve: null, suddenDeath: null, ende: null, wetter: false });
  assert.equal(MAX_LEBENSENERGIE, 500);
  treffe(spiel, 1, M_RAKETE, 0);
  assert.equal(spiel.panzer[1].energie, 200);
  assert.equal(spiel.panzer[0].treffer, 300);
  spiel.holeEreignisse();
  treffe(spiel, 1, M_RAKETE, 0);
  assert.equal(spiel.panzer[1].aktiv, false);
  assert.equal(spiel.panzer[0].abschuesse, 1);
  assert.ok(spiel.holeEreignisse().some((e) => e.typ === 'tot' && e.nr === 2));
});

test('der Schild schützt vor Schaden', () => {
  const spiel = new Spiel({ seed: 3, spieler: spieler(2), salve: null, suddenDeath: null, ende: null, alleWaffen: true });
  spiel.wendeAn({ nr: 2, m: M_SCHILD, f: 1, k: 10 });
  assert.ok(spiel.panzer[1].schild > 0);
  treffe(spiel, 1, M_RAKETE, 0);
  assert.equal(spiel.panzer[1].energie, MAX_LEBENSENERGIE);
});

test('alle 3 Sekunden feuern alle Panzer gemeinsam', () => {
  const spiel = new Spiel({ seed: 11, spieler: spieler(4), suddenDeath: null, ende: null, wetter: false });
  const takteBisSalve = (3 * BILDER_PRO_SEKUNDE) / BILDER_PRO_TAKT;
  for (let t = 0; t < takteBisSalve - 1; t++) spiel.takt([]);
  assert.equal(spiel.holeEreignisse().filter((e) => e.typ === 'schuss').length, 0);
  spiel.takt([]);
  const ereignisse = spiel.holeEreignisse();
  assert.ok(ereignisse.some((e) => e.typ === 'salve'));
  assert.equal(ereignisse.filter((e) => e.typ === 'schuss').length, 4);
  // Feuer-Befehle einzelner Spieler zählen im Salven-Modus nicht
  spiel.takt([{ nr: 1, f: 1, k: 40 }]);
  assert.equal(spiel.holeEreignisse().filter((e) => e.typ === 'schuss').length, 0);
});

test('Winkel, Kraft und Munition werden übernommen, leere Munition nicht', () => {
  const spiel = new Spiel({ seed: 2, spieler: spieler(2), alleWaffen: true });
  spiel.takt([{ nr: 1, w: 70, k: 44, m: M_RAKETE }, { nr: 2, m: 5 /* Laser: 0 im Lager */ }]);
  const [a, b] = spiel.panzer;
  assert.deepEqual([a.kanone, a.kx, a.ky, a.kraft, a.munition], [70, ...KANONE[70], 44, M_RAKETE]);
  assert.equal(b.munition, M_STEIN);
});

test('Sudden Death beendet jede Partie spätestens zur Endzeit', () => {
  const spiel = new Spiel({ seed: 8, spieler: spieler(4), salve: null, suddenDeath: 1, ende: 6, wetter: false });
  for (let t = 0; t < 20 * 6 && spiel.phase === 'laeuft'; t++) spiel.takt([]);
  assert.equal(spiel.phase, 'ende');
  assert.ok(spiel.panzer.some((p) => p.nr === spiel.sieger));
  assert.ok(['letzter', 'gleichzeitig', 'zeit'].includes(spiel.siegGrund));
});

test('zu Beginn zielen die Panzer schräg zur Mitte', () => {
  const spiel = new Spiel({ seed: 4, spieler: spieler(4) });
  for (const p of spiel.panzer) {
    if (p.x < BREITE / 2) assert.ok(p.kx > 0 && p.ky < 0);
    else assert.ok(p.kx < 0 && p.ky < 0);
  }
});

test('Standard: nur Raketen, unbegrenzt, kein Ballon', () => {
  const spiel = new Spiel({ seed: 21, spieler: spieler(3), suddenDeath: null, ende: null });
  for (const p of spiel.panzer) {
    assert.equal(p.munition, M_RAKETE);
    assert.equal(p.lager[M_RAKETE], -1);
    assert.equal(p.lager.filter((l) => l !== 0).length, 1);
  }
  spiel.takt([{ nr: 1, m: M_STEIN }]);
  assert.equal(spiel.panzer[0].munition, M_RAKETE);
  for (let t = 0; t < 20 * 30; t++) spiel.takt([]);
  assert.equal(spiel.ballon.aktiv, false);
  assert.ok(spiel.panzer.every((p) => p.lager[M_RAKETE] === -1));
});
