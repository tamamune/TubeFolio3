/* ===== ミュージック: 再生リスト・ライブラリの動画を、音楽プレーヤーのように続けて再生する =====
   ・画面: サイドバーの「ミュージック」(manager.html#music でも開く)。曲を選ぶ一覧と、再生の順番(キュー)
   ・プレーヤー: 画面の下に固定(ほかの画面に移っても止まらない)。YouTube の埋め込み(youtube.com/embed)を 1 つだけ置く
   ・曲送りは埋め込みの再生リスト機能(loadPlaylist。200 曲ずつ)に任せる … 画面を消しても次の曲へ進みやすい(TubeTunes と同じ方式)
   ・画面を消しても止まらないように、埋め込みの中で src/embed-keep.js が「いつも表示中」と答える。広告の早送りは src/embed-ads.js
   ・名前は mu で始める(manager の各 JS はグローバルを共有している) */
const MU_WIN = 200; // 一度にプレーヤーへ渡す曲数
const MU_KEY = "tf-mu-state", MU_SET = "tf-mu-set";
const muSt = { q: [], order: [], pos: -1, shuffle: false, repeat: "off", playing: false, time: 0, dur: 0, vol: 100, vid: true };
let muSel = "", muFrame = null, muReady = false, muListenT = null, muPending = [], muWin = { start: -1, len: 0, one: false }, muLoadAt = 0, muAdOn = false, muAdGrace = 0, muSeeking = false, muDock = null;
const muAd = () => muAdOn || Date.now() < muAdGrace;
const muFmt = (t) => { t = Math.max(0, Math.floor(+t || 0)); const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60; return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s).padStart(2, "0"); };
const muCur = () => (muSt.pos >= 0 ? muSt.q[muSt.order[muSt.pos]] : null);

/* ---------- 保存 ---------- */
function muSave() {
  const { q, order, pos, shuffle, repeat, vol, vid } = muSt;
  ls.set(MU_KEY, JSON.stringify({ q, order, pos, shuffle, repeat, vol, vid, time: muSt.time })); // キューと再生位置: このパソコンだけ(ドライブ同期の対象外)
  const set = JSON.stringify({ shuffle, repeat, vol, vid }); // シャッフル・リピート・音量・動画で再生: 設定なので、ドライブ同期の対象(変わったときだけ書く)
  if (ls.get(MU_SET, "") !== set) ls.set(MU_SET, set);
}
(function muLoad() {
  try {
    const s = JSON.parse(ls.get(MU_KEY, "null")); if (!s || !Array.isArray(s.q)) return;
    Object.assign(muSt, { q: s.q, order: s.order?.length === s.q.length ? s.order : s.q.map((_, i) => i), pos: Math.min(s.pos ?? -1, s.q.length - 1), shuffle: !!s.shuffle, repeat: ["off", "all", "one"].includes(s.repeat) ? s.repeat : "off", vol: s.vol ?? 100, vid: s.vid ?? (innerWidth > 820), time: s.time || 0 });
  } catch {}
  if (ls.get(MU_KEY, null) == null) muSt.vid = innerWidth > 820;
  try { const t = JSON.parse(ls.get(MU_SET, "null")); if (t) Object.assign(muSt, { shuffle: !!t.shuffle, repeat: ["off", "all", "one"].includes(t.repeat) ? t.repeat : "off", vol: t.vol ?? muSt.vol, vid: t.vid ?? muSt.vid }); } catch {}
})();

/* ---------- 並び(シャッフル) ---------- */
function muReorder(keepCur) {
  const cur = keepCur ? muSt.order[muSt.pos] : -1, n = muSt.q.length;
  let o = muSt.q.map((_, i) => i);
  if (!muSt.shuffle) { muSt.order = o; muSt.pos = n ? Math.max(0, cur) : -1; return; } // 混ぜないときは、元の並びで、今の曲の位置に合わせる
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [o[i], o[j]] = [o[j], o[i]]; }
  if (cur >= 0) { o = o.filter((x) => x !== cur); o.unshift(cur); muSt.pos = 0; } else muSt.pos = n ? 0 : -1; // 混ぜるときは、今の曲を先頭に
  muSt.order = o;
}
const muTrack = ([id, v]) => ({ id, title: v.title || id, ch: v.channel || "", dur: v.duration || "" });

