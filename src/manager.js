const KEY = "tubefolio";
let data = { folders: [], videos: {}, bookmarks: [] };
let cur = "home", sel = null, selPl = null, openPl = null; // openPl: 中身を一覧表示中の再生リストID
const plLoading = new Set();
let drag = null; // { type: "folder" | "video", id }

const $ = (id) => document.getElementById(id);
const save = () => chrome.storage.local.set({ [KEY]: data });
const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const parse = (t) => t.split(":").reduce((a, x) => a * 60 + (+x || 0), 0);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ls = {
  get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};
// サブフォルダ(1階層まで): folder.parent に親IDを持つ
const SYS = (id) => id === "all" || id === "home" || id === "playlists" || id === "search" || id === "recs";
const isYtList = () => cur === "search" || cur === "recs"; // YouTubeから取得した動画の一覧を表示中か
const pls = () => (data.playlists ||= []);
const kids = (id) => data.folders.filter((f) => f.parent === id);
const descIds = (id) => [id, ...kids(id).map((k) => k.id)];
const inFolder = (v, id) => SYS(id) || descIds(id).some((x) => v.folders.includes(x));
let expanded = new Set(JSON.parse(ls.get("tf-expanded", "[]")));
const saveExpanded = () => ls.set("tf-expanded", JSON.stringify([...expanded]));
function toast(msg) {
  const t = $("toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 1800);
}

/* ---------- アイコン ---------- */
const ICON_ALL = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></svg>`;
const ICON_HOME = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/></svg>`;
const ICON_PL = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h12M3 11h12M3 16h7"/><path d="m16 14 5 3-5 3z"/></svg>`;
const ICON_RECS = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z"/></svg>`;
const iconFolder = (c) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="${c}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`;

/* ---------- 描画 ---------- */
const CHEV = `<svg class="chev" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`;
function renderFolders() {
  const n = (id) => id === "playlists" ? pls().length : Object.values(data.videos).filter((v) => inFolder(v, id)).length;
  const item = (id, icon, name, o = {}) =>
    `<button class="nav-item ${cur === id ? "on" : ""} ${o.sub ? "sub" : ""} ${o.open ? "open" : ""}" data-f="${id}" data-tip="${esc(name)}" ${o.drag ? 'draggable="true"' : ""}>${o.sub ? '<span class="bullet"></span>' : icon}<span class="name">${esc(name)}</span>${id === "home" || id === "recs" ? "" : `<span class="n">${n(id)}</span>`}${o.kids ? CHEV : ""}</button>`;
  // ホーム / YouTube(おすすめ・再生リスト) / ライブラリ(自分で整理した動画とフォルダ)の3区画
  let h = item("home", ICON_HOME, "ホーム")
    + `<div class="nav-label">YouTube</div>` + item("recs", ICON_RECS, "おすすめ") + item("playlists", ICON_PL, "YouTubeの再生リスト")
    + `<div class="nav-label">ライブラリ</div>` + item("all", ICON_ALL, "すべての動画");
  for (const f of data.folders.filter((x) => !x.parent)) {
    const ks = kids(f.id), open = expanded.has(f.id);
    h += item(f.id, iconFolder(f.color), f.name, { drag: true, kids: ks.length, open });
    if (ks.length && open) h += ks.map((k) => item(k.id, "", k.name, { drag: true, sub: true })).join("");
  }
  $("folders").innerHTML = h;
}

const cardHtml = (id, v) => `
    <div class="card ${id === sel ? "on" : ""}" data-id="${id}" draggable="true">
      <button class="card-del" data-del="${id}" title="削除" aria-label="削除">✕</button>
      <img loading="lazy" src="https://i.ytimg.com/vi/${id}/mqdefault.jpg" alt="">
      <div><b>${esc(v.title)}</b><small>${esc(v.channel)}</small><br>${(v.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>
    </div>`;

function renderHome() {
  const vids = Object.entries(data.videos).sort((a, b) => (b[1].savedAt || "").localeCompare(a[1].savedAt || ""));
  const stat = (n, l) => `<div class="stat"><b>${n}</b><span>${l}</span></div>`;
  const tops = data.folders.filter((f) => !f.parent);
  const count = (id) => Object.values(data.videos).filter((v) => inFolder(v, id)).length;
  return `
    <div class="home-title">ようこそ</div>
    <div class="stats">${stat(vids.length, "保存した動画")}${stat(data.folders.length, "フォルダ")}${stat(data.bookmarks.length, "しおり")}</div>
    <h3 class="sec">最近保存した動画</h3>
    <div class="grid">${vids.slice(0, 6).map(([id, v]) => cardHtml(id, v)).join("") || '<div class="empty">まだ動画がありません。YouTubeで📁ボタンから保存しましょう</div>'}</div>
    <h3 class="sec">フォルダ</h3>
    <div class="grid folders-grid">${tops.map((f) => `
      <button class="ftile" data-go="${f.id}">${iconFolder(f.color)}<span class="name">${esc(f.name)}</span><span class="n">${count(f.id)}</span></button>`).join("")}</div>`;
}

function renderList() {
  const q = $("q").value.trim().toLowerCase();
  const list = $("list");
  if (cur === "search") { list.className = ""; list.innerHTML = renderSearch(); return; }
  if (cur === "recs") { list.className = ""; list.innerHTML = renderRecs(); return; }
  if (cur === "playlists") { list.className = ""; list.innerHTML = openPl ? renderPlDetail() : renderPlaylists(q); return; }
  if (cur === "home" && !q) { list.className = "home"; list.innerHTML = renderHome(); return; }
  list.className = "";
  const scope = cur === "home" ? "all" : cur; // ホームで検索したときは全体から探す
  const items = Object.entries(data.videos).filter(([, v]) =>
    inFolder(v, scope) &&
    (!q || [v.title, v.channel, ...(v.tags || [])].join(" ").toLowerCase().includes(q)));
  list.innerHTML = items.length ? `<div class="grid">${items.map(([id, v]) => cardHtml(id, v)).join("")}</div>` : `<div class="empty">該当する動画がありません</div>`;
}

function play(id, start = 0) {
  $("player").src = `https://www.youtube.com/embed/${id}?start=${start}&autoplay=${start ? 1 : 0}&rel=0&enablejsapi=1`;
}

function select(id) {
  sel = id; selPl = null; ytPlaying = null;
  $("detail").classList.remove("pl", "yt");
  $("d-delete").textContent = "この動画を削除";
  const v = data.videos[id];
  $("detail").hidden = false;
  $("d-title").textContent = v.title;
  $("d-meta").textContent = `${v.channel} ・ 保存: ${new Date(v.savedAt).toLocaleDateString("ja-JP")}`;
  $("d-open").href = `https://www.youtube.com/watch?v=${id}`;
  play(id);
  renderDetail();
  renderList();
}

function renderDetail() {
  if (selPl || ytPlaying) return;
  if (!sel || !data.videos[sel]) { $("detail").hidden = true; return; }
  const bms = data.bookmarks.filter((b) => b.videoId === sel).sort((a, b) => a.time - b.time);
  $("d-bms").innerHTML = bms.length
    ? bms.map((b) => `<li><a data-t="${b.time}">${fmt(b.time)}</a><span>${esc(b.note)}</span></li>`).join("")
    : `<li class="empty">しおりはありません</li>`;
  const v = data.videos[sel];
  $("d-folders").innerHTML = data.folders.map((f) =>
    `<label><input type="checkbox" data-f="${f.id}" ${v.folders.includes(f.id) ? "checked" : ""}>${iconFolder(f.color).replace('width="20" height="20"', 'width="16" height="16"')}${esc((f.parent ? (data.folders.find((p) => p.id === f.parent)?.name + " / ") : "") + f.name)}</label>`).join("");
}

function render() { renderFolders(); renderList(); renderDetail(); }

/* ---------- クリック系(イベント委譲) ---------- */
$("folders").addEventListener("click", (e) => {
  const b = e.target.closest("[data-f]"); if (!b) return;
  cur = b.dataset.f; openPl = null;
  // 子を持つフォルダは、押すたびにアコーディオンを開閉
  if (kids(cur).length) { expanded.has(cur) ? expanded.delete(cur) : expanded.add(cur); saveExpanded(); }
  hidePreview();
  render();
  if (cur === "playlists") autoSyncPlaylists();
  if (cur === "recs") autoLoadRecs();
});
$("list").addEventListener("click", (e) => {
  const tab = e.target.closest("[data-pltab]");
  if (tab) { plTab = tab.dataset.pltab; ls.set("tf-pl-tab", plTab); renderList(); return; }
  const act = e.target.closest("[data-act]");
  if (act) { act.dataset.act === "pl-add" ? openPlDialog() : importFromYouTube(false); return; }
  const delPl = e.target.closest("[data-delpl]");
  if (delPl) { e.stopPropagation(); deletePlaylist(delPl.dataset.delpl); return; }
  const pl = e.target.closest("[data-pl]");
  if (pl) { openPlaylist(pl.dataset.pl); return; }
  const vw = e.target.closest("[data-view]");
  if (vw) { rowView = vw.dataset.view; ls.set("tf-view", rowView); hidePreview(); renderList(); return; }
  const pv = e.target.closest("[data-prev]");
  if (pv) { prevMode = pv.dataset.prev; ls.set("tf-prev", prevMode); hidePreview(); renderList(); return; }
  if (e.target.closest("[data-back]")) { openPl = null; renderList(); return; }
  const ysave = e.target.closest("[data-ytsave]");
  if (ysave) { e.stopPropagation(); openAddDialog("https://www.youtube.com/watch?v=" + ysave.dataset.ytsave); return; }
  const vsave = e.target.closest("[data-savevid]");
  if (vsave) { e.stopPropagation(); saveVideoFromPl(vsave.dataset.savevid); return; }
  const vrow = e.target.closest("[data-vid]");
  if (vrow) { isYtList() ? playYt(vrow.dataset.vid) : playInPlaylist(vrow.dataset.vid); return; }
  if (e.target.closest("[data-recreload]")) { loadRecs(); return; }
  const chip = e.target.closest("[data-chip]");
  if (chip) { selectChip(+chip.dataset.chip); return; }
  if (e.target.closest("[data-playall]")) { selectPlaylist(openPl, true); return; }
  if (e.target.closest("[data-reload]")) { const p = pls().find((x) => x.id === openPl); if (p) loadPlItems(p, false); return; }
  const del = e.target.closest("[data-del]");
  if (del) { e.stopPropagation(); deleteVideo(del.dataset.del); return; }
  const t = e.target.closest("[data-go]");
  if (t) { cur = t.dataset.go; openPl = null; $("q").value = ""; render(); return; }
  const c = e.target.closest(".card"); if (c) select(c.dataset.id);
});
$("d-bms").addEventListener("click", (e) => {
  const a = e.target.closest("a[data-t]"); if (a) play(sel, +a.dataset.t);
});
$("d-folders").addEventListener("change", async (e) => {
  const c = e.target.closest("input[data-f]"); if (!c) return;
  const v = data.videos[sel];
  v.folders = c.checked ? [...new Set([...v.folders, c.dataset.f])] : v.folders.filter((x) => x !== c.dataset.f);
  await save(); render();
});
$("bm-form").onsubmit = async (e) => {
  e.preventDefault();
  data.bookmarks.push({ videoId: sel, time: parse($("bm-time").value), note: $("bm-note").value, createdAt: new Date().toISOString() });
  $("bm-form").reset();
  await save(); renderDetail();
};
$("q").oninput = () => { if (qmode === "lib") renderList(); };
/* ---------- 動画の削除・登録 ---------- */
async function deleteVideo(id) {
  const v = data.videos[id]; if (!v) return;
  if (!confirm(`「${v.title}」を削除しますか?\nこの動画のしおりも一緒に削除されます(元に戻せません)。`)) return;
  delete data.videos[id];
  data.bookmarks = data.bookmarks.filter((b) => b.videoId !== id);
  if (sel === id) { sel = null; $("player").src = "about:blank"; }
  await save(); render(); toast("削除しました");
}
$("d-delete").onclick = () => (selPl ? deletePlaylist(selPl) : sel && deleteVideo(sel));

// URL・動画IDから11文字の動画IDを取り出す
function videoIdFrom(s) {
  s = s.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    if (u.hostname === "youtu.be") return u.pathname.slice(1, 12);
    if (/(^|\.)youtube\.com$/.test(u.hostname)) {
      const m = u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{11})/);
      return u.searchParams.get("v") || (m && m[1]) || null;
    }
  } catch {}
  return null;
}
async function fetchMeta(id) {
  try {
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent("https://www.youtube.com/watch?v=" + id)}`);
    if (!r.ok) throw 0;
    const j = await r.json();
    return { title: j.title, channel: j.author_name };
  } catch { return { title: id, channel: "" }; }
}
function openAddDialog(prefill = "") {
  const opts = [`<option value="">フォルダなし</option>`].concat(data.folders.map((f) =>
    `<option value="${f.id}">${esc((f.parent ? (data.folders.find((p) => p.id === f.parent)?.name + " / ") : "") + f.name)}</option>`));
  $("add-folder-sel").innerHTML = opts.join("");
  if (!SYS(cur)) $("add-folder-sel").value = cur;
  $("add-urls").value = typeof prefill === "string" ? prefill : "";
  $("add-dialog").showModal();
  $("add-urls").focus();
}
$("add-video").onclick = () => openAddDialog();
$("add-cancel").onclick = () => $("add-dialog").close();
$("add-form").onsubmit = async (e) => {
  e.preventDefault();
  const lines = $("add-urls").value.split(/\s+/).filter(Boolean);
  const ids = [...new Set(lines.map(videoIdFrom))];
  const valid = ids.filter(Boolean), bad = lines.length - valid.length;
  if (!valid.length) { toast("動画URLを認識できませんでした"); return; }
  $("add-submit").disabled = true;
  const folder = $("add-folder-sel").value;
  const metas = await Promise.all(valid.map((id) => (data.videos[id] ? null : fetchMeta(id))));
  let added = 0, moved = 0;
  valid.forEach((id, i) => {
    const v = data.videos[id];
    if (v) { if (folder && !v.folders.includes(folder)) { v.folders.push(folder); moved++; } return; }
    data.videos[id] = { ...metas[i], folders: folder ? [folder] : [], tags: [], savedAt: new Date().toISOString() };
    added++;
  });
  await save();
  $("add-submit").disabled = false;
  $("add-dialog").close();
  render();
  toast(`${added}件を登録${moved ? `、${moved}件を既存から追加` : ""}${bad ? `(認識できない${bad}件はスキップ)` : ""}`);
};

$("add-folder").onclick = async () => {
  const name = prompt("新しいフォルダ名")?.trim();
  if (!name) return;
  const colors = ["#f59e0b", "#3b82f6", "#ec4899", "#10b981", "#8b5cf6", "#ef4444", "#14b8a6"];
  data.folders.push({ id: "f" + Date.now().toString(36), name, color: colors[data.folders.length % colors.length] });
  await save(); render(); toast(`「${name}」を作成しました`);
};

/* ---------- ドラッグ&ドロップ ---------- */
const clearMarks = () => $("folders").querySelectorAll(".drop-target,.drop-before,.drop-after").forEach((x) => x.classList.remove("drop-target", "drop-before", "drop-after"));

// 動画カードを掴む
$("list").addEventListener("dragstart", (e) => {
  const c = e.target.closest(".card"); if (!c) return;
  drag = { type: "video", id: c.dataset.id };
  e.dataTransfer.effectAllowed = "copyMove"; e.dataTransfer.setData("text/plain", c.dataset.id);
  c.classList.add("dragging");
});
// フォルダを掴む(並べ替え)
$("folders").addEventListener("dragstart", (e) => {
  const b = e.target.closest('[draggable="true"]'); if (!b) return;
  drag = { type: "folder", id: b.dataset.f };
  e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", b.dataset.f);
  b.classList.add("dragging");
});
document.addEventListener("dragend", () => {
  drag = null; clearMarks();
  document.querySelectorAll(".dragging").forEach((x) => x.classList.remove("dragging"));
});
// フォルダのドロップ位置: 上端=前 / 下端=後 / 中央=サブフォルダにする(1階層まで)
function folderZone(b, e) {
  const t = data.folders.find((x) => x.id === b.dataset.f), mv = data.folders.find((x) => x.id === drag.id);
  if (!t || !mv || t.id === mv.id) return null;
  const hasKids = kids(mv.id).length > 0;
  if (t.parent && hasKids) return null; // 親フォルダは子の間に入れない
  const r = b.getBoundingClientRect(), y = (e.clientY - r.top) / r.height;
  const canInto = !t.parent && !hasKids;
  if (canInto && y >= 0.28 && y <= 0.72) return "into";
  return y < 0.5 ? "before" : "after";
}
$("folders").addEventListener("dragover", (e) => {
  if (!drag) return;
  const b = e.target.closest("[data-f]");
  clearMarks();
  if (!b) return;
  if (drag.type === "video" && !SYS(b.dataset.f)) {
    e.preventDefault(); e.dataTransfer.dropEffect = "copy"; b.classList.add("drop-target");
  } else if (drag.type === "folder" && !SYS(b.dataset.f)) {
    const z = folderZone(b, e);
    if (!z) return;
    e.preventDefault(); e.dataTransfer.dropEffect = "move";
    b.classList.add(z === "into" ? "drop-target" : "drop-" + z);
  }
});
$("folders").addEventListener("drop", async (e) => {
  if (!drag) return;
  const b = e.target.closest("[data-f]"); if (!b) return;
  e.preventDefault();
  if (drag.type === "video" && !SYS(b.dataset.f)) {
    const v = data.videos[drag.id], f = data.folders.find((x) => x.id === b.dataset.f);
    if (v && f && !v.folders.includes(f.id)) { v.folders.push(f.id); await save(); toast(`「${f.name}」に追加しました`); }
    else if (f) toast(`すでに「${f.name}」に入っています`);
  } else if (drag.type === "folder" && !SYS(b.dataset.f)) {
    const z = folderZone(b, e);
    if (z) {
      const moving = data.folders.find((x) => x.id === drag.id), target = data.folders.find((x) => x.id === b.dataset.f);
      if (z === "into") {
        moving.parent = target.id;
        expanded.add(target.id); saveExpanded();
        toast(`「${target.name}」のサブフォルダにしました`);
      } else {
        if (target.parent) moving.parent = target.parent; else delete moving.parent;
        data.folders = data.folders.filter((x) => x !== moving);
        const i = data.folders.findIndex((x) => x.id === target.id);
        data.folders.splice(z === "after" ? i + 1 : i, 0, moving);
      }
      await save();
    }
  }
  drag = null; clearMarks(); render();
});

/* ---------- パネルのサイズ変更・折りたたみ ---------- */
function setupResizer(handle, varName, min, max, fromRight) {
  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault(); handle.setPointerCapture(e.pointerId);
    document.body.classList.add("resizing");
    const panel = handle.parentElement, startX = e.clientX, startW = panel.getBoundingClientRect().width;
    const move = (ev) => {
      const dx = ev.clientX - startX;
      const w = Math.max(min, Math.min(max, startW + (fromRight ? -dx : dx)));
      document.documentElement.style.setProperty(varName, w + "px");
    };
    const up = () => {
      document.body.classList.remove("resizing");
      handle.removeEventListener("pointermove", move); handle.removeEventListener("pointerup", up);
      ls.set("tf" + varName, document.documentElement.style.getPropertyValue(varName));
    };
    handle.addEventListener("pointermove", move); handle.addEventListener("pointerup", up);
  });
}
setupResizer($("rs-side"), "--side-w", 180, 400, false);
setupResizer($("rs-detail"), "--detail-w", 320, 760, true);
for (const v of ["--side-w", "--detail-w"]) { const s = ls.get("tf" + v, ""); if (s) document.documentElement.style.setProperty(v, s); }

function applyCollapsed(on) { document.body.classList.toggle("collapsed", on); ls.set("tf-collapsed", on ? "1" : "0"); }
$("collapse").onclick = () => applyCollapsed(!document.body.classList.contains("collapsed"));
applyCollapsed(ls.get("tf-collapsed", "0") === "1");

/* ---------- テーマ: auto → light → dark ---------- */
const THEMES = ["auto", "light", "dark"], LABEL = { auto: "🌓 自動", light: "☀ ライト", dark: "🌙 ダーク" };
let theme = ls.get("tf-theme", "auto");
function applyTheme() {
  if (theme === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.dataset.theme = theme;
  $("theme").textContent = LABEL[theme];
}
$("theme").onclick = () => { theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]; ls.set("tf-theme", theme); applyTheme(); };
applyTheme();

/* ---------- 起動 ---------- */
chrome.storage.local.get(KEY).then((r) => { if (r[KEY]) data = r[KEY]; render(); });
chrome.storage.onChanged.addListener((c) => { if (c[KEY]) { data = c[KEY].newValue; render(); } });

/* ---------- 再生リスト(APIを使わない方式) ---------- */
const PL_KINDS = { own: "作成した", saved: "保存した", manual: "URLで追加" };
let plTab = ls.get("tf-pl-tab", "all");
const kindOf = (p) => p.kind || "manual";
function renderPlaylists(q) {
  const all = pls();
  const tabs = `<div class="pl-tabs">${[["all", "すべて"], ...Object.entries(PL_KINDS)].map(([k, l]) =>
    `<button class="tab ${plTab === k ? "on" : ""}" data-pltab="${k}">${l}<span>${k === "all" ? all.length : all.filter((p) => kindOf(p) === k).length}</span></button>`).join("")}</div>`;
  const items = all.filter((p) => (plTab === "all" || kindOf(p) === plTab) && (!q || (p.title + " " + p.channel).toLowerCase().includes(q)));
  const bar = `<div class="pl-bar"><button class="chip accent" data-act="pl-add">＋ 再生リストを追加</button><button class="chip" data-act="pl-import" title="YouTubeにログイン中のブラウザから自分の再生リストを読み込みます">今すぐ更新</button></div>`;
  const last = +ls.get("tf-pl-sync", "0");
  const info = last ? `<span class="sync-info">最終更新 ${new Date(last).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>` : "";
  if (!items.length) return bar.replace("</div>", info + "</div>") + tabs + `<div class="empty">再生リストがありません。URLを貼って追加するか、YouTubeから読み込んでください。</div>`;
  return bar.replace("</div>", info + "</div>") + tabs + `<div class="grid">` + items.map((p) => `
    <div class="card ${p.id === selPl ? "on" : ""}" data-pl="${esc(p.id)}">
      <button class="card-del" data-delpl="${esc(p.id)}" title="削除" aria-label="削除">✕</button>
      ${p.thumb ? `<img loading="lazy" src="${esc(p.thumb)}" alt="">` : `<img alt="" src="icons/icon-128.png" style="object-fit:contain;padding:18px">`}
      <div><b>${esc(p.title)}</b><small>${esc(p.channel || PL_KINDS[kindOf(p)])}</small></div>
    </div>`).join("") + `</div>`;
}

// 再生用のURL。「作成した」リストは非公開のことが多く、リスト自体は埋め込めない。
// そのため中の動画IDを並べて再生する(動画自体が公開・限定公開なら再生できる)。
let plNeedsPlayer = null;
let nowPlaying = null; // { plId, idx }: 「作成した」リストで再生中の位置
function embedSrc(p, i = 0, auto = false) {
  const items = p.items || [];
  if (kindOf(p) === "own" && items.length)
    return `https://www.youtube.com/embed/${items[i].id}?rel=0&autoplay=${auto ? 1 : 0}&enablejsapi=1`;
  return `https://www.youtube.com/embed/videoseries?list=${encodeURIComponent(p.id)}&autoplay=${auto ? 1 : 0}&enablejsapi=1`;
}
// 「作成した」リストはリスト自体が非公開で埋め込めないことが多いので、動画を1本ずつ再生し、終わったら次へ進む
function playIndex(p, i, auto) {
  const v = p.items[i];
  nowPlaying = { plId: p.id, idx: i };
  $("player").src = embedSrc(p, i, auto);
  $("d-meta").textContent = `再生中 (${i + 1}/${p.items.length}): ${v.title}`;
  document.querySelectorAll(".pl-row").forEach((r) => r.classList.toggle("playing", r.dataset.vid === v.id));
}
/* ---------- 埋め込みプレイヤーとのやりとり ---------- */
// プレイヤー(enablejsapi=1)へ購読を依頼し、イベントを受け取る。読み込み直後は応答しないことがあるので、
// 公式のIFrame APIと同じく応答が来るまで繰り返し依頼する。
const playerSubs = new Map(); // iframe -> handler
function listenPlayer(frame, handler) {
  let timer = null, got = false;
  const ping = () => { try { frame.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: 1, channel: "widget" }), "*"); } catch {} };
  const start = () => { // 読み込みのたびに、応答が来るまで(最大10秒)購読を依頼し直す
    clearInterval(timer); got = false; let n = 0;
    timer = setInterval(() => { if (got || ++n > 40 || !frame.isConnected) return clearInterval(timer); ping(); }, 250);
  };
  frame.addEventListener("load", start);
  playerSubs.set(frame, (m) => { got = true; handler(m); });
  start();
}
addEventListener("message", (e) => {
  for (const [frame, h] of playerSubs) {
    if (!frame.isConnected) { playerSubs.delete(frame); continue; }
    if (e.source !== frame.contentWindow) continue;
    let m; try { m = typeof e.data === "string" ? JSON.parse(e.data) : e.data; } catch { return; }
    if (m && typeof m === "object") h(m);
    return;
  }
});

