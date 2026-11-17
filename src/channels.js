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

/* ---------- チャンネル一覧(登録チャンネル / フォルダ / 未分類) ---------- */
function channelsView(t) {
  const list = chIn(t), f = data.folders.find((x) => x.id === t);
  const last = +ls.get("tf-ch-sync", "0");
  const sync = t === "channels" ? `<button class="btn s" data-act="sync" ${syncing ? "disabled" : ""}>${syncing ? "同期中…" : "⟳ YouTubeと同期"}</button><span class="sync-i">${useDummy ? "ダミー表示中(設定で切り替え)" : last ? "最終同期 " + new Date(last).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "未同期"}</span>` : "";
  const sib = f ? data.folders.filter((x) => (x.parent || "") === (f.parent || "")) : [], si = f ? sib.indexOf(f) : -1;
  const mv = f ? `<button class="btn s" data-act="up" data-id="${esc(f.id)}" ${si <= 0 ? "disabled" : ""} title="フォルダを上へ">▲ 上へ</button><button class="btn s" data-act="down" data-id="${esc(f.id)}" ${si >= sib.length - 1 ? "disabled" : ""} title="フォルダを下へ">▼ 下へ</button>${f.parent ? `<button class="btn s" data-act="unnest" data-id="${esc(f.id)}" title="親フォルダの外(ひとつ上の階層)へ出します">入れ子を解除</button>` : ""}` : "";
  const fa = f ? mv + `<button class="btn s" data-act="kw" data-id="${esc(f.id)}">🔎 キーワード${f.keywords?.length ? `(${f.keywords.length})` : ""}</button><button class="btn s" data-act="addsub" data-id="${esc(f.id)}">＋ サブフォルダ</button><button class="btn s" data-act="rename" data-id="${esc(f.id)}">名前を変更</button><button class="btn s" data-act="delfolder" data-id="${esc(f.id)}">フォルダを削除</button>` : "";
  const subs = f && kids(f.id).length ? `<div class="subs">${kids(f.id).map((k) => `<button class="tab" data-t="${esc(k.id)}" data-drop="${esc(k.id)}">📁 ${esc(k.name)} <small>${chIn(k.id).length}</small></button>`).join("")}</div>` : "";
  const crumb = f && f.parent ? `<div class="crumb"><button class="tab" data-t="${esc(f.parent)}">↑ ${esc(folderPath(f.parent))}</button></div>` : "";
  const empty = t === "channels"
    ? (useDummy ? "ダミーのチャンネルを準備しています…" : "登録チャンネルがありません。「YouTubeと同期」を押すと、YouTubeの登録チャンネルを取り込みます。")
    : "このフォルダにはチャンネルがありません。チャンネルの📁ボタンか、ドラッグで追加できます。";
  return `<section class="row"><h2>${esc(folderName(t))}<small>${list.length}チャンネル</small></h2>${crumb}<div class="ch-bar">${sync}${fa}</div>${subs}${sgPanel(t)}${list.length ? `<div class="ch-grid">${list.map((c) => chCard(c, f ? f.id : "")).join("")}</div>` : `<div class="empty" style="margin-top:0">${empty}</div>`}</section>`;
}

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
  const ids = desc(id);
  if (!confirm(`フォルダ「${folderName(id)}」を削除します。\nチャンネルは「未分類」に戻ります(チャンネル自体は削除されません)。`)) return;
  data.folders = data.folders.filter((f) => !ids.includes(f.id));
  for (const c of Object.values(data.channels || {})) c.folders = (c.folders || []).filter((x) => !ids.includes(x));
  for (const v of Object.values(data.videos)) v.folders = (v.folders || []).filter((x) => !ids.includes(x));
  tab = "channels"; await persist(); render();
}

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
function openAssign(id) {
  const c = data.channels?.[id]; if (!c) return;
  assignId = id;
  $("chd-t").textContent = c.name;
  $("chd-list").innerHTML = data.folders.length
    ? data.folders.map((f) => `<label class="set-row"><span>${esc(folderPath(f.id))}</span><input type="checkbox" data-fid="${esc(f.id)}" ${(c.folders || []).includes(f.id) ? "checked" : ""}></label>`).join("")
    : `<p class="hint">フォルダがありません。サイドバーの「フォルダを追加」で作成してください。</p>`;
  $("chd").showModal();
}
$("chd-list").addEventListener("change", async (e) => {
  const fid = e.target.dataset.fid, c = data.channels?.[assignId]; if (!fid || !c) return;
  const s = new Set(c.folders || []); e.target.checked ? s.add(fid) : s.delete(fid);
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
$("set-dummy").addEventListener("change", () => { ensureDummy(); if (!useDummy && !chAll().length) syncSubs(true); });

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
    else if (a === "addfolder") askFolder(null);
    else if (a === "rename") askFolder(b.dataset.id);
    else if (a === "addsub") askFolder(null, b.dataset.id);
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
document.addEventListener("dragstart", (e) => { const c = e.target.closest?.(".ch"); if (c) { dragCh = c.dataset.chid; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", dragCh); c.classList.add("dragging"); } });
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
  if (list.length > 20 && !confirm(`${list.length}件を「${folderName(fid)}」に追加します。よろしいですか?`)) return;
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
