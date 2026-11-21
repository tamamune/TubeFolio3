// 埋め込みプレーヤー(youtube.com/embed。MAIN world / document_start)
// 画面を消してページが「非表示」になっても、プレーヤーに「表示中」と思わせて、一時停止させない(TubeTunes と同じ)
(() => {
  const def = (obj, key, val) => { try { Object.defineProperty(obj, key, { configurable: true, get: () => val }); } catch {} };
  def(Document.prototype, "hidden", false);
  def(Document.prototype, "webkitHidden", false);
  def(Document.prototype, "visibilityState", "visible");
  def(Document.prototype, "webkitVisibilityState", "visible");
  try { document.hasFocus = () => true; } catch {}
  const block = (e) => { e.stopImmediatePropagation(); };
  for (const t of ["visibilitychange", "webkitvisibilitychange", "pagehide", "blur", "freeze"]) {
    window.addEventListener(t, block, true);
    document.addEventListener(t, block, true);
  }
})();
