/* ===== 低評価率(👎 12%)をサムネに出す(ホーム・検索・一覧など、TubeFolio3 の動画カード) =====
   ・割合は Return YouTube Dislike の推定値(低評価 ÷(高評価+低評価))。YouTube は低評価の数を公開していないので、あくまで推定
   ・30% 以上は「⚠」付きの赤い印にして警告する
   ・画面に見えているカードだけ、少しずつ取りに行く(同時に3件まで)。結果はこのパソコンに1日覚えておく(tf-ryd-cache。同期しない)
   ・設定「一般」でオン/オフ(tf-ryd。ドライブ同期の対象) */
const RYD_WARN = 30, RYD_TTL = 24 * 3600 * 1000;
let rydOn = ls.get("tf-ryd", "on") !== "off";
const rydCache = (() => { try { return JSON.parse(ls.get("tf-ryd-cache", "{}")) || {}; } catch { return {}; } })(); // { 動画ID: [割合(0〜100、-1 = 分からない), 取った時刻] }
let rydSaveT = 0;
const rydSave = () => { clearTimeout(rydSaveT); rydSaveT = setTimeout(() => { const e = Object.entries(rydCache).sort((a, b) => b[1][1] - a[1][1]).slice(0, 3000); ls.set("tf-ryd-cache", JSON.stringify(Object.fromEntries(e))); }, 2000); };
const rydQ = [], rydBusy = new Set();
async function rydFetch(id) {
  try {
    const r = await fetch(`https://returnyoutubedislikeapi.com/votes?videoId=${encodeURIComponent(id)}`);
    if (!r.ok) return -1;
    const j = await r.json(), l = +j.likes || 0, d = +j.dislikes || 0;
    return l + d > 0 ? Math.round((d / (l + d)) * 1000) / 10 : -1;
  } catch { return -1; }
}
async function rydPump() {
  while (rydQ.length && rydBusy.size < 3) {
    const id = rydQ.shift(); if (rydBusy.has(id)) continue;
    rydBusy.add(id);
    rydFetch(id).then((p) => { rydCache[id] = [p, Date.now()]; rydSave(); rydPaintId(id); }).finally(() => { rydBusy.delete(id); rydPump(); });
  }
}
const rydHtml = (p) => p < 0 ? "" : `<span class="dl ${p >= RYD_WARN ? "warn" : ""}" title="低評価の割合(Return YouTube Dislike の推定)${p >= RYD_WARN ? ` ・ ${RYD_WARN}%以上なので注意` : ""}">${p >= RYD_WARN ? "⚠ " : ""}👎 ${p < 10 ? p.toFixed(1) : Math.round(p)}%</span>`;
function rydPaint(th, id) {
  th.querySelector(":scope > .dl")?.remove();
  const c = rydCache[id]; if (!rydOn || !c) return;
  th.insertAdjacentHTML("beforeend", rydHtml(c[0]));
}
const rydPaintId = (id) => document.querySelectorAll(`#main .c[data-v="${CSS.escape(id)}"] > .th`).forEach((th) => rydPaint(th, id));
// 見えてきたカードだけ調べる
const rydIO = typeof IntersectionObserver === "function" ? new IntersectionObserver((es) => {
  for (const e of es) {
    if (!e.isIntersecting) continue;
    rydIO.unobserve(e.target);
    const id = e.target.closest(".c[data-v]")?.dataset.v; if (!id) continue;
    const c = rydCache[id];
    if (c && Date.now() - c[1] < RYD_TTL) rydPaint(e.target, id);
    else if (!rydQ.includes(id)) { rydQ.push(id); rydPump(); }
  }
}, { rootMargin: "200px" }) : null;
// 一覧が描き直されたら、新しく出たカードを見張る(ダミーのカードは data-v がないので対象外)
function rydScan() {
  if (!rydOn || !rydIO) return;
  document.querySelectorAll("#main .c[data-v] > .th:not([data-ryd])").forEach((th) => { th.dataset.ryd = "1"; rydIO.observe(th); });
}
let rydT = 0;
new MutationObserver(() => { clearTimeout(rydT); rydT = setTimeout(rydScan, 150); }).observe(document.getElementById("main") || document.body, { childList: true, subtree: true });
setTimeout(rydScan, 500);
// 設定「一般」の切り替え
document.addEventListener("change", (e) => {
  if (e.target.id !== "set-ryd") return;
  rydOn = e.target.value !== "off"; ls.set("tf-ryd", rydOn ? "on" : "off");
  document.querySelectorAll("#main .th > .dl").forEach((x) => x.remove());
  document.querySelectorAll("#main .th[data-ryd]").forEach((x) => delete x.dataset.ryd);
  rydScan();
});
