/* ===== 登録チャンネルのフォルダ分け + YouTubeの登録チャンネルとの同期 =====
   データ: data.channels = { [channelId]: { id, name, handle, thumb, folders: [フォルダID], subscribed, dummy? } }
   フォルダは data.folders(id / name / color / parent)を共用する。 */
const COLORS = ["#f59e0b", "#3b82f6", "#ec4899", "#10b981", "#8b5cf6", "#ef4444", "#14b8a6", "#eab308"];
const persist = () => chrome.storage.local.set({ [KEY]: data });
const chAll = () => Object.values(data.channels || {}).filter((c) => !!c.dummy === useDummy).sort((a, b) => (a.name || "").localeCompare(b.name || "", "ja"));
const inFolder = (c, id) => desc(id).some((x) => (c.folders || []).includes(x));
const chIn = (t) => t === "uncat" ? chAll().filter((c) => !(c.folders || []).length) : t === "channels" ? chAll() : chAll().filter((c) => inFolder(c, t));
const folderName = (id) => id === "uncat" ? "未分類" : id === "channels" ? "登録チャンネル" : (data.folders.find((f) => f.id === id)?.name || "");
const folderPath = (id) => { const out = []; let f = data.folders.find((x) => x.id === id), n = 0; while (f && n++ < 20) { out.unshift(f.name); f = data.folders.find((x) => x.id === f.parent); } return out.join(" / "); };
const initial = (s) => (s || "?").replace(/^【.*?】/, "").trim().charAt(0).toUpperCase() || "?";

/* ---------- カード ---------- */
function chCard(c, from) {
  const hue = ([...c.id].reduce((a, ch) => a + ch.charCodeAt(0), 0) * 37) % 360;
  const av = c.thumb && !c.dummy ? `<img class="av-img" loading="lazy" src="${esc(c.thumb)}" alt="">` : `<span class="av-img av-ph" style="--h:${hue}">${esc(initial(c.name))}</span>`;
  const inner = `${av}<b>${esc(c.name)}</b><small>${esc(c.handle || "")}${c.subscribed === false ? " ・ 登録解除済み" : ""}</small>`;
  const fl = (c.folders || []).map((id) => folderName(id)).filter(Boolean);
  return `<div class="ch ${c.subscribed === false ? "gone" : ""}" draggable="true" data-chid="${esc(c.id)}">${c.dummy ? `<div class="ch-a">${inner}</div>` : `<a class="ch-a" href="https://www.youtube.com/channel/${encodeURIComponent(c.id)}" target="_blank" rel="noopener">${inner}</a>`}
    <button class="ch-f" data-chf="${esc(c.id)}" title="フォルダを選ぶ(複数のフォルダに入れられます)">📁 ${fl.length ? esc(fl.join("・")) : "未分類"}</button>${from ? `<button class="ch-x" data-chrm="${esc(c.id)}" data-from="${esc(from)}" title="このフォルダから外す" aria-label="このフォルダから外す">✕</button>` : ""}</div>`;
}
const chRail = (title, list, key = "") => list.length ? rail(title, list.map(chCard).join(""), list.length, "チャンネル", key) : "";
function chRows() {
  let h = "";
  for (const f of data.folders.filter((x) => !x.parent)) h += chRail(f.name, chIn(f.id), f.id);
  h += chRail("未分類", chIn("uncat"), "uncat");
  return h || note("フォルダ", "登録チャンネルがありません。サイドバーの「登録チャンネル」から同期してください。");
}

/* チャンネル一覧(フォルダ管理の画面)は chstats.js の channelsView */

/* ---------- フォルダの追加・名前変更・削除 ---------- */
let fdMode = null; // { id?, parent? }
function askFolder(id, parent) {
  fdMode = { id, parent };
  $("fd-t").textContent = id ? "フォルダ名を変更" : parent ? `「${folderName(parent)}」にサブフォルダを追加` : "フォルダを追加";
  $("fd-name").value = id ? folderName(id) : "";
  $("fd").showModal(); $("fd-name").focus(); $("fd-name").select();
}
$("fd-form").onsubmit = async (e) => {
  e.preventDefault();
  const name = $("fd-name").value.trim(); if (!name) return;
  if (fdMode?.id) { const f = data.folders.find((x) => x.id === fdMode.id); if (f) f.name = name; }
  else { const id = "f" + Date.now().toString(36); const f = { id, name, color: COLORS[data.folders.length % COLORS.length] }; if (fdMode?.parent) f.parent = fdMode.parent; data.folders.push(f); tab = id; }
  $("fd").close(); await persist(); render();
};
$("fd-cancel").onclick = () => $("fd").close();
async function deleteFolder(id) {
  const ids = desc(id), n = chIn(id).length, sub = ids.length - 1, name = folderName(id);
  if (!await uiConfirm(`フォルダ「${folderName(id)}」を削除しますか?${sub ? `\n中のサブフォルダ(${sub}個)も削除されます。` : ""}${n ? `\n入っているチャンネル(${n})は「未分類」に戻ります(チャンネル自体は消えません)。` : ""}`)) return;
  data.folders = data.folders.filter((f) => !ids.includes(f.id));
  for (const c of Object.values(data.channels || {})) c.folders = (c.folders || []).filter((x) => !ids.includes(x));
  for (const v of Object.values(data.videos)) v.folders = (v.folders || []).filter((x) => !ids.includes(x));
  if (ids.includes(tab)) tab = "channels"; // 見ていたフォルダを消したときだけ移動する
  await persist(); render();
  toast(`フォルダ「${name}」を削除しました`);
}

/* ---------- サイドバーでのフォルダ操作 ----------
   ・「フォルダを追加」を押すと、その場に入力欄が出る(Enter で作成、Esc で取り消し)
   ・各フォルダの「⋯」(または右クリック)でメニュー: 名前を変更 / サブフォルダを追加 / 上へ / 下へ / 入れ子を解除 / キーワード / 削除 */
