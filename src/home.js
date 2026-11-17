const KEY = "tubefolio";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ls = { get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
let data = { folders: [], videos: {}, bookmarks: [] };
let tab = "all", heroI = 0, heroT = null;
const thumb = (id, k = "mqdefault") => `https://i.ytimg.com/vi/${id}/${k}.jpg`;
const all = () => Object.entries(data.videos).sort((a, b) => (b[1].savedAt || "").localeCompare(a[1].savedAt || ""));
const kids = (id) => data.folders.filter((f) => f.parent === id);
const desc = (id, seen = new Set()) => { if (seen.has(id)) return []; seen.add(id); return [id, ...kids(id).flatMap((k) => desc(k.id, seen))]; }; // 入れ子の子孫すべて
const depthOf = (f) => { let d = 0, p = f, n = 0; while (p?.parent && n++ < 20) { p = data.folders.find((x) => x.id === p.parent); d++; } return d; };
const inF = (v, id) => desc(id).some((x) => v.folders.includes(x));
const SECTIONS = [["resume", "視聴を再開"], ["later", "TubeFolio2 後で見る"], ["pl", "再生リスト"], ["savedpl", "ライブラリ: 保存した再生リスト"], ["saved", "ライブラリ: 保存した動画"]];
let hidden = new Set((() => { try { return JSON.parse(ls.get("tf-home-hidden", "[]")); } catch { return []; } })());
const on = (k) => !hidden.has(k);
const KEYS = SECTIONS.map(([k]) => k);
let order = (() => { let o = []; try { o = JSON.parse(ls.get("tf-home-order", "[]")); } catch {} return [...o.filter((k) => KEYS.includes(k)), ...KEYS.filter((k) => !o.includes(k))]; })(); // ホームの並び順
let hpl = new Set((() => { try { return JSON.parse(ls.get("tf-home-hpl", "[]")); } catch { return []; } })()); // ホームで非表示にする再生リスト
const plId = (p) => p.id || "dummy" + p.n;
let folded = new Set((() => { try { return JSON.parse(ls.get("tf-home-folded", "[]")); } catch { return []; } })()); // サイドバーで閉じているフォルダ
const vmap = new Map(); // 再生ダイアログ用: 動画ID -> {title, channel}
const dummyTh = (i) => `<div class="dm" style="--h:${(i * 47 + 200) % 360}"></div>`;
const card = ([id, v]) => {
  if (v.dummy) { const pg = v.pct ? `<span class="pg"><i style="width:${v.pct}%"></i></span>` : ""; return `<div class="c ${subCls(v)}"><div class="th">${dummyTh(v.n)}${v.duration ? `<span class="dur">${esc(v.duration)}</span>` : ""}${pg}</div><b>${esc(v.title)}</b>${cn(v)}</div>`; }
  vmap.set(id, v);
  const pct = v.pct ? `<span class="pg"><i style="width:${Math.min(100, v.pct)}%"></i></span>` : "";
  return `<button class="c ${subCls(v)}" data-v="${esc(id)}"><div class="th"><img loading="lazy" src="${thumb(id)}" alt="">${v.duration ? `<span class="dur">${esc(v.duration)}</span>` : ""}${pct}${bmBtn(id)}</div><b>${esc(v.title)}</b>${cn(v)}</button>`;
};
const plCard = (p) => p.dummy ? `<div class="c"><div class="th">${dummyTh(p.n)}<span class="dur">再生リスト</span></div><b>${esc(p.title)}</b><small>${esc(p.channel || "")}</small></div>` : `<a class="c" href="library.html#pl:${encodeURIComponent(p.id)}" title="ライブラリ管理で開く"><div class="th">${p.thumb ? `<img loading="lazy" src="${esc(p.thumb)}" alt="">` : `<img alt="" src="icons/icon-128.png" style="object-fit:contain;padding:18px">`}<span class="dur">再生リスト</span></div><b>${esc(p.title)}</b><small>${esc(p.channel || "")}</small></a>`;
const seeAll = (key) => key ? `<button class="seeall" data-t="${esc(key)}">すべて表示 ›</button>` : "";
const rail = (title, cards, n, unit = "本", key = "") => `<section class="row"><h2>${key ? `<button class="h2l" data-t="${esc(key)}">${esc(title)}</button>` : esc(title)}<small>${n}${unit}</small>${seeAll(key)}</h2><div class="rail"><button class="arrow l" data-s="-1" aria-label="前へ">‹</button><div class="track">${cards}</div><button class="arrow r" data-s="1" aria-label="次へ">›</button></div></section>`;
const row = (title, items, key = "") => items.length ? rail(title, items.map(card).join(""), items.length, "本", key) : "";
const note = (title, msg) => `<section class="row"><h2>${esc(title)}</h2><div class="empty" style="margin:6px 32px 14px">${msg}</div></section>`;
const tabsHtml = () => [["all", "すべて"], ["channels", "登録チャンネル"], ...data.folders.filter((f) => !f.parent).map((f) => [f.id, f.name]), ["uncat", "未分類"]].map(([id, n]) => `<button class="tab ${tab === id ? "on" : ""}" data-t="${id}">${esc(n)}</button>`).join("");

function renderNav() {
  const home = `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M3 11l9-8 9 8v10h-6v-6H9v6H3z"/></svg>`;
  const people = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2a6.5 6.5 0 0 1 3.5 5.8"/></svg>`;
  const fico = (c) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`;
  const cnt = (id) => `<span class="n lbl">${chIn(id).length}</span>`;
  const item = (id, ico, name, extra = "") => `<button class="ni ${tab === id ? "on" : ""}" data-t="${id}" data-drop="${id === "channels" ? "" : id}" title="${esc(name)}">${ico}<span class="lbl">${esc(name)}</span>${extra}</button>`;
  let h = `<button class="ni ${tab === "all" || tab.startsWith("list:") ? "on" : ""}" data-t="all" title="ホーム">${home}<span class="lbl">ホーム</span></button>`;
  h += `<button class="ni ${tab === "search" ? "on" : ""}" data-t="search" title="検索"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><span class="lbl">検索</span></button>`;
  h += `<button class="ni ${tab === "bookmarks" ? "on" : ""}" data-t="bookmarks" title="ブックマーク"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M6 3h12v18l-6-4-6 4z"/></svg><span class="lbl">ブックマーク</span></button>`;
  h += `<div class="nav-h">フォルダ</div>`;
  h += item("channels", people, "すべて", cnt("channels")).replace('data-drop=""', "");
  const chev = (f) => kids(f.id).length ? `<span class="chev ${folded.has(f.id) ? "" : "open"}" data-fold="${esc(f.id)}" role="button" aria-label="${folded.has(f.id) ? "開く" : "閉じる"}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></span>` : "";
  const tree = (parent, depth) => data.folders.filter((x) => (x.parent || "") === parent && (parent || !x.parent)).map((f) => (depth === 0
    ? item(f.id, fico(f.color || "#ccc"), f.name, cnt(f.id) + chev(f))
    : `<button class="ni sub ${tab === f.id ? "on" : ""}" style="padding-left:${12 + depth * 18}px" data-t="${f.id}" data-drop="${f.id}" title="${esc(f.name)}">${fico(f.color || "#ccc")}<span class="lbl">${esc(f.name)}</span>${cnt(f.id)}${chev(f)}</button>`)
    + (folded.has(f.id) && !document.body.classList.contains("rail") ? "" : tree(f.id, depth + 1))).join("");
  h += tree("", 0);
  h += item("uncat", fico("#777"), "未分類", cnt("uncat"));
  h += `<button class="ni ${tab === "test" ? "on" : ""}" data-t="test" title="テスト"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2.2h12.4a1.5 1.5 0 0 0 1.3-2.2L14 9V3"/><path d="M7.5 15h9"/></svg><span class="lbl">テスト</span></button>`;
  h += `<button class="ni add" data-act="addfolder" title="フォルダを追加"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg><span class="lbl">フォルダを追加</span></button>`;
  $("nav-list").innerHTML = h;
  // 上部のタブバーは廃止(サイドバーで切り替える)
}

function renderHero(list) {
  const picks = list.slice(0, 5);
  if (!picks.length) return "";
  heroI %= picks.length;
  const [id, v] = picks[heroI];
  const fn = data.folders.find((f) => v.folders.includes(f.id));
  return `<section class="hero"><div class="hero-bg" style="background-image:url(${thumb(id, "maxresdefault")}),url(${thumb(id, "hqdefault")})"></div>
    <div class="hero-in"><span class="badge">${heroI === 0 ? "最近保存" : "ピックアップ"}</span><h1>${esc(v.title)}</h1><p>${esc(v.channel)}${fn ? " ・ " + esc(fn.name) : ""}</p>
    <div class="btns"><button class="btn p" data-v="${id}">▶ 再生する</button><a class="btn s" href="library.html">ライブラリで管理</a></div></div>
    <div class="dots">${picks.map(([i], n) => `<button class="${n === heroI ? "on" : ""}" data-h="${n}" style="background-image:url(${thumb(i)})" aria-label="${n + 1}"></button>`).join("")}</div></section>`;
}

function swapHero() { // ヒーローだけ差し替える(横スクロール中の行の位置を保つため、全体は描画し直さない)
  const el = $("main").querySelector(".hero"); if (!el) return;
  const t = document.createElement("div"); t.innerHTML = renderHero(all());
  if (t.firstElementChild) el.replaceWith(t.firstElementChild);
}
function render() {
  renderNav();
  const list = all();
  let h = "";
  if (tab === "all") {
    h += renderHero(list);
    for (const k of order) if (on(k)) h += SEC[k]();
  } else {
    h += tab.startsWith("list:") ? listView(tab.slice(5)) : tab === "search" ? searchView() : tab === "bookmarks" ? bookmarksView() : tab === "test" ? testView() : channelsView(tab);
  }
  $("main").innerHTML = h;
  clearInterval(heroT);
  if ($("main").querySelector(".hero")) heroT = setInterval(() => { if (!$("pl").open) { heroI++; swapHero(); } }, 8000);
}

function openV(id) {
  const v = data.videos[id] || vmap.get(id); if (!v) return;
  $("pl-f").src = `https://www.youtube.com/embed/${id}?autoplay=1&rel=0&enablejsapi=1`;
  $("pl-t").textContent = v.title; $("pl-m").textContent = v.channel; $("pl-o").href = `https://www.youtube.com/watch?v=${id}`;
  $("pl-bm").dataset.bm = id; $("pl-bm").classList.toggle("on", isBm(id));
  $("pl").showModal();
}
$("pl").addEventListener("close", () => { $("pl-f").src = "about:blank"; });
$("pl-x").onclick = () => $("pl").close();
$("pl").addEventListener("click", (e) => { if (e.target === $("pl")) $("pl").close(); });

document.addEventListener("click", (e) => {
  const t = (s) => e.target.closest(s);
  let b;
  if ((b = t("[data-fold]"))) { const id = b.dataset.fold; folded.has(id) ? folded.delete(id) : folded.add(id); ls.set("tf-home-folded", JSON.stringify([...folded])); return renderNav(); }
  if ((b = t("[data-bm]"))) { e.preventDefault(); return bmToggle(b.dataset.bm); }
  if ((b = t("[data-v]"))) return openV(b.dataset.v);
  if ((b = t("[data-t]"))) { tab = b.dataset.t; scrollTo(0, 0); if (innerWidth <= 820) document.body.classList.remove("nav-on"); return render(); }
  if ((b = t("[data-h]"))) { heroI = +b.dataset.h; return swapHero(); }
  if ((b = t("[data-s]"))) { const tr = b.parentElement.querySelector(".track"); tr.scrollBy({ left: +b.dataset.s * tr.clientWidth * 0.8, behavior: "smooth" }); }
});
$("menu").onclick = () => {
  if (innerWidth <= 820) document.body.classList.toggle("nav-on");
  else { document.body.classList.toggle("rail"); ls.set("tf-home-rail", document.body.classList.contains("rail") ? "1" : "0"); }
};
if (ls.get("tf-home-rail", "0") === "1") document.body.classList.add("rail");

chrome.storage.local.get(KEY).then((r) => { if (r[KEY]) data = r[KEY]; render(); });
chrome.storage.onChanged.addListener((c) => { if (c[KEY]) { data = c[KEY].newValue; render(); } });

/* ---------- YouTubeにログイン中のアカウント(左下) ---------- */
const sha1hex = async (t) => [...new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(t)))].map((x) => x.toString(16).padStart(2, "0")).join("");
async function authHeader() {
  const get = async (n) => (await chrome.cookies.get({ url: "https://www.youtube.com", name: n }).catch(() => null))?.value || "";
  const sid = (await get("SAPISID")) || (await get("__Secure-3PAPISID"));
  if (!sid) return "";
  const ts = Math.floor(Date.now() / 1000), o = "https://www.youtube.com";
  const part = async (l, v) => `${l} ${ts}_${await sha1hex(`${ts} ${v} ${o}`)}`;
  const out = [await part("SAPISIDHASH", sid)];
  const p1 = await get("__Secure-1PAPISID"), p3 = await get("__Secure-3PAPISID");
  if (p1) out.push(await part("SAPISID1PHASH", p1));
  if (p3) out.push(await part("SAPISID3PHASH", p3));
  return out.join(" ");
}
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
async function fetchAccount() {
  const html = await (await fetch("https://www.youtube.com/", { credentials: "include" })).text();
  const context = jsonAfter(html, '"INNERTUBE_CONTEXT":');
  const version = (html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/) || [])[1] || context?.client?.clientVersion || "";
  if (!context) return null;
  const headers = { "Content-Type": "application/json", "X-Youtube-Client-Name": "1", "X-Youtube-Client-Version": version, "X-Origin": "https://www.youtube.com", "X-Goog-AuthUser": "0" };
  const a = await authHeader(); if (!a) return { signedOut: true };
  headers.Authorization = a;
  const r = await fetch("https://www.youtube.com/youtubei/v1/account/account_menu?prettyPrint=false", { method: "POST", credentials: "include", headers, body: JSON.stringify({ context }) });
  if (!r.ok) throw new Error("http " + r.status);
  const j = await r.json();
  const h = j?.actions?.[0]?.openPopupAction?.popup?.multiPageMenuRenderer?.header?.activeAccountHeaderRenderer;
  if (!h) return { signedOut: true };
  const th = h.accountPhoto?.thumbnails || [];
  return { name: h.accountName?.simpleText || "", email: h.email?.simpleText || "", handle: h.channelHandle?.simpleText || "", photo: th[th.length - 1]?.url || "" };
}
function showAccount(a) {
  const img = $("acct-img"), ph = $("acct-ph");
  if (!a || a.signedOut) { $("acct-name").textContent = "未ログイン"; $("acct-sub").textContent = "YouTubeにログインしてください"; img.hidden = true; ph.hidden = false; $("acct").style.cursor = "pointer"; $("acct").onclick = () => window.open("https://accounts.google.com/ServiceLogin?service=youtube", "_blank", "noopener"); return; }
  $("acct-name").textContent = a.name || "YouTube";
  $("acct-sub").textContent = a.email || a.handle || "";
  $("acct").title = [a.name, a.email, a.handle].filter(Boolean).join(" / ");
  if (a.photo) { img.src = a.photo; img.hidden = false; ph.hidden = true; }
}
(async () => {
  try { const c = JSON.parse(ls.get("tf-acct", "null")); if (c) showAccount(c); } catch {}
  try { const a = await fetchAccount(); if (a) { showAccount(a); if (!a.signedOut) ls.set("tf-acct", JSON.stringify(a)); } } catch { if (!ls.get("tf-acct", "")) { $("acct-name").textContent = "YouTube"; $("acct-sub").textContent = "取得できませんでした"; } }
})();