// 101/150: 所有者が埋め込みを禁止 / 152,153: 埋め込み元の制限
const EMBED_ERRS = new Set([101, 150, 152, 153]);
const NE_BADGE = `<span class="ne-badge" title="所有者が他のサイトでの再生を許可していないため、YouTubeでのみ再生できます">埋め込み不可</span>`;
// 埋め込み不可と分かった動画を覚えておく(次からはプレビューを試さず、一覧に印を付ける)
const noEmbed = new Set((() => { try { return JSON.parse(ls.get("tf-noembed", "[]")); } catch { return []; } })());
function markNoEmbed(id) {
  if (!id || noEmbed.has(id)) return;
  noEmbed.add(id);
  ls.set("tf-noembed", JSON.stringify([...noEmbed].slice(-500)));
  document.querySelectorAll(`.pl-row[data-vid="${CSS.escape(id)}"] .thumb`).forEach((t) => { if (!t.querySelector(".ne-badge")) t.insertAdjacentHTML("beforeend", NE_BADGE); });
}

// 右パネルのプレイヤー: 再生終了で次へ(「作成した」リスト)、埋め込み不可なら案内を表示
const playerVid = () => ($("player").src.match(/\/embed\/([\w-]{11})/) || [])[1] || "";
listenPlayer($("player"), (m) => {
  if (m.event === "onError" && EMBED_ERRS.has(+m.info)) return showBlocked();
  if (!nowPlaying) return;
  const ended = (m.event === "onStateChange" && m.info === 0) || (m.event === "infoDelivery" && m.info?.playerState === 0);
  if (!ended) return;
  const p = pls().find((x) => x.id === nowPlaying.plId);
  if (p?.items && nowPlaying.idx + 1 < p.items.length) playIndex(p, nowPlaying.idx + 1, true);
});
function showBlocked() {
  const id = playerVid();
  markNoEmbed(id);
  const box = $("player").parentElement;
  box.querySelector(".player-block")?.remove();
  const href = id ? `https://www.youtube.com/watch?v=${id}` : $("d-open").href;
  box.insertAdjacentHTML("beforeend", `<div class="player-block" ${id ? `style="background-image:url('https://i.ytimg.com/vi/${id}/hqdefault.jpg')"` : ""}>
      <div><b>この動画はYouTubeでのみ再生できます</b><small>動画の所有者が、他のサイトでの再生を許可していません</small>
      <a class="chip accent" href="${esc(href)}" target="_blank" rel="noopener">YouTubeで開く ↗</a></div></div>`);
  // 「作成した」リストを順番に再生中なら、飛ばして次の動画へ
  const p = nowPlaying && pls().find((x) => x.id === nowPlaying.plId);
  if (p?.items && nowPlaying.idx + 1 < p.items.length) {
    const next = nowPlaying.idx + 1;
    toast("埋め込み不可の動画をスキップします");
    setTimeout(() => { if (nowPlaying?.plId === p.id && nowPlaying.idx === next - 1) playIndex(p, next, true); }, 2500);
  }
}
// 別の動画に切り替えたら案内を消し、コメント欄を新しい動画に合わせる
new MutationObserver(() => { $("player").parentElement.querySelector(".player-block")?.remove(); setCommentsVideo(playerVid()); })
  .observe($("player"), { attributes: true, attributeFilter: ["src"] });