/* ---------- 埋め込みプレーヤー ---------- */
function muPost(obj) { try { muFrame?.contentWindow?.postMessage(JSON.stringify(obj), "https://www.youtube.com"); } catch {} }
function muCmd(func, ...args) {
  if (!muFrame) return;
  if (!muReady) { muPending.push([func, args]); return; }
  muPost({ event: "command", func, args, id: 1, channel: "widget" });
}
function muListen() {
  muReady = false; clearInterval(muListenT); let n = 0;
  const ping = () => { muPost({ event: "listening", id: 1, channel: "widget" }); if (++n > 80) clearInterval(muListenT); };
  ping(); muListenT = setInterval(ping, 250);
}
function muMakeFrame(videoId) {
  const q = new URLSearchParams({ enablejsapi: "1", autoplay: "0", playsinline: "1", rel: "0", iv_load_policy: "3", origin: location.origin });
  muFrame = document.createElement("iframe");
  muFrame.src = `https://www.youtube.com/embed/${videoId}?${q}`;
  muFrame.allow = "autoplay; encrypted-media; picture-in-picture";
  muFrame.title = "TubeFolio3 ミュージック";
  muFrame.addEventListener("load", muListen);
  muAdOn = false; muAdGrace = 0;
  muDock.querySelector(".mu-vid").append(muFrame);
}
addEventListener("message", (e) => {
  if (!muFrame || e.source !== muFrame.contentWindow) return;
  let d = e.data; if (typeof d === "string") { try { d = JSON.parse(d); } catch { return; } }
  if (!d?.event) return;
  if (d.event === "tf-ad") { muAdOn = !!d.on; if (!muAdOn) muAdGrace = Date.now() + 1500; return; }
  if (!muReady) {
    muReady = true; clearInterval(muListenT);
    for (const ev of ["onReady", "onStateChange", "onError"]) muPost({ event: "command", func: "addEventListener", args: [ev], id: 1, channel: "widget" });
    muPost({ event: "command", func: "setVolume", args: [muSt.vol], id: 1, channel: "widget" });
    muPost({ event: "command", func: "unMute", args: [], id: 1, channel: "widget" });
    const p = muPending; muPending = []; for (const [f, a] of p) muPost({ event: "command", func: f, args: a, id: 1, channel: "widget" });
  }
  if (d.event === "infoDelivery" || d.event === "initialDelivery") muInfo(d.info || {});
  else if (d.event === "onStateChange") muState(d.info);
  else if (d.event === "onError") muError(d.info);
});
function muInfo(info) {
  if (typeof info.playlistIndex === "number" && muWin.start >= 0 && Date.now() - muLoadAt > 1500 && !muWin.one) { // プレーヤーが次の曲へ進んだら、こちらの位置も合わせる
    const np = muWin.start + info.playlistIndex;
    if (np !== muSt.pos && np < muSt.order.length) { muSt.pos = np; muSt.time = 0; muSt.dur = 0; muPaint(true); }
  }
  if (!muAd()) {
    if (typeof info.currentTime === "number") muSt.time = info.currentTime;
    if (typeof info.duration === "number" && info.duration > 0) muSt.dur = info.duration;
  }
  if (typeof info.playerState === "number" && !(muAd() && info.playerState === 0)) muState(info.playerState); else muPaintTime();
}
function muState(st) {
  if (st === 0 && muAd()) return;
  muSt.playing = st === 1 || st === 3; muPaintCtl();
  if (st === 0) muEnded();
  if (st === 1) { muErrN = 0; if (muSt.dur) muSession(); }
}
let muEndFor = null;
function muEnded() {
  const c = muCur(); if (!c || muEndFor === c.id + ":" + muSt.pos) return;
  if (!muWin.one && muWin.start >= 0 && muSt.pos < muWin.start + muWin.len - 1) return; // 窓の途中は、プレーヤーが自動で次へ進む
  muEndFor = c.id + ":" + muSt.pos; muNext(true);
}
let muErrN = 0;
function muError() { // 再生できない曲(削除・非公開・埋め込み禁止)は飛ばす。続けて失敗したら止める
  if (++muErrN > 5) { muErrN = 0; muSt.playing = false; muPaintCtl(); toast("続けて再生できませんでした。止めます"); return; }
  setTimeout(() => muNext(true), 600);
}

