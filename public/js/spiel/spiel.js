// Der Spielkern: eine Partie Cannonhill, Bild für Bild wie im Original
// (Physik, CheckPanzer, CheckHimmelPixel, CheckMunListe, FindActivePixel,
// Explosion, Laser, CheckBallon aus panzer.cpp).
//
// Deterministisch: gleicher Startwert + gleiche Eingaben = bit-genau gleicher
// Verlauf auf jedem Gerät. Deshalb nur der eigene Zufallsgenerator, keine
// Winkelfunktionen, und Effekte wie Rauch und Flammen entstehen erst in der
// Anzeige (zeichner.js) aus den Ereignissen.

import {
  BREITE, HOEHE, BEREICHE_X, BEREICHE_Y, BEREICH_B, BEREICH_H, G, T, IMPULSABGABE, HIMMELHOEHE, MAX_HIMMELPIXEL,
  MAX_MUN, MAX_SCHUSSENERGIE, MAX_LEBENSENERGIE, MAGNETKONSTANTE, BALLON_ZUFALL, MAX_SPIELER,
  BILDER_PRO_SEKUNDE, BILDER_PRO_TAKT, PANZER_B, PANZER_H, MUN_B, MUN_H, BALLON_B, BALLON_H,
  SALVE_SEKUNDEN, START_KRAFT, SCHUSS_TEILER,
  LUFT, WASSER, SCHNEE, PANZER, MUNITION, SAEURE, ARTEN, MASSE, REIBUNG,
  M_STEIN, M_SCHILD, M_LASER, M_MEDI, M_MAGNET, M_MAGRAKETE, M_MEGA, M_SCHNEEBALL, M_SPLITTER,
  M_RAKETE, M_GRANATE, M_FASS, MUN_ANZAHL, MUNITIONEN,
  EXP_NICHTS, EXP_KRATER, EXP_EXPLOSION, EXP_GRANATE, EXP_SPLITTER, EXP_FASS, EXP_MEGA, EXP_SCHNEEBALL,
  KANONE, KANONE_SENKRECHT, SPIELERFARBEN, startLager,
} from './regeln.js';
import { Welt, HANG_WAAGRECHT, HANG_SCHRAEG, rest } from './welt.js';

const FREI = -1; // Munitionsplatz unbenutzt
const KANONE_45_LINKS = 18; // [-14, -14]
const KANONE_45_RECHTS = 58; // [14, -14]
export const HIMMEL = 99; // "Besitzer" der Geschosse aus dem Sudden-Death-Regen

// Wer ruft die Physik auf? (InfoNr im Original)
const INFO_HIMMEL = -1;
const INFO_PIXEL = -2;
const INFO_PANZER = -3;

// sqrt(Reibung a · Reibung b) für jedes Materialpaar, einmal ausgerechnet
const REIBFAKTOR = new Float64Array(ARTEN * ARTEN);
for (let a = 0; a < ARTEN; a++) for (let b = 0; b < ARTEN; b++) REIBFAKTOR[a * ARTEN + b] = Math.sqrt(REIBUNG[a] * REIBUNG[b]);

/** Zufallsgenerator (mulberry32): auf allen Geräten dieselbe Folge. */
export function zufallsgenerator(seed) {
  let a = seed >>> 0;
  const r = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
  r.zustand = () => a;
  return r;
}

export class Spiel {
  /**
   * @param {object} o
   * @param {number} o.seed
   * @param {{nr: number, name: string}[]} o.spieler  2–8 Spieler
   * @param {boolean} [o.wind]
   * @param {boolean} [o.wetter]
   * @param {number|null} [o.suddenDeath]  Sekunden bis zum Geschossregen (null = nie)
   * @param {number|null} [o.ende]  Sekunden bis zum harten Ende (null = nie)
   * @param {number|null} [o.salve]  alle so viele Sekunden feuern alle gemeinsam (null = jeder feuert selbst)
   * @param {object|null} [o.steinTextur]  nur für die Farben
   */
  constructor({ seed, spieler, wind = false, wetter = false, suddenDeath = 120, ende = 130, salve = SALVE_SEKUNDEN, steinTextur = null }) {
    if (spieler.length < 1 || spieler.length > MAX_SPIELER) throw new Error('1 bis 8 Spieler');
    this.zufall = zufallsgenerator(seed);
    this.welt = new Welt(steinTextur);
    this.bild = 0;
    this.phase = 'laeuft';
    this.sieger = null;
    this.siegGrund = null;
    this.ereignisse = [];
    this.suddenDeathBild = suddenDeath == null ? Infinity : Math.round(suddenDeath * BILDER_PRO_SEKUNDE);
    this.endeBild = ende == null ? Infinity : Math.round(ende * BILDER_PRO_SEKUNDE);
    this.naechsterRegen = 0;
    this.salveAbstand = salve == null ? null : Math.round(salve * BILDER_PRO_SEKUNDE);
    this.naechsteSalve = this.salveAbstand ?? Infinity;

    // Reihenfolge der Zufallszahlen wie in NeuesSpiel()
    this.wind = wind ? rest(this.zufall(), 7) - 3 : 0;
    this.wetter = wetter ? rest(this.zufall(), 3) : 0; // 0 nichts, 1 Regen, 2 Schnee
    this.himmel = rest(this.zufall(), 3);
    this.welt.erzeugeLandschaft(this.zufall);

    this.panzer = spieler.map((s, i) => ({
      nr: s.nr,
      name: s.name,
      farbe: SPIELERFARBEN[i],
      bildNr: i, // welche Panzerfarbe aus Panzer.png (ab 4: umgefärbt)
      aktiv: true,
      x: 10,
      y: 10,
      relx: 0.5,
      rely: 0.5,
      vx: 0,
      vy: 0,
      kanone: KANONE_SENKRECHT,
      kx: KANONE[KANONE_SENKRECHT][0],
      ky: KANONE[KANONE_SENKRECHT][1],
      schussAktiv: false,
      munition: M_STEIN,
      lager: startLager(),
      kraft: START_KRAFT, // eingestellte Schusskraft
      schussEnergie: 0,
      energie: MAX_LEBENSENERGIE,
      version: 0,
      schild: 0,
      magnet: 0,
      treffer: 0,
      abschuesse: 0,
      todBild: null,
    }));
    this.panzerNachNr = new Map(this.panzer.map((p, i) => [p.nr, i]));
    this.stellePanzerAuf();

    this.mun = Array.from({ length: MAX_MUN }, () => ({
      besitzer: FREI, typ: M_STEIN, x: 1, y: 1, relx: 0.5, rely: 0.5, vx: 0, vy: 0, bx: 0, by: 0, leben: -1, ausserhalb: false,
    }));
    this.himmelPixel = Array.from({ length: MAX_HIMMELPIXEL }, () => ({
      art: LUFT, x: 0, y: 0, relx: 0.5, rely: 0.5, vx: 0, vy: 0, leben: -1,
    }));
    this.ballon = { aktiv: false, x: -1, y: -1, relx: 0.5, rely: 0.5, munition: -1, anzahl: 0 };

    // Arbeitsobjekt der Physik ("Objekt" im Original) und ihr Ergebnis
    this.o = { art: 0, x: 0, y: 0, relx: 0.5, rely: 0.5, vx: 0, vy: 0, bx: 0, by: 0, kontakt: false, leben: -1 };
    this.ex = 0;
    this.ey = 0;
    this.lx = 0;
    this.ly = 0;
    this.pruefDurchgang = 0;
    this.schaden = new Int32Array(spieler.length);
    this.energieVorher = new Int32Array(spieler.length);
  }

