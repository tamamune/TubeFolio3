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
  /* ---------- タグとハッシュタグ ---------- */
  // 概要欄のハッシュタグ(#の後ろの文字・数字・_)。数字だけのもの(#1 など)は除く
  const hashOf = (desc) => [...new Set([...String(desc || "").matchAll(/(?:^|[^\p{L}\p{N}_&/#])#([\p{L}\p{N}_]+)/gu)].map((m) => m[1]))].filter((t) => !/^\d+$/.test(t));
  // 動画のタグとハッシュタグ。ページのデータにあればそれを使い、なければ YouTube に問い合わせる
  async function tagsOf(vid, info) {
    const own = info?.videoId === vid;
    let tags = own && Array.isArray(info.keywords) ? info.keywords : null, desc = own && typeof info.description === "string" ? info.description : null, meta = null;
    if (tags == null || desc == null) { meta = await yta("videoMeta", vid); tags ??= meta.keywords; desc ??= meta.description; }
    return { tags: [...new Set(tags || [])], hash: hashOf(desc), title: (own && info.title) || meta?.title || "", channel: (own && info.channel) || meta?.channel || "" };
  }
  // 見た動画のタグ・ハッシュタグを記録する(管理ページの 設定 → 「タグ」で、まとめて管理する)
  // 保存先: chrome.storage.local の "tf-taglog" = { v: { 動画ID: { t: 題名, ch: チャンネル, at: 見た日時, tags, hash } } }(新しい 3000本まで)
  const TAGLOG = "tf-taglog";
  let logged = "";
  async function logTags() {
    const v = vidNow(); if (!v || v === logged) return;
    await new Promise((r) => setTimeout(r, 4000)); // 動画を開いてすぐ閉じたものは記録しない / ページのデータがそろうのを待つ
    if (vidNow() !== v || v === logged) return;
    logged = v;
    try {
      const r = await tagsOf(v, await videoInfo());
      const s = (await chrome.storage.local.get(TAGLOG))[TAGLOG] || {}, all = (s.v ||= {});
      // 管理ページで削除したタグ(block)は記録しない
      const block = new Set((s.block || []).map((x) => String(x).toLowerCase()));
      const tags = r.tags.filter((n) => !block.has(("tag:" + n).toLowerCase())), hash = r.hash.filter((n) => !block.has(("hash:" + n).toLowerCase()));
      if (!tags.length && !hash.length) return;
      delete all[v]; // 見直したら、新しい側へ
      all[v] = { t: r.title, ch: r.channel, at: Date.now(), tags, hash };
      const ids = Object.keys(all); if (ids.length > 3000) ids.slice(0, ids.length - 3000).forEach((k) => delete all[k]);
      prune(s);
      await chrome.storage.local.set({ [TAGLOG]: s });
    } catch { logged = ""; }
  }
  // 最大保存数(管理ページで設定)を超えたら、取り置き(keep)以外で、最後に見たのが古いタグから消す(tags.js の tgPrune と同じ)
  function prune(s) {
    const max = +s.max || 0; if (!max) return;
    const last = new Map();
    for (const r of Object.values(s.v)) for (const [kind, list] of [["tag", r.tags || []], ["hash", r.hash || []]]) for (const n of list) { const k = (kind + ":" + n).toLowerCase(); last.set(k, Math.max(last.get(k) || 0, r.at || 0)); }
    if (last.size <= max) return;
    const keep = new Set((s.keep || []).map((x) => String(x).toLowerCase()));
    const drop = new Set([...last].filter(([k]) => !keep.has(k)).sort((a, b) => a[1] - b[1]).slice(0, last.size - max).map(([k]) => k));
    for (const [id, r] of Object.entries(s.v)) {
      r.tags = (r.tags || []).filter((n) => !drop.has(("tag:" + n).toLowerCase()));
      r.hash = (r.hash || []).filter((n) => !drop.has(("hash:" + n).toLowerCase()));
      if (!r.tags.length && !r.hash.length) delete s.v[id];
    }
  }
  addEventListener("yt-navigate-finish", logTags);
  setTimeout(logTags, 1500);

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
    const head = el("div", "tf-mh"); { const ti = el("b", "tf-mt"); const im = el("img"); im.src = chrome.runtime.getURL("icons/icon-32.png"); im.alt = ""; ti.append(im, document.createTextNode("TubeFolio3")); head.append(ti); }
    const open = el("button", "tf-lnk", "管理ページ ↗"); open.onclick = () => { closeMenu(); chrome.runtime.sendMessage("tf-open-manager"); }; head.append(open);
    const plBox = el("div", "tf-pane"), foBox = el("div", "tf-pane"), chBox = el("div", "tf-pane"), tgBox = el("div", "tf-pane");
    const panes = { pl: plBox, fo: foBox, ch: chBox, tg: tgBox }, names = { pl: "再生リスト", fo: "フォルダ", ch: "チャンネル", tg: "タグ" };
    const tabs = el("div", "tf-tabs"); tabs.setAttribute("role", "tablist");
    const show = (k) => { lastTab = k; for (const [key, p] of Object.entries(panes)) p.hidden = key !== k; tabs.querySelectorAll(".tf-tab").forEach((b) => b.classList.toggle("on", b.dataset.k === k)); place(); };
    for (const k of Object.keys(names)) { const b = el("button", "tf-tab", names[k]); b.dataset.k = k; b.onclick = () => show(k); tabs.append(b); }
    plBox.append(el("div", "tf-em", "読み込み中…"));
    box.append(head, tabs, plBox, foBox, chBox, tgBox, status);
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

    show(lastTab);
    fillPanes(vid, { plBox, foBox, chBox, tgBox }, msg);
  }
  // 再生リスト・フォルダ・チャンネル・タグの中身を作る(⋯ の古いメニューと、ツールのパネル(ptools.js)の両方から使う)
  async function fillPanes(vid, { plBox, foBox, chBox, tgBox }, msg) {
    const row = (label, checked, onchange, dot) => {
      const l = el("label", "tf-row"), cb = el("input"); cb.type = "checkbox"; cb.checked = checked;
      l.append(cb);
      if (dot && typeof dot === "object") { // フォルダ設定のアイコン(画像・背景色・フォルダの色)
        const d = el("span", "tf-fi"); if (dot.bg) d.style.background = dot.bg;
        if (dot.img) { const im = el("img"); im.src = dot.img; im.alt = ""; d.append(im); }
        else d.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="${(dot.color || "#ccc").replace(/[^#\w(),.% -]/g, "")}" stroke-width="2" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`;
        l.append(d);
      } else if (dot) { const d = el("span", "tf-dot"); d.style.background = dot; l.append(d); }
      l.append(el("span", "tf-t", label));
      cb.onchange = () => onchange(cb);
      return l;
    };
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
      }, f);
      l.style.paddingLeft = 10 + d * 18 + "px"; foBox.append(l); walk(f.id, d + 1);
    });
    walk("", 0);
    if (!data.folders.length) foBox.append(el("div", "tf-em", "フォルダがありません(管理ページで作成してください)"));

    // タグ(投稿者が設定した、画面には出ないキーワード)と、概要欄のハッシュタグ。分けて表示する
    // タグは押すとそのタグで検索、ハッシュタグは押すと YouTube のハッシュタグのページ
    tgBox.append(el("div", "tf-em", "読み込み中…"));
    (async () => {
      let r; try { r = await tagsOf(vid, info); } catch (e) { tgBox.textContent = ""; return tgBox.append(el("div", "tf-em bad", "読み込めませんでした: " + e.message)); }
      tgBox.textContent = "";
      const sect = (title, list, empty, kind) => {
        const hd = el("div", "tf-tgh"); hd.append(el("b", null, `${title}(${list.length})`));
        if (list.length) {
          const shown = kind === "hash" ? list.map((t) => "#" + t) : list;
          const cp = el("button", "tf-lnk", "すべてコピー"); cp.onclick = () => navigator.clipboard.writeText(shown.join(kind === "hash" ? " " : ", ")).then(() => msg(`${title}をコピーしました`), () => msg("コピーできませんでした", true));
          hd.append(cp);
        }
        tgBox.append(hd);
        if (!list.length) return tgBox.append(el("div", "tf-em", empty));
        const wrap = el("div", "tf-tags");
        for (const t of list) {
          const a = el("a", "tf-tag" + (kind === "hash" ? " hash" : ""), kind === "hash" ? "#" + t : t); a.target = "_blank"; a.rel = "noopener";
          if (kind === "hash") { a.href = "/hashtag/" + encodeURIComponent(t); a.title = "#" + t + " を TubeFolio3 で検索"; } else { a.href = "/results?search_query=" + encodeURIComponent(t); a.title = "「" + t + "」を TubeFolio3 で検索"; }
          a.onclick = (e) => { e.preventDefault(); e.stopPropagation(); chrome.runtime.sendMessage({ tf: "open-search", q: kind === "hash" ? "#" + t : t }); }; // プレーヤーの中だと、リンクの標準の動きが YouTube に止められるので、自分で新しいタブで開く
          wrap.append(a);
        }
        tgBox.append(wrap);
      };
      sect("タグ", r.tags, "投稿者が設定したタグはありません", "tag");
      sect("ハッシュタグ", r.hash, "概要欄にハッシュタグはありません", "hash");
    })();

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
  globalThis.tfReg = { build: (panes, msg) => { const vid = vidNow(); if (vid) return fillPanes(vid, panes, msg); } };
  addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });
  addEventListener("yt-navigate-start", closeMenu);

  // 「⋯」は YouTube の標準のまま(再生リスト・フォルダ・タグは、プレーヤーの 🛠 ツールのパネルから開く)

  /* ---------- コメント流し(再生画面) ----------
     ・動画のコメントを、映像の上に背景なしで、下から上へ流す。1件は「名前・♥評価・投稿日」の行と、本文
     ・プレーヤーの右下の「⋯」ボタンのメニュー(「コメント表示」タブ)で設定する(表示・場所・文字の大きさ・幅・名前・並び順・翻訳・終わったあと)
     ・コメント欄そのものを隠すボタン(表示の負荷を減らす)も、同じ場所に置く
     ・コメントは YouTube から取る(background.js 経由)。コメント欄を開いていなくても取れる */
  const CM_DEF = { on: false, side: "right", size: 100, hs: 100, width: "normal", name: "display", icon: true, sort: "top", tr: true, loop: true, auto: false };
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
    if (cm.on) { startCm(); applyLayer(); } else stopCm();
  }
  // 表示場所・文字の大きさ・幅を、コメントの層に反映する。大きさや幅が変わると各コメントの高さも変わるので、位置を詰め直す
  function applyLayer() {
    const l = document.querySelector(".tf-cm"); if (!l) return;
    l.classList.toggle("left", cm.side === "left"); l.style.setProperty("--tf-fs", cm.size / 100); l.style.setProperty("--tf-hs", cm.hs / 100); l.classList.toggle("auto", !!cm.auto); const pe = playerEl(); if (pe) l.style.setProperty("--tf-pw", pe.clientWidth); l.style.setProperty("--tf-w", CM_W[cm.width] + "%");
    let y = null; for (const it of cm.items) { it.h = it.el.offsetHeight; if (y != null) it.y = Math.max(it.y, y); y = it.y + it.h + 16; it.el.style.transform = `translateY(${it.y}px)`; }
  }
  // プレーヤーの大きさが変わったら(ウィンドウ・全画面・シアターモード)、「自動」の文字サイズを計算し直す
  let roEl = null, roRaf = 0; const ro = new ResizeObserver(() => { if (!cm.auto) return; cancelAnimationFrame(roRaf); roRaf = requestAnimationFrame(applyLayer); });
  function layer() {
    const p = playerEl(); if (!p) return null;
    if (roEl !== p) { ro.disconnect(); ro.observe(p); roEl = p; }
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
  // コメントを取ったら、流す前にまとめて翻訳しておく。1件ずつ送ると翻訳の窓口に断られて、コメントがなかなか出ないので、
  // 全部を数回の通信にまとめて送る(translateMany)。訳せなかったコメントは、原文のまま流す
  // 訳せなかったコメントは、原文のまま流しつつ、1分後に(3回まで)訳し直す。訳せたら、まだ流していないものから日本語になる
  let trRetry = 0, trTries = 0;
  async function trPrefetch(retry = false) {
    if (!cm.tr) return;
    if (!retry) { clearTimeout(trRetry); trTries = 0; }
    const todo = [...new Set(cm.list.map((c) => c.text).filter((s) => needTr(s) && !trRes.get(s)?.[2]))];
    if (!todo.length) return;
    let out = null;
    try { out = await Promise.race([yta("translateMany", todo), new Promise((res) => setTimeout(() => res(null), 30000))]); } catch { out = null; }
    let failed = 0;
    todo.forEach((s, i) => {
      const r = out?.[i];
      if (!r?.text) { failed++; if (!trRes.has(s)) trRes.set(s, [s, false, false]); return; } // [本文, 翻訳したか, 結果が出たか]
      trRes.set(s, r.src !== "ja" && r.text !== s ? [r.text, true, true] : [s, false, true]);
    });
    if (failed && ++trTries <= 3) { clearTimeout(trRetry); trRetry = setTimeout(() => trPrefetch(true), 60000); }
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
    if (e.target?.closest?.(".tf-cmenu, .tf-tsp")) return false; // 手前の設定メニューの上では、コメントを動かさない(メニュー自身がスクロールできるように)
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
    more: `<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><circle cx="5.5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="18.5" cy="12" r="2"/></svg>`,
    ts: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="7"/><path d="M12 9.5V13l2.5 1.5M9.5 3h5"/></svg>`,
  };
  /* ---------- プレーヤーの「⋯」(設定)メニュー: タブで「コメント表示」と「SponsorBlock」を切り替える ---------- */
  function closeCmMenu() { document.querySelector(".tf-cmenu")?.remove(); }
  let moreTab = "cm"; // 前回開いていたタブ
  function toggleMore(btn) {
    if (document.querySelector(".tf-cmenu")) return closeCmMenu();
    closeTsPanel();
    const p = playerEl(); if (!p) return;
    const box = el("div", "tf-cmenu");
    ["click", "mousedown", "dblclick", "wheel", "contextmenu"].forEach((t) => box.addEventListener(t, (e) => e.stopPropagation())); // 後ろの映像のクリック(再生・停止)にしない
    const panes = { cm: el("div", "tf-mpane"), sb: el("div", "tf-mpane"), su: el("div", "tf-mpane") }, names = { cm: "コメント表示", sb: "SponsorBlock", su: "字幕" };
    const tabs = el("div", "tf-mtabs");
    const show = (k) => { moreTab = k; for (const [key, pn] of Object.entries(panes)) pn.hidden = key !== k; tabs.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.k === k)); };
    for (const k of Object.keys(names)) { const b = el("button", null, names[k]); b.type = "button"; b.dataset.k = k; b.onclick = () => show(k); tabs.append(b); }
    box.append(tabs, panes.cm, panes.sb, panes.su); p.append(box);
    buildCmPane(panes.cm);
    globalThis.tfSB?.buildPane(panes.sb);
    globalThis.tfSub?.buildPane(panes.su);
    show(moreTab);
    setTimeout(() => addEventListener("click", function h(e) { if (!box.isConnected) return removeEventListener("click", h, true); if (!box.contains(e.target) && !btn.contains(e.target)) { closeCmMenu(); removeEventListener("click", h, true); } }, true), 0);
  }
  function buildCmPane(m) {
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
    seg("文字サイズ", "auto", [[false, "固定"], [true, "自動"]], applyLayer, "横幅が広いと小さく、狭いと大きく");
    slider("本文の大きさ", "size", 60, 200);
    slider("名前・日付の大きさ", "hs", 50, 200);
    seg("幅", "width", [["narrow", "狭い"], ["normal", "標準"], ["wide", "広い"]], applyLayer);
    seg("名前", "name", [["display", "表示名"], ["user", "ユーザーネーム"]]);
    seg("アイコン", "icon", [[true, "表示"], [false, "なし"]]);
    seg("並び順", "sort", [["top", "評価順"], ["new", "新着順"]], () => reloadCm());
    seg("外国語", "tr", [[true, "日本語に翻訳"], [false, "そのまま"]], () => { if (cm.tr) trPrefetch(); });
    seg("最後まで流したら", "loop", [[true, "ループ"], [false, "非表示"]]);
  }
  addEventListener("keydown", (e) => { if (e.key === "Escape") closeCmMenu(); });
  globalThis.tfCm = { buildPane: buildCmPane }; // 🛠 ツールの「コメント表示」タブ(ptools.js)から使う

  /* ---------- 「時間」ボタン: コメント欄の時間(0:15 など)とチャプターの一覧 ----------
     ・コメントに時間があれば「時間 + コメント」、動画にチャプターがあれば「時間 + 題名」を一覧にする。押すとその時間へ移動する
     ・どちらも無い動画では、ボタンを隠す。アイコンの上の数字は、時間のあるコメントの数 */
  const ex = { vid: null, gen: 0, comments: [], chapters: [] };
  const TS_RE = /(?<![\d:])((?:\d{1,2}:)?[0-5]?\d:[0-5]\d)(?![\d:])/;
  const tsSec = (s) => s.split(":").reduce((a, x) => a * 60 + +x, 0);
  const fmtT = (s) => { s = Math.floor(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60; return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(ss).padStart(2, "0"); };
  // コメント1件から、時間のある行を取り出す(曲のリストのように、1件に時間が複数あれば、行ごとに分ける)
  function exComments(list) {
    const out = [];
    for (const c of list) {
      for (const line of String(c.raw || c.text || "").split(/\n+/)) {
        const m = line.match(TS_RE); if (!m) continue;
        const rest = line.replace(m[0], "").replace(/^[\s\-–—:：・|｜>→]+|[\s\-–—:：・|｜]+$/g, "").trim();
        out.push({ sec: tsSec(m[1]), text: rest || line.trim(), name: c.name || "", likes: c.likes || "" });
      }
    }
    return out.sort((a, b) => a.sec - b.sec).slice(0, 300);
  }
  function exItems() { // 動画の長さを超える時間は、時間ではないものとして除く
    const d = document.querySelector("#movie_player video")?.duration, ok = (s) => !(isFinite(d) && d > 0) || s <= d + 1;
    return { c: ex.comments.filter((x) => ok(x.sec)), h: ex.chapters.filter((x) => ok(x.sec)) };
  }
  // 時間のあるコメントかチャプターが見つかって、「時間」ボタンが出るとき、1本の動画につき1回だけ音を鳴らす
  const tsBeep = () => { try { const a = new Audio(chrome.runtime.getURL("sounds/warn1.mp3")); a.volume = 0.6; a.play().catch(() => {}); } catch {} };
  function updateTsBtn() {
    const b = document.querySelector(".tf-ytp[data-k=ts]"); if (!b) return;
    const { c, h } = exItems(), has = c.length + h.length > 0, bd = b.querySelector(".tf-bdg");
    if (has && b.hidden && ex.vid && ex.beep !== ex.vid) { ex.beep = ex.vid; tsBeep(); }
    b.hidden = !has; if (bd) { bd.hidden = !c.length; bd.textContent = c.length > 99 ? "99+" : c.length; }
    if (!has) closeTsPanel(); else if (document.querySelector(".tf-tsp")) renderTsPanel();
  }
  function loadEx() {
    const v = vidNow();
    if (ex.vid === v) return;
    ex.vid = v; ex.comments = []; ex.chapters = []; const g = ++ex.gen; closeTsPanel(); updateTsBtn();
    if (!v) return;
    yta("chapters", v).then((r) => { if (ex.gen === g) { ex.chapters = r; updateTsBtn(); exTranslate(g); } }).catch(() => {});
    const tryC = async (n) => {
      let list = []; try { list = await yta("comments", v, 150, "top"); } catch { /* 取れなければ、やり直す */ }
      if (ex.gen !== g) return;
      ex.comments = exComments(list); updateTsBtn(); exTranslate(g);
      if (!list.length && n < 3) setTimeout(() => tryC(n + 1), 4000);
    };
    tryC(0);
  }
  // 一覧のコメントとチャプターの題名を日本語に翻訳する(コメント表示の「外国語: 日本語に翻訳」のとき。流すコメントと同じ訳の控え trRes を使う)
  // 訳せたら一覧を描き直す。原文は、行に重ねたときのヒントに出す
  const exLabel = (s) => (cm.tr && trRes.get(s)?.[1] ? trRes.get(s)[0] : s);
  async function exTranslate(g) {
    if (!cm.tr) return;
    const todo = [...new Set([...ex.comments.map((r) => r.text), ...ex.chapters.map((r) => r.title)].filter((s) => s && needTr(s) && !trRes.get(s)?.[2]))];
    if (!todo.length) return;
    let out = null;
    try { out = await Promise.race([yta("translateMany", todo), new Promise((res) => setTimeout(() => res(null), 30000))]); } catch { out = null; }
    todo.forEach((s, i) => { const r = out?.[i]; if (r?.text) trRes.set(s, r.src !== "ja" && r.text !== s ? [r.text, true, true] : [s, false, true]); });
    if (ex.gen === g) renderTsPanel();
  }
  document.addEventListener("durationchange", (e) => { if (e.target?.closest?.("#movie_player")) updateTsBtn(); }, true);
  function closeTsPanel() { document.querySelector(".tf-tsp")?.remove(); }
  // 一覧を作り直す。中身が前と同じなら作り直さない
  // (コメントの読み込みや durationchange のたびに作り直すと、押している途中で行が入れ替わり、クリックが効かないことがあった)
  function renderTsPanel() {
    const m = document.querySelector(".tf-tsp"); if (!m) return;
    const { c, h } = exItems();
    const sig = JSON.stringify([c.map((r) => [r.sec, exLabel(r.text), r.name]), h.map((r) => [r.sec, exLabel(r.title)])]); // 訳が届いたら描き直す
    if (m.dataset.sig === sig) return;
    m.dataset.sig = sig;
    const top = m.scrollTop; m.textContent = "";
    const sect = (title, rows, kind) => {
      const hd = el("div", "tf-tsh", `${title}(${rows.length})`); m.append(hd);
      for (const r of rows) {
        const d = el("div", "tf-tsr"), t = el("button", "tf-tst", fmtT(r.sec)); t.type = "button";
        const orig = r.text || r.title || "", label = exLabel(orig); // コメントは text、チャプター(ytapi.js の chapters)は title。訳があれば訳を出す
        const tx = el("div", "tf-tsx"); tx.append(el("span", null, label || "(題名なし)"));
        if (kind === "c" && r.name) tx.append(el("small", null, r.name.replace(/^@/, "")));
        d.append(t, tx); d.title = (r.name ? r.name.replace(/^@/, "") + ": " : "") + label + (label !== orig ? "\n原文: " + orig : ""); d.dataset.sec = r.sec; m.append(d); // 押したときの処理は、一覧の箱(toggleTsPanel)でまとめて行う
      }
    };
    if (c.length) sect("コメントの時間", c, "c");
    if (c.length && h.length) m.append(el("hr", "tf-tsl")); // 上: コメント / 罫線 / 下: チャプター
    if (h.length) sect("チャプター", h, "h");
    m.scrollTop = top;
  }
  function toggleTsPanel(btn) {
    if (document.querySelector(".tf-tsp")) return closeTsPanel();
    const p = playerEl(); if (!p) return;
    closeCmMenu();
    const m = el("div", "tf-tsp");
    ["click", "mousedown", "mouseup", "pointerdown", "pointerup", "dblclick", "wheel", "contextmenu"].forEach((t) => m.addEventListener(t, (e) => e.stopPropagation())); // 後ろの映像のクリック(再生・停止)にしない
    // 行を押したら、その時間へ移動する。行の要素そのものではなく、作り直されない箱で受け取り、離した位置の行で決める
    // (押してから離すまでに一覧が作り直されても、効くように。スクロールバーを動かしたときは移動しない)
    let down = null;
    m.addEventListener("pointerdown", (e) => { down = e.button === 0 && e.target.closest(".tf-tsr") ? { x: e.clientX, y: e.clientY } : null; });
    m.addEventListener("pointerup", (e) => {
      const d0 = down; down = null;
      if (!d0 || e.button !== 0 || Math.abs(e.clientX - d0.x) > 8 || Math.abs(e.clientY - d0.y) > 8) return;
      const row = e.target.closest?.(".tf-tsr"); if (!row || !m.contains(row)) return; // 離した位置の行(作り直された後の行でもよい)
      const v = document.querySelector("#movie_player video"); if (v) { v.currentTime = +row.dataset.sec; v.play?.().catch(() => {}); }
    });
    p.append(m); renderTsPanel();
    setTimeout(() => addEventListener("click", function h(e) { if (!m.isConnected) return removeEventListener("click", h, true); if (!m.contains(e.target) && !btn.contains(e.target)) { closeTsPanel(); removeEventListener("click", h, true); } }, true), 0);
  }
  addEventListener("keydown", (e) => { if (e.key === "Escape") closeTsPanel(); });
  addEventListener("yt-navigate-start", closeTsPanel);

  /* ---------- コメント欄(動画の下)・おすすめ一覧(右側)の表示 ----------
     TubeFolio3 の設定(一般)で選ぶ。
     ・show: 表示する / hide: 非表示 / onplay: 再生と同時に非表示(コメント欄だけ)
     ・d5 / d10: 動画を開いてから 5秒・10秒たったら表示(それまでは隠して、読み込みの負荷を後回しにする) */
  const VIS = {
    cm: { key: "tf-cm-hidemode", cls: "tf-hide-cm", ok: ["show", "onplay", "hide", "d5", "d10"], mode: "show", timer: 0 },
    rel: { key: "tf-rel-mode", cls: "tf-hide-rel", ok: ["show", "hide", "d5", "d10"], mode: "show", timer: 0 },
  };
  const isPlaying = () => { const v = document.querySelector("#movie_player video"); return !!v && !v.paused && !v.ended; };
  const visHide = (o, on) => document.documentElement.classList.toggle(o.cls, on);
  // 動画を開いたとき(と設定を変えたとき)に、その動画での表示を決める
  function visStart(o, fresh) {
    clearTimeout(o.timer);
    const m = o.mode, d = m === "d5" ? 5000 : m === "d10" ? 10000 : 0;
    if (d) {
      if (!fresh) return visHide(o, false); // 設定を変えただけのときは、今の動画では表示のままにする
      visHide(o, true); o.timer = setTimeout(() => visHide(o, false), d);
    } else visHide(o, m === "hide" || (m === "onplay" && isPlaying()));
  }
  const visRead = (o, v) => (o.mode = o.ok.includes(v) ? v : "show");
  chrome.storage.local.get(Object.values(VIS).map((o) => o.key)).then((r) => { for (const o of Object.values(VIS)) { visRead(o, r[o.key]); visStart(o, true); } });
  chrome.storage.onChanged.addListener((c) => { for (const o of Object.values(VIS)) if (c[o.key]) { visRead(o, c[o.key].newValue); visStart(o, false); } });
  document.addEventListener("playing", (e) => { if (VIS.cm.mode === "onplay" && e.target?.closest?.("#movie_player")) visHide(VIS.cm, true); }, true); // 再生が始まったら隠す
  addEventListener("yt-navigate-start", () => { for (const o of Object.values(VIS)) { clearTimeout(o.timer); visHide(o, o.mode === "hide" || o.mode === "d5" || o.mode === "d10"); } }); // 次の動画へ移るとき
  addEventListener("yt-navigate-finish", () => { if (location.pathname === "/watch") for (const o of Object.values(VIS)) visStart(o, true); });
  // 動画の終わりに出る YouTube のおすすめ(設定の一般で選ぶ)。show: 表示 / hide: 終了後の動画の一覧を隠す / all: 一覧と、終わりの数秒に出るカードも隠す
  const endApply = (m) => { const h = document.documentElement; h.classList.toggle("tf-hide-end", m === "hide" || m === "all"); h.classList.toggle("tf-hide-ce", m === "all"); };
  chrome.storage.local.get("tf-end-mode").then((r) => endApply(r["tf-end-mode"]));
  chrome.storage.onChanged.addListener((c) => { if (c["tf-end-mode"]) endApply(c["tf-end-mode"].newValue); });

  function ensureCmButtons() {
    const bar = document.querySelector(".ytp-right-controls-left") || document.querySelector(".ytp-right-controls");
    if (!bar) return;
    const mkb = (k, title, onclick, hidden) => {
      if (bar.querySelector(`.tf-ytp[data-k=${k}]`)) return;
      const b = el("button", "ytp-button tf-ytp"); b.dataset.k = k; b.title = title; b.setAttribute("aria-label", title); b.innerHTML = ICON[k];
      b.onclick = (e) => { e.stopPropagation(); onclick(b); }; b.hidden = !!hidden;
      if (k === "ts") b.append(el("span", "tf-bdg")); // アイコンの上の数字
      bar.prepend(b);
    };
    bar.querySelector(".tf-ytp[data-k=more]")?.remove(); // 「⋯」の設定(コメント表示・SponsorBlock・字幕)は、🛠 ツール(ptools.js)のタブに移した
    mkb("ts", "チャプター", toggleTsPanel, true); // 「⋯」の左側。表示するものがあるときだけ見せる
    applyCm(); loadEx(); updateTsBtn();
  }
  addEventListener("yt-navigate-finish", () => { if (cm.on) { cm.vid = null; startCm(); } });


  /* ---------- ブックマーク(メモ): 再生中にキーボードの B を押すと、その時間にメモを書ける ----------
     ・保存先は TubeFolio3 のデータ(data.marks[動画ID].notes = [{ t: 秒, text, at }])。管理ページの「ブックマーク」に並ぶ
     ・メモ欄を開いている間は動画を止め、閉じたら(止める前に再生中だったなら)再生に戻す
     ・Enter で保存、Shift+Enter で改行、Esc で閉じる。メモ欄には、この動画のメモの一覧も出す(時間を押すとその場所へ) */
  const memoT = (s) => { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60; return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0"); };
  const mvid = () => document.querySelector("#movie_player video");
  let memo = null; // { box, vid, t, wasPlaying }
  // 動画の今の画面を小さな画像(JPEG・横320)にする。取れないとき(保護された動画など)は空を返し、一覧では YouTube のサムネイルを使う
  function snapFrame(v) {
    try {
      if (!v.videoWidth) return "";
      const w = 320, h = Math.round(w * v.videoHeight / v.videoWidth), c = document.createElement("canvas"); c.width = w; c.height = h;
      c.getContext("2d").drawImage(v, 0, 0, w, h);
      const url = c.toDataURL("image/jpeg", 0.72); return url.length > 100 ? url : "";
    } catch { return ""; }
  }
  const isTyping = (e) => { const t = e.composedPath?.()[0] || e.target; return !!(t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))); };
  addEventListener("keydown", (e) => {
    if (e.key !== "b" && e.key !== "B") return;
    if (e.ctrlKey || e.altKey || e.metaKey || e.isComposing || isTyping(e) || !vidNow() || !mvid()) return;
    e.preventDefault(); e.stopPropagation();
    memo ? closeMemo() : openMemo();
  }, true);
  async function openMemo() {
    const v = mvid(), vid = vidNow(); if (!v || !vid) return;
    const wasPlaying = !v.paused && !v.ended; v.pause();
    const box = el("div", "tf-memo"); box.setAttribute("role", "dialog"); box.setAttribute("aria-label", "ブックマークのメモ");
    memo = { box, vid, t: v.currentTime, wasPlaying, img: snapFrame(v) }; // 押したときの画面を、ブックマークのサムネイルにする
    const head = el("div", "tf-memo-h");
    if (memo.img) { const im = el("img", "tf-memo-im"); im.src = memo.img; im.alt = ""; head.append(im); }
    head.append(el("b", "", "🔖 メモ"), el("span", "tf-memo-t", memoT(memo.t)));
    const x = el("button", "tf-memo-x", "✕"); x.type = "button"; x.title = "閉じる(Esc)"; x.onclick = () => closeMemo(); head.append(x);
    const ta = el("textarea", "tf-memo-in"); ta.rows = 3; ta.maxLength = 1000; ta.placeholder = "この場面のメモ(空のままでも保存できます)";
    const foot = el("div", "tf-memo-f"); foot.append(el("small", "", "Enter で保存 ・ Shift+Enter で改行 ・ Esc で閉じる"));
    const ok = el("button", "tf-memo-ok", "保存"); ok.type = "button"; ok.onclick = () => saveMemo(ta.value); foot.append(ok);
    const list = el("div", "tf-memo-l");
    box.append(head, ta, foot, list);
    ta.addEventListener("keydown", (e) => {
      e.stopPropagation(); // YouTube のショートカット(k / j / l など)に渡さない
      if (e.isComposing) return;
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveMemo(ta.value); }
      else if (e.key === "Escape") { e.preventDefault(); closeMemo(); }
    });
    ["keyup", "keypress"].forEach((k) => ta.addEventListener(k, (e) => e.stopPropagation()));
    ["click", "mousedown", "pointerdown", "dblclick", "wheel"].forEach((k) => box.addEventListener(k, (e) => e.stopPropagation())); // プレーヤーの「押すと一時停止」などに渡さない
    (document.querySelector("#movie_player") || document.body).append(box);
    ta.focus();
    paintMemoList();
  }
  async function paintMemoList() {
    if (!memo) return;
    const list = memo.box.querySelector(".tf-memo-l"), notes = ((await load()).marks?.[memo.vid]?.notes || []).slice().sort((a, b) => a.t - b.t);
    list.replaceChildren();
    if (!notes.length) return;
    list.append(el("div", "tf-memo-lh", `この動画のメモ(${notes.length})`));
    notes.forEach((n) => {
      const r = el("div", "tf-memo-r"), tb = el("button", "tf-memo-tb", memoT(n.t)); tb.type = "button"; tb.title = "この時間へ移動";
      tb.onclick = () => { const v = mvid(); if (v) v.currentTime = n.t; memo.t = n.t; memo.box.querySelector(".tf-memo-t").textContent = memoT(n.t); };
      const d = el("button", "tf-memo-del", "✕"); d.type = "button"; d.title = "このメモを消す";
      d.onclick = async () => { const s = await load(), m = s.marks?.[memo.vid]; if (!m?.notes) return; m.notes = m.notes.filter((o) => o.at !== n.at); await save(s); paintMemoList(); };
      const tx = el("span", "tf-memo-tx", n.text || "(メモなし ・ 押すと書けます)"); tx.title = "押すと編集";
      tx.onclick = () => editMemo(tx, n);
      const eb = el("button", "tf-memo-eb", "✎"); eb.type = "button"; eb.title = "このメモを書き直す"; eb.onclick = () => editMemo(tx, n);
      r.append(tb, tx, eb, d); list.append(r);
    });
  }
  // 一覧のメモの書き直し: Enter か欄の外で保存(Shift+Enter で改行)、Esc でやめる
  function editMemo(tx, n) {
    if (tx.querySelector("textarea")) return;
    const ta = el("textarea", "tf-memo-in tf-memo-ed"); ta.value = n.text || ""; ta.maxLength = 1000; ta.rows = Math.min(6, Math.max(2, ta.value.split("\n").length));
    tx.replaceChildren(ta); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
    let done = false;
    const end = async (ok) => {
      if (done) return; done = true;
      const text = ta.value.trim();
      if (ok && text !== (n.text || "")) {
        const s = await load(), o = s.marks?.[memo?.vid]?.notes?.find((x) => x.at === n.at);
        if (o) { o.text = text; await save(s); }
      }
      paintMemoList();
    };
    ta.addEventListener("keydown", (e) => {
      e.stopPropagation(); // YouTube のショートカットに渡さない
      if (e.isComposing) return;
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); end(true); }
      else if (e.key === "Escape") { e.preventDefault(); end(false); }
    });
    ["keyup", "keypress"].forEach((k) => ta.addEventListener(k, (e) => e.stopPropagation()));
    ta.addEventListener("blur", () => end(true));
  }
  async function saveMemo(text) {
    if (!memo) return;
    const { vid, t, img } = memo, info = await videoInfo(), v = mvid();
    const s = await load(); s.marks = s.marks || {};
    const now = new Date().toISOString(), m = s.marks[vid] || (s.marks[vid] = { at: now });
    m.title = info.title || m.title || ""; m.channel = info.channel || m.channel || "";
    if (v && isFinite(v.duration) && !m.duration) m.duration = memoT(v.duration);
    m.at = now; // 新しくメモした動画を、一覧の先頭に
    (m.notes = m.notes || []).push({ t: Math.floor(t), text: text.trim(), at: now, ...(img ? { img } : {}) });
    await save(s);
    toastMemo(`🔖 ${memoT(t)} にメモしました`);
    closeMemo();
  }
  function closeMemo() {
    if (!memo) return;
    const { box, wasPlaying } = memo; memo = null; box.remove();
    if (wasPlaying) mvid()?.play().catch(() => {});
  }
  function toastMemo(msg) {
    const t = el("div", "tf-memo-toast", msg); (document.querySelector("#movie_player") || document.body).append(t);
    setTimeout(() => t.remove(), 2200);
  }
  addEventListener("yt-navigate-start", closeMemo);

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
// ツールの色は、TubeFolio3 の設定「色の変更」(manager 側が chrome.storage の tf-accent に写す)に合わせる
(() => {
  const paint = (a) => document.documentElement.setAttribute("data-tf-acc", /^[a-z]{2,12}$/.test(a || "") ? a : "amber");
  chrome.storage.local.get("tf-accent").then((r) => paint(r["tf-accent"]));
  chrome.storage.onChanged.addListener((c) => { if (c["tf-accent"]) paint(c["tf-accent"].newValue); });
})();