/* ---------- 再生の操作 ---------- */
function muLoadWin(p, start = 0, autoplay = true) {
  const n = muSt.order.length; if (!n) return;
  if (muSt.repeat === "one") muWin = { start: p, len: 1, one: true };
  else { const s = n <= MU_WIN ? 0 : p; muWin = { start: s, len: Math.min(MU_WIN, n - s), one: false }; }
  const ids = muSt.order.slice(muWin.start, muWin.start + muWin.len).map((i) => muSt.q[i].id), idx = muWin.one ? 0 : p - muWin.start;
  muLoadAt = Date.now(); muEndFor = null;
  if (!muFrame) muMakeFrame(ids[idx]);
  muCmd(autoplay ? "loadPlaylist" : "cuePlaylist", ids, idx, Math.floor(start || 0));
  muCmd("setLoop", muWin.one || (muSt.repeat === "all" && n <= MU_WIN));
}
function muPlayPos(p, start = 0) {
  if (p < 0 || p >= muSt.order.length) return;
  muSt.pos = p; muSt.time = start; muSt.dur = 0; muSt.playing = true;
  if (muFrame && muReady && !muWin.one && muWin.start >= 0 && p >= muWin.start && p < muWin.start + muWin.len && muSt.repeat !== "one") { muLoadAt = Date.now(); muEndFor = null; muCmd("playVideoAt", p - muWin.start); }
  else muLoadWin(p, start, true);
  muPaint(true); muSave();
}
function muNext(auto) {
  const n = muSt.order.length; if (!n) return;
  if (auto && muSt.repeat === "one") return muPlayPos(muSt.pos);
  let p = muSt.pos + 1;
  if (p >= n) { if (muSt.repeat === "all") p = 0; else { muSt.playing = false; muCmd("pauseVideo"); muPaintCtl(); return; } }
  muPlayPos(p);
}
function muPrev() {
  if (muSt.time > 4) { muCmd("seekTo", 0, true); muSt.time = 0; return muPaintTime(); }
  const n = muSt.order.length; if (!n) return;
  muPlayPos(muSt.pos > 0 ? muSt.pos - 1 : muSt.repeat === "all" ? n - 1 : 0);
}
function muToggle() {
  if (!muSt.q.length) return;
  if (!muFrame) return muPlayPos(Math.max(0, muSt.pos), muSt.time);
  if (muSt.playing) { muCmd("pauseVideo"); muSt.playing = false; } else { muCmd("playVideo"); muSt.playing = true; }
  muPaintCtl();
}
// 曲のリストをキューにして、from の曲から再生する(shuffle なら並びを混ぜる。from の曲は最初に聞く)
function muStart(items, from = 0, shuffle = false) {
  muSt.q = items.map(muTrack); muSt.shuffle = shuffle;
  muSt.pos = from; muSt.order = muSt.q.map((_, i) => i); muReorder(true);
  muFrame?.remove(); muFrame = null; muReady = false; muPending = []; muWin = { start: -1, len: 0, one: false };
  muPlayPos(muSt.pos); muShow(); muLibOpen(false); muOpenSheet(true);
}
function muAddQ(items) {
  const had = muSt.q.length, ids = new Set(muSt.q.map((t) => t.id)), add = items.map(muTrack).filter((t) => !ids.has(t.id));
  if (!add.length) return toast("すべてキューに入っています");
  muSt.q.push(...add); for (let i = had; i < muSt.q.length; i++) muSt.order.push(i);
  if (muSt.pos < 0) muSt.pos = 0;
  if (muFrame && muReady) muLoadWin(muSt.pos, muSt.time, muSt.playing); // 窓を作り直す(今の曲と位置はそのまま)
  muSave(); muShow(); muPaint(true); toast(`${add.length}曲をキューに追加しました`);
}
function muShuffleToggle() { muSt.shuffle = !muSt.shuffle; muReorder(true); if (muFrame && muReady) muLoadWin(muSt.pos, muSt.time, muSt.playing); muSave(); muPaintCtl(); render(); }
function muRepeatToggle() { muSt.repeat = { off: "all", all: "one", one: "off" }[muSt.repeat]; if (muFrame && muReady) muLoadWin(muSt.pos, muSt.time, muSt.playing); muSave(); muPaintCtl(); }
function muClear() { muOpenSheet(false); muFrame?.remove(); muFrame = null; muReady = false; muSt.q = []; muSt.order = []; muSt.pos = -1; muSt.playing = false; muSt.time = 0; muSt.dur = 0; muSave(); muDock.hidden = true; document.body.classList.remove("mu-on"); tab = "all"; try { history.replaceState(null, "", location.pathname); } catch {} scrollTo(0, 0); render(); }