/* ---------- コメント(右パネル、APIを使わない方式) ---------- */
// 動画ページの埋め込みデータからコメント欄のトークンを取り出し、YouTubeのページと同じく内部API(next)で取得する
const cmts = { vid: "", cache: {}, loading: false }; // cache[動画ID] = { cfg, list, next, sorts, count, error }
function deepFind(n, key, skip) {
  let r; (function w(x) {
    if (r !== undefined || !x || typeof x !== "object") return;
    if (!Array.isArray(x) && key in x) { r = x[key]; return; }
    for (const [k, v] of Object.entries(x)) if (k !== skip) w(v);
  })(n);
  return r;
}
function walkKey(n, key, fn, skip) {
  (function w(x) {
    if (!x || typeof x !== "object") return;
    if (Array.isArray(x)) return x.forEach(w);
    if (x[key]) fn(x[key]);
    for (const [k, v] of Object.entries(x)) if (k !== skip && k !== key) w(v);
  })(n);
}
function findCommentToken(data) {
  let token = "";
  walkKey(data, "itemSectionRenderer", (s) => { if (!token && s.sectionIdentifier === "comment-item-section") token = deepFind(s, "continuationCommand")?.token || ""; });
  return token;
}
function parseComments(r) {
  const txt = (o) => o?.simpleText || o?.runs?.map((x) => x.text).join("") || o?.content || "";
  const ents = new Map();
  for (const m of r.frameworkUpdates?.entityBatchUpdate?.mutations || []) if (m.payload?.commentEntityPayload) ents.set(m.entityKey, m.payload.commentEntityPayload);
  const list = [];
  // 表示順はスレッドの並びに従う(新形式: commentViewModel → entity / 旧形式: commentRenderer)
  walkKey(r, "commentThreadRenderer", (t) => {
    const vm = t.commentViewModel?.commentViewModel, e = vm && ents.get(vm.commentKey);
    if (e) {
      list.push({ author: e.author?.displayName || "", avatar: e.author?.avatarThumbnailUrl || e.avatar?.image?.sources?.[0]?.url || "",
        text: e.properties?.content?.content || "", time: e.properties?.publishedTime || "", likes: e.toolbar?.likeCountNotliked?.trim() || "",
        replies: +(e.toolbar?.replyCount || 0) || 0, creator: !!e.author?.isCreator, pinned: !!vm.pinnedText });
      return;
    }
    const c = t.comment?.commentRenderer;
    if (c) list.push({ author: txt(c.authorText), avatar: c.authorThumbnail?.thumbnails?.[0]?.url || "", text: txt(c.contentText), time: txt(c.publishedTimeText),
      likes: txt(c.voteCount), replies: +(c.replyCount || 0) || 0, creator: !!c.authorIsChannelOwner, pinned: !!c.pinnedCommentBadge });
  });
  let next = "";
  walkKey(r, "continuationItemRenderer", (c) => { next = deepFind(c, "continuationCommand")?.token || next; }, "commentThreadRenderer"); // 返信の続きは除く
  const sorts = [];
  walkKey(r, "sortFilterSubMenuRenderer", (s) => (s.subMenuItems || []).forEach((it) =>
    sorts.push({ title: it.title, selected: !!it.selected, token: deepFind(it, "continuationCommand")?.token || "" })));
  let count = "";
  walkKey(r, "commentsHeaderRenderer", (h) => { count = count || txt(h.countText); });
  return { list, next, sorts, count };
}