  get suddenDeath() {
    return this.bild >= this.suddenDeathBild;
  }

  /**
   * PutPanzer(): gleichmäßig verteilt auf die Oberfläche. Die Kanone zeigt zu Beginn
   * schräg zur Feldmitte – senkrecht fiele das Geschoss in der Salve auf einen selbst.
   */
  stellePanzerAuf() {
    const n = this.panzer.length;
    this.panzer.forEach((p, i) => {
      const x = Math.trunc(((i + 1) * BREITE) / (n + 1));
      p.x = x;
      p.y = this.welt.oberflaeche(x) - 1;
      p.kanone = x < BREITE / 2 ? KANONE_45_RECHTS : KANONE_45_LINKS;
      p.kx = KANONE[p.kanone][0];
      p.ky = KANONE[p.kanone][1];
    });
  }

  /** Ereignisse seit dem letzten Abholen (für Anzeige und Töne). */
  holeEreignisse() {
    const liste = this.ereignisse;
    this.ereignisse = [];
    return liste;
  }

  // --- Takt und Eingaben -------------------------------------------------------

  /** Wie viele Bilder bis zur nächsten gemeinsamen Salve (null ohne Salven). */
  get bilderBisSalve() {
    return this.salveAbstand == null ? null : Math.max(0, this.naechsteSalve - this.bild);
  }

  /**
   * Ein Netz-Takt: erst alle Eingaben in Server-Reihenfolge, dann drei Physikschritte.
   * Eingabe: {nr, w?: Kanonenstellung 0–76, m?: Munition, k?: Kraft 1–50, f?: 1 = Feuer}
   * Im Salven-Modus wird f ignoriert – dann feuern alle gemeinsam.
   */
  takt(eingaben = []) {
    for (const e of eingaben) this.wendeAn(e);
    for (let i = 0; i < BILDER_PRO_TAKT; i++) this.schritt();
  }

  wendeAn(e) {
    if (this.phase !== 'laeuft' || !e) return;
    const i = this.panzerNachNr.get(e.nr);
    if (i === undefined) return;
    const p = this.panzer[i];
    if (!p.aktiv) return;
    if (Number.isInteger(e.w) && e.w >= 0 && e.w < KANONE.length) {
      p.kanone = e.w;
      p.kx = KANONE[e.w][0];
      p.ky = KANONE[e.w][1];
    }
    if (Number.isInteger(e.m) && e.m > 0 && e.m < M_SPLITTER && p.lager[e.m] !== 0) p.munition = e.m;
    if (Number.isInteger(e.k)) p.kraft = Math.max(1, Math.min(MAX_SCHUSSENERGIE, e.k));
    if (e.f === 1 && this.salveAbstand == null && !p.schussAktiv) {
      p.schussEnergie = p.kraft;
      this.abschuss(i);
    }
  }

  /** Alle lebenden Panzer feuern gleichzeitig mit ihren eingestellten Werten. */
  salve() {
    this.naechsteSalve += this.salveAbstand;
    this.ereignisse.push({ typ: 'salve' });
    for (let i = 0; i < this.panzer.length; i++) {
      const p = this.panzer[i];
      if (!p.aktiv) continue;
      p.schussEnergie = p.kraft;
      this.abschuss(i, true);
    }
  }

  /** Ein Bild der Spielschleife (Refresh() im Zustand SZSPIEL). */
  schritt() {
    this.bild++;
    const laeuft = this.phase === 'laeuft';
    if (laeuft) {
      if (this.bild >= this.naechsteSalve) this.salve();
      if (this.bild === this.suddenDeathBild) this.starteSuddenDeath();
      if (this.bild >= this.suddenDeathBild) this.himmelsregen();
      for (let i = 0; i < this.panzer.length; i++) this.energieVorher[i] = this.panzer[i].aktiv ? this.panzer[i].energie : -1;
    }
    if (this.bild % 2 === 0) this.bewegeBallon();
    this.bewegePanzer();
    this.bewegeHimmelPixel();
    this.bewegeMunition();
    if (this.bild % 3 === 0) this.machWetter();
    this.findeAktivePixel();
    for (const p of this.panzer) {
      if (!p.aktiv) continue;
      if (p.schild > 0) p.schild--;
      if (p.magnet > 0) p.magnet--;
    }
    if (laeuft) this.pruefeSieg();
  }

  // --- Sieg, Sudden Death --------------------------------------------------------

