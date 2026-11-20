/* ===== ログ: 同期の流れやエラーを記録して、設定の「ログ」タブで見られるようにする =====
   ・保存先は chrome.storage.local の "tf-log"(このパソコンだけ。ドライブには同期しない)。新しい 500件まで
   ・管理ページでも YouTube の画面でも使える(YouTube の画面では、この拡張機能のエラーだけを拾う)
   ・使い方: tfLog("info" | "warn" | "error", "分類", "内容") */
(() => {
  const K = "tf-log", MAX = 500;
  const where = typeof document === "undefined" ? "バックグラウンド" : location.protocol === "chrome-extension:" ? "管理ページ" : "YouTube"; // バックグラウンド … 新着のお知らせなど
  let buf = [], timer = 0;
  function flush() {
    timer = 0; const add = buf; buf = []; if (!add.length) return;
    chrome.storage.local.get(K).then((r) => chrome.storage.local.set({ [K]: [...(r[K] || []), ...add].slice(-MAX) })).catch(() => {});
  }
  self.tfLog = (lv, cat, msg) => {
    try {
      buf.push({ t: Date.now(), lv, cat, where, msg: String(msg ?? "").slice(0, 2000) });
      clearTimeout(timer); timer = setTimeout(flush, 400);
    } catch {}
  };
  addEventListener("pagehide", flush);
  const mine = (f) => where === "管理ページ" || (f || "").startsWith("chrome-extension://");
  addEventListener("error", (e) => {
    if (!e.message || !mine(e.filename)) return;
    tfLog("error", "エラー", `${e.message}(${(e.filename || "").split("/").pop()}:${e.lineno || "?"})`);
  });
  if (where === "管理ページ") addEventListener("unhandledrejection", (e) => {
    const r = e.reason; tfLog("error", "エラー", `処理の失敗: ${r?.message || r}${r?.stack ? "\n" + String(r.stack).split("\n").slice(1, 3).join("\n") : ""}`);
  });
})();
