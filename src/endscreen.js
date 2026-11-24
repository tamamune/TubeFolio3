(() => {
  /* ===== 動画の終わりに出す、TubeFolio3 のおすすめ(4本) =====
     設定(一般)の「動画の終わりに出す TubeFolio3 のおすすめ」を「使う」にしたときだけ動く("tf-end-tf")。YouTube のおすすめの表示/非表示とは別の設定
     ・4つの枠それぞれに、おすすめを選ぶ再生リストを設定で指定する("tf-end-slots")
     ・1番目: 見ている動画がその再生リストに入っていれば、リストでその次の動画(最後なら先頭へ)。入っていなければ、リストからランダム
     ・2〜4番目: それぞれの再生リストからランダム
     ・見ている動画と、ほかの枠と同じ動画は選ばない
     ・出すタイミングは設定で選ぶ("tf-end-at" = 終わる何秒前か。0 は終わったとき)
     ・YouTube の終わりの画面は隠し、自動再生の「次の動画」は取り消す(このおすすめを見られるように)
     ・再生リストの中身は YouTube の再生リストのページから読む(10分間は覚えておく) */
  let mode = "show", slots = [], at = 0; // at: 終わる何秒前に出すか(0 = 終わったとき)
  chrome.storage.local.get(["tf-end-tf", "tf-end-mode", "tf-end-slots", "tf-end-at"]).then((r) => { at = +r["tf-end-at"] || 0; mode = r["tf-end-tf"] === "on" || r["tf-end-mode"] === "tf" ? "tf" : ""; slots = r["tf-end-slots"] || []; prefetch(); });
  chrome.storage.onChanged.addListener((c) => {
    if (c["tf-end-tf"]) { mode = c["tf-end-tf"].newValue === "on" ? "tf" : ""; if (mode !== "tf") hide(); }
    if (c["tf-end-slots"]) { slots = c["tf-end-slots"].newValue || []; prefetch(); }
    if (c["tf-end-at"]) at = +c["tf-end-at"].newValue || 0;
  });
  const on = () => mode === "tf" && slots.some(Boolean);
  const vidNow = () => (location.pathname === "/watch" ? new URLSearchParams(location.search).get("v") : null);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const txt = (o) => o?.simpleText || o?.runs?.map((r) => r.text).join("") || o?.content || "";

  /* ---------- 再生リストの中身 ---------- */
  const plCache = new Map(); // id → { at, items: [{ id, title, channel, duration }], p: Promise }
  function parseList(root) {
    const out = new Map();
    (function walk(n) {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) return n.forEach(walk);
      const r = n.playlistVideoRenderer;
      if (r?.videoId && !out.has(r.videoId)) out.set(r.videoId, { id: r.videoId, title: txt(r.title), channel: txt(r.shortBylineText), duration: txt(r.lengthText) });
      const lv = n.lockupViewModel;
      if (lv && /VIDEO/.test(lv.contentType || "") && lv.contentId && !out.has(lv.contentId)) {
        const md = lv.metadata?.lockupMetadataViewModel, rows = md?.metadata?.contentMetadataViewModel?.metadataRows || [];
        const dur = (JSON.stringify(lv.contentImage || {}).match(/"text":"(\d+:\d{2}(?::\d{2})?)"/) || [])[1] || "";
        out.set(lv.contentId, { id: lv.contentId, title: md?.title?.content || "", channel: rows[0]?.metadataParts?.[0]?.text?.content || "", duration: dur });
      }
      Object.values(n).forEach(walk);
    })(root);
    return [...out.values()];
  }
  function loadList(id) {
    const c = plCache.get(id);
    if (c && (c.p || Date.now() - c.at < 10 * 60 * 1000)) return c.p || Promise.resolve(c.items);
    const p = fetch(`/playlist?list=${encodeURIComponent(id)}`, { credentials: "include" }).then((r) => r.text()).then((h) => {
      const a = h.indexOf("ytInitialData = "), b = h.indexOf(";</script>", a);
      const items = a < 0 || b < 0 ? [] : parseList(JSON.parse(h.slice(a + 16, b)));
      plCache.set(id, { at: Date.now(), items }); return items;
    }).catch(() => { plCache.delete(id); return []; });
    plCache.set(id, { at: 0, items: [], p });
    return p;
  }
  // 動画を開いたときに読んでおく(終わったときにすぐ出せるように)
  function prefetch() { if (on() && vidNow()) slots.forEach((s) => s && loadList(s.id)); }
  addEventListener("yt-navigate-finish", () => { hide(); prefetch(); });

  /* ---------- 4本を選ぶ ---------- */
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  async function choose(vid) {
    const lists = await Promise.all(slots.slice(0, 4).map((s) => (s ? loadList(s.id) : Promise.resolve([]))));
    const used = new Set([vid]), out = [];
    lists.forEach((items, i) => {
      const s = slots[i]; if (!s || !items.length) return;
      let v = null, why = "";
      if (i === 0) {
        const k = items.findIndex((x) => x.id === vid);
        if (k >= 0) { for (let j = 1; j <= items.length && !v; j++) { const c = items[(k + j) % items.length]; if (!used.has(c.id)) v = c; } why = "次の動画"; }
      }
      if (!v) { const rest = items.filter((x) => !used.has(x.id)); if (rest.length) v = pick(rest); why = why || "ランダム"; }
      if (v) { used.add(v.id); out.push({ ...v, pl: s.title || "", why }); }
    });
    return out;
  }

  /* ---------- 画面 ---------- */
  let box = null, shownFor = "";
  function hide() { box?.remove(); box = null; shownFor = ""; document.documentElement.classList.remove("tf-end-on"); }
  async function show(force) { // force: テストボタンから。設定が「使わない」でも、すでに出していても、出す
    const vid = vidNow(), mp = document.querySelector("#movie_player");
    if ((!force && (!on() || shownFor === vid)) || !vid || !mp || mp.classList.contains("ad-showing")) return;
    shownFor = vid;
    document.documentElement.classList.add("tf-end-on"); // YouTube の終わりの画面と、自動再生の「次の動画」を隠す
    cancelAutonav();
    let list = await choose(vid);
    if (force && !list.length) list = [1, 2, 3, 4].map((n) => ({ id: vid, title: `テスト用のおすすめ ${n}(再生リストが未設定のため、いまの動画を使っています)`, channel: "TubeFolio3", duration: "" })); // 設定が空でも、見た目を確かめられるように
    if (shownFor !== vid || !list.length) { if (!list.length) document.documentElement.classList.remove("tf-end-on"); return; }
    box?.remove();
    box = el("div", "tf-end"); box.setAttribute("role", "region"); box.setAttribute("aria-label", "TubeFolio3 のおすすめ");
    const head = el("div", "tf-end-h"); head.append(el("b", "", "TubeFolio3 のおすすめ"));
    const again = el("button", "tf-end-re", "↻ 選び直す"); again.type = "button"; again.onclick = (e) => { e.stopPropagation(); shownFor = ""; show(); };
    const x = el("button", "tf-end-x", "✕"); x.type = "button"; x.title = "閉じる"; x.onclick = (e) => { e.stopPropagation(); box?.remove(); box = null; };
    head.append(again, x);
    const grid = el("div", "tf-end-g");
    list.forEach((v, i) => {
      const a = el("a", "tf-end-c"); a.href = `/watch?v=${encodeURIComponent(v.id)}`;
      const th = el("div", "tf-end-th"), img = el("img"); img.src = `https://i.ytimg.com/vi/${encodeURIComponent(v.id)}/mqdefault.jpg`; img.alt = ""; img.loading = "lazy";
      th.append(img); if (v.duration) th.append(el("span", "tf-end-d", v.duration));
      th.append(el("span", "tf-end-n", i === 0 && v.why === "次の動画" ? "▶ 次の動画" : String(i + 1)));
      a.append(th, el("div", "tf-end-t", v.title || v.id), el("small", "tf-end-m", [v.channel, v.pl && `📂 ${v.pl}`].filter(Boolean).join(" ・ ")));
      grid.append(a);
    });
    box.append(head, grid);
    ["click", "mousedown", "pointerdown", "dblclick", "keydown", "wheel"].forEach((k) => box.addEventListener(k, (e) => e.stopPropagation())); // プレーヤーの操作に渡さない
    mp.append(box);
    try { const a = new Audio(chrome.runtime.getURL("sounds/quiz5.mp3")); a.volume = 0.6; a.play().catch(() => {}); } catch {} // おすすめを出したときの音
  }
  // 自動再生の「◯秒後に次の動画」を取り消す(取り消さないと、YouTube のおすすめへ移ってしまう)
  // カウントダウンは隠してあるので見えていなくても押す。始まるまで少しかかるため、3秒の間くり返し押す(何もないときに押しても害はない)
  function cancelAutonav() {
    let n = 0;
    const t = setInterval(() => {
      document.querySelector("#movie_player .ytp-autonav-endscreen-upnext-cancel-button")?.click();
      if (++n >= 12 || !shownFor) clearInterval(t);
    }, 250);
  }
  const inPlayer = (e) => e.target?.tagName === "VIDEO" && e.target.closest?.("#movie_player");
  // 出すタイミングより前の位置にいるか(そこまで戻したら、おすすめを消す)
  const before = (v) => isFinite(v.duration) && v.currentTime < v.duration - Math.max(at, 0.5) - 1;
  document.addEventListener("ended", (e) => {
    if (!inPlayer(e)) return;
    if (shownFor && shownFor === vidNow()) cancelAutonav(); // 先に出していたときは、自動再生の取り消しだけ
    else show();
  }, true);
  // 「終わる◯秒前」を選んだとき: 残りがその秒数になったら出す(短すぎる動画では出さない)
  document.addEventListener("timeupdate", (e) => {
    if (!at || !inPlayer(e) || shownFor || !on()) return;
    const v = e.target; if (!isFinite(v.duration) || v.duration < at * 2 || v.paused) return;
    if (v.duration - v.currentTime <= at) show();
  }, true);
  document.addEventListener("playing", (e) => { if (shownFor && inPlayer(e) && before(e.target)) hide(); }, true); // 最初から見直したら消す
  document.addEventListener("seeking", (e) => { if (shownFor && inPlayer(e) && before(e.target)) hide(); }, true);
  addEventListener("yt-navigate-start", hide);
  chrome.runtime.onMessage.addListener((m, s, reply) => { // TubeFolio3 の「テスト」ページのボタンから
    if (m?.tf !== "test-end") return;
    if (!vidNow() || !document.querySelector("#movie_player")) return reply({ ok: false, error: "動画の再生ページではありません" });
    shownFor = ""; show(true).then(() => reply({ ok: true })); return true;
  });
})();