function startFolderEdit(st) {
  closeFolderMenu();
  if (st.mode === "sub") folded.delete(st.parent); // 追加先のフォルダを開いておく
  if (document.body.classList.contains("rail")) document.body.classList.remove("rail"); // 細いサイドバーでは入力できないので広げる
  fEdit = { value: st.mode === "rename" ? folderName(st.id) : "", selectAll: st.mode === "rename", ...st };
  renderNav();
}
async function commitFolderEdit() {
  const st = fEdit; if (!st) return;
  fEdit = null;
  const name = st.value.trim();
  if (name) {
    if (st.mode === "rename") { const f = data.folders.find((x) => x.id === st.id); if (f && f.name !== name) { f.name = name; await persist(); } }
    else {
      const f = { id: "f" + Date.now().toString(36), name, color: COLORS[data.folders.length % COLORS.length] };
      if (st.mode === "sub") f.parent = st.parent;
      data.folders.push(f); await persist();
      toast(`フォルダ「${name}」を追加しました`);
    }
  }
  render();
}
function cancelFolderEdit() { if (!fEdit) return; fEdit = null; renderNav(); }
document.addEventListener("input", (e) => { if (e.target.id === "fe-in" && fEdit) fEdit.value = e.target.value; });
document.addEventListener("keydown", (e) => {
  if (e.target.id !== "fe-in") return;
  if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); commitFolderEdit(); } // 日本語変換の確定の Enter では作らない
  else if (e.key === "Escape") { e.preventDefault(); cancelFolderEdit(); }
});
// 入力欄の外を押したら、名前が入っていれば確定、空なら取り消し(描き直しで欄が作り直されるときは何もしない)
document.addEventListener("focusout", (e) => { if (e.target.id === "fe-in" && !navRendering) setTimeout(() => { if (fEdit && document.activeElement?.id !== "fe-in") fEdit.value.trim() ? commitFolderEdit() : cancelFolderEdit(); }, 0); });

function closeFolderMenu() { $("fm")?.remove(); }
function openFolderMenu(id, x, y) {
  closeFolderMenu();
  const f = data.folders.find((v) => v.id === id); if (!f) return;
  const sib = data.folders.filter((v) => (v.parent || "") === (f.parent || "")), si = sib.indexOf(f);
  const it = (act, label, dis = false, cls = "") => `<button type="button" class="fm-i ${cls}" data-fm="${act}" ${dis ? "disabled" : ""}>${label}</button>`;
  const box = document.createElement("div");
  box.id = "fm"; box.className = "pm fm"; box.setAttribute("role", "menu"); box.dataset.id = id;
  const ico = f.img ? `<img class="fimg" decoding="async" loading="lazy" src="${esc(f.img)}" alt="">` : `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="${esc(f.color || "#ccc")}" stroke-width="2" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`;
  const tl = (act, ic, label, cls = "") => `<button type="button" class="fm-t ${cls}" data-fm="${act}"><span class="fm-ic">${ic}</span><span>${label}</span></button>`;
  box.innerHTML = `<div class="fm-hd"><span class="fbg" ${f.bg ? `style="background:${esc(f.bg)}"` : ""}>${ico}</span><b>${esc(f.name)}</b></div>`
    + `<button type="button" class="fm-edit" data-fm="edit">✎ 名前・色・画像を編集</button>`
    + `<div class="fm-grid">` + tl("sub", "＋", "サブフォルダ") + tl("rename", "Aa", "名前だけ変更") + (f.parent ? tl("unnest", "↖", "入れ子を解除") : "") + tl("del", "🗑", "削除", "danger") + `</div>`;
  document.body.append(box);
  const w = box.offsetWidth, h = box.offsetHeight;
  box.style.left = Math.max(8, Math.min(x, innerWidth - w - 8)) + "px";
  box.style.top = Math.max(8, Math.min(y, innerHeight - h - 8)) + "px";
}
document.addEventListener("click", (e) => {
  const mvb = e.target.closest("[data-fmove]"); // サイドバーのフォルダ行の ▲▼
  if (mvb) { e.preventDefault(); e.stopPropagation(); const [d, fid] = mvb.dataset.fmove.split("|"); closeFolderMenu(); return void moveFolder(fid, d === "up" ? -1 : 1); }
  const sbtn = e.target.closest("[data-fsub]"); // 行の「＋」: サブフォルダを追加
  if (sbtn) { e.preventDefault(); e.stopPropagation(); return startFolderEdit({ mode: "sub", parent: sbtn.dataset.fsub }); }
  const b = e.target.closest("[data-fmenu]");
  if (b) { e.preventDefault(); e.stopPropagation(); const r = b.getBoundingClientRect(); return openFolderEditor(b.dataset.fmenu); }
  const m = e.target.closest("[data-fm]");
  if (m) {
    e.preventDefault(); e.stopPropagation();
    const id = $("fm")?.dataset.id, a = m.dataset.fm; closeFolderMenu(); if (!id) return;
    if (a === "rename") startFolderEdit({ mode: "rename", id });
    else if (a === "sub") startFolderEdit({ mode: "sub", parent: id });
    else if (a === "up" || a === "down") moveFolder(id, a === "up" ? -1 : 1);
    else if (a === "edit") openFolderEditor(id);
    else if (a === "unnest") unnestFolder(id);
    else if (a === "kw") openKeywords(id);
    else if (a === "del") deleteFolder(id);
    return;
  }
  if ($("fm") && !e.target.closest("#fm")) closeFolderMenu();
}, true);
// サイドバーのフォルダを右クリックしても同じメニューを出す
document.addEventListener("contextmenu", (e) => {
  const n = e.target.closest("#nav-list [data-t]");
  if (!n || !data.folders.some((f) => f.id === n.dataset.t)) return;
  e.preventDefault(); openFolderEditor(n.dataset.t);
});
addEventListener("keydown", (e) => { if (e.key === "Escape") closeFolderMenu(); });
addEventListener("resize", closeFolderMenu);
// ページ全体や、サイドバーのスクロールで閉じる(ホームの行の自動スクロールなど、ほかの場所のスクロールでは閉じない)
addEventListener("scroll", (e) => { const t = e.target; if (!$("fm")?.contains(t) && (t === document || t === document.scrollingElement || t.id === "nav-scroll")) closeFolderMenu(); }, true);

/* ---------- フォルダの並べ替え・入れ子の解除 ---------- */
async function moveFolder(id, dir) { // 同じ階層の兄弟どうしで入れ替える
  const f = data.folders.find((x) => x.id === id); if (!f) return;
  const sib = data.folders.filter((x) => (x.parent || "") === (f.parent || ""));
  const other = sib[sib.indexOf(f) + dir]; if (!other) return;
  const i = data.folders.indexOf(f), j = data.folders.indexOf(other);
  [data.folders[i], data.folders[j]] = [data.folders[j], data.folders[i]];
  await persist(); render();
}
async function unnestFolder(id) { // 親フォルダの外(ひとつ上の階層)へ。元の親のすぐ下に並べる
  const f = data.folders.find((x) => x.id === id); if (!f?.parent) return;
  const parent = data.folders.find((x) => x.id === f.parent);
  data.folders.splice(data.folders.indexOf(f), 1);
  if (parent?.parent) f.parent = parent.parent; else delete f.parent;
  data.folders.splice(Math.max(0, data.folders.indexOf(parent)) + 1, 0, f);
  await persist(); render(); toast(`「${f.name}」の入れ子を解除しました`);
}

