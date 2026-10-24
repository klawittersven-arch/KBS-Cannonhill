// Das Pixelfeld: Landschaft, aktive Pixel und die Pixel-Grundoperationen
// (MakePixel, MovePixel, DeletePixel, Aktivate, Steigung und Compute aus panzer.cpp).
//
// Alles, was den Spielverlauf bestimmt, rechnet nur mit + - * / und Vergleichen –
// so kommt auf jedem Gerät exakt dasselbe heraus. Nur die Farben sind Zufall
// des einzelnen Geräts und zählen nicht zur Prüfsumme.

import {
  BREITE, HOEHE, BEREICHE, BEREICH_B, BEREICH_H, LUFT, GRAS, STEIN, SCHNEE, ERDE,
  SCHNEEDICKE, GRASDICKE, ERDDICKE, FARBE, FARBSTREUUNG,
} from './regeln.js';

const N = BREITE * HOEHE;

/** Hangart aus steigung(): 0 = waagrecht, 1 = Hang (Steigungszahl in steigR), 2 = senkrecht. */
export const HANG_WAAGRECHT = 0;
export const HANG_SCHRAEG = 1;
export const HANG_SENKRECHT = 2;

export class Welt {
  constructor(steinTextur = null) {
    this.art = new Uint8Array(N);
    this.aktiv = new Uint8Array(N);
    this.pruefNr = new Uint32Array(N);
    this.relx = new Float64Array(N).fill(0.5);
    this.rely = new Float64Array(N).fill(0.5);
    this.vx = new Float64Array(N);
    this.vy = new Float64Array(N);
    this.bx = new Float64Array(N); // Zusatzbeschleunigung (z. B. durch Explosionen)
    this.by = new Float64Array(N);
    this.leben = new Int32Array(N).fill(-1);
    this.bereichZahl = new Int32Array(BEREICHE * BEREICHE); // aktive Pixel je Bereich

    // Nur für die Anzeige
    this.farbe = new Uint32Array(N);
    this.steinTextur = steinTextur; // {daten: Uint32Array, breite, hoehe}
    this.geaendert = new Uint8Array(N);
    this.aenderungen = new Int32Array(N);
    this.anzahlAenderungen = 0;
    this.allesNeu = true;

    // Ergebnis von steigung()
    this.steigR = 0;
  }

  /** Material an (x, y); außerhalb des Feldes Luft. */
  artBei(x, y) {
    if (x < 0 || x >= BREITE || y < 0 || y >= HOEHE) return LUFT;
    return this.art[y * BREITE + x];
  }

  markiere(p) {
    if (this.geaendert[p]) return;
    this.geaendert[p] = 1;
    this.aenderungen[this.anzahlAenderungen++] = p;
  }

  /** Aktivate(): Pixel wird (nicht mehr) berechnet. */
  aktiviere(x, y, an) {
    if (x < 0 || x >= BREITE || y < 0 || y >= HOEHE) return;
    const p = y * BREITE + x;
    const b = ((x / BEREICH_B) | 0) * BEREICHE + ((y / BEREICH_H) | 0);
    if (an) {
      if (!this.aktiv[p]) {
        this.aktiv[p] = 1;
        this.bereichZahl[b]++;
      }
      return;
    }
    if (this.aktiv[p]) {
      this.aktiv[p] = 0;
      this.bereichZahl[b]--;
    }
    this.vx[p] = 0;
    this.vy[p] = 0;
    this.relx[p] = 0.5;
    this.rely[p] = 0.5;
    this.bx[p] = 0;
    this.by[p] = 0;
  }

  /** Alle festen Nachbarn von (x, y) wecken. */
  weckeNachbarn(x, y) {
    if (x - 1 >= 0 && this.art[y * BREITE + x - 1] !== LUFT) this.aktiviere(x - 1, y, true);
    if (x - 1 >= 0 && y - 1 >= 0 && this.art[(y - 1) * BREITE + x - 1] !== LUFT) this.aktiviere(x - 1, y - 1, true);
    if (y - 1 >= 0 && this.art[(y - 1) * BREITE + x] !== LUFT) this.aktiviere(x, y - 1, true);
    if (x + 1 < BREITE && y - 1 >= 0 && this.art[(y - 1) * BREITE + x + 1] !== LUFT) this.aktiviere(x + 1, y - 1, true);
    if (x + 1 < BREITE && this.art[y * BREITE + x + 1] !== LUFT) this.aktiviere(x + 1, y, true);
    if (x + 1 < BREITE && y + 1 < HOEHE && this.art[(y + 1) * BREITE + x + 1] !== LUFT) this.aktiviere(x + 1, y + 1, true);
    if (y + 1 < HOEHE && this.art[(y + 1) * BREITE + x] !== LUFT) this.aktiviere(x, y + 1, true);
    if (x - 1 >= 0 && y + 1 < HOEHE && this.art[(y + 1) * BREITE + x - 1] !== LUFT) this.aktiviere(x - 1, y + 1, true);
  }