const cmtsOpen = () => $("d-cmts").open;
function setCommentsVideo(vid) {
  if (vid === cmts.vid) return;
  cmts.vid = vid;
  $("d-cmts").hidden = !vid;
  renderComments();
  if (vid && cmtsOpen()) loadComments();
}
async function loadComments(mode = "first", sortToken = "") {
  const vid = cmts.vid; if (!vid || cmts.loading) return;
  let c = cmts.cache[vid];
  if (mode === "first" && c) return renderComments();
  cmts.loading = true; renderComments();
  try {
    if (!c) {
      const { data, html } = await fetchYtData(`https://www.youtube.com/watch?v=${encodeURIComponent(vid)}`, true);
      c = cmts.cache[vid] = { cfg: ytCfgFrom(html), list: [], next: findCommentToken(data), sorts: [], count: "", error: "" };
      if (!c.next || !c.cfg) c.error = "この動画のコメントはオフになっているか、取得できませんでした。";
    }
    if (mode === "sort") { c.list = []; c.next = sortToken; c.sorts.forEach((s) => (s.selected = s.token === sortToken)); }
    if (c.next && c.cfg) {
      const p = parseComments(await ytContinue(c.next, "/youtubei/v1/next", c.cfg));
      c.list.push(...p.list); c.next = p.next;
      if (p.sorts.length && mode === "first") c.sorts = p.sorts; // 並べ替えの選択肢は最初の読み込みのものを使い続ける
      if (p.count) c.count = p.count;
      if (!c.list.length) c.error = "コメントはまだありません。";
    }
  } catch {
    c = cmts.cache[vid] ||= { list: [], sorts: [] };
    c.error = "コメントを読み込めませんでした(ログイン状態やYouTubeの仕様変更が原因かもしれません)。";
  } finally { cmts.loading = false; if (cmts.vid === vid) renderComments(); }
}
// コメント中の「1:23」のような時刻は、押すとその位置へ移動できるようにする
const linkTimes = (s) => esc(s).replace(/(^|[^\d:])((?:\d{1,2}:)?\d{1,2}:\d{2})(?![\d:])/g, (m, pre, t) => `${pre}<a data-seek="${parse(t)}">${t}</a>`);
function renderComments() {
  const body = $("d-cmts-body"), c = cmts.cache[cmts.vid];
  $("d-cmts-n").textContent = c?.count && c.count !== "コメント" ? ` ・ ${c.count}` : "";
  if (!cmts.vid) { body.innerHTML = ""; return; }
  if (!c) { body.innerHTML = cmts.loading ? `<div class="cm-empty">読み込み中…</div>` : ""; return; }
  const sorts = c.sorts?.length > 1 ? `<div class="cm-sorts">${c.sorts.map((s) => `<button class="tab ${s.selected ? "on" : ""}" data-csort="${esc(s.token)}">${esc(s.title)}</button>`).join("")}</div>` : "";
  const items = (c.list || []).map((m) => `
    <div class="cm">
      ${m.avatar ? `<img class="cm-av" loading="lazy" src="${esc(m.avatar)}" alt="">` : `<span class="cm-av"></span>`}
      <div class="cm-main">
        <div class="cm-head">${m.pinned ? `<span class="cm-pin">📌 固定</span>` : ""}<b class="${m.creator ? "cm-owner" : ""}">${esc(m.author)}</b><span>${esc(m.time)}</span></div>
        <div class="cm-text">${linkTimes(m.text)}</div>
        <div class="cm-foot">${m.likes ? `<span>👍 ${esc(m.likes)}</span>` : ""}${m.replies ? `<span>返信 ${m.replies}件</span>` : ""}</div>
      </div>
    </div>`).join("");
  const tail = cmts.loading ? `<div class="cm-empty">読み込み中…</div>`
    : c.error && !c.list?.length ? `<div class="cm-empty">${esc(c.error)}<br><button class="chip" data-creload>もう一度読み込む</button></div>`
    : c.next ? `<button class="chip cm-more" data-cmore>もっと見る</button>` : "";
  body.innerHTML = sorts + items + tail;
}
$("d-cmts").addEventListener("toggle", () => { ls.set("tf-cmts", cmtsOpen() ? "1" : "0"); if (cmtsOpen()) loadComments(); });
$("d-cmts").open = ls.get("tf-cmts", "0") === "1";
$("d-cmts-body").addEventListener("click", (e) => {
  const seek = e.target.closest("[data-seek]");
  if (seek) {
    const post = (func, args = []) => { try { $("player").contentWindow.postMessage(JSON.stringify({ event: "command", func, args }), "*"); } catch {} };
    post("seekTo", [+seek.dataset.seek, true]); post("playVideo");
    return;
  }
  if (e.target.closest("[data-cmore]")) return loadComments("more");
  const s = e.target.closest("[data-csort]");
  if (s && !s.classList.contains("on")) return loadComments("sort", s.dataset.csort);
  if (e.target.closest("[data-creload]")) { delete cmts.cache[cmts.vid]; loadComments(); }
});