  pruefeSieg() {
    const lebend = this.panzer.filter((p) => p.aktiv);
    if (lebend.length === 1 && this.panzer.length > 1) return this.beende(lebend[0], 'letzter');
    if (lebend.length === 0) {
      // Die Letzten fielen gleichzeitig: wer vorher mehr Energie hatte, gewinnt.
      const kandidaten = this.panzer.filter((_, i) => this.energieVorher[i] >= 0);
      const besteEnergie = Math.max(...kandidaten.map((p) => this.energieVorher[this.panzer.indexOf(p)]));
      const beste = kandidaten.filter((p) => this.energieVorher[this.panzer.indexOf(p)] === besteEnergie);
      return this.beende(beste[rest(this.zufall(), beste.length)], 'gleichzeitig');
    }
    if (this.bild >= this.endeBild) {
      const besteEnergie = Math.max(...lebend.map((p) => p.energie));
      const beste = lebend.filter((p) => p.energie === besteEnergie);
      return this.beende(beste[rest(this.zufall(), beste.length)], 'zeit');
    }
  }

  beende(panzer, grund) {
    this.phase = 'ende';
    this.sieger = panzer.nr;
    this.siegGrund = grund;
    this.ereignisse.push({ typ: 'sieg', nr: panzer.nr, grund });
  }

  starteSuddenDeath() {
    for (const p of this.panzer) {
      p.schild = 0;
      p.magnet = 0;
    }
    this.naechsterRegen = this.bild;
    this.ereignisse.push({ typ: 'suddendeath' });
  }

  /** Immer dichterer Regen aus Raketen, bis spätestens zum Ende nur einer übrig ist. */
  himmelsregen() {
    if (this.bild < this.naechsterRegen) return;
    const dauer = this.endeBild - this.suddenDeathBild;
    const fortschritt = Number.isFinite(dauer) ? Math.min(1, (this.bild - this.suddenDeathBild) / dauer) : 0;
    this.naechsterRegen = this.bild + Math.max(4, Math.round(40 - 36 * fortschritt));
    const s = this.freierPlatz();
    if (s < 0) return;
    const m = this.mun[s];
    this.belegePlatz(m, M_RAKETE, rest(this.zufall(), BREITE), -1, rest(this.zufall(), 11) - 5, 5 + rest(this.zufall(), 10), HIMMEL);
    m.ausserhalb = true;
  }

  // --- Physik ---------------------------------------------------------------------

  /**
   * Physik(): bewegt das Arbeitsobjekt this.o einen Schritt weiter.
   * Ergebnis: false (aus dem Spiel) oder true mit neuer Position in this.ex/this.ey.
   * @param {boolean} beruehrung  stößt das Objekt mit der Landschaft zusammen?
   * @param {number} info  Munitionsplatz (≥ 0) oder INFO_HIMMEL/INFO_PIXEL/INFO_PANZER
   */
  physik(beruehrung, info) {
    const o = this.o;
    const welt = this.welt;
    let ax = 0;
    let ay = G;

    if (beruehrung) {
      const hang = welt.steigung(o.x, o.y);
      let nx = 0;
      let ny = 0;
      if (hang === HANG_WAAGRECHT) {
        ny = -G;
      } else if (hang === HANG_SCHRAEG) {
        const r = welt.steigR;
        const q = 1 + r * r;
        nx = (G * r) / q;
        ny = -G / q;
      }
      ax += nx;
      ay += ny;
      const vBetrag = Math.sqrt(o.vx * o.vx + o.vy * o.vy);
      if (vBetrag !== 0 && hang !== HANG_WAAGRECHT) {
        const nBetrag = Math.sqrt(nx * nx + ny * ny);
        const faktor = REIBFAKTOR[o.art * ARTEN + welt.artBei(o.x, o.y + 1)];
        ax += (-faktor * nBetrag * o.vx) / vBetrag;
        ay += (-faktor * nBetrag * o.vy) / vBetrag;
      }
    }
    ax += o.bx;
    ay += o.by;

    // Wind wirkt nur in der Luft
    const wind = this.wind;
    if (wind !== 0 && welt.artBei(o.x, o.y + 1) === LUFT) {
      let dx = wind * 10 - o.vx;
      if (wind > 0) {
        if (dx < 0) dx = 0;
        if (dx > wind) dx = wind;
      } else {
        if (dx > 0) dx = 0;
        if (dx < wind) dx = wind;
      }
      ax += dx;
    }

    let dvx = o.vx + 0.5 * ax * T;
    let dvy = o.vy + 0.5 * ay * T;
    let xn = o.x;
    let yn = o.y;
    o.relx += dvx * T;
    o.rely += dvy * T;
    if (o.relx < 0 || o.relx >= 1) {
      xn = Math.trunc(o.x + o.relx);
      o.relx -= xn - o.x;
    }
    if (o.rely < 0 || o.rely >= 1) {
      // Haftung: kleine Aufwärtsbewegung auf festem Grund wird geschluckt
      if (o.rely < 0 && dvy < 0 && dvy > -0.5 && welt.artBei(o.x, o.y + 1) !== LUFT) {
        dvy = 0;
        o.rely = 0.5;
      } else {
        yn = Math.trunc(o.y + o.rely);
        o.rely -= yn - o.y;
      }
    }

    // Außerhalb des Feldes
    if (xn >= BREITE || xn < 0) {
      if (info === INFO_PIXEL) {
        if (welt.artBei(o.x, o.y + 1) === LUFT) welt.loesche(o.x, o.y);
      } else if (info >= 0) {
        this.gibPlatzFrei(info);
      }
      return false;
    }
    if (yn >= HOEHE) {
      if (info === INFO_PIXEL) welt.aktiviere(o.x, o.y, false);
      else if (info >= 0) this.gibPlatzFrei(info);
      return false;
    }
    if (yn < 0) {
      if (info === INFO_PIXEL) {
        this.inDenHimmel(o.art, o.x, o.y, dvx, dvy, o.leben);
        o.kontakt = true;
        welt.loesche(o.x, o.y);
        return false;
      }
      if (info < 0) return false;
      const m = this.mun[info];
      if (!m.ausserhalb) {
        m.ausserhalb = true;
        m.vx = dvx;
        m.vy = dvy;
        m.y = -1;
        this.ex = xn;
        this.ey = yn;
        return true;
      }
    }

    // Zusammenstoß mit der Landschaft
    if (beruehrung && (xn !== o.x || yn !== o.y) && welt.art[yn * BREITE + xn] !== LUFT) {
      this.linie(o.x, o.y, xn, yn);
      const ex = this.lx;
      const ey = this.ly;
      const masse = MASSE[o.art];
      if (xn > ex && welt.artBei(ex + 1, ey) !== LUFT && dvx > dvy) {
        o.relx = 0.9;
        this.stoss(ex + 1, ey, dvx, dvy, masse);
        dvx = -(1 - IMPULSABGABE) * dvx * 0.6;
        dvy = (1 - IMPULSABGABE) * dvy * 0.6;
      }
      if (xn < ex && welt.artBei(ex - 1, ey) !== LUFT && dvx < dvy) {
        o.relx = 0.1;
        this.stoss(ex - 1, ey, dvx, dvy, masse);
        dvx = -(1 - IMPULSABGABE) * dvx * 0.6;
        dvy = (1 - IMPULSABGABE) * dvy * 0.6;
      }
      if (yn > ey && welt.artBei(ex, ey + 1) !== LUFT && dvy > dvx) {
        o.rely = 0.9;
        this.stoss(ex, ey + 1, dvx, dvy, masse);
        dvx = (1 - IMPULSABGABE) * dvx * 0.6;
        dvy = -(1 - IMPULSABGABE) * dvy * 0.6;
      }
      if (yn < ey && welt.artBei(ex, ey - 1) !== LUFT && dvy < dvx) {
        o.rely = 0.1;
        this.stoss(ex, ey - 1, dvx, dvy, masse);
        dvx = (1 - IMPULSABGABE) * dvx * 0.6;
        dvy = -(1 - IMPULSABGABE) * dvy * 0.6;
      }
      if (o.x === ex && o.y === ey &&
          welt.artBei(ex - 1, ey) !== LUFT && welt.artBei(ex + 1, ey) !== LUFT &&
          welt.artBei(ex, ey - 1) !== LUFT && welt.artBei(ex, ey + 1) !== LUFT) {
        dvx = 0;
        dvy = 0;
      }
      xn = ex;
      yn = ey;
      o.kontakt = true;
    }

    o.vx = dvx;
    o.vy = dvy;
    this.ex = xn;
    this.ey = yn;
    return true;
  }

