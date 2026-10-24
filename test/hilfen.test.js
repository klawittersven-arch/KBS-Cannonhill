import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalisiereName, saeubere } from '../server/hilfen.ts';

test('Namen werden einheitlich geschrieben', () => {
  assert.equal(normalisiereName('lena', 'm'), 'Lena M.');
  assert.equal(normalisiereName('  ümit  ', 'ö'), 'Ümit Ö.');
  assert.equal(normalisiereName('Anna-Lena', 'k'), 'Anna-Lena K.');
  assert.equal(normalisiereName('Jean  Luc', 'd'), 'Jean Luc D.');
});

test('ungültige Namen werden abgelehnt', () => {
  assert.equal(normalisiereName('', 'm'), null);
  assert.equal(normalisiereName('Lena', ''), null);
  assert.equal(normalisiereName('Lena', 'MM'), null);
  assert.equal(normalisiereName('<script>', 'x'), null);
  assert.equal(normalisiereName('Lena123', 'm'), null);
  assert.equal(normalisiereName('Abcdefghijklmnopq', 'm'), null);
  assert.equal(normalisiereName(42, 'm'), null);
});

test('Messwerte werden auf einfache, kurze Werte beschränkt', () => {
  const sauber = saeubere({ a: 1.23456, b: 'x'.repeat(100), c: { d: { e: 1 } }, f: [1, 2], g: NaN, h: true });
  assert.deepEqual(sauber, { a: 1.23, b: 'x'.repeat(40), c: { d: null }, f: null, g: null, h: true });
  assert.equal(saeubere(null), null);
});
