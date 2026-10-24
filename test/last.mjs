// Lasttest: simuliert einen Beamer und viele Handys gegen einen laufenden Server.
//
//   npx wrangler dev            (in einem zweiten Terminal)
//   npm run last                (30 Handys, 30 Sekunden)
//   ANZAHL=8 DAUER=60 BASIS=https://….workers.dev npm run last
//
// Ein Handy reißt mitten im Test die Verbindung ab und muss danach trotzdem
// dieselbe Landschaft haben wie seine Gruppe. Ein weiteres kommt zu spät.

import { neueWelt, spieleTakt, pruefsumme, BENCH_PRUEFSUMME, BREITE } from '../public/js/sim.js';

const BASIS = process.env.BASIS || 'http://localhost:8787';
const ANZAHL = Number(process.env.ANZAHL || 30);
const DAUER = Number(process.env.DAUER || 30);
const RAUM = process.env.RAUM || String(1000 + Math.floor(Math.random() * 9000));
const URL_WS = `${BASIS.replace(/^http/, 'ws')}/ws/${RAUM}`;
const VORNAMEN = ['Lena', 'Tom', 'Mia', 'Ali', 'Ben', 'Emma', 'Noah', 'Lea', 'Finn', 'Ida'];

const warte = (ms) => new Promise((ok) => setTimeout(ok, ms));
const median = (z) => (z.length ? z.slice().sort((a, b) => a - b)[z.length >> 1] : null);

class Handy {
  constructor(i) {
    this.i = i;
    this.id = `last-${i}-${Math.random().toString(16).slice(2, 10)}`;
    this.vorname = VORNAMEN[i % VORNAMEN.length];
    this.initial = String.fromCharCode(65 + (i % 26));
    this.lauf = null;
    this.verzoegerungen = [];
    this.zuschauen = false;
    this.lobbyNachTest = false;
  }

  verbinde() {
    return new Promise((fertig, fehler) => {
      const ws = new WebSocket(URL_WS);
      this.ws = ws;
      ws.onopen = () => {
        ws.send(JSON.stringify({ typ: 'hallo', rolle: 'handy', id: this.id, vorname: this.vorname, initial: this.initial, geraet: { system: 'Lasttest', browser: 'Node' } }));
      };
      ws.onmessage = (e) => {
        const n = JSON.parse(e.data);
        if (n.typ === 'willkommen') {
          this.nr = n.nr;
          this.sende({ typ: 'bench', daten: { msProSchritt: 0.4, pruefsumme: BENCH_PRUEFSUMME, korrekt: true, mathe: 'node' } });
          fertig();
        }
        this.verarbeite(n);
      };
      ws.onerror = () => fehler(new Error(`Handy ${this.i}: Verbindung fehlgeschlagen`));
    });
  }

  sende(n) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(n));
  }

  verarbeite(n) {
    if (n.typ === 'test') return this.testStand(n);
    if (n.typ === 'lobby') this.lobbyNachTest = true;
    if (n.typ === 't') this.takt(n);
  }

  testStand(n) {
    if (n.phase === 'zuschauen') return void (this.zuschauen = true);
    if (!n.gruppe) {
      this.lauf.endTakt = n.n;
      if (this.lauf.verarbeitet === n.n) this.fertig();
      else this.sende({ typ: 'nachholen' });
      return;
    }
    if (!this.lauf || this.lauf.seed !== n.gruppe.seed) {
      this.lauf = { seed: n.gruppe.seed, gruppe: n.gruppe.name, endTakt: null, gesendet: new Map(), folge: 0, takte: 0 };
    }
    const welt = neueWelt(this.lauf.seed);
    const schuesse = new Map(n.verlauf.feuer);
    for (let t = 1; t <= n.verlauf.bis; t++) spieleTakt(welt, schuesse.get(t) || []);
    Object.assign(this.lauf, { welt, verarbeitet: n.verlauf.bis, nachholen: false });
    if (n.phase === 'ende') {
      this.lauf.endTakt = n.n;
      this.fertig();
    }
  }

  takt(n) {
    const lauf = this.lauf;
    if (!lauf?.welt) return;
    lauf.takte++;
    if (n.n <= lauf.verarbeitet || lauf.nachholen) return;
    if (n.n !== lauf.verarbeitet + 1) {
      lauf.nachholen = true;
      this.sende({ typ: 'nachholen' });
      return;
    }
    const schuesse = [];
    for (const [nr, folge, x, feuer] of n.e) {
      if (nr === this.nr && lauf.gesendet.has(folge)) {
        this.verzoegerungen.push(performance.now() - lauf.gesendet.get(folge));
        lauf.gesendet.delete(folge);
      }
      if (feuer === 1) schuesse.push([nr, x]);
    }
    spieleTakt(lauf.welt, schuesse);
    lauf.verarbeitet = n.n;
    if (n.n % 100 === 0) this.sende({ typ: 'pz', n: n.n, h: pruefsumme(lauf.welt) });
    if (!lauf.eingaben) {
      lauf.eingaben = setInterval(() => {
        lauf.folge++;
        lauf.gesendet.set(lauf.folge, performance.now());
        this.sende({ typ: 'e', s: lauf.folge, x: Math.floor(Math.random() * BREITE), f: lauf.folge % 30 === 0 ? 1 : 0 });
      }, 100);
    }
  }

  fertig() {
    clearInterval(this.lauf.eingaben);
    this.lauf.pruef = pruefsumme(this.lauf.welt);
    this.sende({ typ: 'ergebnis', n: this.lauf.endTakt, h: this.lauf.pruef });
    this.sende({ typ: 'werte', daten: { eingabe: { med: Math.round(median(this.verzoegerungen) ?? 0), p95: 0, n: this.verzoegerungen.length }, takt: { n: this.lauf.takte, haenger: 0 } } });
  }

  trenne() {
    clearInterval(this.lauf?.eingaben);
    if (this.lauf) this.lauf.eingaben = null;
    this.ws.close();
  }
}