  /** MovePixel(): tauscht zwei Pixel und weckt die Umgebung. */
  bewege(x, y, xn, yn) {
    if (x < 0 || x >= BREITE || y < 0 || y >= HOEHE) return;
    if (xn < 0 || xn >= BREITE || yn < 0 || yn >= HOEHE) return;
    const p = y * BREITE + x;
    const q = yn * BREITE + xn;
    const art = this.art[p], relx = this.relx[p], rely = this.rely[p], vx = this.vx[p], vy = this.vy[p];
    const farbe = this.farbe[p], pruefNr = this.pruefNr[p], leben = this.leben[p];

    this.art[p] = this.art[q];
    this.relx[p] = this.relx[q];
    this.rely[p] = this.rely[q];
    this.vx[p] = this.vx[q];
    this.vy[p] = this.vy[q];
    this.farbe[p] = this.farbe[q];
    this.pruefNr[p] = this.pruefNr[q];
    this.leben[p] = this.leben[q];
    this.markiere(p);
    this.aktiviere(x, y, false);
    this.weckeNachbarn(x, y);

    this.art[q] = art;
    this.relx[q] = relx;
    this.rely[q] = rely;
    this.vx[q] = vx;
    this.vy[q] = vy;
    this.farbe[q] = farbe;
    this.pruefNr[q] = pruefNr;
    this.leben[q] = leben;
    this.markiere(q);
    this.aktiviere(xn, yn, true);
  }

  /** DeletePixel() */
  loesche(x, y) {
    if (x < 0 || x >= BREITE || y < 0 || y >= HOEHE) return;
    const p = y * BREITE + x;
    this.art[p] = LUFT;
    this.relx[p] = 0.5;
    this.rely[p] = 0.5;
    this.vx[p] = 0;
    this.vy[p] = 0;
    this.farbe[p] = 0;
    this.leben[p] = -1;
    this.markiere(p);
    this.aktiviere(x, y, false);
    this.weckeNachbarn(x, y);
  }

  /** MakePixel() */
  setze(x, y, art, vx, vy, aktiv, leben) {
    if (x < 0 || x >= BREITE || y < 0 || y >= HOEHE) return;
    const p = y * BREITE + x;
    this.art[p] = art;
    if (art === LUFT) return;
    this.vx[p] = vx;
    this.vy[p] = vy;
    this.leben[p] = leben;
    if (aktiv) this.aktiviere(x, y, true);
    this.farbe[p] = this.neueFarbe(art, x, y);
    this.markiere(p);
  }

  /** Farbe eines neuen Pixels – Zufall nur fürs Auge, nicht für den Spielverlauf. */
  neueFarbe(art, x, y) {
    if (art === STEIN && this.steinTextur) {
      const t = this.steinTextur;
      return t.daten[(y % t.hoehe) * t.breite + (x % t.breite)];
    }
    const [r, g, b] = FARBE[art];
    const streu = () => Math.floor(Math.random() * FARBSTREUUNG * 2) - FARBSTREUUNG;
    const kanal = (wert) => Math.max(0, Math.min(255, wert + streu()));
    return ((255 << 24) | (kanal(b) << 16) | (kanal(g) << 8) | kanal(r)) >>> 0;
  }