/* ---------- 下のプレーヤー ---------- */
const MU_I = {
  prev: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M6 6h2v12H6zM9.5 12 18 6v12z"/></svg>',
  next: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M16 6h2v12h-2zM6 18V6l8.5 6z"/></svg>',
  play: '<svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><path d="M7 4.5v15l13-7.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><path d="M6 4.5h4v15H6zM14 4.5h4v15h-4z"/></svg>',
  shuf: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h3c5 0 6 10 11 10h4M3 17h3c1.7 0 2.9-1 3.9-2.4M14 9.4C15 8 16 7 17.5 7H21M18.5 4.5 21 7l-2.5 2.5M18.5 14.5 21 17l-2.5 2.5"/></svg>',
  rep: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4"/></svg>',
  down: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
  queue: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h12M3 11h12M3 16h7"/><path d="M19 8v9"/><circle cx="17" cy="17.5" r="2"/><path d="M19 8c1 .3 2 1 2 2.5"/></svg>',
  lib: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M8 9h8M8 13h8M8 17h5"/></svg>',
  stop: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
  vol0: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M4 9v6h4l5 4V5L8 9z"/></svg>',
  vol1: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 9v6h4l5 4V5L8 9z" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12"/></svg>',
  vid: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3z" fill="currentColor"/></svg>',
};
const muMob = () => true; // ミニプレーヤー + 全画面の「再生中」は、スマホもデスクトップも同じ作り(TubeTunes と同じ)
let muSheet = false;
function muBuild() {
  muDock = document.createElement("div"); muDock.id = "mu-dock"; muDock.hidden = true;
  const ctl = () => `<button type="button" class="mu-ib" data-mu="shuf" title="シャッフル">${MU_I.shuf}</button><button type="button" class="mu-ib mu-big" data-mu="prev" title="前の曲">${MU_I.prev}</button><button type="button" class="mu-pp" data-mu="pp" title="再生・一時停止">${MU_I.play}</button><button type="button" class="mu-ib mu-big" data-mu="next" title="次の曲">${MU_I.next}</button><button type="button" class="mu-ib" data-mu="rep" title="くり返し">${MU_I.rep}</button>`;
  const bar = `<div class="mu-bar"><span class="mu-tm">0:00</span><input type="range" class="mu-seek" min="0" max="1000" value="0" aria-label="再生位置"><span class="mu-du">0:00</span></div>`;
  muDock.innerHTML = `<div class="mu-vid"></div>
    <div class="mu-main"><div class="mu-info"><b class="mu-t">-</b><small class="mu-c"></small></div>${bar}
      <div class="mu-ctl">${ctl()}<button type="button" class="mu-ib" data-mu="vid" title="映像の表示・非表示">${MU_I.vid}</button><button type="button" class="mu-ib" data-mu="x" title="プレーヤーを閉じる">✕</button></div></div>
    <div class="mu-mini" data-mu="open" role="button"><div class="mu-prog"><div></div></div><img class="mu-art" alt=""><div class="mu-mt"><b class="mu-t">-</b><small class="mu-c"></small></div><button type="button" class="mu-ib" data-mu="pp" title="再生・一時停止">${MU_I.play}</button><button type="button" class="mu-ib" data-mu="next" title="次の曲">${MU_I.next}</button><button type="button" class="mu-ib" data-mu="x" title="停止して閉じる">✕</button></div>
    <div class="mu-full"><div class="mu-bg"></div>
      <div class="mu-fb"><div class="mu-card">
        <div class="mu-stage"><div class="mu-cdw"><div class="mu-cd"><img class="mu-artimg" alt=""><i class="mu-hole"></i></div></div></div>
        <div class="mu-ft"><b class="mu-t">-</b><small class="mu-c"></small><small class="mu-src2"></small></div>
        ${bar}<div class="mu-fc">${ctl()}</div>
        <div class="mu-pill"><button type="button" data-mu="down" title="閉じる">${MU_I.down}<span>閉じる</span></button><button type="button" data-mu="vid" title="動画で再生">${MU_I.vid}<span>動画で再生</span></button><button type="button" data-mu="lib" title="再生リスト">${MU_I.lib}<span>再生リスト</span></button><button type="button" data-mu="queue" title="キュー">${MU_I.queue}<span>キュー</span></button></div>
        <div class="mu-volrow"><span>${MU_I.vol0}</span><input type="range" class="mu-vol" min="0" max="100" value="100" aria-label="音量"><span>${MU_I.vol1}</span></div>
        </div>
        </div></div>
    <div class="mu-qp"><div class="mu-bg"></div><div class="mu-qb"><div class="mu-qhd"><i></i><span>キュー</span><button type="button" class="mu-ib" data-mu="qx" title="プレーヤーへ戻る">✕</button></div><div class="mu-qn"></div><div class="mu-ql"></div></div></div>
    <div class="mu-lib"><div class="mu-bg"></div><div class="mu-lb"><div class="mu-qhd"><i></i><span>再生リストとライブラリ</span><button type="button" class="mu-ib" data-mu="libx" title="プレーヤーへ戻る">✕</button></div><div class="mu-lbl"></div></div></div>`;
  document.body.append(muDock);
  muDock.addEventListener("input", (e) => { if (e.target.classList.contains("mu-seek")) { muSeeking = true; muDock.querySelectorAll(".mu-tm").forEach((x) => (x.textContent = muFmt((e.target.value / 1000) * (muSt.dur || 0)))); } });
  muDock.addEventListener("change", (e) => { if (e.target.classList.contains("mu-seek")) { const t = (e.target.value / 1000) * (muSt.dur || 0); muSt.time = t; muCmd("seekTo", t, true); muSeeking = false; } });
  addEventListener("resize", muPlaceVid);
  muSwipeInit();
  muDock.querySelector(".mu-vol").addEventListener("input", (e) => { muSt.vol = +e.target.value; muCmd("setVolume", muSt.vol); muCmd("unMute"); muSave(); });
  muDock.querySelector(".mu-fb").addEventListener("scroll", muPlaceVid, { passive: true });
}
function muShow() { muDock.hidden = !muSt.q.length && !muSheet; document.body.classList.toggle("mu-on", !!muSt.q.length); muDock.classList.toggle("mu-novid", !muSt.vid); }
// 全画面の「再生中」を開く・閉じる(スマホ)
function muOpenSheet(on) { muSheet = !!on && muMob(); if (muSheet) muDock.hidden = false; else { muLibOpen(false); muQOpen(false); muDock.hidden = !muSt.q.length; } muDock.classList.toggle("mu-open", muSheet); document.body.classList.toggle("mu-sheet", muSheet); if (muSheet) muQueueList(); muPlaceVid(); }
// 動画の枠: 全画面で「動画を表示」のときは、ジャケットの場所に重ねる。それ以外は、見えないほど小さくして置いたまま(作り直さないので、止まらない)
function muPlaceVid() {
  const v = muDock?.querySelector(".mu-vid"); if (!v) return;
  if (!muMob()) { v.removeAttribute("style"); return; }
  if (muSheet && muSt.vid) {
    const r = muDock.querySelector(".mu-stage").getBoundingClientRect(), h = r.width * 9 / 16;
    v.style.cssText = `position:fixed;left:${r.left}px;top:${r.top + (r.height - h) / 2}px;width:${r.width}px;height:${h}px;transform:none;opacity:1;pointer-events:auto;z-index:2147483000;border-radius:12px`;
  } else v.style.cssText = "position:fixed;left:0;bottom:0;width:200px;height:113px;transform:scale(.02);transform-origin:left bottom;opacity:.01;pointer-events:none;z-index:1";
}
function muQueueList() {
  const el = muDock.querySelector(".mu-ql"); if (!el) return;
  muDock.querySelector(".mu-qn").innerHTML = `<div class="mu-qh">${muSt.q.length}曲${muSt.shuffle ? " ・ シャッフル中" : ""}</div>`;
  el.innerHTML = (muSt.q.length ? muSt.order.map((qi, pos) => muRow(pos, muSt.q[qi].id, muSt.q[qi], "q:" + pos).replace('class="mu-row ', `class="mu-row ${pos === muSt.pos ? "now" : ""} `)).join("") : `<div class="empty">キューは空です。「再生リスト」から曲を選んでください。</div>`);
}
function muQOpen(on) { muDock.classList.toggle("mu-qopen", !!on); if (on) { muLibOpen(false); muQueueList(); } muPlaceVid(); }
function muPaintTime() {
  if (!muDock) return;
  const pct = muSt.dur ? Math.min(100, (muSt.time / muSt.dur) * 100) : 0;
  muDock.querySelectorAll(".mu-tm").forEach((x) => (x.textContent = muFmt(muSt.time))); muDock.querySelectorAll(".mu-du").forEach((x) => (x.textContent = muFmt(muSt.dur || 0)));
  if (!muSeeking) muDock.querySelectorAll(".mu-seek").forEach((x) => (x.value = muSt.dur ? Math.round((muSt.time / muSt.dur) * 1000) : 0));
  muDock.querySelector(".mu-prog > div").style.width = pct + "%";
}
function muPaintCtl() {
  if (!muDock) return;
  muDock.querySelectorAll('[data-mu="pp"]').forEach((x) => (x.innerHTML = muSt.playing ? MU_I.pause : MU_I.play));
  muDock.querySelectorAll('[data-mu="shuf"]').forEach((x) => x.classList.toggle("on", muSt.shuffle));
  muDock.querySelectorAll('[data-mu="rep"]').forEach((x) => { x.classList.toggle("on", muSt.repeat !== "off"); x.dataset.rep = muSt.repeat === "one" ? "1" : ""; });
  muDock.querySelectorAll('[data-mu="vid"]').forEach((x) => { x.classList.toggle("on", muSt.vid); const t = x.querySelector("span"); if (t) t.textContent = muSt.vid ? "動画を隠す" : "動画を表示"; });
  muDock.classList.toggle("mu-novid", !muSt.vid); muDock.classList.toggle("mu-spin", muSt.playing && !muSt.vid); muDock.classList.toggle("mu-vidon", muSt.vid);
  const vo = muDock.querySelector(".mu-vol"); if (vo && +vo.value !== muSt.vol) vo.value = muSt.vol;
  muPlaceVid();
}
function muPaint(listToo) {
  if (!muDock) return;
  const c = muCur();
  muDock.querySelectorAll(".mu-t").forEach((x) => (x.textContent = c?.title || "-")); muDock.querySelectorAll(".mu-c").forEach((x) => (x.textContent = c?.ch || ""));
  muDock.querySelector(".mu-src2").textContent = c ? `${muSt.pos + 1} / ${muSt.order.length}` : "";
  const art = muDock.querySelector(".mu-art"), big = muDock.querySelector(".mu-artimg");
  if (c && art.dataset.id !== c.id) { art.dataset.id = c.id; art.src = thumb(c.id, "default"); big.onerror = () => { if (!big.src.includes("hqdefault")) big.src = thumb(c.id, "hqdefault"); }; big.src = thumb(c.id, "hqdefault"); muDock.querySelectorAll(".mu-bg").forEach((x) => (x.style.backgroundImage = `url("${thumb(c.id, "hqdefault")}")`)); }
  if (!c) { big.removeAttribute("src"); delete art.dataset.id; }
  muPaintCtl(); muPaintTime(); muSession();
  if (muDock.classList.contains("mu-qopen")) muQueueList();
  if (listToo && tab === "music") muMark();
}
// 一覧の「再生中」の印だけ付け替える(画面全体を描き直さない)
function muMark() {
  const id = muCur()?.id;
  document.querySelectorAll("#main .mu-row.now").forEach((x) => x.classList.remove("now"));
  document.querySelectorAll(`#main .mu-q .mu-row[data-mu="q:${muSt.pos}"]`).forEach((x) => x.classList.add("now"));
  if (id) document.querySelectorAll(`#main .mu-row[data-id="${id}"]:not([data-mu^="q:"])`).forEach((x) => x.classList.add("now"));
}
// スマホのロック画面・通知の操作(再生・一時停止・前後の曲)
function muSession() {
  if (!("mediaSession" in navigator)) return;
  try {
    const c = muCur(); if (!c) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: c.title, artist: c.ch, album: "TubeFolio3 ミュージック", artwork: [{ src: thumb(c.id, "hqdefault"), sizes: "480x360", type: "image/jpeg" }] });
    navigator.mediaSession.playbackState = muSt.playing ? "playing" : "paused";
    navigator.mediaSession.setActionHandler("play", () => { if (!muSt.playing) muToggle(); });
    navigator.mediaSession.setActionHandler("pause", () => { if (muSt.playing) muToggle(); });
    navigator.mediaSession.setActionHandler("nexttrack", () => muNext(false));
    navigator.mediaSession.setActionHandler("previoustrack", () => muPrev());
  } catch {}
}
setInterval(() => { if (muDock && !muDock.hidden && muSt.playing) { muPaintTime(); muSave(); } }, 2000);

