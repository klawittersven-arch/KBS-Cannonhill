// Ein ganzes Turnier gegen einen laufenden Server:
// Beamer + Handys, die wirklich mitrechnen (NetzSpiel ohne Anzeige).
//
//   npx wrangler dev           (in einem zweiten Terminal)
//   npm run turnier            (10 Handys → Qualifying in 3 Gruppen → Finale)
//   ANZAHL=5 npm run turnier   (5 Handys → direkt ins Finale)
//
// Geprüft wird: Ablauf der Phasen, gleiche Ergebnisse auf allen Handys,
// Finalisten = Gruppensieger, Wiedereinstieg nach Abbruch, Nachzügler.

import { NetzSpiel } from '../public/js/spiel/netzspiel.js';

const BASIS = process.env.BASIS || 'http://localhost:8787';
const ANZAHL = Number(process.env.ANZAHL || 10);
const ENDE = Number(process.env.ENDE || 20); // Spielzeit in Sekunden (nur für den Test so kurz)
const RAUM = String(1000 + Math.floor(Math.random() * 9000));
const URL_WS = `${BASIS.replace(/^http/, 'ws')}/spiel/${RAUM}`;
const VORNAMEN = ['Lena', 'Tom', 'Mia', 'Ali', 'Ben', 'Emma', 'Noah', 'Lea', 'Finn', 'Ida', 'Paul', 'Zoe'];
const warte = (ms) => new Promise((ok) => setTimeout(ok, ms));
const fehler = [];

class Handy {
  constructor(i) {
    this.i = i;
    this.id = `test-${i}-${Math.random().toString(16).slice(2, 10)}`;
    this.vorname = VORNAMEN[i % VORNAMEN.length];
    this.initial = String.fromCharCode(65 + (i % 26));
    this.netz = null;
    this.turnier = null;
    this.ergebnisse = new Map(); // Partie → gemeldetes Ergebnis
  }

  verbinde() {
    return new Promise((fertig, abbruch) => {
      const ws = new WebSocket(URL_WS);
      this.ws = ws;
      ws.onopen = () => ws.send(JSON.stringify({ typ: 'hallo', rolle: 'handy', id: this.id, vorname: this.vorname, initial: this.initial }));
      ws.onmessage = (e) => {
        const n = JSON.parse(e.data);
        if (n.typ === 'willkommen') {
          this.nr = n.nr;
          fertig();
        }
        this.verarbeite(n);
      };
      ws.onerror = () => abbruch(new Error(`Handy ${this.i}: keine Verbindung`));
    });
  }

  sende(n) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(n));
  }

  verarbeite(n) {
    if (n.typ === 'turnier') this.turnier = n;
    if (n.typ === 'spiel') {
      if (this.netz && this.netz.id === n.s) {
        this.netz.baueAuf(n);
      } else {
        this.netz = new NetzSpiel(n, {
          beiEnde: (e) => {
            this.ergebnisse.set(n.s, e);
            this.sende({ typ: 'ende', s: n.s, ...e });
          },
          nachTakt: (spiel, t) => {
            if (t % 20 === 0) this.sende({ typ: 'lage', s: n.s, n: t, p: spiel.panzer.map((p) => [p.nr, p.energie, p.aktiv ? 1 : 0]) });
          },
          lueckeEntdeckt: () => this.sende({ typ: 'nachholen', s: n.s }),
        });
        clearInterval(this.zielen);
        this.zielen = setInterval(() => {
          this.sende({ typ: 'e', s: n.s, w: Math.floor(Math.random() * 77), k: 15 + Math.floor(Math.random() * 30) });
        }, 500);
      }
    }
    if (n.typ === 't' && this.netz && n.s === this.netz.id) {
      this.netz.takt(n.n, n.e);
      this.netz.laufeAlles();
    }
  }

  trenne() {
    this.ws.onmessage = null;
    this.ws.close();
  }

  schliesse() {
    clearInterval(this.zielen);
    this.ws.close();
  }
}

async function beamerVerbinden() {
  const ws = new WebSocket(URL_WS);
  const b = { stand: null, finale: null };
  ws.onmessage = (e) => {
    const n = JSON.parse(e.data);
    if (n.typ === 'stand') b.stand = n;
    if (n.typ === 'spiel') b.finale = new NetzSpiel(n, { lueckeEntdeckt: () => ws.send(JSON.stringify({ typ: 'nachholen' })) });
    if (n.typ === 't' && b.finale && n.s === b.finale.id) {
      b.finale.takt(n.n, n.e);
      b.finale.laufeAlles();
    }
    if (n.typ === 'meldung') fehler.push(`Meldung: ${n.text}`);
  };
  await new Promise((ok, abbruch) => {
    ws.onopen = ok;
    ws.onerror = () => abbruch(new Error(`Server unter ${BASIS} nicht erreichbar`));
  });
  ws.send(JSON.stringify({ typ: 'hallo', rolle: 'beamer', token: `test-${RAUM}` }));
  b.sende = (n) => ws.send(JSON.stringify(n));
  b.schliesse = () => ws.close();
  return b;
}

