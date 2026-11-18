(() => {
  /* YouTube の再生画面の「⋯」(その他の操作)を、TubeFolio3 のメニューに置き換える。
     ・再生リストに追加 / 外す(YouTube の再生リストへ直接書き込む)
     ・TubeFolio3 のフォルダに登録
     ・チャンネル登録 / 解除
     書き込みは background.js 経由(YTA)。ヘッダーの「TubeFolio3」ボタンは、管理ページを開く */
  const KEY = "tubefolio";
  const load = async () => (await chrome.storage.local.get(KEY))[KEY] || { folders: [], videos: {}, bookmarks: [] };
  const save = (d) => chrome.storage.local.set({ [KEY]: d });
  const yta = (op, ...args) => new Promise((res, rej) => chrome.runtime.sendMessage({ tf: "yta", op, args }, (r) => (chrome.runtime.lastError ? rej(new Error(chrome.runtime.lastError.message)) : r?.ok ? res(r.r) : rej(new Error(r?.error || "失敗しました")))));
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const vidNow = () => (location.pathname === "/watch" ? new URLSearchParams(location.search).get("v") : null);

  // 再生中の動画の情報(ページ本体の側のデータ。取れなければ、画面の表示から)
  function pageInfo() {
    return new Promise((res) => {
      const id = Math.random().toString(36).slice(2), done = (v) => { removeEventListener("message", h); res(v); };
      const h = (e) => { if (e.source === window && e.data?.tf === "res" && e.data.id === id) done(e.data.info); };
      addEventListener("message", h); postMessage({ tf: "req", id }, "*"); setTimeout(() => done(null), 600);
    });
  }
  async function videoInfo() {
    const v = vidNow(), p = await pageInfo();
    const a = document.querySelector("ytd-watch-metadata ytd-video-owner-renderer #channel-name a, ytd-watch-metadata ytd-video-owner-renderer a[href^='/@'], ytd-watch-metadata ytd-video-owner-renderer a[href^='/channel/']");
    const info = p && p.videoId === v ? { ...p } : { videoId: v, title: document.querySelector("ytd-watch-metadata h1")?.textContent?.trim() || document.title, channel: a?.textContent?.trim() || "", channelId: "" };
    info.chUrl = a?.getAttribute("href") || "";
    if (!info.channelId) { const m = info.chUrl.match(/\/channel\/(UC[\w-]{22})/); if (m) info.channelId = m[1]; }
    return info;
  }
  const isSubscribed = () => /登録済み|Subscribed|Unsubscribe/i.test(document.querySelector("ytd-watch-metadata #subscribe-button, ytd-watch-metadata yt-subscribe-button-view-model")?.textContent || "");

  /* ---------- メニュー ---------- */
  function closeMenu() { const m = document.querySelector(".tf-menu"); if (m) { m.dispatchEvent(new Event("tf-close")); m.remove(); } }
  let lastTab = "pl"; // 前回開いていたタブ
  async function openMenu(anchor) {
    closeMenu();
    const vid = vidNow(); if (!vid) return;
    const box = el("div", "tf-menu"); box.setAttribute("role", "menu");
    const status = el("div", "tf-st");
    const msg = (t, bad) => { status.textContent = t; status.classList.toggle("bad", !!bad); clearTimeout(msg.t); if (t) msg.t = setTimeout(() => (status.textContent = ""), 3500); };
    const head = el("div", "tf-mh"); head.append(el("b", null, "TubeFolio3"));
    const open = el("button", "tf-lnk", "管理ページ ↗"); open.onclick = () => { closeMenu(); chrome.runtime.sendMessage("tf-open-manager"); }; head.append(open);
    const plBox = el("div", "tf-pane"), foBox = el("div", "tf-pane"), chBox = el("div", "tf-pane");
    const panes = { pl: plBox, fo: foBox, ch: chBox }, names = { pl: "再生リスト", fo: "フォルダ", ch: "チャンネル" };
    const tabs = el("div", "tf-tabs"); tabs.setAttribute("role", "tablist");
    const show = (k) => { lastTab = k; for (const [key, p] of Object.entries(panes)) p.hidden = key !== k; tabs.querySelectorAll(".tf-tab").forEach((b) => b.classList.toggle("on", b.dataset.k === k)); place(); };
    for (const k of Object.keys(names)) { const b = el("button", "tf-tab", names[k]); b.dataset.k = k; b.onclick = () => show(k); tabs.append(b); }
    plBox.append(el("div", "tf-em", "読み込み中…"));
    box.append(head, tabs, plBox, foBox, chBox, status);
    document.body.append(box);

    // 画面に収まる向き・高さにして、ページがスクロールされても「⋯」に付いてくる
    function place() {
      if (!box.isConnected) return;
      const r = anchor.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) return closeMenu();
      const below = innerHeight - r.bottom - 16, above = r.top - 16, down = below >= 360 || below >= above, room = Math.max(220, down ? below : above);
      box.style.maxHeight = Math.min(room, 560) + "px";
      box.style.left = Math.max(8, Math.min(r.right - 340, innerWidth - 348)) + "px";
      if (down) { box.style.top = r.bottom + 8 + "px"; box.style.bottom = ""; } else { box.style.bottom = innerHeight - r.top + 8 + "px"; box.style.top = ""; }
    }
    place(); addEventListener("scroll", place, true); addEventListener("resize", place);
    box.addEventListener("tf-close", () => { removeEventListener("scroll", place, true); removeEventListener("resize", place); });
    setTimeout(() => addEventListener("click", function h(e) { if (!box.isConnected) return removeEventListener("click", h, true); if (!box.contains(e.target)) { closeMenu(); removeEventListener("click", h, true); } }, true), 0);

    const row = (label, checked, onchange, dot) => {
      const l = el("label", "tf-row"), cb = el("input"); cb.type = "checkbox"; cb.checked = checked;
      l.append(cb); if (dot) { const d = el("span", "tf-dot"); d.style.background = dot; l.append(d); }
      l.append(el("span", "tf-t", label));
      cb.onchange = () => onchange(cb);
      return l;
    };
    show(lastTab);
    const info = await videoInfo();

    // 再生リスト
    yta("ownPlaylists", vid).then((list) => {
      plBox.textContent = "";
      if (!list.length) return plBox.append(el("div", "tf-em", "再生リストがありません"));
      list.forEach((p) => plBox.append(row(p.title, p.has, async (cb) => {
        cb.disabled = true;
        try { await yta(cb.checked ? "addVideo" : "removeVideo", p.id, vid); msg(cb.checked ? `「${p.title}」に追加しました` : `「${p.title}」から外しました`); }
        catch (e) { cb.checked = !cb.checked; msg("できませんでした: " + e.message, true); }
        cb.disabled = false;
      })));
    }).catch((e) => { plBox.textContent = ""; plBox.append(el("div", "tf-em bad", "読み込めませんでした: " + e.message)); });

    // フォルダ(入れ子は字下げ)
    const data = await load();
    const cur = new Set(data.videos[vid]?.folders || []);
    const walk = (pid, d) => data.folders.filter((f) => (f.parent || "") === pid).forEach((f) => {
      const l = row(f.name, cur.has(f.id), async (cb) => {
        const dd = await load();
        const v = (dd.videos[vid] ||= { title: info.title, channel: info.channel, chUrl: info.chUrl, folders: [], tags: [], savedAt: new Date().toISOString() });
        v.folders = cb.checked ? [...new Set([...v.folders, f.id])] : v.folders.filter((x) => x !== f.id);
        if (!v.folders.length) delete dd.videos[vid];
        await save(dd); msg(cb.checked ? `「${f.name}」に登録しました` : `「${f.name}」から外しました`);
      }, f.color);
      l.style.paddingLeft = 10 + d * 18 + "px"; foBox.append(l); walk(f.id, d + 1);
    });
    walk("", 0);
    if (!data.folders.length) foBox.append(el("div", "tf-em", "フォルダがありません(管理ページで作成してください)"));

    // チャンネル登録
    let subbed = isSubscribed();
    const b = el("button", "tf-sub"), paint = () => { b.textContent = subbed ? "✓ 登録済み(押すと解除)" : "＋ チャンネル登録"; b.classList.toggle("on", subbed); };
    paint(); chBox.append(el("div", "tf-chn", info.channel || "このチャンネル"), b);
    b.onclick = async () => {
      b.disabled = true;
      try {
        let cid = info.channelId; if (!cid) cid = info.channelId = await yta("channelIdOf", info.chUrl ? new URL(info.chUrl, location.origin).href : location.href);
        if (!cid) throw new Error("チャンネルを特定できませんでした");
        await yta(subbed ? "unsubscribe" : "subscribe", cid); subbed = !subbed; paint(); msg(subbed ? "チャンネル登録しました" : "チャンネル登録を解除しました");
      } catch (e) { msg("できませんでした: " + e.message, true); }
      b.disabled = false;
    };
  }
  addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });
  addEventListener("yt-navigate-start", closeMenu);

  // 再生画面の「⋯」を押したら、YouTube のメニューの代わりに自分のメニューを出す(先に受け取って、YouTube には渡さない)
  document.addEventListener("click", (e) => {
    const b = e.target.closest?.("button");
    if (!b || !b.closest("ytd-watch-metadata #actions") || !/その他の操作|More actions/i.test(b.getAttribute("aria-label") || "")) return;
    e.preventDefault(); e.stopImmediatePropagation(); openMenu(b);
  }, true);

  /* ---------- コメント流し(再生画面) ----------
     ・動画のコメントを、映像の上に背景なしで、下から上へ流す。1件は「名前・♥評価・投稿日」の行と、本文
     ・プレーヤーの右下の「コメント表示」ボタンでメニューを開く(表示・場所・文字の大きさ・幅・名前・並び順・翻訳・終わったあと)
     ・コメント欄そのものを隠すボタン(表示の負荷を減らす)も、同じ場所に置く
     ・コメントは YouTube から取る(background.js 経由)。コメント欄を開いていなくても取れる */
  const CM_DEF = { on: false, side: "right", size: 100, hs: 100, width: "normal", name: "display", icon: true, sort: "top", tr: true, loop: true };
  const cm = { ...CM_DEF, vid: null, list: [], loading: false, raf: 0, last: 0, hover: false, items: [], used: new Set(), idx: 0, gen: 0 };
  const CM_KEYS = Object.keys(CM_DEF);
  const CM_W = { narrow: 17, normal: 24, wide: 34 }; // 幅(映像の幅に対する%)
  chrome.storage.local.get(CM_KEYS.map((k) => "tf-cm-" + k)).then((s) => {
    for (const k of CM_KEYS) { const v = s["tf-cm-" + k]; if (v !== undefined) cm[k] = v; }
    cm.size = Math.min(200, Math.max(60, +cm.size || 100)); cm.hs = Math.min(200, Math.max(50, +cm.hs || 100)); if (!CM_W[cm.width]) cm.width = "normal";
    applyCm();
  });
  const saveCm = () => chrome.storage.local.set(Object.fromEntries(CM_KEYS.map((k) => ["tf-cm-" + k, cm[k]])));
  // ほかのタブや、ドライブからの同期で設定が変わったら、開いている再生画面にも反映する
  chrome.storage.onChanged.addListener((c) => {
    let diff = false;
    for (const k of CM_KEYS) { const ch = c["tf-cm-" + k]; if (ch && ch.newValue !== undefined && ch.newValue !== cm[k]) { cm[k] = ch.newValue; diff = true; } }
    if (!diff) return;
    cm.size = Math.min(200, Math.max(60, +cm.size || 100)); cm.hs = Math.min(200, Math.max(50, +cm.hs || 100)); if (!CM_W[cm.width]) cm.width = "normal";
    applyCm(); applyLayer(); if (cm.on && c["tf-cm-sort"]) reloadCm();
  });
  const playerEl = () => document.querySelector("#movie_player");
  function applyCm() {
    document.querySelectorAll(".tf-ytp[data-k=cm]").forEach((b) => { b.classList.toggle("tf-on", cm.on); b.setAttribute("aria-pressed", cm.on); });
    if (cm.on) { startCm(); applyLayer(); } else stopCm();
  }
  // 表示場所・文字の大きさ・幅を、コメントの層に反映する。大きさや幅が変わると各コメントの高さも変わるので、位置を詰め直す
  function applyLayer() {
    const l = document.querySelector(".tf-cm"); if (!l) return;
    l.classList.toggle("left", cm.side === "left"); l.style.setProperty("--tf-fs", cm.size / 100); l.style.setProperty("--tf-hs", cm.hs / 100); l.style.setProperty("--tf-w", CM_W[cm.width] + "%");
    let y = null; for (const it of cm.items) { it.h = it.el.offsetHeight; if (y != null) it.y = Math.max(it.y, y); y = it.y + it.h + 16; it.el.style.transform = `translateY(${it.y}px)`; }
  }
  function layer() {
    const p = playerEl(); if (!p) return null;
    let l = p.querySelector(".tf-cm"); if (!l) { l = el("div", "tf-cm"); p.append(l); applyLayer(); }
    return l;
  }
  /* コメントの動き: requestAnimationFrame で位置を動かす(マウスを乗せたら止まり、ホイールで上下に動かせる) */
  const TR_ICO = `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true"><path d="M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0014.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg>`;
  const SPEED = 55; // 1秒に動く距離(px)
  function stopCm() { cancelAnimationFrame(cm.raf); cm.raf = 0; cm.items = []; document.querySelectorAll(".tf-cm").forEach((l) => l.remove()); }
  async function startCm() {
    const v = vidNow(); if (!v || !cm.on) return stopCm();
    if (cm.vid !== v) reloadCm(v);
    if (!cm.raf) { cm.last = performance.now(); cm.raf = requestAnimationFrame(frame); }
  }
  // コメントを取り直す(動画が変わったとき・並び順を変えたとき)
  function reloadCm(v = vidNow()) {
    cm.vid = v; cm.list = []; cm.items = []; cm.used = new Set(); cm.idx = 0; cm.loading = false; cm.gen++;
    layer()?.replaceChildren(); if (v) loadCm(v, cm.gen);
  }
  async function loadCm(v, gen, tries = 0) {
    if (cm.loading) return; cm.loading = true;
    try { const list = await yta("comments", v, 150, cm.sort); if (cm.vid === v && cm.gen === gen) { cm.list = list; cm.idx = 0; cm.used = new Set(); trPrefetch(); } } catch { /* 取れなかったら、少し待って数回やり直す */ }
    cm.loading = false;
    if (cm.vid === v && cm.gen === gen && !cm.list.length && tries < 3) setTimeout(() => cm.vid === v && cm.gen === gen && loadCm(v, gen, tries + 1), 4000);
  }
  // 日本語(ひらがな・カタカナ・漢字)を含まない文は翻訳の対象。文字(英数字など)が無い、絵文字だけの文は対象にしない
  const needTr = (s) => !/[぀-ヿ㐀-鿿]/.test(s) && /\p{L}/u.test(s);
  const trRes = new Map(); // 原文 → [本文, 翻訳したか]。翻訳が済んだものだけ入る
  async function translateOnce(s) {
    const r = await Promise.race([yta("translate", s).catch(() => null), new Promise((res) => setTimeout(() => res(null), 4000))]); // 返事が来なくても止まらない
    return r?.text && r.src !== "ja" && r.text !== s ? [r.text, true] : [s, false];
  }
  // コメントを取ったら、流す前にまとめて翻訳しておく(流す直前に1件ずつ待つと、流れが途切れるため)
  function trPrefetch() {
    if (!cm.tr) return;
    const list = cm.list.map((c) => c.text); let i = 0;
    const worker = async () => { while (i < list.length) { const s = list[i++]; if (needTr(s) && !trRes.has(s)) trRes.set(s, await translateOnce(s)); } };
    for (let k = 0; k < 4; k++) worker();
  }
  // 次に流すコメントを選ぶ(翻訳がまだのものは飛ばす)。全部流し終えたら、ループなら最初から、そうでなければ終わり
  function pickNext() {
    const n = cm.list.length; if (!n) return null;
    if (cm.used.size >= n) { if (!cm.loop) return null; cm.used.clear(); cm.idx = 0; }
    for (let k = 0; k < n; k++) {
      const i = (cm.idx + k) % n; if (cm.used.has(i)) continue;
      const c = cm.list[i], r = !cm.tr || !needTr(c.text) ? [c.text, false] : trRes.get(c.text);
      if (r) { cm.used.add(i); cm.idx = (i + 1) % n; return { c, text: r[0], tr: r[1] }; }
    }
    return null;
  }
  function spawn(l) {
    const nx = pickNext(); if (!nx || !l.isConnected) return;
    const { c, text, tr } = nx, d = el("div", "tf-cmi"), head = el("div", "tf-ch");
    const nm = cm.name === "user" ? (c.name || "").replace(/^@/, "") : c.name; // ユーザーネーム = @ を除いた形
    if (cm.icon && c.icon) { const av = el("img", "tf-av"); av.src = c.icon.startsWith("//") ? "https:" + c.icon : c.icon; av.alt = ""; av.referrerPolicy = "no-referrer"; head.append(av); } // ユーザーのアイコン
    if (nm) head.append(el("span", "tf-cn", nm));
    if (c.likes && c.likes !== "0") head.append(el("span", "tf-clk", "♥ " + c.likes));
    if (c.time) head.append(el("span", "tf-cd", c.time));
    const body = el("div", "tf-cb"); body.append(el("span", "tf-ct", text));
    if (tr) { const b = el("span", "tf-trb"); b.innerHTML = TR_ICO; b.title = "日本語に翻訳しました"; body.append(b); } // 翻訳したコメントは、文の最後に少し空けて翻訳アイコン
    if (head.childNodes.length) d.append(head); d.append(body);
    const prev = cm.items[cm.items.length - 1], y = prev ? prev.y + prev.h + 16 : l.clientHeight; // 直前のコメントのすぐ下に続ける(ホイールで送ったあとも、空きが広がらない)
    d.style.transform = `translateY(${y}px)`; l.append(d);
    cm.items.push({ el: d, y, h: d.offsetHeight });
    while (cm.items.length > 40) cm.items.shift().el.remove(); // 少し前のコメントまでは、ホイールで戻って読める
  }
  function frame(now) {
    cm.raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - cm.last) / 1000); cm.last = now;
    const l = layer(), video = document.querySelector("#movie_player video"); if (!l) return;
    const paused = !!video?.paused || cm.hover || document.hidden; l.classList.toggle("paused", paused);
    if (!paused) for (const it of cm.items) { it.y -= SPEED * dt; it.el.style.transform = `translateY(${it.y}px)`; }
    const H = l.clientHeight, last = cm.items[cm.items.length - 1];
    if (cm.list.length && (!last || last.y + last.h + 16 <= H)) spawn(l); // 止めている間も、下に空きができたら次のコメントを足す(ホイールで下へ送ったとき用)
  }
  // コメントの上にマウスがあるとき: 止める + ホイールで上下に動かす(それ以外では、これまでどおり操作できる)
  function inZone(e) {
    if (e.target?.closest?.(".tf-cmenu")) return false; // 手前の設定メニューの上では、コメントを動かさない(メニュー自身がスクロールできるように)
    const p = playerEl(); if (!p || !cm.on || !cm.items.length) return false;
    const r = (layer() || p).getBoundingClientRect(), w = r.width * (CM_W[cm.width] + 10) / 100; // コメントが流れる側の端。YouTube の操作バーの部分は、層に含まれない
    const x0 = cm.side === "left" ? r.left : r.right - w;
    return e.clientX > x0 && e.clientX < x0 + w && e.clientY > r.top && e.clientY < r.bottom;
  }
  document.addEventListener("mousemove", (e) => { cm.hover = inZone(e); }, true);
  document.addEventListener("mouseleave", () => { cm.hover = false; }, true);
  document.addEventListener("wheel", (e) => {
    if (!inZone(e)) return;
    e.preventDefault(); e.stopPropagation();
    let d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY; // 下へ回すと、コメントが上へ動く
    const first = cm.items[0];
    if (d < 0) d = Math.max(d, Math.min(0, first.y - 20)); // 上へ戻すのは、最初のコメントまで(下へは、次のコメントが足されるので制限しない)
    for (const it of cm.items) { it.y -= d; it.el.style.transform = `translateY(${it.y}px)`; }
  }, { capture: true, passive: false });
  const ICON = {
    cm: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v11H9l-4 4v-4H4z"/><path d="M8 9h8M8 12h5"/></svg>`,
  };
  /* ---------- 「コメント表示」ボタンのメニュー ---------- */
  function closeCmMenu() { document.querySelector(".tf-cmenu")?.remove(); }
  function toggleCmMenu(btn) {
    if (document.querySelector(".tf-cmenu")) return closeCmMenu();
    const p = playerEl(); if (!p) return;
    const m = el("div", "tf-cmenu");
    ["click", "mousedown", "dblclick", "wheel", "contextmenu"].forEach((t) => m.addEventListener(t, (e) => e.stopPropagation())); // 後ろの映像のクリック(再生・停止)にしない
    const row = (label, hint) => { const r = el("div", "tf-cmr"); const lb = el("span", "tf-cml", label); if (hint) lb.append(el("small", null, hint)); r.append(lb); m.append(r); return r; };
    // 切り替え(複数の選択肢から1つ)。変えたあとに after を実行する
    const seg = (label, key, opts, after, hint) => {
      const s = el("div", "tf-seg"), paint = () => s.querySelectorAll("button").forEach((b) => b.classList.toggle("on", String(b.dataset.v) === String(cm[key])));
      for (const [v, t] of opts) { const b = el("button", null, t); b.type = "button"; b.dataset.v = v; b.onclick = () => { cm[key] = v; saveCm(); after?.(); paint(); }; s.append(b); }
      row(label, hint).append(s); paint();
    };
    const sw = el("button", "tf-sw"); sw.type = "button"; sw.setAttribute("role", "switch");
    const paintSw = () => { sw.setAttribute("aria-checked", cm.on); sw.classList.toggle("on", cm.on); };
    sw.append(el("i")); sw.onclick = () => { cm.on = !cm.on; saveCm(); applyCm(); paintSw(); };
    row("コメントを表示").append(sw); paintSw();
    seg("表示する場所", "side", [["left", "左側"], ["right", "右側"]], applyLayer);
    const slider = (label, key, min, max) => {
      const sz = el("div", "tf-szr"), rg = el("input"); rg.type = "range"; rg.min = min; rg.max = max; rg.step = 10; rg.value = cm[key];
      const val = el("span", "tf-szv", cm[key] + "%");
      rg.oninput = () => { cm[key] = +rg.value; val.textContent = cm[key] + "%"; saveCm(); applyLayer(); };
      sz.append(rg, val); row(label).append(sz);
    };
    slider("本文の大きさ", "size", 60, 200);
    slider("名前・日付の大きさ", "hs", 50, 200);
    seg("幅", "width", [["narrow", "狭い"], ["normal", "標準"], ["wide", "広い"]], applyLayer);
    seg("名前", "name", [["display", "表示名"], ["user", "ユーザーネーム"]]);
    seg("アイコン", "icon", [[true, "表示"], [false, "なし"]]);
    seg("並び順", "sort", [["top", "評価順"], ["new", "新着順"]], () => reloadCm());
    seg("外国語", "tr", [[true, "日本語に翻訳"], [false, "そのまま"]], () => { if (cm.tr) trPrefetch(); });
    seg("最後まで流したら", "loop", [[true, "ループ"], [false, "非表示"]]);
    p.append(m);
    setTimeout(() => addEventListener("click", function h(e) { if (!m.isConnected) return removeEventListener("click", h, true); if (!m.contains(e.target) && !btn.contains(e.target)) { closeCmMenu(); removeEventListener("click", h, true); } }, true), 0);
  }
  addEventListener("keydown", (e) => { if (e.key === "Escape") closeCmMenu(); });

  /* ---------- コメント欄(動画の下)の表示 ----------
     TubeFolio3 の設定(一般)で、「表示する」か「再生と同時に非表示」を選ぶ。非表示にすると、コメント欄の描画の負荷が減る */
  let hideMode = "show";
  const setHidden = (on) => document.documentElement.classList.toggle("tf-hide-cm", on);
  const isPlaying = () => { const v = document.querySelector("#movie_player video"); return !!v && !v.paused && !v.ended; };
  chrome.storage.local.get("tf-cm-hidemode").then((r) => { hideMode = r["tf-cm-hidemode"] === "onplay" ? "onplay" : "show"; setHidden(hideMode === "onplay" && isPlaying()); });
  chrome.storage.onChanged.addListener((c) => {
    if (!c["tf-cm-hidemode"]) return;
    hideMode = c["tf-cm-hidemode"].newValue === "onplay" ? "onplay" : "show"; setHidden(hideMode === "onplay" && isPlaying());
  });
  document.addEventListener("playing", (e) => { if (hideMode === "onplay" && e.target?.closest?.("#movie_player")) setHidden(true); }, true); // 再生が始まったら隠す
  addEventListener("yt-navigate-start", () => setHidden(false)); // 次の動画へ移るときは、いったん表示に戻す(その動画の再生が始まったら、また隠す)

  function ensureCmButtons() {
    const bar = document.querySelector(".ytp-right-controls-left") || document.querySelector(".ytp-right-controls");
    if (!bar) return;
    const mkb = (k, title) => {
      if (bar.querySelector(`.tf-ytp[data-k=${k}]`)) return;
      const b = el("button", "ytp-button tf-ytp"); b.dataset.k = k; b.title = title; b.setAttribute("aria-label", title); b.innerHTML = ICON[k];
      b.onclick = (e) => { e.stopPropagation(); toggleCmMenu(b); };
      bar.prepend(b);
    };
    mkb("cm", "コメント表示");
    applyCm();
  }
  addEventListener("yt-navigate-finish", () => { if (cm.on) { cm.vid = null; startCm(); } });

  /* ---------- ヘッダーのボタン(管理ページを開く) ---------- */
  function inject() {
    ensureCmButtons();
    const end = document.querySelector("ytd-masthead #end");
    if (end && !document.querySelector(".tf-head-btn")) {
      const b = el("button", "tf-btn tf-head-btn");
      const ico = el("img"); ico.src = chrome.runtime.getURL("icons/icon-32.png"); ico.width = 20; ico.height = 20;
      b.append(ico, "TubeFolio3");
      b.onclick = () => chrome.runtime.sendMessage("tf-open-manager");
      end.prepend(b);
    }
  }
  let t;
  new MutationObserver(() => { clearTimeout(t); t = setTimeout(inject, 300); }).observe(document.body, { childList: true, subtree: true });
  addEventListener("yt-navigate-finish", inject);
  inject();
})();
