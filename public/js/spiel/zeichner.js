// Anzeige einer Partie auf einem Canvas – mit den Original-Grafiken (außer dem Himmel).
// Effekte (Flammen, Rauch, Trümmer, Laserstrahl) entstehen nur hier, mit dem
// Zufall dieses Geräts; den Spielverlauf beeinflussen sie nicht.

import {
  BREITE, HOEHE, LUFT, PANZER_B, PANZER_H, MUN_B, MUN_H, BALLON_B, BALLON_H,
  MAX_LEBENSENERGIE, MAX_SCHUSSENERGIE, MUNITIONEN, RAUCH_RAUCH, RAUCH_FEUER, BILDER_PRO_SEKUNDE,
  EXP_EXPLOSION, EXP_GRANATE, EXP_SPLITTER, SPIELERFARBEN,
} from './regeln.js';

const MAX_FX = 10000;
// Fast schwarzer Himmel: davor heben sich alle acht Spielerfarben deutlich ab
// (Kontrast ≥ 4,5 : 1), auch auf einem blassen Beamer.
const HIMMEL_OBEN = '#000000';
const HIMMEL_UNTEN = '#0f1a2a';
const UMRISS = [0, 0, 0, 230]; // dunkler Rand um Geschosse – vor Rauch, Feuer und Bergen
const MUN_RAND = 1;
const RAUCH_TOENUNG = 0.6; // Anteil der Spielerfarbe an der Rauchspur, der Rest bleibt grau
const MUN_ZELLE_B = MUN_B + 2 * MUN_RAND;
const MUN_ZELLE_H = MUN_H + 2 * MUN_RAND;
const TAN_22 = 0.41421356; // tan(π/8)
const TAN_67 = 2.41421356; // tan(3π/8)

/** Lädt alle Bilder des Spiels. */
export async function ladeBilder(basis = '/img/') {
  const lade = (name) =>
    new Promise((ok, fehler) => {
      const bild = new Image();
      bild.onload = () => ok(bild);
      bild.onerror = () => fehler(new Error(`Bild fehlt: ${name}`));
      bild.src = basis + name;
    });
  const [panzer, munition, fels, wind, ballon] = await Promise.all(
    ['panzer.png', 'munition.png', 'fels.png', 'wind.png', 'ballon.png'].map(lade),
  );
  return { panzer, munition, fels, wind, ballon };
}

/** Steintextur als Pixelfeld – für die Farben der Felsen in der Landschaft. */
export function steinTextur(bilder) {
  const d = pixelDaten(bilder.fels, 0, 0, bilder.fels.width, bilder.fels.height);
  return { daten: new Uint32Array(d.data.buffer), breite: d.width, hoehe: d.height };
}

function leinwand(b, h) {
  const c = document.createElement('canvas');
  c.width = b;
  c.height = h;
  return c;
}

function pixelDaten(bild, x, y, b, h) {
  const c = leinwand(b, h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bild, x, y, b, h, 0, 0, b, h);
  return ctx.getImageData(0, 0, b, h);
}

const rgba = (r, g, b) => ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
const css = ([r, g, b]) => `rgb(${r}, ${g}, ${b})`;
const zufall = (n) => Math.floor(Math.random() * n);