function selectPlaylist(id, auto = false) {
  const p = pls().find((x) => x.id === id); if (!p) return;
  selPl = id; sel = null; ytPlaying = null;
  $("detail").classList.remove("yt");
  $("detail").hidden = false; $("detail").classList.add("pl");
  $("d-delete").textContent = "この再生リストを削除";
  $("d-kind").value = kindOf(p);
  $("d-title").textContent = p.title;
  $("d-meta").textContent = `${p.channel || "再生リスト"} ・ 追加: ${new Date(p.addedAt).toLocaleDateString("ja-JP")}`;
  $("d-open").href = `https://www.youtube.com/playlist?list=${id}`;
  if (kindOf(p) === "own" && !p.items?.length && plLoading.has(id)) { plNeedsPlayer = id; $("player").src = "about:blank"; } // 動画一覧の取得を待つ
  else if (kindOf(p) === "own" && p.items?.length) playIndex(p, 0, auto);
  else { nowPlaying = null; $("player").src = embedSrc(p, 0, auto); }
  renderList();
}

async function deletePlaylist(id) {
  const p = pls().find((x) => x.id === id); if (!p) return;
  if (!confirm(`再生リスト「${p.title}」をTubeFolio3から削除しますか?
(YouTube上の再生リストは削除されません)`)) return;
  data.playlists = pls().filter((x) => x.id !== id);
  if (selPl === id) { selPl = null; $("detail").hidden = true; $("player").src = "about:blank"; }
  await save(); render(); toast("削除しました");
}

// URL・IDから再生リストIDを取り出す(動画URLに list= が付いていてもOK)
function playlistIdFrom(s) {
  s = s.trim();
  try { const l = new URL(s).searchParams.get("list"); if (l) return l; } catch {}
  return /^(PL|UU|OL|FL|RD|LL)[w-]{10,}$/.test(s) ? s : null;
}
async function fetchPlMeta(id) {
  try {
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent("https://www.youtube.com/playlist?list=" + id)}`);
    if (!r.ok) throw 0;
    const j = await r.json();
    return { title: j.title, channel: j.author_name, thumb: j.thumbnail_url };
  } catch { return { title: id, channel: "", thumb: "" }; }
}
function openPlDialog() { $("pl-urls").value = ""; $("pl-dialog").showModal(); $("pl-urls").focus(); }
$("pl-cancel").onclick = () => $("pl-dialog").close();
$("pl-form").onsubmit = async (e) => {
  e.preventDefault();
  const lines = $("pl-urls").value.split(/s+/).filter(Boolean);
  const ids = [...new Set(lines.map(playlistIdFrom))].filter(Boolean).filter((id) => !pls().some((p) => p.id === id));
  if (!ids.length) { toast("新しい再生リストURLが見つかりませんでした"); return; }
  $("pl-submit").disabled = true;
  const metas = await Promise.all(ids.map(fetchPlMeta));
  ids.forEach((id, i) => pls().push({ id, ...metas[i], kind: "manual", addedAt: new Date().toISOString() }));
  await save(); $("pl-submit").disabled = false; $("pl-dialog").close(); render();
  toast(`${ids.length}件の再生リストを追加しました`);
};

// 試験的: YouTubeの「再生リスト」ページを、ログイン中のブラウザの権限で読み込んで解析する(非公式・仕様変更で動かなくなる可能性あり)
function collectPlaylists(root) {
  const found = new Map();
  const img = (o) => (JSON.stringify(o).match(/https:\/\/i\.ytimg\.com\/vi\/[^"\\]+/) || [""])[0];
  (function walk(n) {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(walk);
    const lv = n.lockupViewModel;
    if (lv && /PLAYLIST/.test(lv.contentType || "") && lv.contentId)
{
      // 「作成した」リストは公開設定(非公開/公開/限定公開)が表示され、「保存した」他人のリストは作成者名が表示される
      const rows = lv.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows || [];
      const texts = rows.flatMap((r) => (r.metadataParts || []).map((p) => p.text?.content || "")).filter(Boolean);
      const own = texts.some((t) => /^(非公開|公開|限定公開|Private|Public|Unlisted)$/i.test(t.trim()));
      found.set(lv.contentId, { title: lv.metadata?.lockupMetadataViewModel?.title?.content || lv.contentId, thumb: img(lv), kind: own ? "own" : "saved", channel: own ? "" : (texts[0] || "") });
    }
    for (const k of ["gridPlaylistRenderer", "playlistRenderer"]) {
      const r = n[k];
      if (r?.playlistId) found.set(r.playlistId, { title: r.title?.simpleText || r.title?.runs?.[0]?.text || r.playlistId, thumb: r.thumbnail?.thumbnails?.[0]?.url || img(r), kind: "own", channel: "" });
    }
    Object.values(n).forEach(walk);
  })(root);
  found.delete("WL"); found.delete("LL");
  return found;
}
async function importFromYouTube(silent = false) {
  if (!silent) toast("YouTubeから読み込み中…");
  try {
    const html = await (await fetch("https://www.youtube.com/feed/playlists", { credentials: "include" })).text();
    const start = html.indexOf("ytInitialData = ");
    const end = html.indexOf(";</script>", start);
    if (start < 0 || end < 0) throw new Error("data");
    const found = collectPlaylists(JSON.parse(html.slice(start + 16, end)));
    if (!found.size) { if (!silent) toast("再生リストが見つかりません。YouTubeにログインしているか確認してください"); return; }
    let added = 0;
    for (const [id, m] of found) {
      const ex = pls().find((p) => p.id === id);
      if (ex) { if (m.thumb) ex.thumb = m.thumb; if (m.title && m.title !== id) ex.title = m.title; if (!ex.kindLocked) ex.kind = m.kind; if (m.channel) ex.channel = m.channel; }
      else { pls().push({ id, title: m.title, channel: m.channel, thumb: m.thumb, kind: m.kind, addedAt: new Date().toISOString() }); added++; }
    }
    pls().forEach((p) => { if (!p.kind) p.kind = "manual"; });
    ls.set("tf-pl-sync", String(Date.now()));
    await save(); render();
    toast(added ? `${added}件の再生リストを取り込みました` : "再生リストは最新です");
  } catch { if (!silent) toast("読み込めませんでした(ログイン状態やYouTubeの仕様変更が原因かもしれません)"); }
}
// 再生リストを開いたとき、前回から10分以上たっていれば自動で取り込む
function autoSyncPlaylists() {
  if (Date.now() - +ls.get("tf-pl-sync", "0") > 10 * 60 * 1000 || pls().some((p) => !p.kind)) importFromYouTube(true);
}

$("d-kind").onchange = async () => {
  const p = pls().find((x) => x.id === selPl); if (!p) return;
  p.kind = $("d-kind").value; p.kindLocked = true; // 手動で変えた分類は、自動取り込みで上書きしない
  await save(); render();
};

/* ---------- 再生リストの中身(動画一覧) ---------- */
const fmtAgo = (t) => new Date(t).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

function renderPlDetail() {
  const p = pls().find((x) => x.id === openPl);
  if (!p) { openPl = null; return renderPlaylists(""); }
  const items = p.items || [];
  const head = `<div class="pl-head">
      <button class="chip" data-back>← 再生リスト</button>
      <div class="pl-head-title"><b>${esc(p.title)}</b><small>${esc(p.channel || PL_KINDS[kindOf(p)])} ・ ${items.length}本${items.length >= 100 ? "(先頭100本まで)" : ""}</small></div>
      <button class="chip accent" data-playall>▶ 全部再生</button>
      <button class="chip" data-reload title="YouTubeから最新の内容を読み込み直します">更新</button>
    </div>`;
  if (plLoading.has(p.id) && !items.length) return head + `<div class="empty">読み込み中…</div>`;
  if (!items.length) return head + `<div class="empty">動画を読み込めていません。YouTubeにログインしているか確認して「更新」を押してください。</div>`;
  return head + viewBar() + `<div class="${rowsCls()}">` + items.map((v, i) => `
    <div class="pl-row ${nowPlaying?.plId === p.id && nowPlaying.idx === i ? "playing" : ""}" data-vid="${esc(v.id)}">
      <span class="idx">${i + 1}</span>
      ${thumbHtml(v)}
      <div class="meta"><b>${esc(v.title)}</b><small>${esc(v.channel)}</small></div>
      <span class="dur">${esc(v.duration || "")}</span>
      <button class="chip" data-savevid="${esc(v.id)}" title="ライブラリに保存">📁 保存</button>
    </div>`).join("") + `</div>`;
}

function openPlaylist(id) {
  const p = pls().find((x) => x.id === id); if (!p) return;
  openPl = id;
  if (!p.items || p.itemsV !== 2 || Date.now() - (p.itemsAt || 0) > 10 * 60 * 1000) loadPlItems(p, true);
  selectPlaylist(id); // 右のパネルで再生リスト全体を再生できる状態にする(中で一覧も描画)
}

function playInPlaylist(vid) {
  const p = pls().find((x) => x.id === openPl); if (!p) return;
  const v = (p.items || []).find((x) => x.id === vid);
  const i = (p.items || []).findIndex((x) => x.id === vid);
  $("detail").hidden = false;
  if (kindOf(p) === "own" && i >= 0) return playIndex(p, i, true);
  nowPlaying = null;
  $("player").src = `https://www.youtube.com/embed/${vid}?list=${encodeURIComponent(p.id)}&autoplay=1&rel=0&enablejsapi=1`;
  if (v) $("d-meta").textContent = `再生中: ${v.title}`;
}

