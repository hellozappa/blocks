import { EditorView } from '@codemirror/view';

/** Keep the clicked Reading text line at its screen height while Live Preview lays out. */
export function anchorReadingCursor(view: EditorView, offset: number, screenTop: number, current: () => boolean): void {
  const win = view.dom.ownerDocument.defaultView!;
  const viewport = view.scrollDOM.getBoundingClientRect();
  const margin = Math.max(0, Math.min(viewport.height - 1, screenTop - viewport.top));
  const key = {};
  let cancelled = false;
  let frame = 0;
  let remaining = 4;
  const cancel = () => {
    cancelled = true;
    if (frame) win.cancelAnimationFrame(frame);
    for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) view.dom.removeEventListener(event, cancel, true);
  };
  for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) view.dom.addEventListener(event, cancel, true);
  view.dispatch({ selection: { anchor: offset }, effects: EditorView.scrollIntoView(offset, { y: 'start', yMargin: margin }) });
  view.focus();
  const measure = () => {
    frame = 0;
    view.requestMeasure({
      key,
      read: () => {
        if (cancelled || !current() || !view.dom.isConnected || view.state.selection.main.head !== offset) return undefined;
        return view.coordsAtPos(offset)?.top;
      },
      write: top => {
        if (cancelled) return;
        if (top === undefined || !current() || view.state.selection.main.head !== offset) { cancel(); return; }
        // Reading and Live Preview have different block heights; preserve the clicked line, not scrollTop.
        const delta = top - screenTop;
        if (Math.abs(delta) > .5) view.scrollDOM.scrollTop += delta;
        if (--remaining > 0) frame = win.requestAnimationFrame(measure);
        else cancel();
      },
    });
  };
  measure();
}
