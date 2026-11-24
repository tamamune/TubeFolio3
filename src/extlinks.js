/* ===== TubeFolio3 の画面から外へ出るリンクは、ブラウザの新しいタブで開く =====
   動画の再生(ホームの再生・プレーヤー)以外のリンク(チャンネル・ニュース・外部サイトなど)は、すべてここを通る。
   スマホ(Android)では、リンクを押すと YouTube アプリに飛んでしまうので、拡張機能から chrome.tabs.create で開く。
   スマホは youtube.com を m.youtube.com にして、アプリに渡らないようにする。 */
(() => {
  const touch = () => { try { return matchMedia("(pointer:coarse)").matches && !matchMedia("(pointer:fine)").matches; } catch { return false; } };
  const fix = (u) => {
    try {
      const x = new URL(u, "https://www.youtube.com/");
      if (!/^https?:$/.test(x.protocol)) return "";
      if (touch() && x.hostname === "www.youtube.com") x.hostname = "m.youtube.com";
      return x.href;
    } catch { return ""; }
  };
  const open = (u, active = true) => { const url = fix(u); if (!url) return false; if (chrome.tabs?.create) { chrome.tabs.create({ url, active }); return true; } return false; };
  window.tfOpenTab = open;
  const orig = window.open.bind(window);
  window.open = (u, ...rest) => (u && open(String(u)) ? null : orig(u, ...rest));
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0) return;
    const a = e.target.closest?.("a[href]"); if (!a) return;
    const h = a.getAttribute("href") || "";
    if (!/^https?:\/\//i.test(h)) return; // #や chrome-extension: のリンクは、そのまま
    e.preventDefault(); open(h, !(e.ctrlKey || e.metaKey));
  }, true);
})();