/* ---------- チャンネルをフォルダに割り当てる ---------- */
let assignId = null;
function folderTree() { // 親 → 子の順(入れ子は字下げ)に並べる
  const out = [], seen = new Set();
  const walk = (parent, depth) => data.folders.filter((x) => (x.parent || "") === parent).forEach((f) => { if (seen.has(f.id)) return; seen.add(f.id); out.push({ f, depth }); walk(f.id, depth + 1); });
  walk("", 0); data.folders.forEach((f) => { if (!seen.has(f.id)) out.push({ f, depth: 0 }); });
  return out;
}
function openAssign(id) {
  const c = data.channels?.[id]; if (!c) return;
  assignId = id;
  $("chd-t").textContent = c.name;
  $("chd-list").innerHTML = ""; $("chd").showModal(); // 先に枠を出してから、一覧を描く(画像の多いフォルダで、枠まで遅れて出るのを防ぐ)
  setTimeout(() => { if (assignId !== id) return;
  $("chd-list").innerHTML = data.folders.length
    ? folderTree().map(({ f, depth }) => { const on = (c.folders || []).includes(f.id), ico = f.img ? `<img class="fimg" decoding="async" loading="lazy" src="${esc(f.img)}" alt="">` : `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="${esc(f.color || "#ccc")}" stroke-width="2" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`;
      return `<label class="asg ${on ? "on" : ""} ${depth ? "sub" : ""}" style="padding-left:${8 + depth * 14}px"><span class="fbg" ${f.bg ? `style="background:${esc(f.bg)}"` : ""}>${ico}</span><span class="asg-n">${esc(f.name)}</span><input type="checkbox" data-fid="${esc(f.id)}" ${on ? "checked" : ""}><i class="asg-c"></i></label>`; }).join("")
    : `<p class="hint">フォルダがありません。サイドバーの「フォルダを追加」で作成してください。</p>`;
  }, 0);
}
$("chd-list").addEventListener("change", async (e) => {
  const fid = e.target.dataset.fid, c = data.channels?.[assignId]; if (!fid || !c) return;
  const s = new Set(c.folders || []); e.target.checked ? s.add(fid) : s.delete(fid);
  e.target.closest(".asg")?.classList.toggle("on", e.target.checked);
  c.folders = [...s]; await persist(); render();
});
$("chd-close").onclick = () => $("chd").close();
async function moveChannel(id, target) { // ドラッグ&ドロップ: 指定のフォルダに追加する(同じチャンネルを複数のフォルダに入れられる)。未分類へ落とすと全フォルダから外す
  const c = data.channels?.[id]; if (!c) return;
  c.folders = target === "uncat" ? [] : [...new Set([...(c.folders || []), target])];
  await persist(); render();
}

/* ---------- YouTubeの登録チャンネルと同期 ---------- */
let syncing = false;
function collectChannels(root) {
  const out = new Map(), tokens = [];
  const pic = (t) => { const u = (t?.thumbnails || []).slice(-1)[0]?.url || ""; return u.startsWith("//") ? "https:" + u : u; };
  (function walk(n) {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(walk);
    for (const k of ["channelRenderer", "gridChannelRenderer"]) {
      const r = n[k];
      if (r?.channelId && !out.has(r.channelId)) {
        const base = r.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl || "";
        const sc = txt(r.subscriberCountText);
        out.set(r.channelId, { id: r.channelId, name: txt(r.title), handle: base.startsWith("/@") ? base.slice(1) : (sc.startsWith("@") ? sc : ""), thumb: pic(r.thumbnail) });
      }
    }
    const tk = n.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
    if (tk) tokens.push(tk);
    Object.values(n).forEach(walk);
  })(root);
  return { list: [...out.values()], token: tokens[tokens.length - 1] || "" };
}
async function fetchSubscriptions() {
  const html = await (await fetch("https://www.youtube.com/feed/channels", { credentials: "include" })).text();
  const a = html.indexOf("ytInitialData = "), b = html.indexOf(";</script>", a);
  if (a < 0 || b < 0) throw new Error("data");
  const first = collectChannels(JSON.parse(html.slice(a + 16, b)));
  const all = new Map(first.list.map((c) => [c.id, c]));
  let token = first.token;
  const context = jsonAfter(html, '"INNERTUBE_CONTEXT":');
  const version = (html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/) || [])[1] || context?.client?.clientVersion || "";
  for (let i = 0; token && context && i < 40; i++) { // 登録チャンネルが多い場合は続きを順に読む
    const headers = { "Content-Type": "application/json", "X-Youtube-Client-Name": "1", "X-Youtube-Client-Version": version, "X-Origin": "https://www.youtube.com", "X-Goog-AuthUser": "0" };
    const auth = await authHeader(); if (auth) headers.Authorization = auth;
    const r = await fetch("https://www.youtube.com/youtubei/v1/browse?prettyPrint=false", { method: "POST", credentials: "include", headers, body: JSON.stringify({ context, continuation: token }) });
    if (!r.ok) break;
    const page = collectChannels(await r.json());
    const before = all.size;
    page.list.forEach((c) => all.set(c.id, c));
    token = all.size > before ? page.token : "";
  }
  return [...all.values()];
}
async function syncSubs(silent) {
  if (syncing || useDummy) return;
  syncing = true; render();
  try {
    const subs = await fetchSubscriptions();
    if (!subs.length) { if (!silent) toast("登録チャンネルが見つかりません。YouTubeにログインしているか確認してください"); return; }
    const chs = (data.channels ||= {});
    const ids = new Set(subs.map((c) => c.id));
    let added = 0, gone = 0;
    for (const s of subs) {
      const ex = chs[s.id];
      if (ex) Object.assign(ex, { name: s.name || ex.name, handle: s.handle || ex.handle, thumb: s.thumb || ex.thumb, subscribed: true });
      else { chs[s.id] = { ...s, folders: [], subscribed: true }; added++; }
    }
    for (const c of Object.values(chs)) if (!c.dummy && c.subscribed !== false && !ids.has(c.id)) { c.subscribed = false; gone++; }
    ls.set("tf-ch-sync", String(Date.now()));
    await persist();
    if (!silent) toast(`同期しました(新規 ${added}件 / 登録解除 ${gone}件 / 全${subs.length}件)`);
  } catch { if (!silent) toast("同期できませんでした(YouTubeへのログインやページの仕様変更が原因かもしれません)"); }
  finally { syncing = false; render(); }
}

