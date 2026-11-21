(() => {
  /* ===== チャンネルのページ(YouTube)に「TubeFolio3」ボタンを置く =====
     「登録済み」「コミュニティ」の横に、同じ見た目のボタンを1つ置き、押すとメニューを出す。
     ・チャンネル登録 / 解除(background.js 経由で YouTube に書き込む)
     ・フォルダ設定(このチャンネルを TubeFolio3 のフォルダに入れる。data.channels[チャンネルID].folders。管理ページと同じデータ)
     ・視聴済み動画を消す(動画の一覧で、80%以上見た動画を隠す)
     ・メンバー限定動画を消す(動画の一覧で、メンバー限定の動画を隠す)
     この2つの切り替えは設定として覚える(tf-chp-watched / tf-chp-members。ドライブ同期の対象) */
  const KEY = "tubefolio", K_W = "tf-chp-watched", K_M = "tf-chp-members";
  const load = async () => (await chrome.storage.local.get(KEY))[KEY] || { folders: [], videos: {}, bookmarks: [], channels: {} };
  const save = (d) => chrome.storage.local.set({ [KEY]: d });
  const yta = (op, ...args) => new Promise((res, rej) => chrome.runtime.sendMessage({ tf: "yta", op, args }, (r) => (chrome.runtime.lastError ? rej(new Error(chrome.runtime.lastError.message)) : r?.ok ? res(r.r) : rej(new Error(r?.error || "失敗")))));
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const isChannel = () => /^\/(@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)(\/|$)/.test(location.pathname);
  let hideW = false, hideM = false;
  chrome.storage.local.get([K_W, K_M]).then((r) => { hideW = r[K_W] === "on"; hideM = r[K_M] === "on"; });
  chrome.storage.onChanged.addListener((c) => { if (c[K_W]) hideW = c[K_W].newValue === "on"; if (c[K_M]) hideM = c[K_M].newValue === "on"; });

  /* ---------- 動画の一覧から隠す ---------- */
  const ITEM = "ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-video-renderer, ytd-playlist-video-renderer, ytd-reel-item-renderer";
  const progressOf = (it) => { // 見た割合(%)
    let m = 0;
    for (const p of it.querySelectorAll("#progress, [class*='WatchedProgressBarSegment'], [class*='ProgressBarSegment']")) { const w = parseFloat(p.style?.width || ""); if (w > m) m = w; }
    return m;
  };
  const isMembers = (it) => {
    for (const b of it.querySelectorAll("ytd-badge-supported-renderer, yt-badge-shape, .badge-shape-wiz__text, [class*='badge'], [class*='Badge']")) if (/メンバー限定|Members only/i.test(b.textContent || "")) return true;
    return !!it.querySelector("[aria-label*='メンバー限定'], [aria-label*='Members only']");
  };
  function scan() {
    const on = isChannel() && (hideW || hideM);
    for (const it of document.querySelectorAll(on ? ITEM : ".tf-chhide")) {
      const hide = on && ((hideW && progressOf(it) >= 80) || (hideM && isMembers(it)));
      it.classList.toggle("tf-chhide", hide);
    }
  }

  /* ---------- ボタン ---------- */
  const icon = () => { const i = el("img"); i.src = chrome.runtime.getURL("icons/icon-32.png"); i.alt = ""; i.className = "tf-chb-i"; return i; };
  function makeButton() {
    const wrap = el("div", "yt-flexible-actions-view-model-wiz__action tf-chbtn");
    const b = el("button", "tf-chb");
    b.type = "button"; b.setAttribute("aria-label", "TubeFolio3");
    const ic = icon();
    const tx = el("span", "tf-chb-t", "TubeFolio3");
    b.append(ic, tx); wrap.append(b);
    b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); document.querySelector(".tf-chmenu") ? closeMenu() : openMenu(b); };
    return wrap;
  }
  function inject() {
    if (!isChannel()) { document.querySelector(".tf-chbtn")?.remove(); return; }
    const box = document.querySelector("yt-flexible-actions-view-model") || document.querySelector("ytd-c4-tabbed-header-renderer #buttons");
    if (!box || box.querySelector(".tf-chbtn") || !box.children.length) return;
    box.append(makeButton());
  }

  /* ---------- メニュー ---------- */
  function closeMenu() { document.querySelector(".tf-chmenu")?.remove(); }
  const subscribedNow = () => /登録済み|Subscribed/i.test((document.querySelector("yt-flexible-actions-view-model, #subscribe-button, ytd-c4-tabbed-header-renderer #buttons") || {}).textContent || "");
  async function channelId() {
    const cand = [document.querySelector("link[rel='canonical']")?.href, document.querySelector("meta[itemprop='channelId']")?.content, document.querySelector("meta[property='og:url']")?.content, location.href];
    for (const u of cand) { const m = String(u || "").match(/UC[\w-]{22}/); if (m) return m[0]; }
    return yta("channelIdOf", location.href);
  }
  async function openMenu(anchor) {
    closeMenu();
    const box = el("div", "tf-menu tf-chmenu"), status = el("div", "tf-st");
    const msg = (t, bad) => { status.textContent = t; status.classList.toggle("bad", !!bad); clearTimeout(msg.t); if (t) msg.t = setTimeout(() => (status.textContent = ""), 3500); };
    const head = el("div", "tf-mh"), ti = el("b", "tf-mt"); ti.append(icon(), document.createTextNode("TubeFolio3")); head.append(ti);
    const open = el("button", "tf-lnk", "管理ページ ↗"); open.onclick = () => { closeMenu(); chrome.runtime.sendMessage("tf-open-manager"); }; head.append(open);
    const tabs = el("div", "tf-tabs"), pane = el("div", "tf-pane"), foPane = el("div", "tf-pane"); pane.append(el("div", "tf-em", "読み込み中…"));
    const show = (k) => { pane.hidden = k !== "set"; foPane.hidden = k !== "fo"; tabs.querySelectorAll(".tf-tab").forEach((b) => b.classList.toggle("on", b.dataset.k === k)); place(); };
    for (const [k, n] of [["set", "チャンネル"], ["fo", "フォルダ"]]) { const b = el("button", "tf-tab", n); b.type = "button"; b.dataset.k = k; b.onclick = () => show(k); tabs.append(b); }
    box.append(head, tabs, pane, foPane, status); document.body.append(box);
    const place = () => {
      if (!box.isConnected) return;
      const r = anchor.getBoundingClientRect();
      box.style.maxHeight = Math.max(220, Math.min(innerHeight - r.bottom - 24, 560)) + "px";
      box.style.left = Math.max(8, Math.min(r.left, innerWidth - 348)) + "px"; box.style.top = r.bottom + 8 + "px";
    };
    show("set"); addEventListener("resize", place);
    setTimeout(() => addEventListener("click", function h(e) { if (!box.isConnected) return removeEventListener("click", h, true); if (!box.contains(e.target) && !anchor.contains(e.target)) { closeMenu(); removeEventListener("click", h, true); } }, true), 0);

    const row = (label, checked, onchange, iconNode) => {
      const l = el("label", "tf-row"), cb = el("input"); cb.type = "checkbox"; cb.checked = checked; l.append(cb);
      if (iconNode) l.append(iconNode);
      l.append(el("span", "tf-t", label)); cb.onchange = () => onchange(cb); return l;
    };
    const folderIcon = (f) => {
      const d = el("span", "tf-fi"); if (f.bg) d.style.background = f.bg;
      if (f.img) { const im = el("img"); im.src = f.img; im.alt = ""; d.append(im); }
      else d.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="${(f.color || "#ccc").replace(/[^#\w(),.% -]/g, "")}" stroke-width="2" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`;
      return d;
    };
    const sec = (t) => el("div", "tf-chh", t);

    let cid = "";
    try { cid = await channelId(); } catch { /* 下で表示 */ }
    pane.textContent = "";
    // チャンネル登録
    let subbed = subscribedNow();
    const sb = el("button", "tf-sub"), paint = () => { sb.textContent = subbed ? "✓ 登録済み(押すと解除)" : "＋ チャンネル登録"; sb.classList.toggle("on", subbed); };
    paint(); pane.append(sb);
    sb.onclick = async () => {
      sb.disabled = true;
      try { if (!cid) throw new Error("チャンネルを特定できませんでした"); await yta(subbed ? "unsubscribe" : "subscribe", cid); subbed = !subbed; paint(); msg(subbed ? "チャンネル登録しました" : "チャンネル登録を解除しました"); }
      catch (e) { msg("できませんでした: " + e.message, true); }
      sb.disabled = false;
    };
    // フォルダ設定
    const data = await load(), cur = new Set(data.channels?.[cid]?.folders || []);
    const walk = (pid, d) => data.folders.filter((f) => (f.parent || "") === pid).forEach((f) => {
      const l = row(f.name, cur.has(f.id), async (cb) => {
        const dd = await load();
        if (!cid) { cb.checked = !cb.checked; return msg("チャンネルを特定できませんでした", true); }
        const nm = document.querySelector("yt-dynamic-text-view-model h1, ytd-channel-name #text, #channel-name #text")?.textContent?.trim() || "";
        const c = ((dd.channels ||= {})[cid] ||= { id: cid, name: nm, handle: (location.pathname.match(/^\/(@[^/]+)/) || [])[1] || "", thumb: document.querySelector("#avatar img, yt-decorated-avatar-view-model img")?.src || "", folders: [], subscribed: subbed });
        c.folders = cb.checked ? [...new Set([...(c.folders || []), f.id])] : (c.folders || []).filter((x) => x !== f.id);
        await save(dd); msg(cb.checked ? `「${f.name}」に登録しました` : `「${f.name}」から外しました`);
      }, folderIcon(f));
      l.style.paddingLeft = 10 + d * 18 + "px"; foPane.append(l); walk(f.id, d + 1);
    });
    walk("", 0);
    if (!data.folders.length) foPane.append(el("div", "tf-em", "フォルダがありません(管理ページで作成してください)"));
    // 一覧から消す
    pane.append(sec("動画の一覧"));
    pane.append(row("視聴済み動画を消す(80%以上見た動画)", hideW, (cb) => { hideW = cb.checked; chrome.storage.local.set({ [K_W]: hideW ? "on" : "off" }); scan(); }));
    pane.append(row("メンバー限定動画を消す", hideM, (cb) => { hideM = cb.checked; chrome.storage.local.set({ [K_M]: hideM ? "on" : "off" }); scan(); }));
  }
  addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });
  addEventListener("yt-navigate-start", closeMenu);
  setInterval(() => { try { inject(); scan(); } catch { /* ページ移動の途中 */ } }, 1000);
})();
