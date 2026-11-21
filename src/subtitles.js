/* ===== 再生画面の字幕(3つの表示を切り替える) =====
   ・オフ     : 何もしない(YouTube の字幕の設定のまま)。ほかのモードから切り替えたときは字幕を消す
   ・日本語   : 日本語の音声なら字幕なし(自動字幕もオフ)。外国語の音声なら、日本語の字幕を出す
   ・二か国語 : 外国語(原文)と日本語を、同時に出す。日本語の音声なら字幕なし
   しくみ: YouTube には原文の字幕を読み込ませて画面からは隠し、原文と日本語訳(YouTube の自動翻訳)の
   字幕の一覧を ytpage.js で取って、動画の再生位置に合わせて自分で描く。
   (YouTube の表示に任せると、YouTube 側が後から字幕の設定を戻してしまい、安定しなかった)
   広告の間は待つ(広告にも字幕があり、プレーヤーの情報が広告のものになるため)。 */
(() => {
  const KEY = "tf-sub-mode", MODES = ["off", "ja", "both"];
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const yta = (op, ...args) => new Promise((res, rej) => chrome.runtime.sendMessage({ tf: "yta", op, args }, (r) => (chrome.runtime.lastError ? rej(new Error(chrome.runtime.lastError.message)) : r?.ok ? res(r.r) : rej(new Error(r?.error || "失敗しました")))));
  const vidNow = () => (location.pathname === "/watch" ? new URLSearchParams(location.search).get("v") : null);
  const playerEl = () => document.querySelector("#movie_player");
  const isJaCode = (c) => /^ja\b/i.test(c || "");

  let mode = "off", gen = 0, note = "", capOn = false, cues = null, tick = 0, drawn = null;
  const trCache = new Map(), trBusy = new Set(), listeners = new Set();
  const say = (t) => { note = t; listeners.forEach((f) => f()); };

  // ページ本体の側(ytpage.js)へ頼む
  function bridge(op, arg, ms = 15000) {
    return new Promise((res) => {
      const id = Math.random().toString(36).slice(2), done = (v) => { removeEventListener("message", h); res(v); };
      const h = (e) => { if (e.source === window && e.data?.tf === "capres" && e.data.id === id) done(e.data.r); };
      addEventListener("message", h); postMessage({ tf: "cap", id, op, arg }, "*"); setTimeout(() => done(null), ms);
    });
  }

  chrome.storage.local.get(KEY).then((s) => { if (MODES.includes(s[KEY])) mode = s[KEY]; if (mode !== "off") apply(); });
  chrome.storage.onChanged.addListener((c) => { const n = c[KEY]?.newValue; if (MODES.includes(n) && n !== mode) { mode = n; apply(); } });

  /* ---------- 二か国語の描画 ---------- */
  function box() {
    const p = playerEl(); if (!p) return null;
    let b = p.querySelector(".tf-dsub"); if (!b) { b = el("div", "tf-dsub"); p.append(b); }
    b.style.fontSize = Math.max(12, Math.min(28, p.clientWidth / 64)) + "px";
    return b;
  }
  function clearBox() { document.querySelectorAll(".tf-dsub").forEach((b) => b.remove()); drawn = null; }
  // 時刻 t(ミリ秒)に出ている原文の番号(自動字幕は区切りが重なって届くので、いちばん新しいもの)。なければ -1
  function cueAt(t) { let k = -1; cues.o.forEach((c, n) => { if (c.s <= t && t < c.e) k = n; }); return k; }
  // YouTube の日本語訳(tlang=ja)は、原文とは別の所で細かく区切られている(「彼らは」だけ、など)。
  // 原文の各行の時間(その行の始まり〜次の行の始まり)に入る訳をつなげて、その行の日本語にする
  function group(c) {
    c.g = c.o.map((w, n) => { const end = c.o[n + 1]?.s ?? w.e; return c.j.filter((x) => x.s >= w.s - 300 && x.s < end - 300).map((x) => x.t).join(""); });
    return c;
  }
  function trFallback(s) { // YouTube の日本語訳が取れなかったときだけ、文ごとに翻訳する
    if (trCache.has(s) || trBusy.size) return trCache.get(s) || ""; // 同時に頼むのは 1件だけ(翻訳の順番待ちを独り占めして、コメントの翻訳が止まらないように)
    trBusy.add(s);
    yta("translate", s, true).then((r) => { if (r?.text) trCache.set(s, r.text); }).catch(() => {}).finally(() => trBusy.delete(s));
    return "";
  }
  function render() {
    const p = playerEl(), v = p?.querySelector("video"); if (!v || !cues) return;
    if (!p.classList.contains("tf-subon")) p.classList.add("tf-subon"); // YouTube の字幕が見えてしまわないように
    if (p.classList.contains("ad-showing")) { if (drawn) clearBox(); return; } // 途中の広告の間は出さない
    const t = v.currentTime * 1000, i = cueAt(t), src = i < 0 ? "" : cues.o[i].t, o = mode === "both" ? src : "";
    const j = (i < 0 ? "" : cues.j.length ? cues.g[i] : trFallback(src)).replace(/^[、。,.・\s]+/, "");
    const key = o + "\u0000" + j; if (key === drawn && p.querySelector(".tf-dsub")) return;
    drawn = key;
    const b = box(); if (!b) return;
    b.textContent = "";
    if (o) b.append(el("div", "tf-dsub-o", o));
    if (j) b.append(el("div", "tf-dsub-j", j));
    if (j && i >= 0 && globalThis.tfTts?.on()) globalThis.tfTts.speak(j, (cues.o[i + 1]?.s ?? cues.o[i].e) - cues.o[i].s); // 日本語で読み上げ(ptools.js)
  }

  /* ---------- 切り替え ---------- */
  function stop() {
    gen++; clearInterval(tick); tick = 0; cues = null; clearBox();
    playerEl()?.classList.remove("tf-subon");
  }
  async function capOff() { if (capOn) { capOn = false; await bridge("off"); } }
  async function apply() {
    stop(); say("");
    const g = gen;
    const v = vidNow();
    if (!v || mode === "off") { await capOff(); return; }
    await new Promise((r) => setTimeout(r, 800)); // 動画の切り替え直後は、プレーヤーの準備を待つ
    if (g !== gen) return;
    let info = null; // 動画の切り替え直後は、プレーヤーがまだ前の動画のことがあるので、今の動画になるまで待つ
    // 広告の間は、プレーヤーの情報が広告のものなので、広告が終わるまで待つ
    // 字幕の情報が、今の動画のものになるまで待つ(前の動画のままだと、音声の言語を取り違える)
    for (let i = 0; i < 400; i++) {
      info = await bridge("info"); if (g !== gen) return;
      if (info && !info.ad && info.vid === v && (!info.playing || info.playing === v)) break;
      if (info?.ad && i % 10 === 0) say("広告が終わったら、字幕を出します");
      await new Promise((ok) => setTimeout(ok, 300));
    }
    if (!info) return say("プレーヤーの情報を取得できませんでした");
    if (info.vid !== v) return say("この動画の字幕の情報を取得できませんでした");
    const spoken = info.lang || "";
    if (!info.tracks.length) { await capOff(); return say("この動画には字幕(自動字幕を含む)がありません"); }
    if (isJaCode(spoken)) { // 日本語の音声: YouTube の字幕(自動字幕も)を消す。YouTube が後から付け直すことがあるので、少し後にも確かめる
      say("日本語の音声なので、字幕はオフです");
      for (const ms of [0, 3000, 8000]) {
        if (ms) await new Promise((ok) => setTimeout(ok, ms === 3000 ? 3000 : 5000));
        if (g !== gen) return;
        capOn = true; await capOff();
      }
      return;
    }

    // 日本語・二か国語とも: YouTube 自身の字幕は原文で読み込ませて隠し、字幕の一覧(原文と日本語訳)を取って自分で描く
    // (YouTube の表示に任せると、YouTube 側が後から字幕の設定を戻してしまい、安定しないため)
    const p = playerEl(); if (!p) return;
    p.classList.add("tf-subon");
    let r = null;
    for (let i = 0; i < 3 && !r?.ok; i++) { r = await bridge("on", { tl: false }); if (g !== gen) return; if (!r?.ok) await new Promise((ok) => setTimeout(ok, 1000)); }
    if (!r?.ok) { p.classList.remove("tf-subon"); capOn = true; await capOff(); return say(`字幕を有効にできませんでした(${r?.why || "応答なし"})`); }
    capOn = true;
    let c = null;
    for (let i = 0; i < 6 && !c?.o?.length; i++) { // 再生前などで YouTube が字幕を読み込まないときは、待ってやり直す
      say(i ? "字幕を待っています…(動画を再生すると読み込まれます)" : `外国語の音声(${spoken})の字幕を読み込んでいます…`);
      c = await bridge("cues", { lang: r.lang, kind: r.kind, vid: v }, 30000);
      if (g !== gen) return;
      if (!c?.o?.length && i < 5) { await bridge("on", { tl: false }); if (g !== gen) return; }
    }
    if (!c?.o?.length) { p.classList.remove("tf-subon"); await capOff(); return say(`字幕を読み込めませんでした(${c?.why || "字幕が空でした"})`); } // 失敗したら、YouTube の字幕を出しっぱなしにしない
    cues = group(c);
    const what = mode === "both" ? "原文と日本語訳" : "日本語訳";
    say(c.j.length ? `外国語の音声(${spoken})です。${what}を表示しています` : `外国語の音声(${spoken})です。日本語訳が取れなかったので、文ごとに翻訳しています`);
    tick = setInterval(render, 150);
    render();
  }
  addEventListener("yt-navigate-finish", () => { if (mode !== "off") apply(); else stop(); });
  addEventListener("yt-navigate-start", () => stop());

  /* ---------- 設定(プレーヤー「⋯」メニューの「字幕」タブ) ---------- */
  function buildPane(m) {
    const r = el("div", "tf-cmr tf-subr"), lb = el("span", "tf-cml", "字幕");
    const s = el("div", "tf-seg"), paint = () => s.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.v === mode));
    // 説明は、ボタンに重ねたときだけ出す
    const tips = { off: "TubeFolio3 の字幕を使わない", ja: "日本語の音声は字幕なし(自動字幕もオフ)。外国語の音声は、日本語の字幕を表示します", both: "外国語の原文と日本語を、同時に表示します" };
    for (const [v, t] of [["off", "オフ"], ["ja", "日本語"], ["both", "二か国語"]]) {
      const b = el("button", null, t); b.type = "button"; b.dataset.v = v; b.title = tips[v];
      b.onclick = () => { if (mode === v) return; mode = v; chrome.storage.local.set({ [KEY]: v }); paint(); apply(); };
      s.append(b);
    }
    r.append(lb, s); m.append(r); paint();
    const st = el("div", "tf-subs"); const upd = () => (st.textContent = note); listeners.add(upd); upd();
    m.append(st);
    const mo = new MutationObserver(() => { if (!m.isConnected) { listeners.delete(upd); mo.disconnect(); } }); mo.observe(document.body, { childList: true, subtree: true });
  }
  globalThis.tfSub = { buildPane };
})();
