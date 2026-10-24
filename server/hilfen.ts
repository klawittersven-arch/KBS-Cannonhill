// Prüfen und Aufräumen von Eingaben der Handys.

/** "lena", "m" → "Lena M."; null bei ungültiger Eingabe. */
export function normalisiereName(vorname: unknown, initial: unknown): string | null {
  if (typeof vorname !== 'string' || typeof initial !== 'string') return null;
  const v = vorname.normalize('NFC').replace(/\s+/g, ' ').trim();
  const i = initial.normalize('NFC').trim();
  if (!/^\p{L}[\p{L}' -]{0,14}$/u.test(v) || !/^\p{L}$/u.test(i)) return null;
  return `${v.charAt(0).toLocaleUpperCase('de')}${v.slice(1)} ${i.toLocaleUpperCase('de')}.`;
}

/** Übernimmt nur einfache Werte (Zahlen, kurze Texte, Wahrheitswerte), höchstens 2 Ebenen tief. */
export function saeubere(wert: unknown, tiefe = 0): unknown {
  if (typeof wert === 'number') return Number.isFinite(wert) ? Math.round(wert * 100) / 100 : null;
  if (typeof wert === 'boolean') return wert;
  if (typeof wert === 'string') return wert.slice(0, 40);
  if (wert && typeof wert === 'object' && !Array.isArray(wert) && tiefe < 2) {
    const ergebnis: Record<string, unknown> = {};
    for (const [schluessel, inhalt] of Object.entries(wert).slice(0, 16)) {
      ergebnis[schluessel.slice(0, 20)] = saeubere(inhalt, tiefe + 1);
    }
    return ergebnis;
  }
  return null;
}