  /**
   * Steigung(): Hangart unter (x, y). Das Original liefert einen Winkel θ = atan(r)
   * bzw. π + atan(r); die Physik braucht davon nur sin·cos = r/(1+r²) und
   * cos² = 1/(1+r²). Deshalb wird hier nur r bestimmt – ganz ohne atan.
   */
  steigung(x, y) {
    if (x >= BREITE || x < 0 || y >= HOEHE || y < 0) return HANG_WAAGRECHT;
    if (x + 1 >= BREITE || x - 1 <= 0 || y + 1 >= HOEHE || y - 1 <= 0) return HANG_WAAGRECHT;
    if (this.artBei(x, y + 1) === LUFT) return HANG_SENKRECHT;

    if (this.artBei(x + 1, y + 1) === LUFT || this.artBei(x - 1, y + 1) === LUFT) {
      let y1 = y;
      for (; y1 <= HOEHE; y1++) if (this.artBei(x - 1, y1) !== LUFT) break;
      let y2 = y;
      for (; y2 <= HOEHE; y2++) if (this.artBei(x + 1, y2) !== LUFT) break;
      if (y1 >= y2) {
        this.steigR = -(y1 - y); // θ = π + atan(r) ist nie 0
        return HANG_SCHRAEG;
      }
      if (y2 - y === 0) return HANG_WAAGRECHT; // atan(0) = 0
      this.steigR = y2 - y;
      return HANG_SCHRAEG;
    }

    let x1 = x - 1;
    for (; x1 >= 0; x1--) {
      if (this.artBei(x1, y) !== LUFT) {
        x1 = -1;
        break;
      }
      if (this.artBei(x1, y + 1) === LUFT) break;
    }
    let x2 = x + 1;
    for (; x2 < BREITE; x2++) {
      if (this.artBei(x2, y) !== LUFT) {
        x2 = -1;
        break;
      }
      if (this.artBei(x2, y + 1) === LUFT) break;
    }
    if (x1 === -1) {
      if (x2 === -1) return HANG_WAAGRECHT;
      this.steigR = 1 / (x2 - x);
    } else if (x2 === -1 || Math.abs(x1 - x) < Math.abs(x2 - x)) {
      this.steigR = 1 / (x1 - x);
    } else {
      this.steigR = 1 / (x2 - x);
    }
    return HANG_SCHRAEG;
  }

  /** Compute(): Gebirge durch fortgesetztes Halbieren mit zufälligem Versatz. */
  erzeugeLandschaft(zufall) {
    const px = new Int32Array(1026);
    const py = new Int32Array(1026);
    px[1] = 0;
    py[1] = HOEHE - (zufall() % 200) - 1;
    px[2] = BREITE - 1;
    py[2] = HOEHE - (zufall() % 200) - 1;
    let anzahl = 2;
    for (;;) {
      for (let i = anzahl; i >= 2; i--) {
        px[2 * i - 1] = px[i];
        py[2 * i - 1] = py[i];
      }
      for (let i = 1; i <= anzahl - 1; i++) {
        const abstand = px[2 * i + 1] - px[2 * i - 1];
        const mitte = (py[2 * i - 1] + py[2 * i + 1]) >> 1;
        px[2 * i] = (px[2 * i - 1] + px[2 * i + 1]) >> 1;
        if (i === 1) py[2 * i] = mitte - rest(zufall(), abstand >> 1);
        else py[2 * i] = mitte - rest(zufall(), abstand) + (abstand >> 1);
        if (py[2 * i] > HOEHE - 50) py[2 * i] = HOEHE - 50;
        if (py[2 * i] < 100) py[2 * i] = 100;
      }
      anzahl = 2 * anzahl - 1;
      if (2 * anzahl - 1 > 1000) break;
    }

    let i = 2;
    for (let x = 0; x < BREITE; x++) {
      if (x === px[i] && i < anzahl) i++;
      const ymax = py[i - 1] + Math.trunc(((x - px[i - 1]) * (py[i] - py[i - 1])) / (px[i] - px[i - 1]));
      for (let y = Math.max(0, ymax); y < HOEHE; y++) {
        let art = STEIN;
        if (y < ymax + SCHNEEDICKE) art = SCHNEE;
        else if (y < ymax + SCHNEEDICKE + GRASDICKE) art = GRAS;
        else if (y < ymax + SCHNEEDICKE + GRASDICKE + ERDDICKE) art = ERDE;
        this.setze(x, y, art, 0, 0, false, -1);
      }
    }
    this.allesNeu = true;
  }

  /** Oberste feste Zeile in Spalte x (oder HOEHE, wenn keine). */
  oberflaeche(x) {
    for (let y = 0; y < HOEHE; y++) if (this.art[y * BREITE + x] !== LUFT) return y;
    return HOEHE;
  }
}

/** Ganzzahl-Rest wie rand() % n in C; bei n ≤ 0 einfach 0. */
export function rest(zahl, n) {
  return n > 0 ? zahl % n : 0;
}