  /** Impuls an ein getroffenes Pixel abgeben. */
  stoss(x, y, dvx, dvy, masse) {
    const welt = this.welt;
    const p = y * BREITE + x;
    const andere = MASSE[welt.art[p]];
    welt.vx[p] += (IMPULSABGABE * dvx * masse) / andere;
    welt.vy[p] += (IMPULSABGABE * dvy * masse) / andere;
    welt.aktiviere(x, y, true);
  }

  /** LineIntersect(): erstes freies Pixel auf dem Weg vom Ziel zurück zum Start. */
  linie(x1, y1, x2, y2) {
    if (x1 === x2 && y1 === y2) {
      this.lx = x1;
      this.ly = y1;
      return;
    }
    const dx = x2 - x1;
    const dy = y2 - y1;
    let sx;
    let sy;
    let schritte;
    if (Math.abs(dx) > Math.abs(dy)) {
      sx = dx > 0 ? -1 : 1;
      sy = dy / (dx * sx);
      schritte = Math.abs(dx);
    } else {
      sy = dy > 0 ? -1 : 1;
      sx = dy === 0 ? 0 : dx / (dy * sy);
      schritte = Math.abs(dy);
    }
    const art = this.welt.art;
    let x = x2;
    let y = y2;
    for (let i = 0; i < schritte; i++) {
      const ix = Math.trunc(x);
      const iy = Math.trunc(y);
      if (art[iy * BREITE + ix] === LUFT) {
        this.lx = ix;
        this.ly = iy;
        return;
      }
      x += sx;
      y += sy;
    }
    this.lx = x1;
    this.ly = y1;
  }

  inDenHimmel(art, x, y, vx, vy, leben) {
    for (const h of this.himmelPixel) {
      if (h.art !== LUFT) continue;
      h.art = art;
      h.x = x;
      h.y = y + HIMMELHOEHE - 1;
      h.relx = 0.5;
      h.rely = 0.5;
      h.vx = vx;
      h.vy = vy;
      h.leben = leben;
      return true;
    }
    return false;
  }

  // --- Panzer, Himmelspixel, Ballon, Wetter -----------------------------------------

  /** CheckPanzer() */
  bewegePanzer() {
    const o = this.o;
    for (const p of this.panzer) {
      if (!p.aktiv) continue;
      o.art = PANZER;
      o.x = p.x;
      o.y = p.y;
      o.relx = p.relx;
      o.rely = p.rely;
      o.vx = p.vx;
      o.vy = p.vy;
      o.bx = 0;
      o.by = 0;
      o.leben = -1;
      if (!this.physik(true, INFO_PANZER)) continue;
      p.relx = o.relx;
      p.rely = o.rely;
      p.vx = o.vx;
      p.vy = o.vy;
      p.x = this.ex;
      p.y = this.ey;
      if (p.magnet > 0) this.magnetFeld(p);
    }
  }

  /** CheckHimmelPixel(): Pixel oberhalb des Bildes fliegen weiter und fallen zurück. */
  bewegeHimmelPixel() {
    const o = this.o;
    for (const h of this.himmelPixel) {
      if (h.art === LUFT) continue;
      o.art = h.art;
      o.x = h.x;
      o.y = h.y;
      o.relx = h.relx;
      o.rely = h.rely;
      o.vx = h.vx;
      o.vy = h.vy;
      o.bx = 0;
      o.by = 0;
      o.leben = h.leben;
      if (!this.physik(false, INFO_HIMMEL)) {
        h.art = LUFT;
        continue;
      }
      h.relx = o.relx;
      h.rely = o.rely;
      h.vx = o.vx;
      h.vy = o.vy;
      h.x = this.ex;
      h.y = this.ey;
      if (this.ey >= HIMMELHOEHE) {
        this.welt.setze(this.ex, this.ey - HIMMELHOEHE + 1, h.art, Math.trunc(h.vx), Math.trunc(h.vy), true, h.leben);
        h.art = LUFT;
      }
    }
  }

