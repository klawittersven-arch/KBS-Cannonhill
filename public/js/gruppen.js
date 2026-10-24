// Gruppeneinteilung für das Turnier.
// Wird im Browser (Beamer-Vorschau) und im Server (Durable Object) benutzt.
//
// Regeln:
//   2–8 SuS   → kein Qualifying, alle spielen direkt das Finale
//   9–32 SuS  → Qualifying in Gruppen à 3–4, Finale mit allen Gruppensiegern
//   33–40 SuS → 8 Gruppen à 4–5 (mehr als 8 Finalisten gibt es nie)
// Die Lehrkraft kann "direktfinale" oder "qualifying" erzwingen, soweit möglich.

export const MAX_FINALISTEN = 8;
export const MAX_SPIELER = 40;

/**
 * Plant, wie viele Gruppen welcher Größe gebildet werden.
 * @param {number} anzahl  Anzahl der Spieler
 * @param {'auto'|'direktfinale'|'qualifying'} modus
 * @returns {{art: 'zuwenig'|'direktfinale'|'qualifying', groessen: number[], hinweis: string}}
 */
export function planeTurnier(anzahl, modus = 'auto') {
  if (anzahl < 2) {
    return { art: 'zuwenig', groessen: anzahl === 1 ? [1] : [], hinweis: 'Mindestens 2 Spieler nötig.' };
  }

  let art = modus === 'auto' ? (anzahl <= MAX_FINALISTEN ? 'direktfinale' : 'qualifying') : modus;
  let hinweis = '';

  if (art === 'direktfinale' && anzahl > MAX_FINALISTEN) {
    art = 'qualifying';
    hinweis = `Direkt ins Finale geht nur mit höchstens ${MAX_FINALISTEN} Spielern.`;
  }
  if (art === 'qualifying' && anzahl < 4) {
    art = 'direktfinale';
    hinweis = 'Für ein Qualifying braucht es mindestens 4 Spieler.';
  }
  if (art === 'direktfinale') {
    return { art, groessen: [anzahl], hinweis };
  }

  // Qualifying: möglichst Vierergruppen, mindestens 2 und höchstens 8 Gruppen,
  // Größen unterscheiden sich höchstens um 1, keine Gruppe mit nur 1 Spieler.
  let gruppen = Math.max(2, Math.min(MAX_FINALISTEN, Math.ceil(anzahl / 4)));
  gruppen = Math.min(gruppen, Math.floor(anzahl / 2));
  const basis = Math.floor(anzahl / gruppen);
  const rest = anzahl % gruppen;
  const groessen = [];
  for (let i = 0; i < gruppen; i++) groessen.push(basis + (i < rest ? 1 : 0));
  return { art, groessen, hinweis };
}

/**
 * Verteilt die Spieler zufällig auf Gruppen nach planeTurnier().
 * @template T
 * @param {T[]} spieler
 * @param {'auto'|'direktfinale'|'qualifying'} modus
 * @param {() => number} zufall  liefert Zahlen in [0, 1)
 * @returns {{art: string, gruppen: T[][], hinweis: string}}
 */
export function teileGruppen(spieler, modus = 'auto', zufall = Math.random) {
  const plan = planeTurnier(spieler.length, modus);
  const gemischt = spieler.slice();
  for (let i = gemischt.length - 1; i > 0; i--) {
    const j = Math.floor(zufall() * (i + 1));
    [gemischt[i], gemischt[j]] = [gemischt[j], gemischt[i]];
  }
  const gruppen = [];
  let pos = 0;
  for (const groesse of plan.groessen) {
    gruppen.push(gemischt.slice(pos, pos + groesse));
    pos += groesse;
  }
  return { art: plan.art, gruppen, hinweis: plan.hinweis };
}

/** Kurzbeschreibung für die Beamer-Anzeige, z. B. "Qualifying: 8 Gruppen (6×4, 2×3) → Finale mit 8". */
export function beschreibePlan(anzahl, modus = 'auto') {
  const plan = planeTurnier(anzahl, modus);
  if (plan.art === 'zuwenig') return 'Warte auf mindestens 2 Spieler';
  if (plan.art === 'direktfinale') return `Direkt ins Finale mit ${anzahl}`;
  const zaehler = new Map();
  for (const g of plan.groessen) zaehler.set(g, (zaehler.get(g) || 0) + 1);
  const teile = [...zaehler.entries()].sort((a, b) => b[0] - a[0]).map(([g, n]) => `${n}×${g}`);
  return `Qualifying: ${plan.groessen.length} Gruppen (${teile.join(', ')}) → Finale mit ${plan.groessen.length}`;
}
