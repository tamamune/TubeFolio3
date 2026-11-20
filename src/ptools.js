(() => {
  /* ===== 再生画面のツール =====
     操作バー(左): ⟲〇 / 〇⟳ … 〇秒戻る・進む(〇秒は設定「一般」で 5/10/15/30 秒)
     操作バー(右): 🛠 ツール … 押すとパネルを開く
       ・A-B 区間リピート(A を決める / B を決める / 解除)
       ・コマ送り(1コマ戻る・進む。押すと一時停止)
       ・画面の調整(明るさ・コントラスト・彩度・色あい。リセット)
       ・日本語で読み上げ(外国語の動画で、日本語訳の字幕を音声で読む。字幕の仕組みは subtitles.js)
     そのほか(設定「一般」で切り替え):
       ・広告の早送り(広告の間は16倍速・音を消し、スキップできれば押す)
       ・画質の固定(ytpage.js に頼む)
       ・H.264 で再生(ytpage.js がページの読み込み時に効かせる。youtube.com の localStorage に写す)
       ・正確な公開日時をタイトルの下に表示
     設定は chrome.storage(ドライブ同期の対象) */
  const KEYS = ["tf-seek", "tf-vf", "tf-tts", "tf-adff", "tf-quality", "tf-h264", "tf-pubdate"];
  const S = { "tf-seek": 10, "tf-vf": { b: 100, c: 100, s: 100, h: 0 }, "tf-tts": "off", "tf-adff": "off", "tf-quality": "auto", "tf-h264": "off", "tf-pubdate": "on" };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const player = () => document.getElementById("movie_player");
  const video = () => player()?.querySelector("video");
  const isWatch = () => location.pathname === "/watch";
  const vidNow = () => (isWatch() ? new URLSearchParams(location.search).get("v") : null);
  const ad = () => !!player()?.classList.contains("ad-showing");
  const fmt = (t) => { t = Math.max(0, Math.floor(t)); const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60; return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s).padStart(2, "0"); };
  const ask = (msg, wait = 800) => new Promise((res) => {
    const id = Math.random().toString(36).slice(2), done = (v) => { removeEventListener("message", h); res(v); };
    const h = (e) => { if (e.source === window && e.data?.id === id && /res$/.test(e.data.tf || "")) done(e.data.r ?? e.data.info); };
    addEventListener("message", h); postMessage({ ...msg, id }, "*"); setTimeout(() => done(null), wait);
  });

  /* ---------- 〇秒戻る・進む(操作バーの左) ---------- */
  function seekBtns() {
    const left = player()?.querySelector(".ytp-left-controls"); if (!left || !isWatch()) return;
    const n = +S["tf-seek"] || 10;
    let g = left.querySelector(".tf-seekg");
    if (g && g.dataset.n === String(n)) return;
    g?.remove(); g = el("span", "tf-seekg"); g.dataset.n = n;
    for (const d of [-n, n]) {
      const b = el("button", "ytp-button tf-seekb", d < 0 ? `⟲${n}` : `${n}⟳`); b.type = "button";
      b.title = `${n}秒${d < 0 ? "戻る" : "進む"}`; b.setAttribute("aria-label", b.title);
      b.onclick = (e) => { e.stopPropagation(); const v = video(); if (v) v.currentTime = Math.max(0, Math.min((v.duration || 1e9) - 0.2, v.currentTime + d)); };
      g.append(b);
    }
    const play = left.querySelector(".ytp-play-button");
    play ? play.after(g) : left.prepend(g);
  }

  /* ---------- A-B 区間リピート ---------- */
  const ab = { a: null, b: null, vid: "" };
  setInterval(() => {
    const v = video(); if (!v || ab.a == null || ab.b == null || ad() || ab.vid !== vidNow()) return;
    if (v.currentTime >= ab.b || v.currentTime < ab.a - 0.5) v.currentTime = ab.a;
  }, 150);
  function abMarks() { // シークバーの上に A-B の範囲を出す
    const bar = player()?.querySelector(".ytp-progress-bar"); if (!bar) return;
    bar.querySelector(".tf-abr")?.remove();
    const v = video(); if (!v?.duration || ab.a == null || ab.vid !== vidNow()) return;
    const r = el("div", "tf-abr"), b = ab.b ?? v.duration;
    r.style.left = (ab.a / v.duration) * 100 + "%"; r.style.width = Math.max(0.3, ((b - ab.a) / v.duration) * 100) + "%";
    bar.append(r);
  }

  /* ---------- 画面の調整(動画に CSS の filter をかける) ---------- */
  function applyVf() {
    const f = S["tf-vf"] || {}, v = video(); if (!v) return;
    const def = (f.b ?? 100) === 100 && (f.c ?? 100) === 100 && (f.s ?? 100) === 100 && !(+f.h);
    v.style.filter = def ? "" : `brightness(${f.b ?? 100}%) contrast(${f.c ?? 100}%) saturate(${f.s ?? 100}%) hue-rotate(${+f.h || 0}deg)`;
  }

  /* ---------- 日本語で読み上げ(字幕の日本語訳を音声で読む) ---------- */
  let ttsLast = "", duck = null;
  function speak(text, durMs) {
    if (!text || text === ttsLast || !("speechSynthesis" in window)) return; ttsLast = text;
    const v = video();
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text); u.lang = "ja-JP";
      const need = text.length / 7.5 * 1000; u.rate = Math.min(2, Math.max(1, durMs > 0 ? need / durMs : 1.2)); // 字幕の出ている時間に収まる速さ
      if (v && !v.muted) { if (duck == null) duck = v.volume; v.volume = Math.min(duck, Math.max(0.08, duck * 0.25)); } // 読む間は元の音を小さく
      u.onend = u.onerror = () => { if (duck != null && !speechSynthesis.speaking && video()) { video().volume = duck; duck = null; } };
      speechSynthesis.speak(u);
    } catch {}
  }
  const stopTts = () => { try { speechSynthesis.cancel(); } catch {} ttsLast = ""; if (duck != null && video()) video().volume = duck; duck = null; };
  globalThis.tfTts = { on: () => S["tf-tts"] === "on", speak }; // subtitles.js が日本語の行を出すときに呼ぶ
  document.addEventListener("pause", () => { if (S["tf-tts"] === "on") stopTts(); }, true);

  /* ---------- ツールのパネル(操作バーの右の 🛠) ---------- */
  function toolBtn() {
    const right = player()?.querySelector(".ytp-right-controls"); if (!right || !isWatch()) return;
    // 置き場所: 「時間」(チャプター)ボタン(content.js)の右隣。YouTube が作り直して並びが崩れたら、置き直す
    const ts = right.querySelector(".tf-ytp[data-k=ts]"), cur = right.querySelector(".tf-toolb");
    if (cur) { if (ts && ts.nextElementSibling !== cur) ts.after(cur); return; }
    const b = el("button", "ytp-button tf-toolb", "🛠"); b.type = "button"; b.title = "TubeFolio3 のツール(再生・画面の調整・読み上げ・コメント表示・SponsorBlock・字幕)"; b.setAttribute("aria-label", b.title);
    b.onclick = (e) => { e.stopPropagation(); const o = player().querySelector(".tf-tpanel"); o ? o.remove() : panel(); };
    if (ts) ts.after(b); else (right.querySelector(".ytp-right-controls-left") || right).prepend(b);
  }
  // 機能ごとのタブ: 再生 / 画面の調整 / 読み上げ / コメント表示 / SponsorBlock / 字幕(前回開いていたタブを覚える)
  let toolTab = "play";
  function panel() {
    const p = player(); if (!p) return;
    document.querySelector(".tf-cmenu")?.remove();
    const box = el("div", "tf-tpanel tf-cmenu");
    ["click", "mousedown", "dblclick", "wheel", "contextmenu", "keydown"].forEach((t) => box.addEventListener(t, (e) => e.stopPropagation())); // 後ろの映像の操作にしない
    const NAMES = [["play", "再生"], ["vf", "画面の調整"], ["tts", "読み上げ"], ["cm", "コメント表示"], ["sb", "SponsorBlock"], ["su", "字幕"]];
    const tabs = el("div", "tf-mtabs"), panes = {};
    for (const [k, n] of NAMES) { panes[k] = el("div", "tf-mpane"); const b = el("button", null, n); b.type = "button"; b.dataset.k = k; b.onclick = () => show(k); tabs.append(b); }
    const show = (k) => { toolTab = k; for (const [key, pn] of Object.entries(panes)) pn.hidden = key !== k; tabs.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.k === k)); };
    box.append(tabs, ...Object.values(panes));
    let m = panes.play;
    const row = (label, ...kids) => { const r = el("div", "tf-cmr tf-tr"); r.append(el("span", "tf-cml", label)); const k = el("div", "tf-tk"); k.append(...kids); r.append(k); m.append(r); return r; };
    const btn = (t, f, title) => { const b = el("button", "tf-tb", t); b.type = "button"; if (title) b.title = title; b.onclick = f; return b; };
    // A-B
    const abInfo = el("span", "tf-tinfo");
    const paintAb = () => { abInfo.textContent = ab.vid === vidNow() && ab.a != null ? `A ${fmt(ab.a)}${ab.b != null ? ` 〜 B ${fmt(ab.b)} をくり返し中` : " 〜 B を決めてください"}` : "未設定"; abMarks(); };
    row("A-B リピート",
      btn("A", () => { const v = video(); if (!v) return; ab.vid = vidNow(); ab.a = v.currentTime; if (ab.b != null && ab.b <= ab.a) ab.b = null; paintAb(); }, "いまの位置を区間の始まり(A)にする"),
      btn("B", () => { const v = video(); if (!v) return; if (ab.a == null || ab.vid !== vidNow()) { ab.vid = vidNow(); ab.a = 0; } if (v.currentTime <= ab.a + 0.5) return; ab.b = v.currentTime; v.currentTime = ab.a; paintAb(); }, "いまの位置を区間の終わり(B)にして、くり返し再生する"),
      btn("解除", () => { ab.a = ab.b = null; paintAb(); }), abInfo);
    paintAb();
    // コマ送り
    const step = (d) => () => { const v = video(); if (!v) return; v.pause(); v.currentTime = Math.max(0, v.currentTime + d / 30); };
    row("コマ送り", btn("◀ 1コマ", step(-1), "1コマ戻る(一時停止します)"), btn("1コマ ▶", step(1), "1コマ進む(一時停止します)"), btn("◀◀ 1秒", step(-30)), btn("1秒 ▶▶", step(30)));
    // 画面の調整
    m = panes.vf;
    const f = { b: 100, c: 100, s: 100, h: 0, ...(S["tf-vf"] || {}) };
    const sliders = [];
    const slider = (k, label, min, max, unit) => {
      const w = el("label", "tf-tsl"), i = el("input"), n = el("b", null, f[k] + unit);
      i.type = "range"; i.min = min; i.max = max; i.value = f[k];
      i.oninput = () => { f[k] = +i.value; n.textContent = f[k] + unit; S["tf-vf"] = { ...f }; applyVf(); };
      i.onchange = () => chrome.storage.local.set({ "tf-vf": { ...f } });
      w.append(el("span", null, label), i, n); sliders.push([k, i, n, unit]); return w;
    };
    const vf = row("画面の調整", slider("b", "明るさ", 30, 200, "%"), slider("c", "コントラスト", 30, 200, "%"), slider("s", "彩度", 0, 250, "%"), slider("h", "色あい", -180, 180, "°"),
      btn("リセット", () => { Object.assign(f, { b: 100, c: 100, s: 100, h: 0 }); for (const [k, i, n, u] of sliders) { i.value = f[k]; n.textContent = f[k] + u; } S["tf-vf"] = { ...f }; applyVf(); chrome.storage.local.set({ "tf-vf": { ...f } }); }));
    vf.classList.add("tf-tvf");
    // 読み上げ
    m = panes.tts;
    const ttsB = btn("", () => {
      const on = S["tf-tts"] !== "on"; S["tf-tts"] = on ? "on" : "off"; chrome.storage.local.set({ "tf-tts": S["tf-tts"] });
      if (on) { chrome.storage.local.get("tf-sub-mode").then((r) => { if (!r["tf-sub-mode"] || r["tf-sub-mode"] === "off") chrome.storage.local.set({ "tf-sub-mode": "ja" }); }); } // 日本語訳の字幕を使うので、字幕がオフなら「日本語」にする
      else stopTts();
      paintTts();
    });
    const paintTts = () => { ttsB.textContent = S["tf-tts"] === "on" ? "🔊 読み上げ中(押すと止める)" : "🔇 オフ(押すと読み上げる)"; ttsB.classList.toggle("on", S["tf-tts"] === "on"); };
    paintTts();
    row("日本語で読み上げ", ttsB, el("small", "tf-tinfo", "外国語の動画で、日本語訳の字幕を音声で読みます(字幕は「日本語」か「二か国語」で使います)"));
    // コメント表示・SponsorBlock・字幕は、それぞれの機能(content.js・sponsorblock.js・subtitles.js)が中身を作る
    globalThis.tfCm?.buildPane(panes.cm);
    globalThis.tfSB?.buildPane(panes.sb);
    globalThis.tfSub?.buildPane(panes.su);
    p.append(box); show(toolTab);
  }
  document.addEventListener("click", (e) => { const m = document.querySelector(".tf-tpanel"); if (m && !m.contains(e.target) && !e.target.closest(".tf-toolb")) m.remove(); });

  /* ---------- 広告の早送り ---------- */
  let adState = null; // 広告の前の { rate, muted }
  setInterval(() => {
    if (S["tf-adff"] !== "on") return;
    const v = video(); if (!v) return;
    if (ad()) {
      if (!adState) adState = { muted: v.muted };
      v.muted = true; if (v.playbackRate !== 16) v.playbackRate = 16;
      player().querySelector(".ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, button[id^='skip-button']")?.click();
    } else if (adState) { v.muted = adState.muted; adState = null; ask({ tf: "quality", q: S["tf-quality"] }); }
  }, 300);

  /* ---------- 正確な公開日時(タイトルの下) ---------- */
  let pubFor = "";
  async function pubDate() {
    const v = vidNow();
    document.querySelectorAll(".tf-pub").forEach((x) => { if (S["tf-pubdate"] !== "on" || x.dataset.v !== v) x.remove(); });
    if (!v || S["tf-pubdate"] !== "on" || pubFor === v && document.querySelector(".tf-pub")) return;
    let info = null;
    for (let i = 0; i < 20; i++) { info = await ask({ tf: "req" }, 600); if (info?.videoId === v) break; info = null; await new Promise((r) => setTimeout(r, 400)); }
    if (!info || vidNow() !== v) return;
    const iso = info.liveStart || info.publishDate || info.uploadDate; if (!iso) return;
    const d = new Date(iso), hasTime = /T\d/.test(iso);
    const w = "日月火水木金土"[d.getDay()];
    const txt = `📅 ${info.liveStart ? "配信開始" : "公開"} ${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日(${w})${hasTime ? ` ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : ""}${info.viewCount ? ` ・ 再生 ${(+info.viewCount).toLocaleString("ja-JP")}回` : ""}`;
    const t = document.querySelector("ytd-watch-metadata #title"); if (!t) return;
    document.querySelectorAll(".tf-pub").forEach((x) => x.remove());
    const e = el("div", "tf-pub", txt); e.dataset.v = v; t.after(e); pubFor = v;
  }

  /* ---------- 画面の切り替え・設定 ---------- */
  function onVideo() {
    const v = vidNow(); if (!v) return;
    if (ab.vid && ab.vid !== v) { ab.a = ab.b = null; ab.vid = ""; }
    seekBtns(); toolBtn(); applyVf(); pubDate(); stopTts();
    if (S["tf-quality"] !== "auto") setTimeout(() => ask({ tf: "quality", q: S["tf-quality"] }), 1200);
  }
  addEventListener("yt-navigate-finish", () => setTimeout(onVideo, 300));
  setInterval(() => { if (isWatch()) { seekBtns(); toolBtn(); } }, 2000); // YouTube が操作バーを作り直したときにも付け直す
  document.addEventListener("loadeddata", () => { applyVf(); if (S["tf-quality"] !== "auto" && !ad()) ask({ tf: "quality", q: S["tf-quality"] }); }, true);

  const apply = (r, first) => {
    for (const k of KEYS) if (k in r && r[k] != null) S[k] = r[k];
    try { localStorage.setItem("tf-h264", S["tf-h264"] === "on" ? "1" : "0"); } catch {} // ytpage.js が次の読み込みで使う
    seekBtns(); applyVf(); if (!first) pubDate();
    if ("tf-quality" in r && !first) ask({ tf: "quality", q: S["tf-quality"] });
    if (S["tf-tts"] !== "on") stopTts();
  };
  chrome.storage.local.get(KEYS).then((r) => { apply(r, true); onVideo(); });
  chrome.storage.onChanged.addListener((c) => { const r = {}; for (const k of KEYS) if (c[k]) r[k] = c[k].newValue; if (Object.keys(r).length) apply(r); });
})();