async function beamer() {
  const ws = new WebSocket(URL_WS);
  const b = { stand: null, meldungen: [] };
  ws.onmessage = (e) => {
    const n = JSON.parse(e.data);
    if (n.typ === 'stand') b.stand = n;
    if (n.typ === 'meldung' || n.typ === 'belegt') b.meldungen.push(n);
  };
  await new Promise((ok, fehler) => {
    ws.onopen = ok;
    ws.onerror = () => fehler(new Error(`Server unter ${BASIS} nicht erreichbar`));
  });
  ws.send(JSON.stringify({ typ: 'hallo', rolle: 'beamer', token: `lasttest-${RAUM}` }));
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

const b = await beamer();
console.log(`Raum ${RAUM} · ${ANZAHL} Handys · ${DAUER} s · ${BASIS}`);
const handys = Array.from({ length: ANZAHL }, (_, i) => new Handy(i));
await Promise.all(handys.map((h) => h.verbinde()));
await warteBis(() => b.stand?.spieler.filter((s) => s.verbunden).length === ANZAHL, 5000, 'alle Handys in der Lobby');

b.sende({ typ: 'starte', dauer: DAUER });
await warteBis(() => b.stand?.test?.laeuft && b.stand.test.takt > 0, 5000, 'Teststart');

// Verbindungsabbruch mitten im Test, Wiederkehr nach 2 Sekunden
const abbrecher = handys[3 % ANZAHL];
await warte(DAUER * 400);
abbrecher.trenne();
await warte(2000);
await abbrecher.verbinde();

// Nachzügler
const spaet = new Handy(ANZAHL);
await spaet.verbinde();

await warteBis(() => b.stand?.test && !b.stand.test.laeuft, DAUER * 1000 + 10000, 'Testende');
await warteBis(() => handys.every((h) => h.lauf?.pruef), 10000, 'alle Prüfsummen');
await warte(1500);

const test = b.stand.test;
const nachId = new Map(b.stand.spieler.map((s) => [s.id, s]));
let fehler = 0;
console.log(`Einteilung: ${test.art}, Gruppen: ${test.gruppen.map((g) => g.mitglieder.length).join(', ')}`);
console.log(`Server-Takt: ${test.serverTakt.anzahl} Takte, Ø ${test.serverTakt.schnittMs} ms, max ${test.serverTakt.maxMs} ms`);
for (const g of test.gruppen) {
  const ergebnisse = g.mitglieder.map((id) => nachId.get(id)?.ergebnis?.h);
  const gleich = ergebnisse.every((h) => h && h === ergebnisse[0]);
  if (!gleich) fehler++;
  console.log(`  ${g.name}: ${gleich ? 'synchron ✓' : 'NICHT synchron ✗'} (${ergebnisse.join(' ')})`);
}
const abbrecherStand = nachId.get(abbrecher.id);
console.log(`Abbrecher: ${abbrecherStand.abbruecheTest} Abbruch, Prüfsumme ${abbrecher.lauf.pruef}`);
if (abbrecherStand.abbruecheTest !== 1) fehler++;
console.log(`Nachzügler: zuschauen=${spaet.zuschauen}, danach Lobby=${spaet.lobbyNachTest}`);
if (!spaet.zuschauen || !spaet.lobbyNachTest) fehler++;
const alle = handys.flatMap((h) => h.verzoegerungen);
console.log(`Eingabe-Verzögerung: Median ${Math.round(median(alle))} ms über ${alle.length} Eingaben`);
console.log(`Takte pro Handy: min ${Math.min(...handys.map((h) => h.lauf.takte))}, max ${Math.max(...handys.map((h) => h.lauf.takte))}`);

for (const h of [...handys, spaet]) h.ws.close();
b.schliesse();
console.log(fehler ? `FEHLER: ${fehler}` : 'Alles in Ordnung.');
process.exit(fehler ? 1 : 0);