  /** CheckBallon(): Fallschirm mit Munition; wer ihn abschießt, bekommt sie. */
  bewegeBallon() {
    const b = this.ballon;
    if (!b.aktiv && rest(this.zufall(), BALLON_ZUFALL) === 0) {
      b.aktiv = true;
      b.x = rest(this.zufall(), BREITE - BALLON_B);
      b.y = -BALLON_H;
      b.munition = rest(this.zufall(), MUN_ANZAHL - 2) + 1;
      b.anzahl = rest(this.zufall(), 3) + 1;
      b.relx = 0.5;
      b.rely = 0.5;
      this.ereignisse.push({ typ: 'ballon' });
      return;
    }
    if (!b.aktiv) return;
    b.relx += this.wind / 5;
    b.rely += 0.5;
    b.x += Math.trunc(b.relx);
    b.y += Math.trunc(b.rely);
    b.relx -= Math.trunc(b.relx);
    b.rely -= Math.trunc(b.rely);
    const mitte = b.x + BALLON_B / 2;
    if (mitte >= 0 && mitte < BREITE && this.welt.artBei(mitte, b.y + BALLON_H + 1) !== LUFT) this.ballonAbschuss(-1);
    if (b.x >= BREITE || b.x + BALLON_B < 0 || b.y >= HOEHE) b.aktiv = false;
  }

  /** BallonAbschuss() */
  ballonAbschuss(i) {
    const b = this.ballon;
    if (!b.aktiv) return;
    b.aktiv = false;
    const p = i >= 0 ? this.panzer[i] : null;
    if (p && p.lager[b.munition] !== -1) p.lager[b.munition] = Math.min(9, p.lager[b.munition] + b.anzahl);
    this.ereignisse.push({ typ: 'fetz', bild: 'ballon', x: b.x, y: b.y, nr: p ? p.nr : null, mun: b.munition, anzahl: b.anzahl });
  }

  /** MakeWetter() */
  machWetter() {
    if (this.wetter === 1) this.welt.setze(rest(this.zufall(), BREITE), 2, WASSER, 0, 0, true, -1);
    else if (this.wetter === 2) this.welt.setze(rest(this.zufall(), BREITE), 2, SCHNEE, 0, 0, true, -1);
  }

  // --- Aktive Pixel ------------------------------------------------------------------

  /** FindActivePixel(): bewegt alle aktiven Pixel, bereichsweise wie im Original. */
  findeAktivePixel() {
    const welt = this.welt;
    const { art, aktiv, pruefNr, relx, rely, vx, vy, bx, by, leben, bereichZahl } = welt;
    const o = this.o;
    const nr = ++this.pruefDurchgang >>> 0;
    const schaden = this.schaden;
    schaden.fill(0);
    const lebensdauerZaehlt = this.bild % 3 === 0;

    for (let bi = 0; bi < BEREICHE_X; bi++) {
      for (let bj = 0; bj < BEREICHE_Y; bj++) {
        if (bereichZahl[bi * BEREICHE_Y + bj] === 0) continue;
        const x0 = bi * BEREICH_B;
        const y0 = bj * BEREICH_H;
        for (let x = x0; x < x0 + BEREICH_B; x++) {
          for (let y = y0; y < y0 + BEREICH_H; y++) {
            const p = y * BREITE + x;
            if (!aktiv[p] || pruefNr[p] === nr || art[p] === LUFT) continue;
            pruefNr[p] = nr;

            o.art = art[p];
            o.x = x;
            o.y = y;
            o.relx = relx[p];
            o.rely = rely[p];
            o.vx = vx[p];
            o.vy = vy[p];
            o.bx = bx[p];
            o.by = by[p];
            o.leben = leben[p];
            if (!this.physik(true, INFO_PIXEL)) continue;
            relx[p] = o.relx;
            rely[p] = o.rely;
            vx[p] = o.vx;
            vy[p] = o.vy;
            bx[p] = 0;
            by[p] = 0;
            let ex = this.ex;
            let ey = this.ey;

            // In Wasser und Säure versinken
            const unten = welt.artBei(x, y + 1);
            if ((unten === WASSER || unten === SAEURE) && !(art[p] === WASSER || art[p] === SAEURE)) {
              welt.bewege(x, y, x, y + 1);
              ex = x;
              ey = y;
            }

            // Pixel mit begrenzter Lebensdauer
            if (lebensdauerZaehlt) {
              if (leben[p] > 0) leben[p]--;
              if (leben[p] === 0) {
                welt.loesche(x, y);
                continue;
              }
            }

            // Säure frisst Panzer an
            if (art[p] === SAEURE) {
              const t = this.kollision(x, y);
              if (t >= 0 && t < this.panzer.length) {
                schaden[t]++;
                welt.loesche(x, y);
                continue;
              }
            }

            if (Math.sqrt(vx[p] * vx[p] + vy[p] * vy[p]) < 0.05 && ex === x && ey === y &&
                welt.artBei(ex, ey + 1) !== LUFT && leben[p] === -1) {
              welt.aktiviere(x, y, false); // zu langsam: liegen bleiben
            } else if (ex !== x || ey !== y) {
              welt.bewege(x, y, ex, ey);
            }
          }
        }
      }
    }
    for (let i = 0; i < this.panzer.length; i++) this.aendereEnergie(i, -schaden[i], -1);
  }

  // --- Munition ------------------------------------------------------------------------

  freierPlatz() {
    for (let i = 0; i < MAX_MUN; i++) if (this.mun[i].besitzer === FREI) return i;
    return -1;
  }

  belegePlatz(m, typ, x, y, vx, vy, besitzer) {
    m.typ = typ;
    m.x = x;
    m.y = y;
    m.relx = 0.5;
    m.rely = 0.5;
    m.vx = vx;
    m.vy = vy;
    m.bx = 0;
    m.by = 0;
    m.besitzer = besitzer;
    m.leben = MUNITIONEN[typ].dauer;
    m.ausserhalb = false;
  }

