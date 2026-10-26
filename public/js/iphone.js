// iPhone/iPad (Safari) auf den Handy-Seiten: kein Doppeltipp-Zoom und kein Markieren von Text beim Spielen.
// Das CSS (touch-action, user-select in stil.css) verhindert beides meist schon; das hier ist die zweite Sicherung.

const KNOPF_ODER_FELD = 'button, a, input, label, select, textarea';
const istFeld = (el) => el instanceof Element && !!el.closest('input, textarea');

export function schuetzeVorZoomUndMarkieren() {
  // Zwei schnelle Berührungen, etwa auf ◀ ▶ − +, zoomen sonst ins Bild, und das Steuerpult ragt aus dem Bildschirm.
  // Die zweite schnelle Berührung zählt deshalb nicht als Doppeltipp – außer auf Knöpfen und Feldern, die sollen klicken.
  let letzte = 0;
  document.addEventListener(
    'touchend',
    (ereignis) => {
      const schnell = ereignis.timeStamp - letzte < 450;
      letzte = ereignis.timeStamp;
      const ziel = ereignis.target;
      if (schnell && ereignis.cancelable && !(ziel instanceof Element && ziel.closest(KNOPF_ODER_FELD))) {
        ereignis.preventDefault();
      }
    },
    { passive: false },
  );

  // Langes Drücken markiert sonst Text und öffnet „Kopieren/Ausschneiden“: gar nicht erst mit dem Markieren beginnen
  // (Eingabefelder ausgenommen) und eine trotzdem entstandene Auswahl beim nächsten Fingertipp aufheben.
  document.addEventListener('selectstart', (ereignis) => {
    const ziel = ereignis.target instanceof Element ? ereignis.target : ereignis.target?.parentElement;
    if (!istFeld(ziel)) ereignis.preventDefault();
  });
  document.addEventListener('pointerdown', () => {
    const auswahl = getSelection();
    if (auswahl?.rangeCount && !istFeld(document.activeElement)) auswahl.removeAllRanges();
  });
}