async function saveVideoFromPl(vid) {
  const p = pls().find((x) => x.id === openPl);
  const v = p?.items?.find((x) => x.id === vid);
  if (data.videos[vid]) return toast("すでにライブラリにあります");
  data.videos[vid] = { title: v?.title || vid, channel: v?.channel || "", folders: [], tags: [], savedAt: new Date().toISOString() };
  await save(); toast("ライブラリに保存しました");
}

// YouTubeの再生リストページを読み込み、動画の一覧を取り出す(非公式・ログイン中のブラウザの権限を使用)
function collectPlItems(root) {
  const out = new Map();
  const txt = (o) => o?.simpleText || o?.runs?.map((r) => r.text).join("") || "";
  (function walk(n) {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(walk);
    const r = n.playlistVideoRenderer;
    if (r?.videoId) out.set(r.videoId, { id: r.videoId, title: txt(r.title), channel: txt(r.shortBylineText), duration: txt(r.lengthText) });
    const lv = n.lockupViewModel;
    if (lv && /VIDEO/.test(lv.contentType || "") && lv.contentId && !out.has(lv.contentId))
      out.set(lv.contentId, { id: lv.contentId, title: lv.metadata?.lockupMetadataViewModel?.title?.content || lv.contentId, channel: "", duration: "" });
    Object.values(n).forEach(walk);
  })(root);
  return [...out.values()];
}
async function loadPlItems(p, silent) {
  if (plLoading.has(p.id)) return;
  plLoading.add(p.id); if (openPl === p.id) renderList();
  try {
    const html = await (await fetch(`https://www.youtube.com/playlist?list=${encodeURIComponent(p.id)}`, { credentials: "include" })).text();
    const start = html.indexOf("ytInitialData = "), end = html.indexOf(";</script>", start);
    if (start < 0 || end < 0) throw new Error("data");
    const items = collectPlItems(JSON.parse(html.slice(start + 16, end)));
    if (!items.length && !silent) toast("動画が見つかりませんでした");
    if (items.length) { p.items = items; p.itemsAt = Date.now(); p.itemsV = 2; await save(); }
  } catch { if (!silent) toast("読み込めませんでした(ログイン状態やYouTubeの仕様変更が原因かもしれません)"); }
  finally {
    plLoading.delete(p.id);
    if (plNeedsPlayer === p.id) { plNeedsPlayer = null; if (selPl === p.id) { if (kindOf(p) === "own" && p.items?.length) playIndex(p, 0, false); else $("player").src = embedSrc(p, 0, false); } }
    if (openPl === p.id) renderList();
  }
}

/* ---------- 右パネルを閉じる(再生も停止) ---------- */
$("d-close").onclick = () => {
  sel = null; selPl = null; plNeedsPlayer = null; nowPlaying = null; ytPlaying = null;
  $("player").src = "about:blank"; // プレイヤーを破棄して再生を止める
  $("detail").hidden = true;
  renderList(); // 一覧の選択表示を解除
};

/* ---------- ホバープレビュー(埋め込みの無音再生) ---------- */
let prevMode = ls.get("tf-prev", "B") === "off" ? "off" : "B";
// 動画一覧の表示形式: "list"(1行ずつ) / "grid"(YouTubeのような大きいサムネイルの一覧)
let rowView = ls.get("tf-view", "list") === "grid" ? "grid" : "list";
const rowsCls = () => "pl-rows" + (rowView === "grid" ? " as-grid" : "");
const thumbHtml = (v) => `<div class="thumb"><img loading="lazy" src="https://i.ytimg.com/vi/${esc(v.id)}/mqdefault.jpg" alt="">${v.duration ? `<span class="dur-badge">${esc(v.duration)}</span>` : ""}${noEmbed.has(v.id) ? NE_BADGE : ""}</div>`;
const viewBar = () => `<div class="pl-prev">
    <span class="seg" role="group" aria-label="表示形式"><button class="tab ${rowView === "list" ? "on" : ""}" data-view="list" title="リスト表示">☰ リスト</button><button class="tab ${rowView === "grid" ? "on" : ""}" data-view="grid" title="YouTubeのような一覧表示">▦ 一覧</button></span>
    <span class="sep"></span>
    <span>ホバープレビュー:</span><button class="tab ${prevMode === "B" ? "on" : ""}" data-prev="${prevMode === "B" ? "off" : "B"}">${prevMode === "B" ? "オン" : "オフ"}</button></div>`;