  /** Geschoss ist weg: Platz frei, Panzer darf wieder schießen, wenn nichts mehr von ihm fliegt. */
  gibPlatzFrei(i) {
    const b = this.mun[i].besitzer;
    this.mun[i].besitzer = FREI;
    const p = this.panzer[b];
    if (!p) return;
    p.schussAktiv = this.mun.some((m) => m.besitzer === b);
    if (!p.schussAktiv) p.schussEnergie = 0;
  }

  /** CheckMunListe() */
  bewegeMunition() {
    const o = this.o;
    for (let i = 0; i < MAX_MUN; i++) {
      const m = this.mun[i];
      if (m.besitzer === FREI) continue;
      m.leben--;
      o.art = MUNITION;
      o.x = m.x;
      o.y = m.y;
      o.relx = m.relx;
      o.rely = m.rely;
      o.vx = m.vx;
      o.vy = m.vy;
      o.bx = m.bx;
      o.by = m.by;
      o.kontakt = false;
      o.leben = m.leben;
      if (m.typ === M_MAGRAKETE) this.magnetRakete();
      if (!this.physik(!m.ausserhalb, i)) continue;
      m.relx = o.relx;
      m.rely = o.rely;
      m.x = this.ex;
      m.y = this.ey;
      m.bx = 0;
      m.by = 0;
      if (this.ey >= 0 && m.ausserhalb) m.ausserhalb = false;

      let t = this.kollision(m.x, m.y);
      if (t >= 1000 && this.mun[t - 1000].besitzer === m.besitzer) t = -1;
      if ((t !== -1 && !m.ausserhalb) || m.leben === 0 || o.kontakt) {
        if (m.x >= 0 && m.x < BREITE - 1) this.explosion(i);
        const k = t >= 1000 ? t - 1000 : -1;
        if (k >= 0 && this.mun[k].x >= 0 && this.mun[k].x < BREITE - 1) this.explosion(k);
        const besitzer = m.besitzer;
        this.gibPlatzFrei(i);
        if (k >= 0 && this.mun[k].besitzer !== FREI) this.gibPlatzFrei(k);
        if (t === -2) this.ballonAbschuss(besitzer >= 0 && besitzer < this.panzer.length ? besitzer : -1);
      }
      m.vx = o.vx;
      m.vy = o.vy;
    }
  }

  /** CheckKollision(): Panzer-Index, 1000 + Munitionsplatz, -2 Ballon oder -1. */
  kollision(x, y) {
    const panzer = this.panzer;
    for (let i = 0; i < panzer.length; i++) {
      const p = panzer[i];
      if (!p.aktiv) continue;
      if (x >= p.x - PANZER_B / 2 && x < p.x + PANZER_B / 2 && y >= p.y - PANZER_H && y < p.y) return i;
    }
    for (let i = 0; i < MAX_MUN; i++) {
      const m = this.mun[i];
      if (m.besitzer === FREI || (m.x === x && m.y === y)) continue;
      if (x >= m.x - MUN_B / 2 && x < m.x + MUN_B / 2 && y >= m.y - MUN_H / 2 && y < m.y + MUN_H / 2) return 1000 + i;
    }
    const b = this.ballon;
    if (b.aktiv && x >= b.x && x < b.x + BALLON_B && y >= b.y && y < b.y + BALLON_H) return -2;
    return -1;
  }

  /** MakeMagRakete(): die Magnetrakete wird von allen Panzern angezogen. */
  magnetRakete() {
    const o = this.o;
    for (const p of this.panzer) {
      if (!p.aktiv) continue;
      const dx = o.x - p.x;
      const dy = o.y - p.y;
      const abstand2 = dx * dx + dy * dy;
      if (abstand2 === 0) continue;
      const kraft = MAGNETKONSTANTE / abstand2;
      const abstand = Math.sqrt(abstand2);
      o.bx += (-dx * kraft) / abstand;
      o.by += (-dy * kraft) / abstand;
    }
  }

  /** MakeMagnet(): ein Panzer mit Magnet stößt Geschosse ab. */
  magnetFeld(p) {
    for (const m of this.mun) {
      if (m.besitzer === FREI || m.typ === M_STEIN || m.typ === M_SCHNEEBALL || m.typ === M_MEGA) continue;
      const dx = m.x - p.x;
      const dy = m.y - p.y;
      const abstand2 = dx * dx + dy * dy;
      if (abstand2 === 0) continue;
      const kraft = MAGNETKONSTANTE / abstand2;
      const abstand = Math.sqrt(abstand2);
      m.bx += (dx * kraft) / abstand;
      m.by += (dy * kraft) / abstand;
    }
  }

  // --- Schießen und Treffer ------------------------------------------------------------

  /**
   * Abschuss(): mit der eingestellten Munition und Schussenergie.
   * In der Salve darf auch geschossen werden, während das letzte Geschoss noch fliegt.
   */
  abschuss(i, inSalve = false) {
    const p = this.panzer[i];
    const mun = p.munition;
    const lager = p.lager;
    if (p.schussEnergie !== 0 && (inSalve || !p.schussAktiv) && (lager[mun] > 0 || lager[mun] === -1)) {
      if (this.suddenDeath && (mun === M_SCHILD || mun === M_MEDI || mun === M_MAGNET)) {
        p.schussEnergie = 0;
        return;
      }
      this.ereignisse.push({ typ: 'schuss', nr: p.nr, mun, x: p.x, y: p.y });
      if (mun === M_SCHILD) {
        p.schussEnergie = 0;
        if (p.schild !== 0) return;
        p.schild = MUNITIONEN[M_SCHILD].dauer;
      } else if (mun === M_MAGNET) {
        p.schussEnergie = 0;
        if (p.magnet !== 0) return;
        p.magnet = MUNITIONEN[M_MAGNET].dauer;
      } else if (mun === M_LASER) {
        p.schussEnergie = 0;
        this.laser(i);
      } else if (mun === M_MEDI) {
        p.schussEnergie = 0;
        this.aendereEnergie(i, MAX_LEBENSENERGIE, -1);
      } else {
        const s = this.freierPlatz();
        if (s >= 0) {
          p.schussAktiv = true;
          this.belegePlatz(this.mun[s], mun, p.x + p.kx, p.y + p.ky,
            Math.trunc((p.kx * p.schussEnergie) / SCHUSS_TEILER), Math.trunc((p.ky * p.schussEnergie) / SCHUSS_TEILER), i);
        }
      }
      if (lager[mun] !== -1) lager[mun]--;
      if (lager[mun] === 0) p.munition = M_STEIN; // leer: zurück zum Stein
    } else if (lager[mun] <= 0 && lager[mun] !== -1) {
      p.schussEnergie = 0;
    }
  }