/* ---------- ダミー ---------- */
const DUMMY_CH = ["音楽チャンネル", "ゲーム実況", "料理の達人", "プログラミング講座", "旅行Vlog", "ニュース速報", "英会話レッスン", "猫のいる暮らし", "DIY工房", "筋トレ道場", "アニメ解説", "ガジェットレビュー", "歴史の話", "天気予報", "カメラ入門", "ピアノ演奏"];
async function ensureDummy() {
  if (!useDummy || Object.values(data.channels || {}).some((c) => c.dummy)) return;
  const chs = (data.channels ||= {}), fs = data.folders;
  DUMMY_CH.forEach((n, i) => { chs["dummych" + i] = { id: "dummych" + i, name: `【ダミー】${n}`, handle: `@dummy${i + 1}`, thumb: "", dummy: true, subscribed: true, folders: fs.length && i % 4 !== 3 ? [fs.filter((f) => !f.parent)[i % fs.filter((f) => !f.parent).length]?.id].filter(Boolean) : [] }; });
  await persist(); render();
}
chrome.storage.local.get(KEY).then(() => setTimeout(() => { ensureDummy(); if (!useDummy && Date.now() - +ls.get("tf-ch-sync", "0") > 60 * 60 * 1000) syncSubs(true); }, 0));
document.addEventListener("change", (e) => { if (e.target.id !== "set-dummy") return; ensureDummy(); if (!useDummy && !chAll().length) syncSubs(true); });