let pvTimer = null, pvEl = null, pvRow = null;
function hidePreview() { clearTimeout(pvTimer); pvEl?.remove(); pvEl = null; pvRow = null; }
const toSec = (d) => (d || "").split(":").reduce((a, x) => a * 60 + (+x || 0), 0);
// 埋め込み不可の動画: YouTubeのホバー用アニメーションがあればそれを、なければ静止サムネイルを出す
function showPreviewFallback(box, v) {
  const src = v.anim || `https://i.ytimg.com/vi/${encodeURIComponent(v.id)}/hqdefault.jpg`;
  box.innerHTML = `<img src="${esc(src)}" alt=""><span class="pv-note">${v.anim ? "埋め込み不可のため短いプレビューを表示中" : "埋め込み不可のためプレビューできません"}</span>`;
}

function showPreview(row) {
  const v = isYtList() ? ytList()?.find((x) => x.id === row.dataset.vid) : pls().find((x) => x.id === openPl)?.items?.find((x) => x.id === row.dataset.vid);
  if (!v) return;
  const box = document.createElement("div");
  box.className = "pv-pop";
  const start = Math.floor(toSec(v.duration) * 0.3); // イントロを飛ばして動画の30%付近から
  if (noEmbed.has(v.id)) showPreviewFallback(box, v);
  else {
    box.innerHTML = `<iframe src="https://www.youtube.com/embed/${encodeURIComponent(v.id)}?autoplay=1&mute=1&controls=0&disablekb=1&playsinline=1&rel=0&modestbranding=1&enablejsapi=1&start=${start}" allow="autoplay; encrypted-media"></iframe>`;
    // 埋め込みが禁止されている動画はプレイヤーがエラーを返すので、その場で代わりの表示に切り替える
    listenPlayer(box.querySelector("iframe"), (m) => {
      if (m.event === "onError" && EMBED_ERRS.has(+m.info)) { markNoEmbed(v.id); if (pvEl === box) showPreviewFallback(box, v); }
    });
  }
  const t = row.querySelector(".thumb").getBoundingClientRect();
  if (rowView === "grid") {
    // 一覧表示ではYouTubeと同じくサムネイルの上でそのまま再生する
    Object.assign(box.style, { left: t.left + "px", top: t.top + "px", width: t.width + "px", height: t.height + "px" });
  } else {
    box.style.left = Math.max(8, Math.min(t.right + 12, innerWidth - 336)) + "px";
    box.style.top = Math.max(8, Math.min(t.top + t.height / 2 - 90, innerHeight - 190)) + "px";
  }
  document.body.append(box);
  pvEl = box;
}
$("list").addEventListener("mouseover", (e) => {
  const row = e.target.closest(".pl-row");
  if (!row || prevMode === "off" || row === pvRow) return;
  hidePreview(); pvRow = row;
  pvTimer = setTimeout(() => showPreview(row), 200);
});
$("list").addEventListener("mouseout", (e) => {
  if (pvRow && e.relatedTarget?.closest?.(".pl-row") !== pvRow) hidePreview();
});
$("list").addEventListener("scroll", hidePreview);

/* ---------- YouTube検索(APIを使わない方式) ---------- */
let qmode = ls.get("tf-qmode", "lib"); // "lib": ライブラリ内を絞り込み / "yt": YouTubeを検索
let ytq = "", ytResults = null, ytLoading = false, ytError = "", ytPlaying = null;

function applyQmode() {
  $("q-mode").textContent = qmode === "yt" ? "YouTube" : "ライブラリ";
  $("q-mode").classList.toggle("accent", qmode === "yt");
  $("q").placeholder = qmode === "yt" ? "YouTubeを検索(Enterで検索)" : "タイトル・チャンネル・タグで検索";
}
$("q-mode").onclick = () => {
  qmode = qmode === "yt" ? "lib" : "yt"; ls.set("tf-qmode", qmode); applyQmode();
  if (qmode === "lib" && cur === "search") { cur = "home"; hidePreview(); render(); }
};
$("q").addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || qmode !== "yt" || e.isComposing) return; // 日本語入力の変換確定のEnterは無視
  const q = $("q").value.trim(); if (q) searchYouTube(q);
});
applyQmode();