  /** Laser(): Strahl in Kanonenrichtung bis zum Bildrand. */
  laser(i) {
    const p = this.panzer[i];
    const welt = this.welt;
    const dx = p.kx;
    const dy = p.ky;
    let sx;
    let sy;
    let schritte;
    if (Math.abs(dx) > Math.abs(dy)) {
      sx = dx > 0 ? -1 : 1;
      sy = dx === 0 ? 0 : dy / (dx * sx);
      schritte = Math.abs(dx);
    } else {
      sy = dy > 0 ? -1 : 1;
      sx = dy === 0 ? 0 : dx / (dy * sy);
      schritte = Math.abs(dy);
    }
    const getroffen = new Uint8Array(this.panzer.length);
    let ballonGetroffen = false;
    let ende = 0;
    for (let k = 1; ; k++) {
      let x = p.x + k * dx;
      let y = p.y + k * dy;
      if (x < 0 || x >= BREITE || y < 0 || y >= HOEHE) break;
      ende = k;
      for (let j = 0; j < schritte; j++) {
        const ix = Math.trunc(x);
        const iy = Math.trunc(y);
        welt.loesche(ix, iy);
        const jx = ix - 1 + rest(this.zufall(), 2);
        const jy = iy - 1 + rest(this.zufall(), 2);
        welt.loesche(jx, jy);
        const t = this.kollision(ix, iy);
        if (t >= 0 && t < this.panzer.length) getroffen[t] = 1;
        else if (t === -2) ballonGetroffen = true;
        x += sx;
        y += sy;
      }
    }
    this.ereignisse.push({ typ: 'laser', x: p.x, y: p.y, dx, dy, laenge: ende });
    for (let t = 0; t < this.panzer.length; t++) {
      if (getroffen[t] && this.panzer[t].schild === 0 && t !== i) this.aendereEnergie(t, -MUNITIONEN[M_LASER].schaden, i);
    }
    if (ballonGetroffen) this.ballonAbschuss(i);
  }

  /** ChangeLebensEnergie() */
  aendereEnergie(i, anzahl, verursacher) {
    if (anzahl === 0) return;
    const p = this.panzer[i];
    const taeter = verursacher >= 0 && verursacher !== i ? this.panzer[verursacher] : null;
    p.energie += anzahl;
    if (taeter) taeter.treffer -= anzahl;
    if (p.energie > MAX_LEBENSENERGIE) p.energie = MAX_LEBENSENERGIE;
    if (p.energie < 0) {
      if (taeter) taeter.abschuesse++;
      p.energie = 0;
      p.aktiv = false;
      p.todBild = this.bild;
      this.ereignisse.push({ typ: 'tot', nr: p.nr, x: p.x, y: p.y, durch: taeter ? taeter.nr : null });
      this.panzerExplosion(i);
      return;
    }
    if (p.energie < (MAX_LEBENSENERGIE * 3) / 4 && p.energie > MAX_LEBENSENERGIE / 4) p.version = 1;
    if (p.energie > (MAX_LEBENSENERGIE * 3) / 4) p.version = 0;
    if (p.energie < MAX_LEBENSENERGIE / 4) p.version = 2;
    this.ereignisse.push({ typ: 'treffer', nr: p.nr, anzahl });
  }

  /** PanzerExpl(): der Panzer zerplatzt in Splitter. */
  panzerExplosion(i) {
    const p = this.panzer[i];
    for (let k = 0; k <= 10; k++) {
      const s = this.freierPlatz();
      if (s < 0) break;
      this.belegePlatz(this.mun[s], M_SPLITTER, p.x, p.y, 20 - rest(this.zufall(), 40), -rest(this.zufall(), 40), i);
    }
    this.ereignisse.push({ typ: 'fetz', bild: 'panzer', x: p.x - PANZER_B / 2, y: p.y - PANZER_H, nr: p.nr, version: p.version });
  }

