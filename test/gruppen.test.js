import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planeTurnier, teileGruppen, beschreibePlan, MAX_FINALISTEN } from '../public/js/gruppen.js';

test('Beispiele aus der Planung', () => {
  assert.deepEqual(planeTurnier(5).groessen, [5]);
  assert.equal(planeTurnier(5).art, 'direktfinale');
  assert.deepEqual(planeTurnier(8).groessen, [8]);
  assert.deepEqual(planeTurnier(9).groessen, [3, 3, 3]);
  assert.deepEqual(planeTurnier(30).groessen, [4, 4, 4, 4, 4, 4, 3, 3]);
  assert.deepEqual(planeTurnier(32).groessen, [4, 4, 4, 4, 4, 4, 4, 4]);
  assert.deepEqual(planeTurnier(33).groessen, [5, 4, 4, 4, 4, 4, 4, 4]);
  assert.deepEqual(planeTurnier(40).groessen, [5, 5, 5, 5, 5, 5, 5, 5]);
});

test('jede Klassengröße von 2 bis 40 in jedem Modus ergibt eine gültige Einteilung', () => {
  for (const modus of ['auto', 'direktfinale', 'qualifying']) {
    for (let n = 2; n <= 40; n++) {
      const { art, groessen } = planeTurnier(n, modus);
      assert.equal(groessen.reduce((a, b) => a + b, 0), n, `${modus}/${n}: alle verteilt`);
      assert.ok(Math.max(...groessen) - Math.min(...groessen) <= 1, `${modus}/${n}: gleich groß`);
      if (art === 'direktfinale') {
        assert.ok(n <= MAX_FINALISTEN, `${modus}/${n}: Finale höchstens 8`);
      } else {
        assert.equal(art, 'qualifying');
        assert.ok(groessen.length >= 2 && groessen.length <= MAX_FINALISTEN, `${modus}/${n}: 2–8 Gruppen`);
        assert.ok(Math.min(...groessen) >= 2, `${modus}/${n}: niemand allein`);
        assert.ok(Math.max(...groessen) <= 5, `${modus}/${n}: höchstens 5 pro Gruppe`);
      }
    }
  }
});

test('Lehrkraft kann überstimmen, soweit es geht', () => {
  assert.equal(planeTurnier(6, 'qualifying').art, 'qualifying');
  assert.deepEqual(planeTurnier(6, 'qualifying').groessen, [3, 3]);
  assert.equal(planeTurnier(12, 'direktfinale').art, 'qualifying');
  assert.match(planeTurnier(12, 'direktfinale').hinweis, /höchstens 8/);
  assert.equal(planeTurnier(3, 'qualifying').art, 'direktfinale');
  assert.equal(planeTurnier(1).art, 'zuwenig');
  assert.equal(planeTurnier(0).art, 'zuwenig');
});

test('teileGruppen verteilt jeden Spieler genau einmal', () => {
  const spieler = Array.from({ length: 30 }, (_, i) => `s${i}`);
  const { gruppen } = teileGruppen(spieler, 'auto');
  const alle = gruppen.flat();
  assert.equal(alle.length, 30);
  assert.equal(new Set(alle).size, 30);
});

test('Beschreibung für den Beamer', () => {
  assert.equal(beschreibePlan(30), 'Qualifying: 8 Gruppen (6×4, 2×3) → Finale mit 8');
  assert.equal(beschreibePlan(5), 'Direkt ins Finale mit 5');
  assert.equal(beschreibePlan(1), 'Warte auf mindestens 2 Spieler');
});