// YouTubeのページ(検索結果・ホームのおすすめ)から動画を取り出す。
// 旧形式(videoRenderer)と新形式(lockupViewModel)の両方に対応。広告とショートは除外する。
function collectYtVideos(root) {
  const out = new Map();
  const txt = (o) => o?.simpleText || o?.runs?.map((r) => r.text).join("") || "";
  const badge = (lv) => {
    let t = "";
    (function w(n) {
      if (t || !n || typeof n !== "object") return;
      if (n.thumbnailBadgeViewModel?.text) { t = n.thumbnailBadgeViewModel.text; return; }
      Object.values(n).forEach(w);
    })(lv.contentImage);
    return t;
  };
  (function walk(n) {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(walk);
    const r = n.videoRenderer;
    if (r?.videoId && !out.has(r.videoId))
      out.set(r.videoId, { id: r.videoId, title: txt(r.title), channel: txt(r.ownerText) || txt(r.longBylineText), duration: txt(r.lengthText) || (r.badges ? "LIVE" : ""), views: txt(r.viewCountText), published: txt(r.publishedTimeText) });
    const lv = n.lockupViewModel;
    if (lv && /VIDEO/.test(lv.contentType || "") && lv.contentId && !out.has(lv.contentId)) {
      const md = lv.metadata?.lockupMetadataViewModel;
      const rows = md?.metadata?.contentMetadataViewModel?.metadataRows || [];
      const parts = (i) => (rows[i]?.metadataParts || []).map((p) => p.text?.content || "").filter(Boolean);
      const [views = "", published = ""] = parts(1);
      // anim: YouTubeがサムネイルのホバー時に流す数秒のアニメーション(埋め込み不可の動画のプレビューに使う)
      let anim = ""; (function w(x) { if (anim || !x || typeof x !== "object") return; const s = x.animatedThumbnailOverlayViewModel?.thumbnail?.sources; if (s?.length) { anim = s[s.length - 1].url; return; } Object.values(x).forEach(w); })(lv.contentImage);
      out.set(lv.contentId, { id: lv.contentId, title: md?.title?.content || lv.contentId, channel: parts(0).join(" "), duration: badge(lv), views, published, anim });
    }
    for (const [k, v] of Object.entries(n)) if (!/^ad|Ad[A-Z]|^promoted/.test(k)) walk(v);
  })(root);
  return [...out.values()];
}
// ログイン中のブラウザの権限でYouTubeのページを読み込み、埋め込みデータ(ytInitialData)を取り出す
async function fetchYtData(url, withHtml = false) {
  const html = await (await fetch(url, { credentials: "include" })).text();
  const start = html.indexOf("ytInitialData = "), end = html.indexOf(";</script>", start);
  if (start < 0 || end < 0) throw new Error("data");
  const data = JSON.parse(html.slice(start + 16, end));
  return withHtml ? { data, html } : data;
}
async function searchYouTube(q) {
  ytq = q; ytLoading = true; ytError = ""; ytResults = null; cur = "search"; openPl = null; hidePreview(); render();
  try {
    const res = collectYtVideos(await fetchYtData(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=EgIQAQ%253D%253D`));
    if (ytq === q) ytResults = res;
  } catch { if (ytq === q) ytError = "検索結果を取得できませんでした(ネットワークやYouTubeの仕様変更が原因かもしれません)"; }
  finally { if (ytq === q) { ytLoading = false; if (cur === "search") renderList(); } }
}

function renderSearch() {
  const head = `<div class="pl-head"><div class="pl-head-title"><b>「${esc(ytq)}」のYouTube検索結果</b><small>${ytLoading ? "検索中…" : ytResults ? `${ytResults.length}件(動画のみ・先頭の約20件)` : ""}</small></div></div>` + viewBar();
  if (ytLoading) return head + `<div class="empty">検索中…</div>`;
  if (ytError) return head + `<div class="empty">${esc(ytError)}</div>`;
  if (!ytResults?.length) return head + `<div class="empty">見つかりませんでした</div>`;
  return head + ytRowsHtml(ytResults);
}

const ytRowsHtml = (list) => `<div class="${rowsCls()}">` + list.map((v, i) => `
    <div class="pl-row ${ytPlaying === v.id ? "playing" : ""}" data-vid="${esc(v.id)}">
      <span class="idx">${i + 1}</span>
      ${thumbHtml(v)}
      <div class="meta"><b>${esc(v.title)}</b><small>${esc([v.channel, v.views, v.published].filter(Boolean).join(" ・ "))}</small></div>
      <span class="dur">${esc(v.duration)}</span>
      <button class="chip" data-ytsave="${esc(v.id)}">${data.videos[v.id] ? "✓ 保存済み" : "📁 保存"}</button>
    </div>`).join("") + `</div>`;

/* ---------- YouTubeのおすすめ(ホームフィード、APIを使わない方式) ---------- */
// chips: YouTubeのホーム上部のカテゴリ(すべて・音楽・ニュースなど)。byChip: カテゴリごとに取得した動画のキャッシュ
let recs = { items: null, loading: false, error: "", at: 0, chips: [], chip: 0, byChip: {}, cfg: null };
const ytList = () => (cur === "recs" ? recs.items : ytResults);
const NO_RECS = "おすすめを取得できませんでした。YouTubeにログインしているか、YouTubeの「再生履歴」がオンになっているか確認してください(履歴がオフだとおすすめは表示されません)。";

async function loadRecs() {
  if (recs.loading) return;
  recs.loading = true; recs.error = "";
  if (cur === "recs") renderList();
  try {
    const { data: d, html } = await fetchYtData("https://www.youtube.com/", true);
    const items = collectYtVideos(d);
    recs.cfg = ytCfgFrom(html);
    recs.chips = collectChips(d);
    recs.chip = Math.max(0, recs.chips.findIndex((c) => c.selected));
    recs.byChip = { [recs.chip]: items };
    recs.items = items; recs.at = Date.now();
    if (!items.length) recs.error = NO_RECS;
  } catch { recs.error = "おすすめを読み込めませんでした(ログイン状態やYouTubeの仕様変更が原因かもしれません)"; }
  finally { recs.loading = false; if (cur === "recs") renderList(); }
}

// カテゴリを切り替える。YouTubeのページがタブを押したときと同じく、内部API(youtubei)に続きのトークンを送って取得する
async function selectChip(i) {
  const c = recs.chips[i]; if (!c || recs.loading) return;
  recs.chip = i; recs.error = ""; hidePreview();
  if (recs.byChip[i]) { recs.items = recs.byChip[i]; renderList(); return; }
  if (!c.token || !recs.cfg) { recs.items = []; recs.error = "このカテゴリは読み込めませんでした。「更新」を押してからもう一度お試しください。"; renderList(); return; }
  recs.loading = true; recs.items = null; renderList();
  try {
    const items = collectYtVideos(await ytContinue(c.token, c.apiUrl));
    if (recs.chip !== i) return;
    recs.byChip[i] = items; recs.items = items;
    if (!items.length) recs.error = `「${c.title}」の動画が見つかりませんでした。`;
  } catch {
    if (recs.chip === i) { recs.items = []; recs.error = "このカテゴリを読み込めませんでした(ログイン状態やYouTubeの仕様変更が原因かもしれません)。「更新」を押してからもう一度お試しください。"; }
  } finally { recs.loading = false; if (cur === "recs") renderList(); }
}

// ホーム上部のカテゴリ(チップ)を取り出す。新形式(chipViewModel)と旧形式(chipCloudChipRenderer)に対応
function collectChips(root) {
  const out = [], seen = new Set();
  const find = (n, key) => {
    let r; (function w(x) {
      if (r !== undefined || !x || typeof x !== "object") return;
      if (key in x && !Array.isArray(x)) { r = x[key]; return; }
      Object.values(x).forEach(w);
    })(n);
    return r;
  };
  const add = (title, selected, chip) => {
    title = (title || "").trim();
    if (!title || seen.has(title)) return;
    const token = find(chip, "continuationCommand")?.token;
    if (!token && !selected) return; // 切り替えできないチップ(フィードとは別の操作)は除外
    seen.add(title);
    out.push({ title, selected: !!selected, token: token || "", apiUrl: find(chip, "webCommandMetadata")?.apiUrl || "/youtubei/v1/browse" });
  };
  (function walk(n) {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(walk);
    if (n.chipViewModel) add(n.chipViewModel.text, n.chipViewModel.selected, n.chipViewModel);
    const r = n.chipCloudChipRenderer;
    if (r) add(r.text?.simpleText || r.text?.runs?.map((x) => x.text).join(""), r.isSelected, r);
    Object.values(n).forEach(walk);
  })(root);
  return out;
}

// ページに埋め込まれた ytcfg から、内部APIに必要なクライアント情報を取り出す
function jsonAfter(str, key) {
  let i = str.indexOf(key); if (i < 0) return null;
  i = str.indexOf("{", i + key.length);
  let depth = 0, inStr = false;
  for (let j = i; j < str.length; j++) {
    const ch = str[j];
    if (inStr) { if (ch === "\\") j++; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) { try { return JSON.parse(str.slice(i, j + 1)); } catch { return null; } }
  }
  return null;
}
function ytCfgFrom(html) {
  const context = jsonAfter(html, '"INNERTUBE_CONTEXT":');
  const version = (html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/) || [])[1] || context?.client?.clientVersion || "";
  return context ? { context, version } : null;
}

// ログイン中のアカウントとしてリクエストするための認証ヘッダー(youtube.com 自身が付けているものと同じ形式)
async function sha1hex(s) {
  const b = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
async function ytAuthHeader() {
  if (!chrome.cookies?.get) return "";
  const get = async (name) => (await chrome.cookies.get({ url: "https://www.youtube.com", name }).catch(() => null))?.value || "";
  const sid = (await get("SAPISID")) || (await get("__Secure-3PAPISID"));
  if (!sid) return "";
  const ts = Math.floor(Date.now() / 1000), origin = "https://www.youtube.com";
  const part = async (label, v) => `${label} ${ts}_${await sha1hex(`${ts} ${v} ${origin}`)}`;
  const parts = [await part("SAPISIDHASH", sid)];
  const p1 = await get("__Secure-1PAPISID"), p3 = await get("__Secure-3PAPISID");
  if (p1) parts.push(await part("SAPISID1PHASH", p1));
  if (p3) parts.push(await part("SAPISID3PHASH", p3));
  return parts.join(" ");
}
async function ytContinue(token, apiUrl = "/youtubei/v1/browse", cfg = recs.cfg) {
  const { context, version } = cfg;
  const headers = { "Content-Type": "application/json", "X-Youtube-Client-Name": "1", "X-Youtube-Client-Version": version, "X-Origin": "https://www.youtube.com", "X-Goog-AuthUser": "0" };
  const auth = await ytAuthHeader(); if (auth) headers.Authorization = auth;
  const r = await fetch(`https://www.youtube.com${apiUrl}?prettyPrint=false`, { method: "POST", credentials: "include", headers, body: JSON.stringify({ context, continuation: token }) });
  if (!r.ok) throw new Error("http " + r.status);
  return r.json();
}
// 開いたとき、未取得か前回から10分以上たっていれば読み込む
function autoLoadRecs() { if (!recs.items || Date.now() - recs.at > 10 * 60 * 1000) loadRecs(); }

function renderRecs() {
  const info = recs.loading ? "読み込み中…" : recs.items?.length ? `${recs.items.length}件 ・ 取得 ${fmtAgo(recs.at)}` : "";
  const head = `<div class="pl-head"><div class="pl-head-title"><b>YouTubeのおすすめ</b><small>${info}</small></div>
      <button class="chip" data-recreload title="YouTubeから最新のおすすめを読み込み直します" ${recs.loading ? "disabled" : ""}>更新</button></div>`
    + (recs.chips.length > 1 ? `<div class="yt-chips" role="tablist">${recs.chips.map((c, i) =>
        `<button class="tab ${i === recs.chip ? "on" : ""}" role="tab" aria-selected="${i === recs.chip}" data-chip="${i}">${esc(c.title)}</button>`).join("")}</div>` : "")
    + viewBar();
  if (recs.loading && !recs.items?.length) return head + `<div class="empty">読み込み中…</div>`;
  if (recs.error) return head + `<div class="empty">${esc(recs.error)}</div>`;
  if (!recs.items?.length) return head + `<div class="empty">まだ読み込んでいません。「更新」を押してください。</div>`;
  return head + ytRowsHtml(recs.items);
}

function playYt(vid) {
  const v = ytList()?.find((x) => x.id === vid); if (!v) return;
  ytPlaying = vid; sel = null; selPl = null; nowPlaying = null; plNeedsPlayer = null;
  $("detail").hidden = false;
  $("detail").classList.remove("pl"); $("detail").classList.add("yt");
  $("d-title").textContent = v.title;
  $("d-meta").textContent = [v.channel, v.duration].filter(Boolean).join(" ・ ");
  $("d-open").href = `https://www.youtube.com/watch?v=${vid}`;
  $("player").src = `https://www.youtube.com/embed/${encodeURIComponent(vid)}?autoplay=1&rel=0&enablejsapi=1`;
  document.querySelectorAll(".pl-row").forEach((r) => r.classList.toggle("playing", r.dataset.vid === vid));
}