  /** Explosion(): Wirkung des Geschosses am Einschlagsort. */
  explosion(i) {
    const m = this.mun[i];
    const art = MUNITIONEN[m.typ];
    if (art.explosion === EXP_NICHTS) return;
    const welt = this.welt;
    const schaden = this.schaden;
    schaden.fill(0);
    const anzahlPanzer = this.panzer.length;
    const mx = m.x;
    const my = m.y;
    this.ereignisse.push({ typ: 'explosion', art: art.explosion, mun: m.typ, x: mx, y: my, vx: m.vx, vy: m.vy });

    const kreis = (radius, jePixel) => {
      for (let rx = -radius; rx <= radius; rx++) {
        for (let ry = -radius; ry <= radius; ry++) {
          const abstand2 = rx * rx + ry * ry;
          if (abstand2 > radius * radius) continue;
          jePixel(mx + rx, my + ry, rx, ry, abstand2);
        }
      }
    };
    const triff = (x, y, betrag) => {
      const t = this.kollision(x, y);
      if (t >= 0 && t < anzahlPanzer && schaden[t] < betrag) schaden[t] = betrag;
    };
    const innen = (x, y) => x >= 0 && x < BREITE && y >= 0 && y < HOEHE;

    switch (art.explosion) {
      case EXP_KRATER:
        kreis(10, (x, y, rx, ry) => {
          if (!innen(x, y)) return;
          const p = y * BREITE + x;
          if (welt.art[p] !== LUFT) {
            if (rest(this.zufall(), 2) === 0) {
              welt.loesche(x, y);
            } else {
              welt.bx[p] = -m.vx * 10;
              welt.by[p] = -m.vy * 10;
              welt.aktiviere(x, y, true);
            }
          }
          if (rx >= -3 && rx <= 3 && ry >= -3 && ry <= 3) {
            const t = this.kollision(x, y);
            if (t >= 0 && t < anzahlPanzer) schaden[t] = art.schaden;
          }
        });
        this.ereignisse.push({ typ: 'fetz', bild: 'mun', mun: m.typ, x: mx - MUN_B / 2, y: my - MUN_H / 2 });
        break;

      case EXP_EXPLOSION:
      case EXP_GRANATE: {
        const radius = art.explosion === EXP_EXPLOSION ? 20 : 10;
        kreis(radius, (x, y, rx, ry, abstand2) => {
          if (!innen(x, y)) return;
          if (welt.art[y * BREITE + x] !== LUFT) welt.loesche(x, y);
          // Im Original: Schaden · (1 − Abstand / 20) mit Ganzzahl-Division
          triff(x, y, abstand2 < 400 ? art.schaden : 0);
        });
        if (art.explosion === EXP_GRANATE) {
          for (let k = 0; k <= 5; k++) {
            const s = this.freierPlatz();
            if (s < 0) break;
            const vx = m.vx + 20 - rest(this.zufall(), 40);
            const vy = m.vy + 20 - rest(this.zufall(), 40);
            this.belegePlatz(this.mun[s], M_SPLITTER, mx, my, vx, vy, m.besitzer);
          }
        }
        break;
      }

      case EXP_SPLITTER:
        kreis(5, (x, y) => {
          if (!innen(x, y)) return;
          const p = y * BREITE + x;
          if (welt.art[p] !== LUFT && rest(this.zufall(), 2) === 0) welt.loesche(x, y);
          triff(x, y, art.schaden);
          if (welt.art[p] !== LUFT) {
            welt.bx[p] = -m.vx * 10;
            welt.by[p] = -m.vy * 10;
            welt.aktiviere(x, y, true);
          }
        });
        break;

      case EXP_FASS:
        kreis(10, (x, y) => {
          if (x >= BREITE || x < 0 || y >= HOEHE) return;
          if (y < 0) {
            if (this.himmelPixel.some((h) => h.art === LUFT)) {
              const vx = -10 + rest(this.zufall(), 20);
              const vy = -10 + rest(this.zufall(), 20);
              this.inDenHimmel(SAEURE, x, y, vx, vy, rest(this.zufall(), 2000));
            }
            return;
          }
          if (welt.art[y * BREITE + x] !== LUFT) welt.loesche(x, y);
          const vx = -10 + rest(this.zufall(), 20);
          const vy = -10 + rest(this.zufall(), 20);
          welt.setze(x, y, SAEURE, vx, vy, true, rest(this.zufall(), 2000));
        });
        break;

      case EXP_MEGA:
        for (let k = 0; k <= 7; k++) {
          const s = this.freierPlatz();
          if (s < 0) break;
          let typ;
          do {
            typ = rest(this.zufall(), MUN_ANZAHL - 2) + 1;
          } while (typ !== M_RAKETE && typ !== M_STEIN && typ !== M_GRANATE && typ !== M_MAGRAKETE && typ !== M_FASS);
          const vx = 20 - rest(this.zufall(), 40);
          const vy = -rest(this.zufall(), 40);
          this.belegePlatz(this.mun[s], typ, mx, my, vx, vy, m.besitzer);
        }
        break;

      case EXP_SCHNEEBALL:
        kreis(20, (x, y) => {
          if (x >= BREITE || x < 0 || y >= HOEHE) return;
          if (y < 0) {
            if (this.himmelPixel.some((h) => h.art === LUFT)) {
              const vx = -10 + rest(this.zufall(), 20);
              const vy = -10 + rest(this.zufall(), 20);
              this.inDenHimmel(SCHNEE, x, y, vx, vy, -1);
            }
            return;
          }
          if (welt.art[y * BREITE + x] !== LUFT) return;
          const vx = -10 + rest(this.zufall(), 20);
          const vy = -10 + rest(this.zufall(), 20);
          welt.setze(x, y, SCHNEE, vx, vy, true, -1);
        });
        break;
    }

    for (let t = 0; t < anzahlPanzer; t++) {
      if (this.panzer[t].schild === 0) this.aendereEnergie(t, -schaden[t], m.besitzer);
    }
  }

  // --- Prüfsumme ---------------------------------------------------------------------------

  /** Fingerabdruck des ganzen Spielzustands (ohne Farben). */
  pruefsumme() {
    let h = 0x811c9dc5;
    const zahl = new Float64Array(1);
    const bytes = new Uint8Array(zahl.buffer);
    const mischeByte = (b) => {
      h ^= b;
      h = Math.imul(h, 0x01000193);
    };
    const mische = (wert) => {
      zahl[0] = wert;
      for (let i = 0; i < 8; i++) mischeByte(bytes[i]);
    };
    const art = this.welt.art;
    for (let i = 0; i < art.length; i++) {
      h ^= art[i];
      h = Math.imul(h, 0x01000193);
    }
    mische(this.bild);
    mische(this.wind);
    mische(this.zufall.zustand());
    mische(this.sieger ?? -1);
    for (const p of this.panzer) {
      for (const wert of [p.aktiv ? 1 : 0, p.x, p.y, p.relx, p.rely, p.vx, p.vy, p.energie, p.kanone, p.munition, p.kraft, p.schild, p.magnet, p.schussEnergie]) mische(wert);
      for (const l of p.lager) mische(l);
    }
    this.mun.forEach((m, i) => {
      if (m.besitzer === FREI) return;
      for (const wert of [i, m.typ, m.besitzer, m.x, m.y, m.relx, m.rely, m.vx, m.vy, m.leben]) mische(wert);
    });
    for (const p of this.himmelPixel) if (p.art !== LUFT) for (const wert of [p.art, p.x, p.y, p.vx, p.vy]) mische(wert);
    const b = this.ballon;
    if (b.aktiv) for (const wert of [b.x, b.y, b.munition, b.anzahl]) mische(wert);
    return (h >>> 0).toString(16).padStart(8, '0');
  }
}