/* ---------- 画面(サイドバーの「ミュージック」) ---------- */
function musicNav(cur) {
  return `<button class="ni ${cur === "music" ? "on" : ""}" data-t="music" title="ミュージック"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/></svg><span class="lbl">ミュージック</span></button>`;
}
function muSources() { // [キー, 名前, 件数 or null]
  const out = [], later = laterPl();
  if (later) out.push(["later", "TubeFolio2 後で見る", null]);
  out.push(["saved", "ライブラリ: 保存した動画", all().filter(([, v]) => !v.dummy).length]);
  for (const p of plsOf("pl")) out.push(["pl:" + plId(p), p.title, null]);
  for (const p of pls().filter((p) => !LATER(p) && kindOf(p) !== "own" && !hpl.has(plId(p)))) out.push(["pl:" + plId(p), p.title, null]);
  return out;
}
function muItems(key) {
  const real = (l) => (l || []).filter(([id, v]) => id && v && !v.dummy);
  if (key === "saved") return real(all());
  if (key === "later") { const p = laterPl(); return p ? real(cache.later?.[p.id]) : []; }
  if (key.startsWith("pl:")) { const p = pls().find((x) => plId(x) === key.slice(3)); return p ? real(cache.pl?.[p.id]) : []; }
  return [];
}
function muRow(i, id, v, mu, extra = "") {
  return `<div class="mu-row ${muCur()?.id === id && mu.startsWith("q:") === false ? "now" : ""}" data-mu="${mu}" data-id="${esc(id)}" role="button" tabindex="0"><img loading="lazy" alt="" src="${esc(thumb(id, "default"))}"><span class="mu-rt"><b>${esc(v.title || id)}</b><small>${esc(v.channel || v.ch || "")}</small></span><span class="mu-rd">${esc(v.duration || v.dur || "")}</span>${extra}</div>`;
}
const muJson = (k, d) => { try { return JSON.parse(ls.get(k, "")) ?? d; } catch { return d; } };
const muOpenSet = new Set(muJson("tf-mu-open", [])); // 曲の一覧を開いている再生リスト
const muFold = muJson("tf-mu-fold", {}); // 閉じているフォルダ(true = 閉じている)
const muFoldSave = () => ls.set("tf-mu-fold", JSON.stringify(muFold)), muOpenSave = () => ls.set("tf-mu-open", JSON.stringify([...muOpenSet]));
// 再生リストの一覧: 名前・サムネイル・曲の取り方をまとめる
function muPlayList(key) {
  if (key === "saved") { const l = muItems("saved"); return { key, title: "ライブラリ: 保存した動画", thumb: l[0] ? thumb(l[0][0], "default") : "", count: l.length }; }
  const p = key === "later" ? laterPl() : pls().find((x) => plId(x) === key.slice(3)); if (!p) return null;
  const l = muItems(key);
  return { key, p, title: p.title || key, thumb: p.thumb || (l[0] ? thumb(l[0][0], "default") : ""), count: l.length || null };
}
function muPlRow(key) {
  const m = muPlayList(key); if (!m) return "";
  const open = muOpenSet.has(key), items = open ? muItems(key) : [];
  let body = "";
  if (open) {
    const loading = m.p && !items.length && !plFetched.has(m.p.id);
    if (loading) fetchPl(m.p).then(() => { saveCache(); muLibRender(); });
    body = `<div class="mu-tb"><div class="mu-acts"><button type="button" class="btn p" data-mu="play|${esc(key)}">▶ すべて再生</button><button type="button" class="btn" data-mu="shuf|${esc(key)}">🔀 シャッフル</button><button type="button" class="btn" data-mu="add|${esc(key)}">＋ キューに追加</button></div>`
      + `<div class="mu-list">${items.length ? items.map(([id, v], i) => muRow(i, id, v, `trk|${key}|${i}`)).join("") : `<div class="empty">${loading ? "読み込み中…" : "動画がありません"}</div>`}</div></div>`;
  }
  return `<div class="mu-pl ${open ? "open" : ""}" data-mu="tog|${esc(key)}" role="button" tabindex="0"><div class="mu-pi">${m.thumb ? `<img loading="lazy" alt="" src="${esc(m.thumb)}">` : "🎵"}</div><span class="mu-rt"><b>${esc(m.title)}</b><small>${m.count != null ? m.count + "曲" : "タップで曲を表示"}</small></span><span class="mu-car">▸</span></div>${body}`;
}
function muLibHtml() {
  const later = laterPl(), own = plsOf("pl"), saved = pls().filter((p) => !LATER(p) && kindOf(p) !== "own" && !hpl.has(plId(p)));
  const secs = [
    ["own", "再生リスト", own.map((p) => "pl:" + plId(p))],
    ["lib", "ライブラリ(保存した再生リスト)", saved.map((p) => "pl:" + plId(p))],
  ].filter(([, , keys]) => keys.length);
  let h = "";
  if (!secs.length) h += `<div class="empty">再生リストがまだ読み込まれていません。ホームを開いてから、もう一度来てください。</div>`;
  for (const [id, name, keys] of secs) {
    const shut = !!muFold[id];
    h += `<div class="mu-fh2 ${shut ? "" : "open"}" data-mu="fold|${id}" role="button" tabindex="0"><span class="mu-car">▸</span><b>${esc(name)}</b><small>${keys.length}</small></div>`;
    if (!shut) h += `<div class="mu-pls">${keys.map(muPlRow).join("")}</div>`;
  }
  return h;
}
function muLibRender() { const el = muDock?.querySelector(".mu-lbl"); if (el) { const y = el.scrollTop; el.innerHTML = muLibHtml(); el.scrollTop = y; } }
function muLibOpen(on) { if (on) muDock.classList.remove("mu-qopen"); muDock.classList.toggle("mu-libopen", !!on); if (on) { muLibRender(); muPlaceVid(); } else muPlaceVid(); }
// ミュージックのページ(サイドバーの「ミュージック」)。開くとプレーヤーが自動で開く。閉じたあとに、開き直すボタンを出しておく
let muWantOpen = false;
document.addEventListener("click", (e) => { const t = e.target.closest?.("[data-t]"); if (!t) return; if (t.dataset.t === "music") { if (innerWidth > 820) { e.preventDefault(); e.stopImmediatePropagation(); if (muDock) muOpenSheet(!muSheet); return; } muWantOpen = true; } else if (muDock && muSheet) muOpenSheet(false); }, true); // ほかのページへ移るときは、プレーヤーを閉じる(再生は続く)
if (location.hash === "#music" && innerWidth <= 820) muWantOpen = true;
function musicView() {
  if (muWantOpen) { muWantOpen = false; setTimeout(() => muOpenSheet(true), 0); }
  return `<div class="s-bar"><div class="s-head">ミュージック<small class="bm-n">再生リストやライブラリの動画を、音楽のように続けて再生します</small></div></div>`
    + `<div class="mu-acts"><button type="button" class="btn p" data-mu="open">▶ プレーヤーを開く</button><button type="button" class="btn" data-mu="lib">再生リストとライブラリを開く</button></div>`
    + (muSt.q.length ? `<div class="mu-hint">再生中: ${esc(muCur()?.title || "")}</div>` : `<div class="mu-hint">いま再生している曲はありません。</div>`);
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-mu]"); if (!b) return;
  const a = b.dataset.mu;
  if (a === "pp") return muToggle();
  if (a === "next") return muNext(false);
  if (a === "prev") return muPrev();
  if (a === "shuf") return muShuffleToggle();
  if (a === "rep") return muRepeatToggle();
  if (a === "vid") { muSt.vid = !muSt.vid; muSave(); return muPaintCtl(); }
  if (a === "more") { muDock.classList.toggle("mu-moreon"); return; }
  if (a === "queue") return muQOpen(true);
  if (a === "qx") return muQOpen(false);
  if (a === "open") return muOpenSheet(true);
  if (a === "lib") { muOpenSheet(true); return muLibOpen(true); }
  if (a === "libx") return muLibOpen(false);
  if (a === "down") { muOpenSheet(false); tab = "all"; try { history.replaceState(null, "", location.pathname); } catch {} scrollTo(0, 0); return render(); }
  if (a === "yt") { const c = muCur(); if (c) window.open(`https://www.youtube.com/watch?v=${c.id}${muSt.time > 5 ? "&t=" + Math.floor(muSt.time) : ""}`, "_blank"); return; }
  if (a === "x") { muDock.classList.remove("mu-moreon"); muClear(); return; }
  if (a === "clearq") return muClear();
  const [op, key, idx] = a.split("|");
  if (op === "fold") { muFold[key] = !muFold[key]; muFoldSave(); return muLibRender(); }
  if (op === "tog") { muOpenSet.has(key) ? muOpenSet.delete(key) : muOpenSet.add(key); muOpenSave(); return muLibRender(); }
  if (op === "play" || op === "shuf" || op === "add" || op === "trk") {
    const items = muItems(key);
    if (!items.length) return toast("まだ曲を読み込めていません");
    if (op === "play") return muStart(items, 0, false);
    if (op === "shuf") return muStart(items, Math.floor(Math.random() * items.length), true);
    if (op === "add") return muAddQ(items);
    return muStart(items, +idx, muSt.shuffle);
  }
  if (a.startsWith("q:")) { muQOpen(false); return muPlayPos(+a.slice(2)); }
});
document.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.matches?.(".mu-row,.mu-pl,.mu-fh2")) { e.preventDefault(); e.target.click(); } });

