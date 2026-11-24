/* ===== サムネイルの上で動画を再生(ホーム・検索・ブックマークなど、動画カードのサムネイルにマウスを乗せたとき) =====
   YouTube の埋め込みプレーヤーを、音なしでサムネイルの上に重ねる。再生が始まったら表示し、埋め込みできない動画は何も出さない。
   設定で ON / OFF。クリックすると、いつもどおり再生画面を開く。 */
let tpMode = ls.get("tf-thumb-pv", "1"); if (!["0", "1", "2"].includes(tpMode)) tpMode = "1"; // 0 = サムネイルのまま / 1 = 音なしで再生 / 2 = 音ありで再生
let tpOn = tpMode !== "0";
// プレビューの音量(設定 0〜100%。「音ありでプレビュー再生する」のときに使う)
let tpVol = Math.min(100, Math.max(0, Math.round(+ls.get("tf-tp-vol", "50")))); if (isNaN(tpVol)) tpVol = 50;
const tpVolSet = (v) => { tpVol = Math.min(100, Math.max(0, Math.round(+v) || 0)); ls.set("tf-tp-vol", String(tpVol)); $("set-tpvol").value = String(tpVol); $("set-tpvol-n").value = String(tpVol); if (tpFrame) tpSendVol(tpFrame); };
const tpSendVol = (f) => { try { f.contentWindow.postMessage(JSON.stringify({ event: "command", func: "setVolume", args: [tpVol] }), "*"); } catch {} };
$("set-tpvol").value = $("set-tpvol-n").value = String(tpVol);
$("set-tpvol").oninput = () => tpVolSet($("set-tpvol").value);
$("set-tpvol-n").onchange = () => tpVolSet($("set-tpvol-n").value);
$("set-tpv").value = tpMode;
$("set-tpv").onchange = () => { tpMode = $("set-tpv").value; tpOn = tpMode !== "0"; ls.set("tf-thumb-pv", tpMode); if (!tpOn) tpStop(); };
// サムネイル上のUIの大きさ(設定で 20〜100%。チャンネルのプレビューの大きさ pvScale とは別に持つ)
let tpScale = Math.min(100, Math.max(1, +ls.get("tf-tp-ui-scale", "100") || 100)); // 下限は1%(縮めるのは YouTube のプレーヤー内UIだけ。🔖・🕒などは縮めない)
const tpScaleSet = (v) => { tpScale = Math.min(100, Math.max(1, Math.round(+v) || 100)); ls.set("tf-tp-ui-scale", String(tpScale)); $("set-tps").value = String(tpScale); $("set-tps-n").value = String(tpScale); };
$("set-tps").value = $("set-tps-n").value = String(tpScale);
$("set-tps").oninput = () => tpScaleSet($("set-tps").value);
$("set-tps-n").onchange = () => tpScaleSet($("set-tps-n").value);
let tpTimer = 0, tpGuard = 0, tpTh = null, tpFrame = null;
function tpStop() {
  clearTimeout(tpTimer); clearTimeout(tpGuard);
  tpFrame?.remove(); tpFrame = null;
  tpTh?.classList.remove("tp-on"); tpTh = null;
}
const durSec = (t) => { const p = (t || "").trim().split(":").map(Number); return p.length > 1 && p.every((x) => !isNaN(x)) ? p.reduce((a, x) => a * 60 + x, 0) : 0; };
function tpStart(th) {
  const card = th.closest(".c[data-v]"), id = card?.dataset.v;
  if (!id || !/^[\w-]{11}$/.test(id) || !th.isConnected) return;
  const d = durSec(th.querySelector(".dur")?.textContent), start = d > 90 ? Math.floor(d * 0.2) : 0; // 長い動画は、冒頭を避けて少し先から
  const f = document.createElement("iframe");
  f.className = "tp-f"; 
   f.tabIndex = -1; f.setAttribute("aria-hidden", "true"); f.allow = "autoplay";
  f.src = `https://www.youtube.com/embed/${id}?autoplay=1&mute=${tpMode === "2" ? 0 : 1}&controls=0&disablekb=1&fs=0&iv_load_policy=3&modestbranding=1&playsinline=1&rel=0&start=${start}&enablejsapi=1`;
  // プレーヤーに「状態を知らせて」と頼む(読み込み直後は聞いてもらえないことがあるので、返事が来るまで繰り返す)
  f.onload = () => {
    let n = 0; const ask = () => { if (tpFrame !== f || f.dataset.msg || n++ > 12) return; try { f.contentWindow.postMessage(JSON.stringify({ event: "listening", id: 1, channel: "widget" }), "*"); } catch {} setTimeout(ask, 250); };
    ask();
    if (tpMode === "2") [300, 900, 1800].forEach((t) => setTimeout(() => { if (tpFrame === f) tpSendVol(f); }, t)); // 音量を合わせる(読み込み直後は届かないことがあるので、数回)
  };
  th.style.setProperty("--ui", tpScale / 100); // プレビュー中に映像の上へ重なるボタン類の大きさ(設定「サムネイル上のUIの大きさ」。チャンネルのプレビューの大きさとは別)
  th.querySelector("img")?.after(f); th.classList.add("tp-on"); tpTh = th; tpFrame = f;
  setTimeout(() => { if (tpFrame === f && !f.dataset.msg) f.classList.add("play"); }, 5000); // 知らせがまったく届かないときだけ、最後の手段として表示する(通常は再生が始まってから見せる。黒い画面を挟まない)
  tpGuard = setTimeout(() => { if (tpFrame === f && !f.classList.contains("play")) tpStop(); }, 9000); // 始まらない(埋め込み不可など)ときはやめる
}
// プレーヤーからの知らせ: 再生が始まったら見せる / エラーなら外す
addEventListener("message", (e) => {
  if (!tpFrame || e.source !== tpFrame.contentWindow) return;
  tpFrame.dataset.msg = "1";
  let m; try { m = typeof e.data === "string" ? JSON.parse(e.data) : e.data; } catch { return; }
  if (m?.event === "onError") return tpStop();
  const st = m?.event === "onStateChange" ? m.info : m?.info?.playerState;
  if (st === 1 || m?.info?.currentTime > 0) { tpFrame.classList.add("play"); if (tpMode === "2") tpSendVol(tpFrame); } // 再生が始まった
  else if (st === 0) tpStop();
});
document.addEventListener("mouseover", (e) => {
  if (!tpOn) return;
  const th = e.target.closest(".c[data-v] .th");
  if (th === tpTh) return;
  tpStop();
  if (th) tpTimer = setTimeout(() => tpStart(th), pvDelay * 1000);
});
document.addEventListener("mouseleave", tpStop);
addEventListener("blur", tpStop);
addEventListener("scroll", (e) => { if (tpTh && (e.target === document || e.target === document.scrollingElement)) tpStop(); }, true);
document.addEventListener("click", tpStop, true);