/* ---------- ホームの一覧: 視聴を再開 / 後で見る / 残りの再生リスト ---------- */
let useDummy = ls.get("tf-home-dummy", "1") === "1";
const mk = (n, title, channel, extra = {}) => [`dummy${n}`, { dummy: true, n, title, channel, duration: "12:34", ...extra }];
const DUMMY = {
  resume: [["【ダミー】作業用BGM 集中できる音楽", "Dummy Music", 35], ["【ダミー】はじめてのプログラミング入門", "Dummy Academy", 62], ["【ダミー】世界の絶景ドライブ 4K", "Dummy Travel", 18], ["【ダミー】15分で作る簡単晩ごはん", "Dummy Kitchen", 80], ["【ダミー】英会話フレーズ集", "Dummy English", 45], ["【ダミー】猫のおもしろ動画まとめ", "Dummy Pets", 27]].map(([t, c, p], i) => mk(i + 1, t, c, { pct: p })),
  later: [["【ダミー】あとで見たい解説動画 1", "Dummy Channel A"], ["【ダミー】あとで見たい解説動画 2", "Dummy Channel B"], ["【ダミー】あとで見たいライブ配信", "Dummy Channel C"], ["【ダミー】あとで見たいレビュー", "Dummy Channel D"], ["【ダミー】あとで見たい講義", "Dummy Channel E"]].map(([t, c], i) => mk(i + 11, t, c)),
  own: ["お気に入り", "作業用", "勉強", "料理レシピ", "旅行"].map((t, i) => ({ dummy: true, n: i + 21, title: `【ダミー】${t}`, channel: "" })),
  saved: ["おすすめ音楽ミックス", "人気の解説シリーズ", "プログラミング講座", "ライブ映像まとめ"].map((t, i) => ({ dummy: true, n: i + 31, title: `【ダミー】${t}`, channel: "Dummy Channel" })),
};
const pls = () => useDummy ? [...DUMMY.own.map((p) => ({ ...p, kind: "own" })), ...DUMMY.saved.map((p) => ({ ...p, kind: "saved" }))] : (data.playlists || []);
const LATER = (p) => /TubeFolio2/i.test(p.title || "") && /後で見る/.test(p.title || "");
const laterPl = () => useDummy ? { id: "dummy-later", title: "TubeFolio2 後で見る" } : pls().find(LATER);
let cache = (() => { try { return JSON.parse(ls.get("tf-home-cache", "{}")); } catch { return {}; } })();
const saveCache = () => ls.set("tf-home-cache", JSON.stringify(cache));
const ytInit = async (url) => {
  const html = await (await fetch(url, { credentials: "include" })).text();
  const a = html.indexOf("ytInitialData = "), b = html.indexOf(";</script>", a);
  if (a < 0 || b < 0) throw new Error("data");
  return JSON.parse(html.slice(a + 16, b));
};
const txt = (o) => o?.simpleText || o?.runs?.map((r) => r.text).join("") || "";
// 視聴履歴ページから、途中まで見た動画(進捗バー付き)を集める
function collectResume(root) {
  const out = new Map();
  const prog = (n) => { let v = 0; (function w(x) { if (v || !x || typeof x !== "object") return; if (x.thumbnailOverlayResumePlaybackRenderer) { v = x.thumbnailOverlayResumePlaybackRenderer.percentDurationWatched || 0; return; } if (x.thumbnailOverlayProgressBarViewModel) { v = x.thumbnailOverlayProgressBarViewModel.startPercent || 0; return; } Object.values(x).forEach(w); })(n); return v; };
  (function walk(n) {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(walk);
    const r = n.videoRenderer;
    if (r?.videoId) { const pct = prog(r); if (pct > 0 && pct < 96 && !out.has(r.videoId)) out.set(r.videoId, { title: txt(r.title), channel: txt(r.ownerText) || txt(r.longBylineText), duration: txt(r.lengthText), pub: txt(r.publishedTimeText), pct }); }
    const lv = n.lockupViewModel;
    if (lv && /VIDEO/.test(lv.contentType || "") && lv.contentId) {
      const pct = prog(lv.contentImage);
      if (pct > 0 && pct < 96 && !out.has(lv.contentId)) {
        const rows = lv.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows || [];
        let dur = ""; (function w(x) { if (dur || !x || typeof x !== "object") return; if (x.thumbnailBadgeViewModel?.text) { dur = x.thumbnailBadgeViewModel.text; return; } Object.values(x).forEach(w); })(lv.contentImage);
        out.set(lv.contentId, { title: lv.metadata?.lockupMetadataViewModel?.title?.content || lv.contentId, channel: (rows[0]?.metadataParts || []).map((x) => x.text?.content || "").join(" "), duration: dur, pct });
      }
    }
    Object.values(n).forEach(walk);
  })(root);
  return [...out.entries()];
}
function collectPlVideos(root) {
  const out = new Map();
  (function walk(n) {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(walk);
    const r = n.playlistVideoRenderer;
    if (r?.videoId) out.set(r.videoId, { title: txt(r.title), channel: txt(r.shortBylineText), duration: txt(r.lengthText), pub: txt(r.videoInfo).split("•").slice(1).join(" ").trim() });
    const lv = n.lockupViewModel;
    if (lv && /VIDEO/.test(lv.contentType || "") && lv.contentId && !out.has(lv.contentId)) out.set(lv.contentId, { title: lv.metadata?.lockupMetadataViewModel?.title?.content || lv.contentId, channel: "", duration: "" });
    Object.values(n).forEach(walk);
  })(root);
  return [...out.entries()];
}
const resumeRow = () => useDummy ? row("視聴を再開(途中まで見た動画)", DUMMY.resume, "list:resume") : cache.resume?.length ? row("視聴を再開(途中まで見た動画)", cache.resume, "list:resume") : note("視聴を再開(途中まで見た動画)", cache.resumeErr || "読み込み中…");
function laterRow() {
  if (useDummy) return row("TubeFolio2 後で見る", DUMMY.later, "list:later");
  const p = laterPl();
  if (!p) return note("TubeFolio2 後で見る", pls().length ? "「TubeFolio2 後で見る」という名前の再生リストが見つかりません。" : `再生リストをまだ読み込んでいません。<a href="library.html#playlists" style="color:var(--acc)">ライブラリ管理の再生リスト</a>を一度開くと取り込まれます。`);
  const items = cache.later?.[p.id];
  return items?.length ? row("TubeFolio2 後で見る", items, "list:later") : note("TubeFolio2 後で見る", cache.laterErr || "読み込み中…");
}
const kindOf = (p) => p.kind || "manual";
// 再生リスト = 自分で作成したもの(「後で見る」を除く)
const plsOf = (k) => pls().filter((p) => !LATER(p) && (k === "pl" ? kindOf(p) === "own" : kindOf(p) !== "own") && !hpl.has(plId(p)));
const savedRow = () => { const l = all(); return l.length ? row("ライブラリ: 保存した動画", l, "list:saved") : note("ライブラリ: 保存した動画", "まだ動画がありません。YouTubeで📁ボタンから保存しましょう"); };
const SEC = { resume: () => resumeRow(), later: () => laterRow(), pl: () => otherPlRow(), savedpl: () => savedPlRow(), saved: savedRow };
// 「すべて表示」ページ
function listView(k) {
  const back = `<button class="seeall back" data-t="all">‹ ホームへ戻る</button>`;
  const T = Object.fromEntries(SECTIONS);
  let items = [], cards = "", unit = "本";
  if (k === "resume") items = useDummy ? DUMMY.resume : cache.resume || [];
  else if (k === "later") { const p = laterPl(); items = useDummy ? DUMMY.later : (p && cache.later?.[p.id]) || []; }
  else if (k === "saved") items = all();
  if (k === "pl" || k === "savedpl") { const l = plsOf(k); cards = l.map(plCard).join(""); items = l; unit = "件"; }
  else cards = items.map(card).join("");
  return `<section class="row">${back}<h2>${esc(T[k] || "一覧")}<small>${items.length}${unit}</small></h2>${items.length ? vbar() + vgrid(cards) : `<div class="empty" style="margin-top:0">表示できる項目がありません。</div>`}</section>`;
}
function otherPlRow() {
  const rest = plsOf("pl");
  return rest.length ? rail("再生リスト", rest.map(plCard).join(""), rest.length, "件", "list:pl") : "";
}
// ライブラリ = 保存した再生リスト(他人の再生リストなど)と、保存した動画
function savedPlRow() {
  const sv = plsOf("savedpl");
  return sv.length ? rail("ライブラリ: 保存した再生リスト", sv.map(plCard).join(""), sv.length, "件", "list:savedpl") : "";
}
async function refreshHome(force) {
  if (useDummy) return;
  if (!force && Date.now() - (cache.at || 0) < 10 * 60 * 1000) return;
  let changed = false;
  try { cache.resume = collectResume(await ytInit("https://www.youtube.com/feed/history")); cache.resumeErr = cache.resume.length ? "" : "途中まで見た動画はありません(YouTubeにログインし、再生履歴がオンか確認してください)"; changed = true; }
  catch { cache.resumeErr = cache.resume?.length ? "" : "視聴履歴を取得できませんでした(YouTubeへのログインを確認してください)"; }
  const p = laterPl();
  if (p) {
    try { const it = collectPlVideos(await ytInit(`https://www.youtube.com/playlist?list=${encodeURIComponent(p.id)}`)); (cache.later ||= {})[p.id] = it; cache.laterErr = it.length ? "" : "この再生リストに動画がありません"; changed = true; }
    catch { cache.laterErr = cache.later?.[p.id]?.length ? "" : "再生リストを取得できませんでした"; }
  }
  if (changed) cache.at = Date.now();
  saveCache(); render();
}
// 再生リスト一覧が読み込まれたあとに「後で見る」の中身も取りに行く
chrome.storage.local.get(KEY).then(() => refreshHome(false));

