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
const SYS = (id) => id === "all" || id === "home" || id === "playlists" || id === "search";
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
const iconFolder = (c) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="${c}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`;

/* ---------- 描画 ---------- */
const CHEV = `<svg class="chev" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`;
function renderFolders() {
  const n = (id) => id === "playlists" ? pls().length : Object.values(data.videos).filter((v) => inFolder(v, id)).length;
  const item = (id, icon, name, o = {}) =>
    `<button class="nav-item ${cur === id ? "on" : ""} ${o.sub ? "sub" : ""} ${o.open ? "open" : ""}" data-f="${id}" data-tip="${esc(name)}" ${o.drag ? 'draggable="true"' : ""}>${o.sub ? '<span class="bullet"></span>' : icon}<span class="name">${esc(name)}</span>${id === "home" ? "" : `<span class="n">${n(id)}</span>`}${o.kids ? CHEV : ""}</button>`;
  // ホーム / 再生リスト(YouTube側) / ライブラリ(自分で整理した動画とフォルダ)の3区画
  let h = item("home", ICON_HOME, "ホーム")
    + `<div class="nav-label">再生リスト</div>` + item("playlists", ICON_PL, "YouTubeの再生リスト")
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
  $("player").src = `https://www.youtube.com/embed/${id}?start=${start}&autoplay=${start ? 1 : 0}&rel=0`;
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
  render();
  if (cur === "playlists") autoSyncPlaylists();
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
  const pv = e.target.closest("[data-prev]");
  if (pv) { prevMode = pv.dataset.prev; ls.set("tf-prev", prevMode); hidePreview(); renderList(); return; }
  if (e.target.closest("[data-back]")) { openPl = null; renderList(); return; }
  const ysave = e.target.closest("[data-ytsave]");
  if (ysave) { e.stopPropagation(); openAddDialog("https://www.youtube.com/watch?v=" + ysave.dataset.ytsave); return; }
  const vsave = e.target.closest("[data-savevid]");
  if (vsave) { e.stopPropagation(); saveVideoFromPl(vsave.dataset.savevid); return; }
  const vrow = e.target.closest("[data-vid]");
  if (vrow) { cur === "search" ? playYt(vrow.dataset.vid) : playInPlaylist(vrow.dataset.vid); return; }
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
  return `https://www.youtube.com/embed/videoseries?list=${encodeURIComponent(p.id)}&autoplay=${auto ? 1 : 0}`;
}
// 「作成した」リストはリスト自体が非公開で埋め込めないことが多いので、動画を1本ずつ再生し、終わったら次へ進む
function playIndex(p, i, auto) {
  const v = p.items[i];
  nowPlaying = { plId: p.id, idx: i };
  $("player").src = embedSrc(p, i, auto);
  $("d-meta").textContent = `再生中 (${i + 1}/${p.items.length}): ${v.title}`;
  document.querySelectorAll(".pl-row").forEach((r) => r.classList.toggle("playing", r.dataset.vid === v.id));
}
$("player").addEventListener("load", () => {
  // 再生終了を受け取るため、プレイヤーへ購読を依頼する
  try { $("player").contentWindow.postMessage(JSON.stringify({ event: "listening", id: 1, channel: "widget" }), "*"); } catch {}
});
addEventListener("message", (e) => {
  if (e.source !== $("player").contentWindow || !nowPlaying) return;
  let m; try { m = typeof e.data === "string" ? JSON.parse(e.data) : e.data; } catch { return; }
  const ended = (m?.event === "onStateChange" && m.info === 0) || (m?.event === "infoDelivery" && m.info?.playerState === 0);
  if (!ended) return;
  const p = pls().find((x) => x.id === nowPlaying.plId);
  if (p?.items && nowPlaying.idx + 1 < p.items.length) playIndex(p, nowPlaying.idx + 1, true);
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
  const prevBar = `<div class="pl-prev"><span>ホバープレビュー:</span><button class="tab ${prevMode === "B" ? "on" : ""}" data-prev="${prevMode === "B" ? "off" : "B"}">${prevMode === "B" ? "オン" : "オフ"}</button></div>`;
  if (plLoading.has(p.id) && !items.length) return head + `<div class="empty">読み込み中…</div>`;
  if (!items.length) return head + `<div class="empty">動画を読み込めていません。YouTubeにログインしているか確認して「更新」を押してください。</div>`;
  return head + prevBar + `<div class="pl-rows">` + items.map((v, i) => `
    <div class="pl-row ${nowPlaying?.plId === p.id && nowPlaying.idx === i ? "playing" : ""}" data-vid="${esc(v.id)}">
      <span class="idx">${i + 1}</span>
      <div class="thumb"><img loading="lazy" src="https://i.ytimg.com/vi/${esc(v.id)}/mqdefault.jpg" alt=""></div>
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
  $("player").src = `https://www.youtube.com/embed/${vid}?list=${encodeURIComponent(p.id)}&autoplay=1&rel=0`;
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
let pvTimer = null, pvEl = null, pvRow = null;
function hidePreview() { clearTimeout(pvTimer); pvEl?.remove(); pvEl = null; pvRow = null; }
const toSec = (d) => (d || "").split(":").reduce((a, x) => a * 60 + (+x || 0), 0);

function showPreview(row) {
  const v = cur === "search" ? ytResults?.find((x) => x.id === row.dataset.vid) : pls().find((x) => x.id === openPl)?.items?.find((x) => x.id === row.dataset.vid);
  if (!v) return;
  const box = document.createElement("div");
  box.className = "pv-pop";
  const start = Math.floor(toSec(v.duration) * 0.3); // イントロを飛ばして動画の30%付近から
  box.innerHTML = `<iframe src="https://www.youtube.com/embed/${encodeURIComponent(v.id)}?autoplay=1&mute=1&controls=0&disablekb=1&playsinline=1&rel=0&modestbranding=1&start=${start}" allow="autoplay; encrypted-media"></iframe>`;
  const t = row.querySelector(".thumb").getBoundingClientRect();
  box.style.left = Math.max(8, Math.min(t.right + 12, innerWidth - 336)) + "px";
  box.style.top = Math.max(8, Math.min(t.top + t.height / 2 - 90, innerHeight - 190)) + "px";
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

function collectSearchResults(root) {
  const out = new Map();
  const txt = (o) => o?.simpleText || o?.runs?.map((r) => r.text).join("") || "";
  (function walk(n) {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(walk);
    const r = n.videoRenderer;
    if (r?.videoId && !out.has(r.videoId))
      out.set(r.videoId, { id: r.videoId, title: txt(r.title), channel: txt(r.ownerText) || txt(r.longBylineText), duration: txt(r.lengthText) || (r.badges ? "LIVE" : ""), views: txt(r.viewCountText), published: txt(r.publishedTimeText) });
    Object.values(n).forEach(walk);
  })(root);
  return [...out.values()];
}
async function searchYouTube(q) {
  ytq = q; ytLoading = true; ytError = ""; ytResults = null; cur = "search"; openPl = null; hidePreview(); render();
  try {
    const html = await (await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=EgIQAQ%253D%253D`, { credentials: "include" })).text();
    const start = html.indexOf("ytInitialData = "), end = html.indexOf(";</script>", start);
    if (start < 0 || end < 0) throw new Error("data");
    const res = collectSearchResults(JSON.parse(html.slice(start + 16, end)));
    if (ytq === q) ytResults = res;
  } catch { if (ytq === q) ytError = "検索結果を取得できませんでした(ネットワークやYouTubeの仕様変更が原因かもしれません)"; }
  finally { if (ytq === q) { ytLoading = false; if (cur === "search") renderList(); } }
}

function renderSearch() {
  const head = `<div class="pl-head"><div class="pl-head-title"><b>「${esc(ytq)}」のYouTube検索結果</b><small>${ytLoading ? "検索中…" : ytResults ? `${ytResults.length}件(動画のみ・先頭の約20件)` : ""}</small></div></div>
    <div class="pl-prev"><span>ホバープレビュー:</span><button class="tab ${prevMode === "B" ? "on" : ""}" data-prev="${prevMode === "B" ? "off" : "B"}">${prevMode === "B" ? "オン" : "オフ"}</button></div>`;
  if (ytLoading) return head + `<div class="empty">検索中…</div>`;
  if (ytError) return head + `<div class="empty">${esc(ytError)}</div>`;
  if (!ytResults?.length) return head + `<div class="empty">見つかりませんでした</div>`;
  return head + `<div class="pl-rows">` + ytResults.map((v, i) => `
    <div class="pl-row ${ytPlaying === v.id ? "playing" : ""}" data-vid="${esc(v.id)}">
      <span class="idx">${i + 1}</span>
      <div class="thumb"><img loading="lazy" src="https://i.ytimg.com/vi/${esc(v.id)}/mqdefault.jpg" alt=""></div>
      <div class="meta"><b>${esc(v.title)}</b><small>${esc([v.channel, v.views, v.published].filter(Boolean).join(" ・ "))}</small></div>
      <span class="dur">${esc(v.duration)}</span>
      <button class="chip" data-ytsave="${esc(v.id)}">${data.videos[v.id] ? "✓ 保存済み" : "📁 保存"}</button>
    </div>`).join("") + `</div>`;
}

function playYt(vid) {
  const v = ytResults?.find((x) => x.id === vid); if (!v) return;
  ytPlaying = vid; sel = null; selPl = null; nowPlaying = null; plNeedsPlayer = null;
  $("detail").hidden = false;
  $("detail").classList.remove("pl"); $("detail").classList.add("yt");
  $("d-title").textContent = v.title;
  $("d-meta").textContent = [v.channel, v.duration].filter(Boolean).join(" ・ ");
  $("d-open").href = `https://www.youtube.com/watch?v=${vid}`;
  $("player").src = `https://www.youtube.com/embed/${encodeURIComponent(vid)}?autoplay=1&rel=0`;
  document.querySelectorAll(".pl-row").forEach((r) => r.classList.toggle("playing", r.dataset.vid === vid));
}
