import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  neueWelt, spieleTakt, pruefsumme, leistungstest, zufall, BENCH_PRUEFSUMME, BREITE,
} from '../public/js/sim.js';

test('Leistungstest liefert die feste Referenz-Prüfsumme', () => {
  const ergebnis = leistungstest();
  assert.equal(ergebnis.pruefsumme, BENCH_PRUEFSUMME);
  assert.equal(ergebnis.korrekt, true);
});

test('Zufallsgenerator ist reproduzierbar', () => {
  const a = zufall(42);
  const b = zufall(42);
  for (let i = 0; i < 1000; i++) assert.equal(a(), b());
});

test('Live-Takte und Nachholen aus dem Verlauf ergeben dieselbe Landschaft', () => {
  const r = zufall(7);
  const verlauf = [];
  const live = neueWelt(123456);
  for (let t = 1; t <= 600; t++) {
    const schuesse = [];
    if (r() % 4 === 0) schuesse.push([1 + (r() % 4), r() % BREITE]);
    if (schuesse.length) verlauf.push([t, schuesse]);
    spieleTakt(live, schuesse);
  }
  const nachgeholt = neueWelt(123456);
  const nachTakt = new Map(verlauf);
  for (let t = 1; t <= 600; t++) spieleTakt(nachgeholt, nachTakt.get(t) || []);
  assert.equal(pruefsumme(nachgeholt), pruefsumme(live));
});

test('verschiedene Startwerte ergeben verschiedene Landschaften', () => {
  assert.notEqual(pruefsumme(neueWelt(1)), pruefsumme(neueWelt(2)));
});