/* ---------- YouTubeの📁で登録した動画のタイトル・チャンネルが空なら補う ---------- */
let metaBusy = false;
async function fillMeta() {
  if (metaBusy) return; metaBusy = true;
  try {
    const miss = Object.entries(data.videos).filter(([, v]) => !v.title || !v.channel).slice(0, 20);
    const got = {};
    await Promise.all(miss.map(async ([id]) => {
      try { const j = await (await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent("https://www.youtube.com/watch?v=" + id)}&format=json`)).json(); got[id] = { title: j.title, channel: j.author_name }; } catch {}
    }));
    if (!Object.keys(got).length) return;
    const cur = (await chrome.storage.local.get(KEY))[KEY]; if (!cur) return;
    for (const [id, m] of Object.entries(got)) { const v = cur.videos[id]; if (v) { if (!v.title) v.title = m.title; if (!v.channel) v.channel = m.channel; } }
    await chrome.storage.local.set({ [KEY]: cur });
  } finally { metaBusy = false; }
}
chrome.storage.local.get(KEY).then(() => setTimeout(fillMeta, 500));

/* ---------- 設定 ---------- */
function paintSettings() {
  const T = Object.fromEntries(SECTIONS);
  let h = `<div class="set-h">ホームの並び順と表示</div>` + order.map((k, i) => `<div class="set-row"><label><input type="checkbox" data-k="${k}" ${on(k) ? "checked" : ""}> <span>${esc(T[k])}</span></label><span class="mv"><button type="button" class="btn s" data-mv="${k}|-1" ${i === 0 ? "disabled" : ""} aria-label="上へ">▲</button><button type="button" class="btn s" data-mv="${k}|1" ${i === order.length - 1 ? "disabled" : ""} aria-label="下へ">▼</button></span></div>`).join("");
  const ps = pls().filter((p) => !LATER(p));
  if (ps.length) h += `<div class="set-h">再生リストの表示(ホーム・一覧)</div>` + ps.map((p) => `<label class="set-row"><span>${esc(p.title)} <small>${kindOf(p) === "own" ? "作成" : "保存"}</small></span><input type="checkbox" data-p="${esc(plId(p))}" ${hpl.has(plId(p)) ? "" : "checked"}></label>`).join("");
  $("set-list").innerHTML = h;
}
function openSettings() {
  paintSettings();
  $("set-dummy").checked = useDummy;
  $("set-auto").checked = autoScroll;
  $("set-date").value = dateMode;
  $("set").showModal();
}
$("settings").onclick = openSettings;
$("set-close").onclick = () => $("set").close();
$("set").addEventListener("click", (e) => { if (e.target === $("set")) $("set").close(); });
$("set-list").addEventListener("change", (e) => {
  const k = e.target.dataset.k, p = e.target.dataset.p;
  if (k) { e.target.checked ? hidden.delete(k) : hidden.add(k); ls.set("tf-home-hidden", JSON.stringify([...hidden])); }
  else if (p) { e.target.checked ? hpl.delete(p) : hpl.add(p); ls.set("tf-home-hpl", JSON.stringify([...hpl])); }
  else return;
  render();
});
$("set-list").addEventListener("click", (e) => {
  const b = e.target.closest("[data-mv]"); if (!b) return;
  const [k, d] = b.dataset.mv.split("|"), i = order.indexOf(k), j = i + +d;
  if (i < 0 || j < 0 || j >= order.length) return;
  [order[i], order[j]] = [order[j], order[i]];
  ls.set("tf-home-order", JSON.stringify(order)); paintSettings(); render();
});
$("set-reload").onclick = () => { $("set").close(); refreshHome(true); };
$("set-dummy").onchange = () => { useDummy = $("set-dummy").checked; ls.set("tf-home-dummy", useDummy ? "1" : "0"); render(); if (!useDummy) refreshHome(true); };

/* ---------- 一覧(横スクロールの行)を自動でゆっくり動かす ---------- */
let autoScroll = ls.get("tf-home-auto", "1") === "1";
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const AS = new WeakMap(); // track -> { x, dir, wait }
let lastT = 0;
function autoStep(now) {
  const dt = Math.min(0.1, (now - (lastT || now)) / 1000); lastT = now;
  if (autoScroll && !reduceMotion.matches && !$("pl").open && !$("set").open && !$("fd").open && !$("chd").open) {
    for (const tr of document.querySelectorAll(".track")) {
      const max = tr.scrollWidth - tr.clientWidth; if (max <= 4) continue;
      let st = AS.get(tr); if (!st) AS.set(tr, st = { x: tr.scrollLeft, dir: 1, wait: 1 });
      if (tr.matches(":hover") || tr.contains(document.activeElement)) { st.x = tr.scrollLeft; continue; } // 触っている間は止める
      if (Math.abs(tr.scrollLeft - st.x) > 2) st.x = tr.scrollLeft; // 手動・矢印で動かしたら、その位置から再開
      if (st.wait > 0) { st.wait -= dt; continue; }
      st.x += st.dir * 28 * dt; // 約28px/秒
      if (st.x >= max) { st.x = max; st.dir = -1; st.wait = 1.5; } else if (st.x <= 0) { st.x = 0; st.dir = 1; st.wait = 1.5; }
      tr.scrollLeft = st.x;
    }
  }
  requestAnimationFrame(autoStep);
}
requestAnimationFrame(autoStep);
$("set-auto").onchange = () => { autoScroll = $("set-auto").checked; ls.set("tf-home-auto", autoScroll ? "1" : "0"); };