export class Zeichner {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} bilder  aus ladeBilder()
   * @param {{namenPx?: number, eigeneNr?: number|null, kraftAnzeige?: 'eigene'|'alle'|'keine'}} [optionen]
   */
  constructor(canvas, bilder, optionen = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.bilder = bilder;
    this.namenPx = optionen.namenPx ?? 8;
    this.eigeneNr = optionen.eigeneNr ?? null;
    this.kraftAnzeige = optionen.kraftAnzeige ?? 'eigene';

    this.boden = leinwand(BREITE, HOEHE);
    this.bodenCtx = this.boden.getContext('2d');
    this.bodenBild = this.bodenCtx.createImageData(BREITE, HOEHE);
    this.boden32 = new Uint32Array(this.bodenBild.data.buffer);

    this.fx = leinwand(BREITE, HOEHE);
    this.fxCtx = this.fx.getContext('2d');
    this.fxBild = this.fxCtx.createImageData(BREITE, HOEHE);
    this.fx32 = new Uint32Array(this.fxBild.data.buffer);
    this.teilchen = [];
    this.altePixel = [];

    this.himmel = this.ctx.createLinearGradient(0, 0, 0, HOEHE);
    this.himmel.addColorStop(0, HIMMEL_OBEN);
    this.himmel.addColorStop(1, HIMMEL_UNTEN);
    this.panzerBilder = this.baueFarbpanzer();
    this.munitionsBilder = SPIELERFARBEN.map((farbe) => this.baueMunition(farbe));
    this.munitionOhneFarbe = this.baueMunition(null);
    this.fetzDaten = {
      panzer: [0, 1, 2, 3].map((spalte) => [0, 1, 2].map((v) => pixelDaten(bilder.panzer, spalte * PANZER_B, v * PANZER_H, PANZER_B, PANZER_H))),
      mun: MUNITIONEN.map((m) => pixelDaten(bilder.munition, m.bild * MUN_B, 0, MUN_B, MUN_H)),
      ballon: pixelDaten(bilder.ballon, 0, 0, BALLON_B, BALLON_H),
    };
    this.blitzBis = 0;
    this.passeGroesseAn();
  }

  /** Panzerbilder für Spieler 5–8: der rote Panzer, umgefärbt. */
  baueFarbpanzer() {
    const liste = [];
    for (let i = 0; i < 8; i++) {
      const c = leinwand(PANZER_B, PANZER_H * 3);
      const ctx = c.getContext('2d');
      if (i < 4) {
        ctx.drawImage(this.bilder.panzer, i * PANZER_B, 0, PANZER_B, PANZER_H * 3, 0, 0, PANZER_B, PANZER_H * 3);
      } else {
        const ziel = SPIELERFARBEN[i];
        const d = pixelDaten(this.bilder.panzer, 0, 0, PANZER_B, PANZER_H * 3);
        for (let p = 0; p < d.data.length; p += 4) {
          const [r, g, b, a] = [d.data[p], d.data[p + 1], d.data[p + 2], d.data[p + 3]];
          if (a === 0 || (Math.abs(r - g) < 40 && Math.abs(r - b) < 40)) continue; // Risse bleiben grau
          const hell = Math.max(r, g, b) / 255;
          const weiss = Math.min(g, b) / 255; // helle Glanzlichter
          d.data[p] = Math.min(255, ziel[0] * hell + 255 * weiss * 0.6);
          d.data[p + 1] = Math.min(255, ziel[1] * hell + 255 * weiss * 0.6);
          d.data[p + 2] = Math.min(255, ziel[2] * hell + 255 * weiss * 0.6);
        }
        ctx.putImageData(d, 0, 0);
      }
      liste.push(c);
    }
    return liste;
  }

  /**
   * Geschossbilder in Spielerfarbe: graue Teile (Kanonenkugel, Raketenkörper) werden
   * in einem etwas helleren Ton der Spielerfarbe eingefärbt, farbige Details bleiben –
   * so erkennt man Waffe und Schützen. Jedes Bild bekommt einen dunklen Rand und dafür
   * einen Pixel Platz ringsum (Zelle MUN_ZELLE_B × MUN_ZELLE_H). Ohne Farbe: nur der Rand.
   */
  baueMunition(farbe) {
    const ziel = farbe && farbe.map((k) => k + (255 - k) * 0.2);
    const spalten = this.bilder.munition.width / MUN_B;
    const d = pixelDaten(this.bilder.munition, 0, 0, spalten * MUN_B, 8 * MUN_H);
    const q = d.data;
    if (ziel) {
      for (let p = 0; p < q.length; p += 4) {
        const [r, g, bl, a] = [q[p], q[p + 1], q[p + 2], q[p + 3]];
        if (a === 0 || Math.abs(r - g) > 40 || Math.abs(r - bl) > 40) continue;
        const faktor = 0.45 + 0.75 * (Math.max(r, g, bl) / 255);
        q[p] = Math.min(255, ziel[0] * faktor);
        q[p + 1] = Math.min(255, ziel[1] * faktor);
        q[p + 2] = Math.min(255, ziel[2] * faktor);
      }
    }
    const c = leinwand(spalten * MUN_ZELLE_B, 8 * MUN_ZELLE_H);
    const ctx = c.getContext('2d');
    const bild = ctx.createImageData(c.width, c.height);
    const z = bild.data;
    const deckend = (sx, sy, x, y) =>
      x >= 0 && y >= 0 && x < MUN_B && y < MUN_H && q[((sy + y) * d.width + sx + x) * 4 + 3] > 0;
    for (let zeile = 0; zeile < 8; zeile++) {
      for (let spalte = 0; spalte < spalten; spalte++) {
        const sx = spalte * MUN_B;
        const sy = zeile * MUN_H;
        for (let y = -MUN_RAND; y < MUN_H + MUN_RAND; y++) {
          for (let x = -MUN_RAND; x < MUN_B + MUN_RAND; x++) {
            const zp = ((zeile * MUN_ZELLE_H + y + MUN_RAND) * c.width + spalte * MUN_ZELLE_B + x + MUN_RAND) * 4;
            if (deckend(sx, sy, x, y)) {
              const qp = ((sy + y) * d.width + sx + x) * 4;
              for (let k = 0; k < 4; k++) z[zp + k] = q[qp + k];
            } else if (
              deckend(sx, sy, x - 1, y) || deckend(sx, sy, x + 1, y) || deckend(sx, sy, x, y - 1) || deckend(sx, sy, x, y + 1) ||
              deckend(sx, sy, x - 1, y - 1) || deckend(sx, sy, x + 1, y - 1) || deckend(sx, sy, x - 1, y + 1) || deckend(sx, sy, x + 1, y + 1)
            ) {
              for (let k = 0; k < 4; k++) z[zp + k] = UMRISS[k];
            }
          }
        }
      }
    }
    ctx.putImageData(bild, 0, 0);
    return c;
  }

  /** Auflösung an die angezeigte Größe anpassen (scharfe Schrift auch auf dem Beamer). */
  passeGroesseAn() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const massstab = Math.max(1, Math.min(8, Math.ceil(((rect.width || BREITE) * dpr) / BREITE)));
    if (this.canvas.width !== BREITE * massstab) {
      this.canvas.width = BREITE * massstab;
      this.canvas.height = HOEHE * massstab;
    }
    this.massstab = massstab;
  }

  // --- nach jedem Physikschritt ---------------------------------------------------

  /** Ereignisse und Effekte nach einem Bild der Simulation. */
  nachBild(spiel) {
    for (const e of spiel.holeEreignisse()) this.ereignis(spiel, e);

    // Rauch und Feuer hinter fliegenden Geschossen; der Rauch ist in der Farbe des
    // Schützen getönt, damit man die eigene Flugbahn im Getümmel wiederfindet
    for (const m of spiel.mun) {
      if (m.besitzer === -1 || m.ausserhalb) continue;
      const farbe = spiel.panzer[m.besitzer]?.farbe;
      for (const rauch of MUNITIONEN[m.typ].rauch) {
        if (rauch === RAUCH_RAUCH) {
          const t = 100 + zufall(50);
          const ton = farbe ? farbe.map((k) => Math.round(k * RAUCH_TOENUNG + t * (1 - RAUCH_TOENUNG))) : [t, t, t];
          this.neuesTeilchen(m.x - 2 + zufall(4), m.y - 2 + zufall(4), rgba(...ton), 20 + zufall(10), spiel.wind / 5, -zufall(5) / 10);
        } else if (rauch === RAUCH_FEUER) {
          this.neuesTeilchen(m.x - 2 + zufall(4), m.y - 2 + zufall(4), rgba(235 + zufall(20), 235, 10), 5, 0, 0);
        }
      }
    }
    // Beschädigte Panzer qualmen
    if (spiel.bild % 2 === 0) {
      for (const p of spiel.panzer) {
        if (!p.aktiv || p.version === 0) continue;
        for (let j = 0; j < p.version; j++) {
          const t = zufall(50);
          this.neuesTeilchen(p.x - 10 + zufall(20), p.y - 1, rgba(100 + t, 100 + t, 100 + t), 20 + zufall(10), spiel.wind / 5, -0.5 - zufall(10) / 10);
        }
        if (p.version === 2) this.neuesTeilchen(p.x - 10 + zufall(20), p.y - 1, rgba(235 + zufall(20), 235, 10), 15 + zufall(10), 0, -0.5 - zufall(10) / 10);
      }
    }
    if (spiel.bild % 3 === 0) this.bewegeTeilchen();
  }

  ereignis(spiel, e) {
    switch (e.typ) {
      case 'explosion':
        if (e.art === EXP_EXPLOSION || e.art === EXP_GRANATE || e.art === EXP_SPLITTER) {
          const radius = e.art === EXP_EXPLOSION ? 20 : e.art === EXP_GRANATE ? 10 : 5;
          for (let rx = -radius; rx <= radius; rx++) {
            for (let ry = -radius; ry <= radius; ry++) {
              if (rx * rx + ry * ry > radius * radius) continue;
              const abstand = Math.floor(Math.sqrt(rx * rx + ry * ry));
              if (e.art === EXP_SPLITTER) {
                this.neuesTeilchen(e.x + rx, e.y + ry, rgba(255 - zufall(100), 100 + abstand * 5, 0), ((abstand / 4 + zufall(5)) / 2) | 0, 0, 0);
              } else {
                const leben = (abstand / 4 + zufall(5)) | 0;
                this.neuesTeilchen(e.x + rx, e.y + ry, rgba(255 - zufall(100), Math.min(255, abstand * 10), 0), e.art === EXP_GRANATE ? leben >> 1 : leben, 0, 0);
              }
            }
          }
        }
        break;
      case 'fetz':
        if (e.bild === 'panzer') {
          const p = spiel.panzer.find((q) => q.nr === e.nr);
          this.fetz(e.x, e.y, this.fetzDaten.panzer[(p?.bildNr ?? 0) % 4][e.version ?? 0]);
        } else if (e.bild === 'mun') {
          this.fetz(e.x, e.y, this.fetzDaten.mun[e.mun]);
        } else if (e.bild === 'ballon') {
          this.fetz(e.x, e.y, this.fetzDaten.ballon);
        }
        break;
      case 'laser': {
        // Strahl von der Kanone bis zum Rand
        const schritte = Math.max(Math.abs(e.dx), Math.abs(e.dy));
        for (let k = 1; k <= e.laenge; k++) {
          for (let j = 0; j < schritte; j++) {
            const t = (k - 1) + j / schritte;
            this.neuesTeilchen(Math.trunc(e.x + t * e.dx), Math.trunc(e.y + t * e.dy), rgba(255, 0, 0), zufall(10), 0, 0);
          }
        }
        break;
      }
      case 'salve':
        this.blitzBis = performance.now() + 120;
        break;
    }
  }

  /** Fetz(): ein Bild zerplatzt in fliegende Pixel. */
  fetz(x, y, daten) {
    const { width: b, height: h, data } = daten;
    for (let ry = 0; ry < h; ry++) {
      for (let rx = 0; rx < b; rx++) {
        const i = (ry * b + rx) * 4;
        if (data[i + 3] === 0) continue;
        this.neuesTeilchen(x + rx, y + ry, rgba(data[i], data[i + 1], data[i + 2]), zufall(10),
          -(b / 2 - rx) / 5 + zufall(10) / 10 - 0.5, -(h / 2 - ry) / 5 + zufall(10) / 10 - 0.5);
      }
    }
  }

  neuesTeilchen(x, y, farbe, leben, bx, by) {
    if (x < 0 || x >= BREITE || y < 0 || y >= HOEHE || this.teilchen.length >= MAX_FX) return;
    this.teilchen.push({ x: Math.trunc(x), y: Math.trunc(y), relx: 0.5, rely: 0.5, bx, by, farbe, leben });
  }

  /** CheckFXPixel(): Effekte bewegen und altern lassen (20-mal pro Sekunde). */
  bewegeTeilchen() {
    const behalten = [];
    for (const t of this.teilchen) {
      if (t.leben <= 0) continue;
      t.leben--;
      if (t.bx !== 0 || t.by !== 0) {
        t.relx += t.bx;
        t.rely += t.by;
        t.x += Math.trunc(t.relx);
        t.y += Math.trunc(t.rely);
        t.relx -= Math.trunc(t.relx);
        t.rely -= Math.trunc(t.rely);
        if (t.x < 0 || t.x >= BREITE || t.y < 0 || t.y >= HOEHE) continue;
      }
      behalten.push(t);
    }
    this.teilchen = behalten;
  }

  // --- Zeichnen -----------------------------------------------------------------------

  zeichne(spiel) {
    this.aktualisiereBoden(spiel.welt);
    this.aktualisiereFx();
    const ctx = this.ctx;
    const s = this.massstab;
    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = this.himmel;
    ctx.fillRect(0, 0, BREITE, HOEHE);
    ctx.drawImage(this.boden, 0, 0);
    ctx.drawImage(this.fx, 0, 0);

    for (const p of spiel.panzer) if (p.aktiv) this.zeichnePanzer(spiel, p);
    this.zeichneMunition(spiel);
    if (spiel.ballon.aktiv) ctx.drawImage(this.bilder.ballon, spiel.ballon.x, spiel.ballon.y);
    for (const p of spiel.panzer) {
      if (!p.aktiv) continue;
      this.zeichneName(p);
      if (this.kraftAnzeige === 'alle' || (this.kraftAnzeige === 'eigene' && p.nr === this.eigeneNr)) this.zeichneKraft(p);
    }
    this.zeichneAnzeige(spiel);
  }

  aktualisiereBoden(welt) {
    const { art, farbe, geaendert, aenderungen } = welt;
    const ziel = this.boden32;
    if (welt.allesNeu) {
      for (let p = 0; p < ziel.length; p++) ziel[p] = art[p] === LUFT ? 0 : farbe[p];
      for (let i = 0; i < welt.anzahlAenderungen; i++) geaendert[aenderungen[i]] = 0;
      welt.anzahlAenderungen = 0;
      welt.allesNeu = false;
      this.bodenCtx.putImageData(this.bodenBild, 0, 0);
      return;
    }
    const n = welt.anzahlAenderungen;
    if (!n) return;
    let x0 = BREITE, y0 = HOEHE, x1 = -1, y1 = -1;
    for (let i = 0; i < n; i++) {
      const p = aenderungen[i];
      geaendert[p] = 0;
      ziel[p] = art[p] === LUFT ? 0 : farbe[p];
      const x = p % BREITE;
      const y = (p / BREITE) | 0;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    welt.anzahlAenderungen = 0;
    this.bodenCtx.putImageData(this.bodenBild, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
  }

  aktualisiereFx() {
    const fx = this.fx32;
    for (const p of this.altePixel) fx[p] = 0;
    this.altePixel = [];
    for (const t of this.teilchen) {
      const p = t.y * BREITE + t.x;
      fx[p] = t.farbe;
      this.altePixel.push(p);
    }
    this.fxCtx.putImageData(this.fxBild, 0, 0);
  }

  zeichnePanzer(spiel, p) {
    const ctx = this.ctx;
    // Kanone vom Panzerfuß aus, dann der Panzer darüber
    ctx.strokeStyle = css(p.farbe);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p.x + 0.5, p.y + 0.5);
    ctx.lineTo(p.x + p.kx + 0.5, p.y + p.ky + 0.5);
    ctx.stroke();
    ctx.drawImage(this.panzerBilder[p.bildNr], 0, p.version * PANZER_H, PANZER_B, PANZER_H, p.x - PANZER_B / 2, p.y - PANZER_H, PANZER_B, PANZER_H);
    if (p.schild > 0 && spiel.bild % 2 === 0) ctx.drawImage(this.bilder.panzer, 97, 0, 30, 15, p.x - 15, p.y - 14, 30, 15);
    if (p.magnet > 0) ctx.drawImage(this.bilder.panzer, 80, 3, 9, 12, p.x - 5, p.y - 13, 9, 12);
  }

  /** Kraftleiste unter dem Panzer – der Farbverlauf (POWER) aus dem Original, grün bis rot. */
  zeichneKraft(p) {
    const ctx = this.ctx;
    const anteil = p.kraft / MAX_SCHUSSENERGIE;
    const y = Math.min(p.y + 2, HOEHE - 5);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(p.x - 10, y, 20, 5);
    ctx.drawImage(this.bilder.panzer, 80, 0, Math.max(1, Math.round(17 * anteil)), 3, p.x - 9, y + 1, 18 * anteil, 3);
  }

  zeichneName(p) {
    const ctx = this.ctx;
    const px = this.namenPx;
    const oben = p.y - 24;
    // Lebensbalken
    const anteil = Math.max(0, p.energie) / MAX_LEBENSENERGIE;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(p.x - 11, oben, 22, 3);
    ctx.fillStyle = anteil > 0.5 ? '#40c057' : anteil > 0.25 ? '#fab005' : '#fa5252';
    ctx.fillRect(p.x - 10, oben + 0.5, 20 * anteil, 2);
    // Name
    ctx.font = `700 ${px}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(2, px / 4);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.strokeText(p.name, p.x, oben - 1);
    ctx.fillStyle = css(p.farbe);
    ctx.fillText(p.name, p.x, oben - 1);
    if (p.nr === this.eigeneNr) {
      const y = oben - px - 3;
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p.x - 4, y - 5);
      ctx.lineTo(p.x + 4, y - 5);
      ctx.lineTo(p.x, y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  zeichneMunition(spiel) {
    const ctx = this.ctx;
    for (const m of spiel.mun) {
      if (m.besitzer === -1) continue;
      if (m.ausserhalb) {
        // oberhalb des Bildes: Strich am oberen Rand in der Farbe des Schützen
        const p = spiel.panzer[m.besitzer];
        ctx.fillStyle = p ? css(p.farbe) : '#fff';
        ctx.fillRect(m.x - 5, 0, 11, 2);
        continue;
      }
      const spalte = MUNITIONEN[m.typ].bild;
      const schuetze = spiel.panzer[m.besitzer];
      const bogen = schuetze ? this.munitionsBilder[schuetze.bildNr] : this.munitionOhneFarbe;
      ctx.drawImage(
        bogen, spalte * MUN_ZELLE_B, richtung(m.vx, m.vy) * MUN_ZELLE_H, MUN_ZELLE_B, MUN_ZELLE_H,
        m.x - MUN_B / 2 - MUN_RAND, m.y - MUN_H / 2 - MUN_RAND, MUN_ZELLE_B, MUN_ZELLE_H,
      );
    }
  }

  zeichneAnzeige(spiel) {
    const ctx = this.ctx;
    // Wind (WINDHOSE: Zeile = Wind + 3)
    if (spiel.wind !== 0) ctx.drawImage(this.bilder.wind, 0, (spiel.wind + 3) * 8, 36, 8, 3, 3, 36, 8);

    // Zeit bis zur nächsten Salve als Balken oben
    if (spiel.salveAbstand && spiel.phase === 'laeuft') {
      const anteil = 1 - spiel.bilderBisSalve / spiel.salveAbstand;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.fillRect(0, HOEHE - 2, BREITE, 2);
      ctx.fillStyle = '#ff922b';
      ctx.fillRect(0, HOEHE - 2, BREITE * anteil, 2);
    }
    if (performance.now() < this.blitzBis) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
      ctx.fillRect(0, 0, BREITE, HOEHE);
    }

    // Spielzeit
    ctx.font = '700 9px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
    let text;
    let farbe = '#fff';
    if (spiel.suddenDeath && Number.isFinite(spiel.endeBild)) {
      text = `SUDDEN DEATH ${Math.max(0, Math.ceil((spiel.endeBild - spiel.bild) / BILDER_PRO_SEKUNDE))}`;
      farbe = '#ff6b6b';
    } else if (Number.isFinite(spiel.suddenDeathBild)) {
      const rest = Math.max(0, Math.ceil((spiel.suddenDeathBild - spiel.bild) / BILDER_PRO_SEKUNDE));
      text = `${Math.floor(rest / 60)}:${String(rest % 60).padStart(2, '0')}`;
    }
    if (text && spiel.phase === 'laeuft') {
      ctx.strokeText(text, BREITE - 3, 3);
      ctx.fillStyle = farbe;
      ctx.fillText(text, BREITE - 3, 3);
    }
  }
}

/** Bildrichtung eines Geschosses (0–7) aus seiner Geschwindigkeit, wie ZeichneMunition(). */
function richtung(x, y) {
  if (x === 0) return y >= 0 ? 2 : 6;
  const g = y / x;
  if (x > 0) {
    if (g <= -TAN_67) return 6;
    if (g <= -TAN_22) return 7;
    if (g <= TAN_22) return 0;
    if (g <= TAN_67) return 1;
    return 2;
  }
  if (g <= -TAN_67) return 2;
  if (g <= -TAN_22) return 3;
  if (g <= TAN_22) return 4;
  if (g <= TAN_67) return 5;
  return 6;
}
