/* ---------- SponsorBlock(再生画面) ----------
   ・みんなが登録した「スポンサー」「登録のお願い」などの区間(https://sponsor.ajay.app)を取ってきて、
     カテゴリごとに「自動でスキップ / ボタンでスキップ / 表示だけ / 使わない」を選べる
   ・シークバーに区間を色で表示する。スキップしたら左下に通知(「元に戻す」で戻れる)
   ・動画IDは、ハッシュの先頭4文字だけを送る(どの動画を見ているかを、サーバーに知られないように)
   ・設定は、操作バーの 🛠 ツールの「SponsorBlock」タブ(ptools.js が buildPane を呼ぶ)
   ・設定は chrome.storage の tf-sb-…(ドライブ同期の対象) */
globalThis.tfSB = (() => {
  const CATS = [
    ["sponsor", "スポンサー", "#00d400"],
    ["selfpromo", "宣伝・自己PR", "#ffff00"],
    ["interaction", "高評価・登録のお願い", "#cc00ff"],
    ["intro", "イントロ・待機画面", "#00ffff"],
    ["outro", "エンドカード・クレジット", "#0202ed"],
    ["preview", "予告・振り返り", "#008fd6"],
    ["filler", "雑談・脱線", "#7300ff"],
    ["music_offtopic", "音楽: 曲以外の部分", "#ff9900"],
    ["poi_highlight", "ハイライト", "#ff1684"],
  ];
  const NAME = Object.fromEntries(CATS.map(([k, n]) => [k, n])), COLOR = Object.fromEntries(CATS.map(([k, , c]) => [k, c]));
  const ACTS = [["auto", "自動でスキップ"], ["manual", "ボタンでスキップ"], ["show", "表示だけ"], ["off", "使わない"]];
  const HL_ACTS = [["auto", "最初に自動で移動"], ["manual", "移動ボタンを出す"], ["show", "表示だけ"], ["off", "使わない"]];
  const ACT_NAME = Object.fromEntries(ACTS);
  const DEF_CATS = { sponsor: "auto", selfpromo: "manual", interaction: "manual", intro: "manual", outro: "manual", preview: "manual", filler: "show", music_offtopic: "manual", poi_highlight: "manual" };
  const S = { on: true, bar: true, notice: true, cats: { ...DEF_CATS } };
  const KEYS = Object.keys(S);
  const st = { vid: null, gen: 0, segs: [], loading: false, err: "", noskip: new Set(), muted: null, hlDone: false, last: null, wantBar: false, stats: { n: 0, sec: 0 } };

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const vidNow = () => (location.pathname === "/watch" ? new URLSearchParams(location.search).get("v") : null);
  const playerEl = () => document.querySelector("#movie_player");
  const video = () => document.querySelector("#movie_player video");
  const isAd = () => !!document.querySelector("#movie_player.ad-showing");
  const fmtT = (s) => { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60; return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(ss).padStart(2, "0"); };
  const fmtDur = (s) => (s < 60 ? Math.round(s) + "秒" : s < 3600 ? Math.round(s / 60) + "分" : (s / 3600).toFixed(1) + "時間");
  const stopProp = (n) => ["click", "mousedown", "dblclick", "wheel", "contextmenu"].forEach((t) => n.addEventListener(t, (e) => e.stopPropagation())); // 後ろの映像のクリック(再生・停止)にしない
  const act = (g) => (S.on ? S.cats[g.cat] || "off" : "off");

  /* ---------- 設定 ---------- */
  const fix = () => { S.cats = { ...DEF_CATS, ...(S.cats && typeof S.cats === "object" ? S.cats : {}) }; };
  const save = (k) => chrome.storage.local.set({ ["tf-sb-" + k]: S[k] });
  chrome.storage.local.get([...KEYS.map((k) => "tf-sb-" + k), "tf-sb-stats"]).then((r) => {
    for (const k of KEYS) if (r["tf-sb-" + k] !== undefined) S[k] = r["tf-sb-" + k];
    fix(); if (r["tf-sb-stats"]) st.stats = r["tf-sb-stats"]; paintBar(); rerender();
  });
  // ほかのタブや、ドライブからの同期で設定が変わったら反映する
  chrome.storage.onChanged.addListener((c) => {
    let diff = false;
    for (const k of KEYS) { const ch = c["tf-sb-" + k]; if (ch && ch.newValue !== undefined && JSON.stringify(ch.newValue) !== JSON.stringify(S[k])) { S[k] = ch.newValue; diff = true; } }
    if (!diff) return;
    fix(); if (!S.on) { unmute(); hideSkipBtn(); } paintBar(); rerender();
  });

  /* ---------- 区間を取る(background.js 経由) ---------- */
  async function sha256Hex(s) {
    const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
    return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
  }
  function load(v) {
    if (st.vid === v) return;
    unmute(); hideSkipBtn(); document.querySelectorAll(".tf-sbn, .tf-sbfull").forEach((x) => x.remove());
    st.vid = v; st.segs = []; st.err = ""; st.noskip = new Set(); st.hlDone = false; st.last = null;
    const g = ++st.gen; paintBar();
    if (!v) { st.loading = false; return rerender(); }
    st.loading = true; rerender();
    sha256Hex(v)
      .then((h) => new Promise((res, rej) => chrome.runtime.sendMessage({ tf: "sb", vid: v, prefix: h.slice(0, 4), cats: CATS.map((c) => c[0]) }, (r) => (chrome.runtime.lastError ? rej(new Error(chrome.runtime.lastError.message)) : r?.ok ? res(r.r) : rej(new Error(r?.error || "失敗しました"))))))
      .then((list) => {
        if (st.gen !== g) return;
        st.segs = (list || []).filter((s) => NAME[s.category] && Array.isArray(s.segment))
          .map((s) => ({ id: s.UUID, cat: s.category, type: s.actionType || "skip", s: +s.segment[0], e: +s.segment[1], dur: +s.videoDuration || 0 }))
          .sort((a, b) => a.s - b.s);
      }, (e) => { if (st.gen === g) st.err = e.message; })
      .finally(() => { if (st.gen === g) { st.loading = false; paintBar(); rerender(); } });
  }

  /* ---------- シークバーの色 ---------- */
  function paintBar() {
    document.querySelectorAll(".tf-sbbar").forEach((x) => x.remove());
    st.wantBar = false;
    if (!S.on || !S.bar || !st.segs.length || st.vid !== vidNow()) return;
    const pb = document.querySelector("#movie_player .ytp-progress-bar"), v = video();
    const dur = v && isFinite(v.duration) && v.duration > 0 && !isAd() ? v.duration : st.segs.find((g) => g.dur)?.dur;
    if (!pb || !dur) return;
    const bar = el("div", "tf-sbbar");
    for (const g of st.segs) {
      if (act(g) === "off" || g.type === "full") continue;
      const m = el("div", "tf-sbm" + (g.type === "poi" ? " poi" : ""));
      m.style.left = Math.min(100, g.s / dur * 100) + "%";
      if (g.type !== "poi") m.style.width = Math.max(0.15, Math.min(100, (g.e - g.s) / dur * 100)) + "%";
      m.style.background = COLOR[g.cat]; bar.append(m);
    }
    if (!bar.childNodes.length) return;
    pb.append(bar); st.wantBar = true;
  }
  document.addEventListener("durationchange", (e) => { if (e.target?.closest?.("#movie_player")) paintBar(); }, true);

  /* ---------- スキップの通知・ボタン ---------- */
  function notice(text, color, undo) {
    if (!S.notice) return;
    const p = playerEl(); if (!p) return;
    p.querySelector(".tf-sbn")?.remove();
    const n = el("div", "tf-sbn"); stopProp(n);
    const d = el("span", "tf-sbd"); d.style.background = color; n.append(d, el("span", "tf-sbt", text));
    if (undo) { const u = el("button", "tf-sbu", "元に戻す"); u.type = "button"; u.onclick = () => { undo(); n.remove(); }; n.append(u); }
    const x = el("button", "tf-sbx", "×"); x.type = "button"; x.title = "閉じる"; x.onclick = () => n.remove(); n.append(x);
    p.append(n); clearTimeout(notice.t); notice.t = setTimeout(() => n.remove(), 5000);
  }
  function hideSkipBtn() { document.querySelectorAll(".tf-sbk").forEach((b) => b.remove()); }
  function showSkipBtn(m) {
    const p = playerEl(); if (!p) return;
    let b = p.querySelector(".tf-sbk");
    if (b && b.dataset.id === m.g.id) return;
    if (!b) { b = el("button", "tf-sbk"); b.type = "button"; stopProp(b); p.append(b); }
    b.dataset.id = m.g.id; b.textContent = "";
    const d = el("span", "tf-sbd"); d.style.background = COLOR[m.g.cat];
    b.append(d, el("span", null, m.label), el("span", "tf-sbi", "⏭"));
    b.classList.toggle("hl", m.g.type === "poi");
    b.onclick = (e) => { e.stopPropagation(); m.go(); hideSkipBtn(); };
  }
  function addStats(sec) {
    if (!(sec > 0)) return;
    st.stats = { n: (st.stats.n || 0) + 1, sec: (st.stats.sec || 0) + sec };
    chrome.storage.local.set({ "tf-sb-stats": st.stats });
  }
  function skip(v, g, byHand) {
    const from = v.currentTime, to = Math.min(g.e, isFinite(v.duration) ? v.duration : g.e);
    st.last = { id: g.id, at: performance.now() };
    v.currentTime = to; addStats(to - from);
    notice((byHand ? "スキップしました: " : "自動でスキップしました: ") + NAME[g.cat], COLOR[g.cat], () => { st.noskip.add(g.id); v.currentTime = Math.max(0, from - 0.1); });
  }
  function unmute() { if (st.muted) { const v = video(); if (v) v.muted = false; st.muted = null; } }
  // 動画全体がスポンサーなどのとき、題名の横に印を付ける
  function paintFull() {
    const f = S.on && st.vid === vidNow() ? st.segs.find((g) => g.type === "full" && act(g) !== "off") : null;
    const cur = document.querySelector(".tf-sbfull");
    if (!f) return cur?.remove();
    if (cur?.dataset.cat === f.cat) return;
    const h = document.querySelector("ytd-watch-metadata #title h1"); if (!h) return;
    cur?.remove();
    const c = el("span", "tf-sbfull", NAME[f.cat]); c.dataset.cat = f.cat; c.style.setProperty("--c", COLOR[f.cat]); c.title = "SponsorBlock: この動画全体が「" + NAME[f.cat] + "」です";
    h.prepend(c);
  }

  /* ---------- 再生中のチェック(0.15秒ごと) ---------- */
  function tick() {
    const v0 = vidNow(); if (v0 !== st.vid) load(v0);
    if (!v0) return;
    paintFull();
    if (st.wantBar && !document.querySelector("#movie_player .ytp-progress-bar .tf-sbbar")) paintBar(); // シークバーが作り直されたとき
    const v = video();
    if (!v || !st.segs.length || !S.on || isAd()) { hideSkipBtn(); if (isAd()) unmute(); return; }
    const t = v.currentTime; let manual = null, inMute = null;
    for (const g of st.segs) {
      const a = act(g); if (a === "off" || a === "show" || g.type === "full") continue;
      if (g.type === "poi") {
        if (a === "auto" && !st.hlDone && !v.paused && t < 3 && g.s > t + 1) { st.hlDone = true; v.currentTime = g.s; notice("ハイライトへ移動しました", COLOR[g.cat], () => { v.currentTime = 0; }); }
        else if (a === "manual" && t < g.s - 1 && !manual) manual = { g, label: "ハイライトへ", go: () => { v.currentTime = g.s; } };
        continue;
      }
      if (t < g.s || t >= g.e - 0.25) continue;
      if (g.type === "mute") {
        if (a === "auto" && !st.noskip.has(g.id)) inMute = g;
        else if (!manual) manual = { g, label: "スキップ: " + NAME[g.cat], go: () => skip(v, g, true) };
        continue;
      }
      if (a === "auto" && !st.noskip.has(g.id)) {
        if (st.last?.id === g.id && performance.now() - st.last.at < 1500) continue; // 移動の途中で、同じ区間をもう一度スキップしない
        if (!v.paused || v.currentTime > 0) { skip(v, g, false); return; }
      }
      if (!manual) manual = { g, label: "スキップ: " + NAME[g.cat], go: () => skip(v, g, true) };
    }
    if (inMute && st.muted !== inMute.id) { if (!v.muted) { v.muted = true; st.muted = inMute.id; } }
    else if (!inMute && st.muted) unmute();
    if (manual) showSkipBtn(manual); else hideSkipBtn();
  }
  setInterval(tick, 150);

  /* ---------- 「⋯」メニューの SponsorBlock タブ ---------- */
  let rerenderFn = null;
  function rerender() { if (rerenderFn && !rerenderFn()) rerenderFn = null; }
  function buildPane(m) {
    const render = () => {
      if (!m.isConnected) return false;
      m.textContent = "";
      const row = (label, hint) => { const r = el("div", "tf-cmr"); const lb = el("span", "tf-cml", label); if (hint) lb.append(el("small", null, hint)); r.append(lb); m.append(r); return r; };
      const seg = (label, key, opts) => {
        const s = el("div", "tf-seg");
        for (const [v, t] of opts) { const b = el("button", v === S[key] ? "on" : null, t); b.type = "button"; b.onclick = () => { S[key] = v; save(key); paintBar(); render(); }; s.append(b); }
        row(label).append(s);
      };
      const sw = el("button", "tf-sw" + (S.on ? " on" : "")); sw.type = "button"; sw.setAttribute("role", "switch"); sw.setAttribute("aria-checked", S.on); sw.append(el("i"));
      sw.onclick = () => { S.on = !S.on; save("on"); if (!S.on) { unmute(); hideSkipBtn(); } paintBar(); render(); };
      row("SponsorBlock を使う", "スポンサーなどの区間を飛ばす").append(sw);
      seg("シークバーに表示", "bar", [[true, "表示"], [false, "なし"]]);
      seg("スキップの通知", "notice", [[true, "表示"], [false, "なし"]]);

      // この動画の区間
      m.append(el("div", "tf-sbh", "この動画の区間" + (st.segs.length ? `(${st.segs.length})` : "")));
      if (st.loading) m.append(el("div", "tf-sbe", "読み込み中…"));
      else if (st.err) m.append(el("div", "tf-sbe bad", "読み込めませんでした: " + st.err));
      else if (!st.segs.length) m.append(el("div", "tf-sbe", "登録されている区間はありません"));
      for (const g of st.segs) {
        const d = el("div", "tf-tsr"), t = el("button", "tf-tst", g.type === "full" ? "全体" : fmtT(g.s)); t.type = "button";
        const tx = el("div", "tf-tsx"), dot = el("i", "tf-sbd"); dot.style.background = COLOR[g.cat];
        tx.append(dot, el("span", null, NAME[g.cat]), el("small", null, g.type === "poi" || g.type === "full" ? ACT_NAME[act(g)] || "" : `${fmtDur(g.e - g.s)}・${g.type === "mute" ? "ミュート" : ACT_NAME[act(g)]}`));
        d.append(t, tx);
        if (g.type !== "full") { d.title = `${fmtT(g.s)}〜${fmtT(g.e)} へ移動`; d.onclick = () => { const v = video(); if (v) { st.noskip.add(g.id); v.currentTime = g.s; v.play?.().catch(() => {}); } }; }
        m.append(d);
      }

      // カテゴリごとの動作
      m.append(el("div", "tf-sbh", "カテゴリごとの動作"));
      for (const [k, n, c] of CATS) {
        const r = el("div", "tf-cmr tf-sbr"), lb = el("span", "tf-cml"), dot = el("i", "tf-sbd"); dot.style.background = c;
        lb.append(dot, n); r.append(lb);
        const sel = el("select", "tf-sbsel");
        for (const [v, t] of k === "poi_highlight" ? HL_ACTS : ACTS) { const o = el("option", null, t); o.value = v; sel.append(o); }
        sel.value = S.cats[k] || "off";
        sel.onchange = () => { S.cats = { ...S.cats, [k]: sel.value }; save("cats"); paintBar(); render(); };
        r.append(sel); m.append(r);
      }
      const ft = el("div", "tf-sbf");
      ft.append(el("div", null, st.stats.n ? `これまでに ${st.stats.n} 回スキップ・合計 ${fmtDur(st.stats.sec)} 節約` : "まだスキップしていません"));
      const a = el("a", null, "区間のデータ: SponsorBlock(みんなの投稿) ↗"); a.href = "https://sponsor.ajay.app/"; a.target = "_blank"; a.rel = "noopener";
      ft.append(a); m.append(ft);
      return true;
    };
    render(); rerenderFn = render;
  }
  return { buildPane };
})();
