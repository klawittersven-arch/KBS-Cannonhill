// Mini-Pixelphysik für den Netztest.
//
// Zwei Aufgaben:
//  1. Leistungstest: Wie schnell rechnet dieses Handy Pixelphysik?
//  2. Gleichtakt-Test: Alle Handys einer Gruppe bekommen dieselben Takte und
//     müssen am Ende bit-genau dieselbe Landschaft haben.
//
// Deshalb nur Ganzzahl-Rechnung und ein eigener Zufallsgenerator:
// Math.random(), Math.sin() usw. können auf iPhone und Android verschieden sein.

export const BREITE = 320;
export const HOEHE = 200;

export const LUFT = 0;
export const ERDE = 1;
export const FELS = 2;
export const GRAS = 3;

/** Zufallsgenerator (mulberry32) – liefert auf allen Geräten dieselbe Folge. */
export function zufall(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

/** Erzeugt eine hügelige Landschaft aus dem Startwert. */
export function neueWelt(seed) {
  const feld = new Uint8Array(BREITE * HOEHE);
  const r = zufall(seed);
  let hoehe = 110 + (r() % 40);
  let steigung = 0;
  for (let x = 0; x < BREITE; x++) {
    steigung += (r() % 5) - 2;
    if (steigung > 3) steigung = 3;
    if (steigung < -3) steigung = -3;
    hoehe += steigung;
    if (hoehe < 60) { hoehe = 60; steigung = 1; }
    if (hoehe > 175) { hoehe = 175; steigung = -1; }
    for (let y = hoehe; y < HOEHE; y++) {
      let art = ERDE;
      if (y < hoehe + 2) art = GRAS;
      else if (y > hoehe + 18 && r() % 100 < 6) art = FELS;
      feld[y * BREITE + x] = art;
    }
  }
  return { feld, schritte: 0 };
}

/** Sprengt einen Krater; die Mitte liegt auf der Oberfläche der Spalte x. */
export function explosion(welt, x, radius) {
  const feld = welt.feld;
  x = ((x % BREITE) + BREITE) % BREITE;
  let y = 0;
  while (y < HOEHE - 1 && feld[y * BREITE + x] === LUFT) y++;
  const r2 = radius * radius;
  const fels2 = (radius >> 1) * (radius >> 1);
  for (let dy = -radius; dy <= radius; dy++) {
    const yy = y + dy;
    if (yy < 0 || yy >= HOEHE) continue;
    for (let dx = -radius; dx <= radius; dx++) {
      const xx = x + dx;
      if (xx < 0 || xx >= BREITE) continue;
      const d = dx * dx + dy * dy;
      if (d > r2) continue;
      const p = yy * BREITE + xx;
      if (feld[p] === FELS && d > fels2) continue; // Fels hält mehr aus
      feld[p] = LUFT;
    }
  }
  return y;
}

export const SCHUSS_RADIUS = 7;

/**
 * Ein Takt im Gleichtakt-Test: erst alle Schüsse des Takts, dann ein Physikschritt.
 * Wird live und beim Nachholen benutzt – beides muss exakt gleich rechnen.
 * @param {number[][]} schuesse  [[spielerNr, x], ...] in der Reihenfolge des Servers
 * @returns {number[][]} [[spielerNr, x, y], ...] für die Explosionsanzeige
 */
export function spieleTakt(welt, schuesse) {
  const treffer = [];
  for (const [nr, x] of schuesse) {
    treffer.push([nr, x, explosion(welt, x, SCHUSS_RADIUS)]);
  }
  schritt(welt);
  return treffer;
}

/** Ein Physikschritt: lose Erde und Gras rutschen nach unten. */
export function schritt(welt) {
  const feld = welt.feld;
  const vonLinks = (welt.schritte & 1) === 0;
  for (let y = HOEHE - 2; y >= 0; y--) {
    const zeile = y * BREITE;
    for (let i = 0; i < BREITE; i++) {
      const x = vonLinks ? i : BREITE - 1 - i;
      const p = zeile + x;
      const art = feld[p];
      if (art !== ERDE && art !== GRAS) continue;
      const unten = p + BREITE;
      if (feld[unten] === LUFT) {
        feld[unten] = art;
        feld[p] = LUFT;
        continue;
      }
      // seitlich abrutschen; Richtung wechselt nach festem Muster
      const richtung = ((x ^ y ^ welt.schritte) & 1) === 0 ? 1 : -1;
      const xs = x + richtung;
      if (xs >= 0 && xs < BREITE && feld[unten + richtung] === LUFT && feld[p + richtung] === LUFT) {
        feld[unten + richtung] = art;
        feld[p] = LUFT;
      }
    }
  }
  welt.schritte++;
}

/** Prüfsumme (FNV-1a) über die ganze Landschaft, als 8-stellige Hex-Zahl. */
export function pruefsumme(welt) {
  const feld = welt.feld;
  let h = 0x811c9dc5;
  for (let i = 0; i < feld.length; i++) {
    h ^= feld[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// --- Leistungstest -------------------------------------------------------

export const BENCH_SEED = 20261024;
export const BENCH_SCHRITTE = 300;
export const BENCH_MESSBEGINN = 100; // die ersten Schritte wärmen nur auf
// Auf jedem korrekt rechnenden Gerät kommt genau diese Prüfsumme heraus
// (wird von test/sim.test.js abgesichert).
export const BENCH_PRUEFSUMME = '784c6151';

/**
 * Rechnet eine feste Folge von Explosionen und Schritten.
 * @param {() => number} jetzt  Zeitmesser in Millisekunden
 * @returns {{msProSchritt: number, pruefsumme: string, korrekt: boolean}}
 */
export function leistungstest(jetzt = () => performance.now()) {
  const welt = neueWelt(BENCH_SEED);
  const r = zufall(BENCH_SEED ^ 0x5bd1e995);
  let start = 0;
  for (let i = 0; i < BENCH_SCHRITTE; i++) {
    if (i === BENCH_MESSBEGINN) start = jetzt();
    if (i % 10 === 0) explosion(welt, r() % BREITE, 6 + (r() % 10));
    schritt(welt);
  }
  const ms = (jetzt() - start) / (BENCH_SCHRITTE - BENCH_MESSBEGINN);
  const summe = pruefsumme(welt);
  return { msProSchritt: Math.round(ms * 100) / 100, pruefsumme: summe, korrekt: summe === BENCH_PRUEFSUMME };
}

/**
 * Fingerabdruck der Kommazahl-Funktionen dieses Browsers.
 * Geräte mit verschiedenem Ergebnis würden mit Math.sin & Co. auseinanderlaufen –
 * genau deshalb rechnet das spätere Spiel mit eigenen Funktionen.
 */
export function matheFingerabdruck() {
  const ansicht = new DataView(new ArrayBuffer(8));
  let h = 0x811c9dc5;
  const mische = (wert) => {
    ansicht.setFloat64(0, wert);
    for (let i = 0; i < 8; i++) {
      h ^= ansicht.getUint8(i);
      h = Math.imul(h, 0x01000193);
    }
  };
  for (let i = 1; i <= 2000; i++) {
    const x = i * 0.0137;
    mische(Math.sin(x));
    mische(Math.cos(x * 1.3));
    mische(Math.tan(x * 0.3));
    mische(Math.atan2(x, 1.7));
    mische(Math.pow(x, 0.37));
    mische(Math.exp(-x));
    mische(Math.log(x + 1));
    mische(Math.cbrt(x));
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