/* ---------- クリック・ドラッグ ---------- */
document.addEventListener("click", (e) => {
  const t = (s) => e.target.closest(s);
  let b;
  if ((b = t("[data-sgadd]"))) { const [c, f] = b.dataset.sgadd.split("|"); return sgAdd(c, f); }
  if ((b = t("[data-sgx]"))) { const [c, f] = b.dataset.sgx.split("|"); return sgIgnore(c, f); }
  if ((b = t("[data-sgall]"))) return sgAddAll(b.dataset.sgall);
  if ((b = t("[data-chf]"))) { e.preventDefault(); return openAssign(b.dataset.chf); }
  if ((b = t("[data-chrm]"))) { e.preventDefault(); const c = data.channels?.[b.dataset.chrm]; if (c) { c.folders = (c.folders || []).filter((x) => x !== b.dataset.from); persist().then(render); } return; }
  if ((b = t("[data-act]"))) {
    const a = b.dataset.act;
    if (a === "sync") syncSubs(false);
    else if (a === "addfolder") startFolderEdit({ mode: "add" });
    else if (a === "rename") startFolderEdit({ mode: "rename", id: b.dataset.id }); // サイドバーのその場で入力
    else if (a === "addsub") startFolderEdit({ mode: "sub", parent: b.dataset.id });
    else if (a === "kw") openKeywords(b.dataset.id);
    else if (a === "up" || a === "down") moveFolder(b.dataset.id, a === "up" ? -1 : 1);
    else if (a === "unnest") unnestFolder(b.dataset.id);
    else if (a === "delfolder") deleteFolder(b.dataset.id);
  }
});
function toast(msg) {
  const el = $("toast"); el.textContent = msg; el.classList.add("show");
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove("show"), 2600);
}
let dragCh = null;
document.addEventListener("dragstart", (e) => { const c = e.target.closest?.(".ch,.chr"); if (c) { dragCh = c.dataset.chid; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", dragCh); c.classList.add("dragging"); } });
document.addEventListener("dragend", () => { dragCh = null; document.querySelectorAll(".dragging,.drop").forEach((x) => x.classList.remove("dragging", "drop")); });
document.addEventListener("dragover", (e) => { const n = e.target.closest?.("[data-drop]"); if (dragCh && n) { e.preventDefault(); document.querySelectorAll(".drop").forEach((x) => x !== n && x.classList.remove("drop")); n.classList.add("drop"); } });
document.addEventListener("drop", (e) => { const n = e.target.closest?.("[data-drop]"); if (dragCh && n) { e.preventDefault(); const id = dragCh; dragCh = null; moveChannel(id, n.dataset.drop); } });


/* ===== キーワードによる仕分け補助(候補を表示するだけで、自動では入れない) ===== */
const nz = (x) => String(x || "").normalize("NFKC").toLowerCase();
// チャンネルごとの「そのチャンネルの動画タイトル」(保存した動画・視聴履歴・後で見る から集める)
function titlesByChannel() {
  const m = new Map(), add = (ch, t) => { if (!ch || !t) return; const k = nz(ch); (m.get(k) || m.set(k, []).get(k)).push(t); };
  for (const v of Object.values(data.videos || {})) add(v.channel, v.title);
  for (const [, v] of cache.resume || []) add(v.channel, v.title);
  for (const arr of Object.values(cache.later || {})) for (const [, v] of arr) add(v.channel, v.title);
  return m;
}
// フォルダのキーワードに引っかかるチャンネル(そのフォルダに未登録・無視していないもの)
function suggestions(f, tmap) {
  const kws = (f.keywords || []).map(nz).filter(Boolean); if (!kws.length) return [];
  const ign = new Set(f.ignored || []), out = [];
  for (const c of chAll()) {
    if ((c.folders || []).includes(f.id) || ign.has(c.id) || c.subscribed === false) continue;
    const name = nz(c.name), handle = nz(c.handle), titles = tmap.get(name) || [];
    let hit = null;
    for (const k of kws) {
      if (name.includes(k)) { hit = { k, where: "チャンネル名" }; break; }
      if (handle.includes(k)) { hit = { k, where: "ハンドル名" }; break; }
      const tt = titles.find((t) => nz(t).includes(k));
      if (tt) { hit = { k, where: "動画「" + tt.slice(0, 18) + (tt.length > 18 ? "…" : "") + "」" }; break; }
    }
    if (hit) out.push({ c, ...hit });
  }
  return out;
}
function sgPanel(t) {
  const fs = (t !== "channels" && t !== "uncat" ? data.folders.filter((x) => x.id === t) : data.folders).filter((f) => f.keywords?.length);
  if (!fs.length) return "";
  const tmap = titlesByChannel();
  const parts = fs.map((f) => ({ f, s: suggestions(f, tmap) })).filter((x) => x.s.length);
  if (!parts.length) return `<div class="sg-none">🔎 キーワードに一致する新しい候補はありません</div>`;
  return `<div class="sg">${parts.map(({ f, s }) => `<div class="sg-f"><div class="sg-h"><b>🔎 「${esc(folderPath(f.id))}」の候補</b><small>${s.length}件</small><button class="btn s" data-sgall="${esc(f.id)}">すべて追加</button></div>
    <div class="sg-l">${s.slice(0, 24).map(({ c, k, where }) => `<div class="sg-c"><span class="sg-av">${c.thumb && !c.dummy ? `<img src="${esc(c.thumb)}" alt="">` : esc(initial(c.name))}</span><div class="sg-t"><b>${esc(c.name)}</b><small>「${esc(k)}」← ${esc(where)}</small></div><button class="sg-b" data-sgadd="${esc(c.id)}|${esc(f.id)}" title="このフォルダに追加">＋</button><button class="sg-b x" data-sgx="${esc(c.id)}|${esc(f.id)}" title="候補から外す">✕</button></div>`).join("")}</div>
    ${s.length > 24 ? `<small class="sg-more">ほか ${s.length - 24}件(「すべて追加」で含まれます)</small>` : ""}</div>`).join("")}</div>`;
}
async function sgAdd(cid, fid) { const c = data.channels?.[cid]; if (!c) return; c.folders = [...new Set([...(c.folders || []), fid])]; await persist(); render(); }
async function sgIgnore(cid, fid) { const f = data.folders.find((x) => x.id === fid); if (!f) return; f.ignored = [...new Set([...(f.ignored || []), cid])]; await persist(); render(); }
async function sgAddAll(fid) {
  const f = data.folders.find((x) => x.id === fid); if (!f) return;
  const list = suggestions(f, titlesByChannel());
  if (!list.length) return;
  if (list.length > 20 && !await uiConfirm(`${list.length}件を「${folderName(fid)}」に追加します。よろしいですか?`)) return;
  for (const { c } of list) c.folders = [...new Set([...(c.folders || []), fid])];
  await persist(); render(); toast(`${list.length}件を「${folderName(fid)}」に追加しました`);
}
let kwId = null;
function openKeywords(id) {
  const f = data.folders.find((x) => x.id === id); if (!f) return;
  kwId = id; $("kwd-t").textContent = `「${folderPath(id)}」のキーワード`;
  $("kwd-text").value = (f.keywords || []).join("\n"); $("kwd").showModal(); $("kwd-text").focus();
}
$("kwd-cancel").onclick = () => $("kwd").close();
$("kwd-save").onclick = async () => {
  const f = data.folders.find((x) => x.id === kwId); if (!f) return;
  f.keywords = [...new Set($("kwd-text").value.split(/[\n,、,]+/).map((x) => x.trim()).filter(Boolean))];
  if (!f.keywords.length) delete f.keywords;
  $("kwd").close(); await persist(); render();
};
$("kwd-reset").onclick = async () => { const f = data.folders.find((x) => x.id === kwId); if (f) { delete f.ignored; await persist(); render(); toast("候補から外した分を元に戻しました"); } };

/* ===== 設定の「チャンネルのキーワード」タブ: すべてのフォルダのキーワードを一覧で管理 =====
   ・入れ子は字下げの木で表示し、▾ で子フォルダをたためる(たたんだ状態は覚えておく)
   ・上の検索欄で、フォルダ名・キーワードで絞り込める
   ・「キーワードあり / 未設定 / 候補あり」で絞り込める(絞り込み中は、親の名前も添えて平らに並べる)
   ・追加欄はふだん隠し、「＋」を押したフォルダだけ開く */
const kwUi = { q: "", filter: "all", open: "", fold: new Set((() => { try { return JSON.parse(ls.get("tf-kw-folded", "[]") || "[]"); } catch { return []; } })()) };
const kwSaveFold = () => ls.set("tf-kw-folded", JSON.stringify([...kwUi.fold]));
function kwRows() {
  const rows = [], seen = new Set();
  (function walk(pid, d) { data.folders.filter((f) => (f.parent || "") === pid).forEach((f) => { if (seen.has(f.id)) return; seen.add(f.id); rows.push({ f, d }); walk(f.id, d + 1); }); })("", 0);
  return rows;
}
function paintKw() {
  const box = $("set-kw"); if (!box) return;
  const rows = kwRows();
  if (!rows.length) { box.innerHTML = `<p class="hint">フォルダがありません。フォルダ管理の画面で作成してください。</p>`; return; }
  const withKw = rows.filter((r) => r.f.keywords?.length).length, total = rows.reduce((s, r) => s + (r.f.keywords?.length || 0), 0);
  const seg = (v, label) => `<button type="button" class="${kwUi.filter === v ? "on" : ""}" data-kwfilter="${v}">${label}</button>`;
  box.innerHTML = `<p class="hint kw-hint">フォルダごとのキーワードです。チャンネル名・ハンドル名・そのチャンネルの動画タイトルに含まれると、そのフォルダの候補として表示します(自動では入れません)。</p>`
    + `<div class="kw-bar"><input type="search" class="kw-q" id="kw-q" placeholder="フォルダ名・キーワードで探す" value="${esc(kwUi.q)}">`
    + `<div class="kw-seg">${seg("all", "すべて")}${seg("has", "キーワードあり")}${seg("none", "未設定")}${seg("sug", "候補あり")}</div>`
    + `<span class="kw-sum">${rows.length}フォルダ ・ 設定済み ${withKw} ・ キーワード ${total}個</span>`
    + `<span class="kw-fa"><button type="button" class="btn s" data-kwall="open">すべて開く</button><button type="button" class="btn s" data-kwall="close">すべて閉じる</button></span></div>`
    + `<div class="kw-g" id="kw-list"></div>`;
  paintKwList();
}
function paintKwList() {
  const list = $("kw-list"); if (!list) return;
  const rows = kwRows(), tmap = titlesByChannel(), q = kwUi.q.trim().toLowerCase();
  const kids = new Map(); rows.forEach((r) => { const p = r.f.parent || ""; kids.set(p, (kids.get(p) || 0) + 1); });
  const sub = (id) => { let n = 0, k = 0; (function walk(pid) { data.folders.filter((x) => x.parent === pid).forEach((x) => { n++; k += x.keywords?.length || 0; walk(x.id); }); })(id); return { n, k }; };
  const flat = !!q || kwUi.filter !== "all";
  let shown = rows.map((r) => ({ ...r, sug: suggestions(r.f, tmap).length }));
  if (kwUi.filter === "has") shown = shown.filter((r) => r.f.keywords?.length);
  if (kwUi.filter === "none") shown = shown.filter((r) => !r.f.keywords?.length);
  if (kwUi.filter === "sug") shown = shown.filter((r) => r.sug);
  if (q) shown = shown.filter((r) => folderPath(r.f.id).toLowerCase().includes(q) || (r.f.keywords || []).some((k) => k.toLowerCase().includes(q)));
  if (!flat) { // たたんだフォルダの子は出さない
    const hide = new Set(); shown = shown.filter((r) => { if (r.f.parent && (hide.has(r.f.parent) || kwUi.fold.has(r.f.parent))) { hide.add(r.f.id); return false; } return true; });
  }
  if (!shown.length) { list.innerHTML = `<p class="kw-empty">${q ? `「${esc(kwUi.q)}」に一致するフォルダ・キーワードはありません。` : "該当するフォルダはありません。"}</p>`; return; }
  list.innerHTML = shown.map(({ f, d, sug }) => {
    const kws = f.keywords || [], hasKids = kids.get(f.id), folded = kwUi.fold.has(f.id), open = kwUi.open === f.id;
    const ic = `<span class="fbg"${f.bg ? ` style="background:${esc(f.bg)}"` : ""}>${f.img ? `<img class="fimg" decoding="async" loading="lazy" src="${esc(f.img)}" alt="">` : `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="${esc(f.color || "#ccc")}" stroke-width="2" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`}</span>`;
    const tg = !flat && hasKids ? `<button type="button" class="kw-tg" data-kwfold="${esc(f.id)}" aria-label="${folded ? "開く" : "たたむ"}" aria-expanded="${!folded}">${folded ? "▸" : "▾"}</button>` : `<span class="kw-tg sp"></span>`;
    const up = flat && f.parent ? `<small class="kw-up">${esc(folderPath(f.parent))} /</small>` : "";
    const fs = !flat && hasKids && folded ? (() => { const s = sub(f.id); return `<small class="kw-fs">サブ ${s.n} ・ ${s.k}個</small>`; })() : "";
    const hit = (k) => q && k.toLowerCase().includes(q) ? " hit" : "";
    return `<div class="kw-r${kws.length ? "" : " kw-no"}" data-kwf="${esc(f.id)}" style="--d:${flat ? 0 : d}">`
      + `<div class="kw-n">${tg}${ic}<div class="kw-t" title="${esc(folderPath(f.id))}">${up}<b>${esc(f.name)}</b></div>${fs}</div>`
      + `<div class="kw-c">${kws.map((k, i) => `<span class="kw-chip${hit(k)}">${esc(k)}<button type="button" data-kwdel="${esc(f.id)}|${i}" aria-label="「${esc(k)}」を削除">✕</button></span>`).join("")}`
      + (open ? `<input class="kw-in" data-kwin="${esc(f.id)}" maxlength="40" placeholder="キーワード(Enterで追加・Escで閉じる)"><button type="button" class="btn s kw-add" data-kwadd="${esc(f.id)}">追加</button>`
        : `<button type="button" class="kw-plus" data-kwopen="${esc(f.id)}" title="キーワードを追加">＋${kws.length ? "" : " キーワード"}</button>`)
      + `</div><div class="kw-m">${sug ? `<small class="kw-s" title="キーワードに合う、まだこのフォルダに入っていないチャンネル">候補 ${sug}</small>` : ""}${f.ignored?.length ? `<button type="button" class="kw-rs" data-kwreset="${esc(f.id)}" title="候補から外したチャンネルを、また候補に出します">無視を解除(${f.ignored.length})</button>` : ""}<small class="kw-cnt">${kws.length ? kws.length + "個" : "未設定"}</small></div></div>`;
  }).join("");
  if (kwUi.open) document.querySelector(`[data-kwin="${CSS.escape(kwUi.open)}"]`)?.focus();
}
async function kwAdd(fid, text) {
  const f = data.folders.find((x) => x.id === fid); if (!f) return;
  const add = text.split(/[\n,、,]+/).map((x) => x.trim()).filter(Boolean); if (!add.length) return;
  f.keywords = [...new Set([...(f.keywords || []), ...add])];
  kwUi.open = fid; await persist(); paintKw(); render(); // 続けて入力できるよう、追加欄は開いたまま
}
$("set-kw").addEventListener("click", async (e) => {
  const t = (s) => e.target.closest(s); let b;
  if ((b = t("[data-kwopen]"))) { kwUi.open = b.dataset.kwopen; return paintKwList(); }
  if ((b = t("[data-kwfold]"))) { const id = b.dataset.kwfold; kwUi.fold.has(id) ? kwUi.fold.delete(id) : kwUi.fold.add(id); kwSaveFold(); return paintKwList(); }
  if ((b = t("[data-kwall]"))) { kwUi.fold = b.dataset.kwall === "open" ? new Set() : new Set(data.folders.filter((x) => data.folders.some((y) => y.parent === x.id)).map((x) => x.id)); kwSaveFold(); return paintKwList(); }
  if ((b = t("[data-kwfilter]"))) { kwUi.filter = b.dataset.kwfilter; document.querySelectorAll("[data-kwfilter]").forEach((x) => x.classList.toggle("on", x === b)); return paintKwList(); }
  if ((b = t("[data-kwadd]"))) { const i = document.querySelector(`[data-kwin="${CSS.escape(b.dataset.kwadd)}"]`); return kwAdd(b.dataset.kwadd, i?.value || ""); }
  if ((b = t("[data-kwdel]"))) { const [fid, i] = b.dataset.kwdel.split("|"), f = data.folders.find((x) => x.id === fid); if (!f?.keywords) return; f.keywords.splice(+i, 1); if (!f.keywords.length) delete f.keywords; await persist(); paintKw(); return render(); }
  if ((b = t("[data-kwreset]"))) { const f = data.folders.find((x) => x.id === b.dataset.kwreset); if (f) { delete f.ignored; await persist(); paintKw(); render(); toast("候補から外した分を元に戻しました"); } }
});
$("set-kw").addEventListener("input", (e) => { if (e.target.id === "kw-q") { kwUi.q = e.target.value; paintKwList(); } });
$("set-kw").addEventListener("keydown", (e) => {
  const i = e.target.closest?.("[data-kwin]"); if (!i || e.isComposing) return;
  if (e.key === "Enter") { e.preventDefault(); kwAdd(i.dataset.kwin, i.value); }
  else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); kwUi.open = ""; paintKwList(); }
});
// 設定のタブ(一般 / チャンネルのキーワード)
function setSetTab(k) {
  $("set-gen").hidden = k !== "gen"; $("set-kw").hidden = k !== "kw"; $("set-home").hidden = k !== "home"; $("set-sync").hidden = k !== "sync"; $("set-tags").hidden = k !== "tags"; $("set-log").hidden = k !== "log"; if (k === "log") paintLog();
  if (k === "tags" && typeof paintTags === "function") paintTags(); // tags.js
  document.querySelectorAll("[data-settab]").forEach((b) => { const on = b.dataset.settab === k; b.classList.toggle("on", on); b.setAttribute("aria-selected", on); });
  if (k === "gen" && typeof paintLook === "function") paintLook();
  if (k === "kw") paintKw();
  if (k === "sync" && typeof paintSync === "function") paintSync();
}
document.addEventListener("click", (e) => { const b = e.target.closest("[data-settab]"); if (b) setSetTab(b.dataset.settab); });

/* ===== サイドバーのフォルダをドラッグで並べ替え・入れ子にする =====
   行の上のほうに落とす = その前へ / 下のほうに落とす = その後ろへ / 真ん中に落とす = そのフォルダの中(サブフォルダ)へ
   「未分類」の行に落とす = 一番上の階層の最後へ */
let dragFd = null;
const clearFdMarks = () => document.querySelectorAll(".drop-before,.drop-after,.drop-into").forEach((x) => x.classList.remove("drop-before", "drop-after", "drop-into"));
const fdPos = (e, el) => { const r = el.getBoundingClientRect(), y = (e.clientY - r.top) / r.height; return y < 0.28 ? "before" : y > 0.72 ? "after" : "into"; };
async function moveFolderTo(id, targetId, pos) {
  const f = data.folders.find((x) => x.id === id); if (!f) return;
  if (pos === "root") {
    data.folders = data.folders.filter((x) => x !== f); delete f.parent; data.folders.push(f);
  } else {
    const t = data.folders.find((x) => x.id === targetId); if (!t || t === f) return;
    if (desc(id).includes(targetId)) return toast("フォルダを、その中のフォルダへは移動できません");
    const lastOf = (fid) => Math.max(...desc(fid).map((i) => data.folders.findIndex((x) => x.id === i))); // そのフォルダと子孫の最後の位置
    data.folders = data.folders.filter((x) => x !== f);
    if (pos === "into") { f.parent = t.id; folded.delete(t.id); ls.set("tf-home-folded", JSON.stringify([...folded])); data.folders.splice(lastOf(t.id) + 1, 0, f); }
    else { if (t.parent) f.parent = t.parent; else delete f.parent; data.folders.splice(pos === "after" ? lastOf(t.id) + 1 : data.folders.indexOf(t), 0, f); }
  }
  await persist(); render();
}
document.addEventListener("dragstart", (e) => {
  const r = e.target.closest?.("[data-fdrag]"); if (!r) return;
  dragFd = r.dataset.fdrag; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", dragFd); r.classList.add("dragging"); closeFolderMenu();
});
document.addEventListener("dragend", () => { dragFd = null; clearFdMarks(); document.querySelectorAll("[data-fdrag].dragging").forEach((x) => x.classList.remove("dragging")); });
document.addEventListener("dragover", (e) => {
  if (!dragFd) return;
  const r = e.target.closest?.("[data-fdrag]"), u = e.target.closest?.('#nav-list [data-t="uncat"]');
  if (r && r.dataset.fdrag !== dragFd) { e.preventDefault(); clearFdMarks(); r.classList.add("drop-" + fdPos(e, r)); }
  else if (u) { e.preventDefault(); clearFdMarks(); u.classList.add("drop-before"); }
});
document.addEventListener("drop", (e) => {
  if (!dragFd) return;
  const r = e.target.closest?.("[data-fdrag]"), u = e.target.closest?.('#nav-list [data-t="uncat"]'), id = dragFd;
  if (r && r.dataset.fdrag !== id) { e.preventDefault(); const pos = fdPos(e, r); dragFd = null; clearFdMarks(); moveFolderTo(id, r.dataset.fdrag, pos); }
  else if (u) { e.preventDefault(); dragFd = null; clearFdMarks(); moveFolderTo(id, null, "root"); }
});

/* ---------- フォルダの編集ダイアログ(左に大きなプレビュー、右に名前。おすすめの配色をワンクリックで選び、細かい調整は下で。「保存」で反映) ---------- */
// [名前, アイコンの色, 背景色]
const FED_THEMES = [
  ["標準", "#ccc", ""], ["オレンジ", "#ffb74d", "#4a2a0a"], ["レッド", "#ff6b6b", "#4a1414"], ["ピンク", "#f472b6", "#4a1430"],
  ["パープル", "#c4a1ff", "#2e1a52"], ["ブルー", "#6cb6ff", "#112a52"], ["ティール", "#4fd1c5", "#0d3b38"], ["グリーン", "#6ee7a0", "#12381f"],
  ["ゴールド", "#fde047", "#3d3408"], ["モノクロ", "#ffffff", "#2b2b2b"],
];
const FED_ICONS = ["#ccc", "#ffb74d", "#ff6b6b", "#f472b6", "#c4a1ff", "#6cb6ff", "#4fd1c5", "#6ee7a0", "#fde047", "#ffffff"];
const FED_BGS = ["", "#ffffff", "#2b2b2b", "#4a2a0a", "#4a1414", "#4a1430", "#2e1a52", "#112a52", "#0d3b38", "#12381f", "#3d3408"];
function openFolderEditor(id) {
  const f = data.folders.find((x) => x.id === id); if (!f) return;
  const st = { name: f.name, color: f.color || "#ccc", bg: f.bg || "", img: f.img || "" };
  $("fed")?.remove();
  const dlg = document.createElement("dialog"); dlg.id = "fed";
  const hex = (v, d) => (/^#[0-9a-f]{6}$/i.test(v) ? v : d);
  const folderSvg = (c, s = 22) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="${esc(c)}" stroke-width="2" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`;
  const tile = (c, bg, img, s = 22) => `<span class="fbg" ${bg ? `style="background:${esc(bg)}"` : ""}>${img ? `<img class="fimg" decoding="async" loading="lazy" src="${esc(img)}" alt="">` : folderSvg(c, s)}</span>`;
  const sw = (kind, list, cur) => list.map((c) => `<button type="button" class="fed-s ${c === cur ? "on" : ""} ${c ? "" : "none"}" data-${kind}="${c}" title="${c || "なし"}" ${c ? `style="background:${c}"` : ""}></button>`).join("");
  dlg.innerHTML = `<div class="fed-top">
      <button type="button" class="fed-big" data-fed="img" title="クリックまたは画像をドラッグして変更"><span class="fed-pv"></span><span class="fed-cam">🖼 画像を変更</span></button>
      <div class="fed-nm"><label>フォルダの名前</label><input class="fed-in" data-fed="name" maxlength="40" placeholder="フォルダ名"><div class="fed-ib"><button type="button" class="btn s" data-fed="img">🖼 画像を取り込む</button><button type="button" class="btn s" data-fed="imgclear" title="画像の四隅の色(黒など)を背景とみなして透明にします。背景色が見えるようになります">✂ 元の背景を透明に</button><button type="button" class="fed-link" data-fed="imgdel">画像を外す</button></div></div>
    </div>
    <div class="fed-sec"><h3>アイコンの背景色</h3><div class="fed-sws" data-row="bg"></div></div>
    <div class="fed-act">${f.parent ? `<button type="button" class="btn s fed-l" data-fed="unnest">入れ子を解除</button>` : ""}<button type="button" class="btn s fed-l fed-del" data-fed="del">削除</button><button type="button" class="btn s" data-fed="cancel">キャンセル</button><button type="button" class="btn p" data-fed="save">保存</button></div>`;
  document.body.append(dlg);
  const custom = (k) => `<label class="fed-s fed-c" title="好きな色を選ぶ">＋<input type="color" data-fed="${k}"></label>`;
  const paint = (full = true) => {
    dlg.querySelector(".fed-pv").innerHTML = tile(st.color, st.bg, st.img, 40);
    dlg.querySelector("[data-fed=imgdel]").hidden = dlg.querySelector("[data-fed=imgclear]").hidden = !st.img;
    dlg.querySelector(".fed-big").classList.toggle("has", !!st.img);
    dlg.querySelector("[data-row=bg]").innerHTML = sw("bg", FED_BGS, st.bg) + custom("bg");
    dlg.querySelector("input[data-fed=bg]").value = hex(st.bg, "#333333");
  };
  dlg.querySelector("[data-fed=name]").value = st.name;
  dlg.addEventListener("input", (e) => {
    const k = e.target.dataset.fed; if (!k) return;
    if (k === "name") st.name = e.target.value; else if (k === "color") st.color = e.target.value; else if (k === "bg") st.bg = e.target.value;
    if (k !== "name") paint();
  });
  dlg.addEventListener("click", (e) => {
        const sb = e.target.closest("button[data-bg]"); if (sb) { st.bg = sb.dataset.bg; return paint(); }
    const k = e.target.closest("button[data-fed]")?.dataset.fed;
    if (k === "cancel") dlg.close();
    else if (k === "unnest") { dlg.close(); unnestFolder(id); }
    else if (k === "del") { dlg.close(); deleteFolder(id); }
    else if (k === "imgclear") clearImgBg(st.img, (u) => { st.img = u; paint(); });
    else if (k === "imgdel") { st.img = ""; paint(); }
    else if (k === "img") imageToData((u) => { st.img = u; paint(); });
    else if (k === "save") {
      const name = st.name.trim() || f.name;
      f.name = name;
      if ((f.bg || "") !== st.bg || (f.img || "") !== st.img || f.color !== st.color) f.icoAt = Date.now(); // 見た目を変えた時刻(同期で、新しい方のアイコンを残すため)
      f.color = st.color; st.bg ? (f.bg = st.bg) : delete f.bg; st.img ? (f.img = st.img) : delete f.img;
      persist().then(() => { render(); toast(`「${name}」を保存しました`); }); dlg.close();
    }
  });
  // 画像をプレビューへドラッグして変更
  const big = dlg.querySelector(".fed-big");
  big.addEventListener("dragover", (e) => { e.preventDefault(); big.classList.add("drag"); });
  big.addEventListener("dragleave", () => big.classList.remove("drag"));
  big.addEventListener("drop", (e) => { e.preventDefault(); big.classList.remove("drag"); const fl = e.dataTransfer.files?.[0]; if (fl?.type.startsWith("image/")) imageToData((u) => { st.img = u; paint(); }, fl); });
  dlg.addEventListener("close", () => dlg.remove());
  dlg.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.dataset?.fed === "name" && !e.isComposing) { e.preventDefault(); dlg.querySelector("[data-fed=save]").click(); } });
  paint(); dlg.showModal(); dlg.querySelector("[data-fed=name]").select();
}
function imageToData(cb, dropped) { // 画像(選ぶ・ドロップ)を、64×64 に中央で切り抜いた data URL にして返す
  // accept は拡張子で並べる。「image/*」だと Windows では、ファイル選択を開く前に画像の種類を全部調べるので、開くのがワンテンポ遅れる
  const inp = document.createElement("input"); inp.type = "file"; inp.accept = ".png,.jpg,.jpeg,.jfif,.gif,.webp,.avif,.bmp,.ico,.svg";
  inp.style.display = "none"; document.body.append(inp); // 画面に付けておく(付けないと、選ぶ前に破棄されて、反応しないことがある)
  inp.addEventListener("cancel", () => inp.remove());
  inp.onchange = () => {
    const file = dropped || inp.files?.[0]; inp.remove(); if (!file) return;
    const url = URL.createObjectURL(file), im = new Image();
    im.onload = () => {
      const S = 64, cv = document.createElement("canvas"); cv.width = cv.height = S; const k = Math.min(S / im.width, S / im.height); const w = im.width * k, h = im.height * k; // 全体を収める(余白は透明のまま。背景色が透けて見える)
      cv.getContext("2d").drawImage(im, (S - w) / 2, (S - h) / 2, w, h); URL.revokeObjectURL(url);
      cb(cv.toDataURL("image/webp", 0.85));
    };
    im.onerror = () => { URL.revokeObjectURL(url); toast("画像を読み込めませんでした"); };
    im.src = url;
  };
  dropped ? inp.onchange() : inp.click();
}
function clearImgBg(src, cb) { // 画像の四隅の色に近い、外側からつながる部分を透明にする(黒い背景の画像などを、背景色が透けるように)
  const im = new Image();
  im.onload = () => {
    const W = im.width, H = im.height, cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const cx = cv.getContext("2d"); cx.drawImage(im, 0, 0);
    const d = cx.getImageData(0, 0, W, H), p = d.data, idx = (x, y) => (y * W + x) * 4;
    const c = idx(0, 0), ref = [p[c], p[c + 1], p[c + 2]];
    if (p[c + 3] < 250) return cb(src); // 最初から透明なら何もしない
    const near = (i) => p[i + 3] > 0 && Math.abs(p[i] - ref[0]) + Math.abs(p[i + 1] - ref[1]) + Math.abs(p[i + 2] - ref[2]) < 90;
    const seen = new Uint8Array(W * H), st = [];
    for (let x = 0; x < W; x++) st.push([x, 0], [x, H - 1]);
    for (let y = 0; y < H; y++) st.push([0, y], [W - 1, y]);
    while (st.length) {
      const [x, y] = st.pop(); if (x < 0 || y < 0 || x >= W || y >= H || seen[y * W + x]) continue;
      seen[y * W + x] = 1; const i = idx(x, y); if (!near(i)) continue;
      p[i + 3] = 0; st.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    cx.putImageData(d, 0, 0); cb(cv.toDataURL("image/webp", 0.85));
  };
  im.src = src;
}
