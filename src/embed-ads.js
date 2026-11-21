// 埋め込みプレーヤー(youtube.com/embed)の中で動く。TubeFolio3 のミュージック(拡張機能のページに置いた埋め込み)のときだけ働く
// ・広告が流れたら、親(music.js)へ「広告中」と知らせる(広告の長さ・終了を曲のものと取り違えないため)
// ・設定「広告の早送り」(tf-mu-adff。既定はオン)がオンなら、広告の間は16倍速・ミュートにして、スキップできれば押す
(() => {
  if (window.top === window) return;
  const fromExt = (location.ancestorOrigins?.[0] || document.referrer || "").startsWith("chrome-extension://" + chrome.runtime.id);
  if (!fromExt) return;
  let enabled = true, saved = null, told = false;
  chrome.storage.local.get("tf-mu-adff").then((r) => { enabled = r["tf-mu-adff"] !== "off"; }).catch(() => {});
  chrome.storage.onChanged.addListener((c) => { if (c["tf-mu-adff"]) enabled = c["tf-mu-adff"].newValue !== "off"; });
  const SKIP = ".ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button-container button, button[id^='skip-button']";
  const tell = (on) => { if (told === on) return; told = on; try { window.parent.postMessage(JSON.stringify({ event: "tf-ad", on }), "*"); } catch {} };
  setInterval(() => {
    const p = document.querySelector("#movie_player, .html5-video-player"), v = document.querySelector("video.html5-main-video, video");
    if (!p) return;
    const ad = p.classList.contains("ad-showing") || p.classList.contains("ad-interrupting");
    tell(ad);
    if (!v) return;
    if (enabled && ad) {
      saved ||= { muted: v.muted, rate: v.playbackRate || 1 };
      if (!v.muted) v.muted = true;
      if (v.playbackRate !== 16) { try { v.playbackRate = 16; } catch {} }
      p.querySelector(SKIP)?.click();
    } else if (saved) { v.muted = saved.muted; v.playbackRate = saved.rate; saved = null; }
  }, 150);
})();