/* ---------- 起動 ---------- */
muBuild(); muShow(); muPaint(false);
if (location.hash === "#music" && innerWidth <= 820) tab = "music";

/* ---------- CD を左右にスワイプして、曲を換える ---------- */
function muGo(delta) { // 前後の曲へ(端では動かない)。動いたら true
  const n = muSt.order.length; if (!n) return false;
  let p = muSt.pos + delta;
  if (p < 0 || p >= n) { if (muSt.repeat === "all" || muSt.shuffle) p = (p + n) % n; else return false; }
  muPlayPos(p); return true;
}
function muSwipeInit() {
  const st = muDock.querySelector(".mu-stage"), w = muDock.querySelector(".mu-cdw");
  let sx = 0, dx = 0, drag = false, busy = false;
  const set = (x, tr) => { w.style.transition = tr || "none"; w.style.transform = `translateX(${x}px) rotate(${x / 12}deg)`; w.style.opacity = String(Math.max(0.2, 1 - Math.abs(x) / 420)); };
  st.addEventListener("pointerdown", (e) => { if (busy || !muSt.q.length || muSt.vid) return; drag = true; sx = e.clientX; dx = 0; try { st.setPointerCapture(e.pointerId); } catch {} });
  st.addEventListener("pointermove", (e) => { if (!drag) return; dx = e.clientX - sx; set(dx); });
  const end = () => {
    if (!drag) return; drag = false;
    const W = st.clientWidth || 300;
    if (Math.abs(dx) > Math.min(70, W * 0.2)) { // CD を外して、新しい CD を入れる
      const dir = dx < 0 ? 1 : -1; busy = true;
      set(-dir * W * 1.1, "transform .22s ease-in, opacity .22s");
      setTimeout(() => {
        const moved = muGo(dir);
        set(moved ? dir * W * 1.1 : 0); w.getBoundingClientRect(); // 反対側から入れる(動けなかったときは、その場に戻す)
        set(0, "transform .3s ease-out, opacity .3s"); setTimeout(() => { busy = false; w.style.transition = ""; }, 320);
      }, 230);
    } else set(0, "transform .2s ease, opacity .2s");
    dx = 0;
  };
  st.addEventListener("pointerup", end); st.addEventListener("pointercancel", end);
}