async function warteBis(bedingung, ms, was) {
  const ende = Date.now() + ms;
  while (!bedingung()) {
    if (Date.now() > ende) throw new Error(`Zeitüberschreitung: ${was}`);
    await warte(100);
  }
}

const pruefe = (bedingung, text) => {
  if (!bedingung) fehler.push(text);
  console.log(`  ${bedingung ? '✓' : '✗'} ${text}`);
};

// --- Ablauf ---------------------------------------------------------------------------

console.log(`Raum ${RAUM} · ${ANZAHL} Handys · ${ENDE} s pro Partie · ${BASIS}`);
const beamer = await beamerVerbinden();
beamer.sende({ typ: 'optionen', optionen: { ende: ENDE } });
const handys = Array.from({ length: ANZAHL }, (_, i) => new Handy(i));
await Promise.all(handys.map((h) => h.verbinde()));
await warteBis(() => beamer.stand?.spieler.filter((s) => s.verbunden).length === ANZAHL, 5000, 'Lobby voll');

beamer.sende({ typ: 'starte' });
await warteBis(() => beamer.stand?.phase !== 'lobby', 5000, 'Turnierstart');
const mitQualifying = beamer.stand.phase === 'qualifying';
console.log(mitQualifying ? `Qualifying: ${beamer.stand.partien.map((p) => p.mitglieder.length).join(', ')} Spieler je Gruppe` : 'Direkt ins Finale');

let spaet = null;
let abbrecher = null;
if (mitQualifying) {
  // mitten im Qualifying: ein Handy bricht ab und kommt zurück, ein weiteres kommt neu dazu
  await warte(6000);
  abbrecher = handys[1];
  abbrecher.trenne();
  await warte(2000);
  await abbrecher.verbinde();
  spaet = new Handy(ANZAHL);
  await spaet.verbinde();
  await warte(300);
  pruefe(spaet.turnier?.rolle === 'zuschauer', 'Nachzügler schaut zu');

  await warteBis(() => beamer.stand?.qualifyingFertig, (ENDE + 20) * 1000, 'Ende des Qualifyings');
  await warte(1500);
  const quali = beamer.stand.partien.filter((p) => p.art === 'quali');
  pruefe(quali.every((p) => p.ergebnis), 'jede Gruppe hat ein Ergebnis');
  pruefe(quali.every((p) => !p.abweichung), 'alle Handys einer Gruppe melden dasselbe Ergebnis');
  const nachNr = new Map(beamer.stand.spieler.map((s) => [s.nr, s.id]));
  const sieger = quali.map((p) => nachNr.get(p.ergebnis?.sieger));
  pruefe(JSON.stringify([...sieger].sort()) === JSON.stringify([...beamer.stand.finalisten].sort()), 'Finalisten = Gruppensieger');
  const pAbbrecher = quali.find((p) => p.mitglieder.includes(abbrecher.id));
  const eAbbrecher = abbrecher.ergebnisse.get(pAbbrecher.id);
  pruefe(eAbbrecher && eAbbrecher.sieger === pAbbrecher.ergebnis.sieger, 'Handy nach Abbruch rechnet dasselbe Ergebnis');
  for (const p of quali) {
    const namen = p.mitglieder.map((id) => beamer.stand.spieler.find((s) => s.id === id)?.name);
    const siegerName = beamer.stand.spieler.find((s) => s.nr === p.ergebnis?.sieger)?.name;
    console.log(`    ${p.name}: ${namen.join(', ')} → ${siegerName} (${p.ergebnis?.grund})`);
  }
  beamer.sende({ typ: 'finale' });
  await warteBis(() => beamer.stand?.phase === 'finale', 5000, 'Finalstart');
}

const finalPartie = () => beamer.stand.partien.find((p) => p.art === 'finale');
await warteBis(() => beamer.stand?.phase === 'siegerehrung', (ENDE + 25) * 1000, 'Siegerehrung');
const fp = finalPartie();
pruefe(fp && fp.ergebnis && !fp.abweichung, 'Finale entschieden, alle Finalisten einig');
pruefe(beamer.finale && beamer.finale.spiel.phase === 'ende' && beamer.finale.spiel.sieger === fp.ergebnis.sieger, 'Beamer rechnet dasselbe Finale');
const siegerName = beamer.stand.sieger?.name;
pruefe(!!siegerName, `Turniersieger: ${siegerName}`);
const alle = [...handys, ...(spaet ? [spaet] : [])];
await warte(500);
pruefe(alle.every((h) => h.turnier?.phase === 'siegerehrung'), 'alle Handys zeigen die Siegerehrung');

beamer.sende({ typ: 'neu' });
await warteBis(() => beamer.stand?.phase === 'lobby', 3000, 'zurück zur Lobby');
pruefe(true, 'Neues Turnier: zurück in der Lobby');

for (const h of alle) h.schliesse();
beamer.schliesse();
console.log(fehler.length ? `FEHLER:\n${fehler.join('\n')}` : 'Alles in Ordnung.');
process.exit(fehler.length ? 1 : 0);
