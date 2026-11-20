(() => {
  /* ===== 再生画面のツール =====
     操作バー(真ん中): ◀| / ⟲〇 / 〇⟳ / |▶ … 1コマ戻る・〇秒戻る・〇秒進む・1コマ進む(〇秒は設定「一般」で 5/10/15/30 秒)
     操作バー(右): 🛠 ツール … 押すとパネルを開く
       ・A-B 区間リピート(A を決める / B を決める / 解除)
       ・画面の調整(明るさ・コントラスト・彩度・色あい。リセット)
       ・日本語で読み上げ(外国語の動画で、日本語訳の字幕を音声で読む。字幕の仕組みは subtitles.js)
     そのほか(設定「一般」で切り替え):
       ・広告の早送り(広告の間は16倍速・音を消し、スキップできれば押す)
       ・画質の固定(ytpage.js に頼む)
       ・H.264 で再生(ytpage.js がページの読み込み時に効かせる。youtube.com の localStorage に写す)
       ・正確な公開日時をタイトルの下に表示
     設定は chrome.storage(ドライブ同期の対象) */
  const KEYS = ["tf-seek", "tf-step", "tf-vf", "tf-tts", "tf-tts-rate", "tf-adff", "tf-quality", "tf-h264", "tf-pubdate"];
  const S = { "tf-seek": 10, "tf-step": "on", "tf-vf": { b: 100, c: 100, s: 100, h: 0 }, "tf-tts": "off", "tf-tts-rate": "auto", "tf-adff": "off", "tf-quality": "auto", "tf-h264": "off", "tf-pubdate": "on" };
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

  /* ---------- コマ送り・〇秒戻る・進む(操作バーの真ん中。両端がコマ送り) ---------- */
  function seekBtns() {
    const bar = player()?.querySelector(".ytp-chrome-controls"); if (!bar || !isWatch()) return;
    // 設定「一般」: 〇秒(0 = 表示しない)と、コマ送りボタン(on / off)
    const n = S["tf-seek"] == null || S["tf-seek"] === "" ? 10 : +S["tf-seek"] || 0, stepOn = S["tf-step"] !== "off";
    let g = player().querySelector(".tf-seekg");
    if (!n && !stepOn) return g?.remove(); // どちらも表示しない
    const key = n + (stepOn ? "s" : "") + "i"; // "i" … 真ん中・アイコンの並び(前の版のボタンが残っていたら作り直す)
    if (g && g.dataset.n === key && g.parentElement === bar) return seekSize(g);
    g?.remove(); g = el("span", "tf-seekg"); g.dataset.n = key;
    const mk = (cls, html, title, f) => { const b = el("button", "ytp-button " + cls); b.type = "button"; b.innerHTML = html; b.title = title; b.setAttribute("aria-label", title); b.onclick = (e) => { e.stopPropagation(); f(); }; g.append(b); };
    const seek = (d) => () => { const v = video(); if (v) v.currentTime = Math.max(0, Math.min((v.duration || 1e9) - 0.2, v.currentTime + d)); };
    // コマ送り: 押すと一時停止して、1コマ(1/30秒)ずつ動かす
    const step = (d) => () => { const v = video(); if (!v) return; v.pause(); v.currentTime = Math.max(0, v.currentTime + d / 30); };
    const ico = (back) => `<svg viewBox="3 3 18 18" fill="currentColor"${back ? ' style="transform:scaleX(-1)"' : ""}><path d="M7 6.5v11l8-5.5z"/><rect x="16" y="6.5" width="2.2" height="11" rx=".6"/></svg>`;
    // 〇秒: 丸い矢印の中に秒数(YouTube のほかのボタンと同じ、アイコンだけの見た目)
    const sec = (back) => `<svg viewBox="1.5 1.5 21 21"><g${back ? "" : ' transform="matrix(-1 0 0 1 24 0)"'}><path d="M12 4.2A7.8 7.8 0 1 1 4.2 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M13.6 1.6v5.2L9.4 4.2z" fill="currentColor"/></g><text x="12" y="15.2" text-anchor="middle" fill="currentColor" font-family="Roboto,Arial,sans-serif" font-weight="700" font-size="${n >= 10 ? 8 : 9}">${n}</text></svg>`;
    if (stepOn) mk("tf-stepb", ico(true), "1コマ戻る(一時停止します)", step(-1));
    if (n) { mk("tf-stepb", sec(true), `${n}秒戻る`, seek(-n)); mk("tf-stepb", sec(false), `${n}秒進む`, seek(n)); }
    if (stepOn) mk("tf-stepb", ico(false), "1コマ進む(一時停止します)", step(1));
    bar.append(g); seekSize(g);
  }
  // ボタンの大きさを、YouTube の再生ボタンに合わせる(全画面などで大きさが変わっても、そのつど合わせる)
  function seekSize(g) {
    const ref = player()?.querySelector(".ytp-play-button"); if (!ref) return;
    const r = ref.getBoundingClientRect(); if (!r.width || !r.height) return;
    g.style.setProperty("--tf-bw", r.width + "px"); g.style.setProperty("--tf-bh", r.height + "px");
    g.style.setProperty("--tf-is", Math.round(Math.min(r.width, r.height)) + "px"); // アイコンはボタンいっぱいの大きさ(絵の余白も詰めてある)
  }
  addEventListener("resize", () => { const g = player()?.querySelector(".tf-seekg"); if (g) seekSize(g); });
  document.addEventListener("fullscreenchange", () => setTimeout(() => { const g = player()?.querySelector(".tf-seekg"); if (g) seekSize(g); }, 300));

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
      // 速さ: 「自動」は字幕の出ている時間に収まる速さ。それ以外は決めた速さ(ツールの「字幕・読み上げ」で選ぶ。tf-tts-rate)
      const fixed = +S["tf-tts-rate"];
      const need = text.length / 7.5 * 1000; u.rate = fixed > 0 ? fixed : Math.min(2, Math.max(1, durMs > 0 ? need / durMs : 1.2));
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
  // 機能ごとのタブ: 再生・画面(A-B リピート・画面の調整) / 字幕・読み上げ / コメント表示 / SponsorBlock(前回開いていたタブを覚える)
  let toolTab = "play";
  function panel() {
    const p = player(); if (!p) return;
    document.querySelector(".tf-cmenu")?.remove();
    const box = el("div", "tf-tpanel tf-cmenu");
    ["click", "mousedown", "dblclick", "wheel", "contextmenu", "keydown"].forEach((t) => box.addEventListener(t, (e) => e.stopPropagation())); // 後ろの映像の操作にしない
    const NAMES = [["play", "再生・画面"], ["su", "字幕・読み上げ"], ["cm", "コメント表示"], ["sb", "SponsorBlock"]];
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
    // コマ送り・〇秒送りは、操作バーの左(seekBtns)にある
    // 画面の調整
    m = panes.play; // 「再生・画面」タブの下の方に置く(上は A-B リピート)
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
    // 「字幕・読み上げ」タブ: 上に字幕(subtitles.js が作る)、その下に読み上げ
    const buildSu = () => {
      panes.su.textContent = "";
      globalThis.tfSub?.buildPane(panes.su);
      m = panes.su;
      const ttsB = btn("", () => {
        const on = S["tf-tts"] !== "on"; S["tf-tts"] = on ? "on" : "off"; chrome.storage.local.set({ "tf-tts": S["tf-tts"] });
        if (on) { chrome.storage.local.get("tf-sub-mode").then((r) => { if (!r["tf-sub-mode"] || r["tf-sub-mode"] === "off") chrome.storage.local.set({ "tf-sub-mode": "ja" }).then(() => setTimeout(buildSu, 50)); }); } // 日本語訳の字幕を使うので、字幕がオフなら「日本語」にする(上の字幕の切り替えも描き直す)
        else stopTts();
        paintTts();
      });
      const paintTts = () => { ttsB.textContent = S["tf-tts"] === "on" ? "🔊 読み上げ中(押すと止める)" : "🔇 オフ(押すと読み上げる)"; ttsB.classList.toggle("on", S["tf-tts"] === "on"); };
      paintTts();
      ttsB.title = "外国語の動画で、日本語訳の字幕を音声で読みます(字幕は「日本語」か「二か国語」で使います)"; // 説明は、重ねたときだけ出す
      row("日本語で読み上げ", ttsB).classList.add("tf-ttsr", "tf-inl"); // 横に並べる(ボタン1つなので)
      // 動画の再生速度(切り替えは ytpage.js が YouTube のプレーヤーに頼む。2x より速いときは video に直接かける)
      const vrates = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
      const vrBs = vrates.map((r) => btn(r + "x", async () => { const res = await ask({ tf: "rate", rate: r }); if (!res) { const v = video(); if (v) v.playbackRate = r; } paintVr(); }, `動画を ${r}x で再生します`));
      const paintVr = () => { const cur = video()?.playbackRate ?? 1; vrBs.forEach((b, i) => b.classList.toggle("on", Math.abs(vrates[i] - cur) < 0.001)); };
      paintVr();
      const vrRow = row("動画の再生速度", ...vrBs); vrRow.classList.add("tf-ttsr", "tf-rates");
      const v0 = video(); if (v0) { const h = () => { if (!vrRow.isConnected) return v0.removeEventListener("ratechange", h); paintVr(); }; v0.addEventListener("ratechange", h); } // ほかの方法で速さが変わっても合わせる
      // 読み上げの速さ
      const rates = [["auto", "自動"], ["0.8", "0.8x"], ["1", "1x"], ["1.25", "1.25x"], ["1.5", "1.5x"], ["2", "2x"]];
      const rateBs = rates.map(([v, t]) => btn(t, () => { S["tf-tts-rate"] = v; chrome.storage.local.set({ "tf-tts-rate": v }); paintRate(); }, v === "auto" ? "字幕が出ている間に読み終わるよう、速さを自動で変えます(1x〜2x)" : `いつも ${t} で読みます`));
      const paintRate = () => rateBs.forEach((b, i) => b.classList.toggle("on", String(S["tf-tts-rate"] ?? "auto") === rates[i][0]));
      paintRate();
      row("読み上げの速さ", ...rateBs).classList.add("tf-rates");
    };
    // コメント表示・SponsorBlock・字幕は、それぞれの機能(content.js・sponsorblock.js・subtitles.js)が中身を作る
    // (SponsorBlock は画面に置かれた枠にしか中身を作らないので、先にパネルを置いてから作る)
    p.append(box);
    globalThis.tfCm?.buildPane(panes.cm);
    globalThis.tfSB?.buildPane(panes.sb);
    buildSu();
    show(panes[toolTab] ? toolTab : toolTab === "vf" ? "play" : "su"); // 前の版の「画面の調整」タブ(vf)は「再生・画面」へ、「読み上げ」タブ(tts)は「字幕・読み上げ」へ
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
