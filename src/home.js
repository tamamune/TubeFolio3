const KEY = "tubefolio";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ls = { get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
let data = { folders: [], videos: {}, bookmarks: [] };
let tab = "all", heroI = 0, heroT = null;
let folderMode = ls.get("tf-folder-mode", "list") === "manage" ? "manage" : "list"; // フォルダを押したときの表示: list = 登録されているチャンネルの一覧 / manage = チャンネルを管理する画面(設定)
const thumb = (id, k = "mqdefault") => `https://i.ytimg.com/vi/${id}/${k}.jpg`;
const all = () => Object.entries(data.videos).sort((a, b) => (b[1].savedAt || "").localeCompare(a[1].savedAt || ""));
const kids = (id) => data.folders.filter((f) => f.parent === id);
const desc = (id, seen = new Set()) => { if (seen.has(id)) return []; seen.add(id); return [id, ...kids(id).flatMap((k) => desc(k.id, seen))]; }; // 入れ子の子孫すべて
const depthOf = (f) => { let d = 0, p = f, n = 0; while (p?.parent && n++ < 20) { p = data.folders.find((x) => x.id === p.parent); d++; } return d; };
const inF = (v, id) => desc(id).some((x) => v.folders.includes(x));
const SECTIONS = [["resume", "続きから"], ["later", "TubeFolio2 後で見る"], ["ytlater", "YouTube の後で見る"], ["trend", "急上昇(日本)"], ["pl", "再生リスト"], ["savedpl", "ライブラリ"]];
let hidden = new Set((() => { try { return JSON.parse(ls.get("tf-home-hidden", "[]")); } catch { return []; } })());
const on = (k) => !hidden.has(k);
const KEYS = SECTIONS.map(([k]) => k);
let order = (() => { let o = []; try { o = JSON.parse(ls.get("tf-home-order", "[]")); } catch {} return [...o.filter((k) => KEYS.includes(k) || k.startsWith("pl:")),...KEYS.filter((k) => !o.includes(k))]; })(); // ホームの並び順
let hpl = new Set((() => { try { return JSON.parse(ls.get("tf-home-hpl", "[]")); } catch { return []; } })()); // ホームで非表示にする再生リスト
const plId = (p) => p.id || "dummy" + p.n;
let folded = new Set((() => { try { return JSON.parse(ls.get("tf-home-folded", "[]")); } catch { return []; } })()); // サイドバーで閉じているフォルダ
const vmap = new Map(); // 再生ダイアログ用: 動画ID -> {title, channel}
// 視聴の進み具合(0〜100)。YouTube の一覧に出てきた動画の「視聴済みの割合」を覚えておき、どの画面のカードにも出す
const watched = new Map(Object.entries((() => { try { return JSON.parse(ls.get("tf-watched", "{}")); } catch { return {}; } })()));
let watchedSave = 0;
const noteWatched = (id, p) => {
  if (!id || !(p > 0) || watched.get(id) === p) return;
  watched.set(id, p);
  clearTimeout(watchedSave); watchedSave = setTimeout(() => { const e = [...watched.entries()]; ls.set("tf-watched", JSON.stringify(Object.fromEntries(e.slice(-3000)))); }, 1500);
};
function watchedPct(n) { // YouTube のサムネイルに付いている進捗バー(視聴済みの割合)を探す
  let v = 0;
  (function w(x) { if (v || !x || typeof x !== "object") return; if (x.thumbnailOverlayResumePlaybackRenderer) { v = x.thumbnailOverlayResumePlaybackRenderer.percentDurationWatched || 0; return; } if (x.thumbnailOverlayProgressBarViewModel) { v = x.thumbnailOverlayProgressBarViewModel.startPercent || 0; return; } Object.values(x).forEach(w); })(n);
  return v;
}
// メンバー限定(メンバー先行公開も含む)か。動画に付いている印(バッジ)だけを見る(タイトルの文字では判断しない)
const MEM_RE = /MEMBERS_ONLY|MEMBERS_FIRST|メンバー限定|メンバー先行|Members[ -]only|Members first/i;
function memOnly(o) {
  let m = false;
  (function w(x) { if (m || !x || typeof x !== "object") return; for (const k of ["metadataBadgeRenderer", "badgeViewModel", "thumbnailBadgeViewModel"]) if (x[k] && MEM_RE.test(JSON.stringify(x[k]))) { m = true; return; } Object.values(x).forEach(w); })(o);
  return m;
}
const memHtml = (v) => v?.mem ? `<span class="mem" title="チャンネルメンバー限定の動画">メン限</span>` : "";
const isDone = (id, v) => (watched.get(id) ?? v?.pct ?? 0) >= 96; // 最後まで見た(「✓ 視聴済み」の印が付く)
// 途中まで見た動画は赤いバーと「▶ 45%」、最後まで見た動画は緑のバーと「✓ 視聴済み」(サムネイルも暗くする)
function progHtml(id, v) {
  const p = watched.get(id) ?? v?.pct ?? 0; if (!(p > 0)) return "";
  const done = p >= 96;
  return `<span class="pg ${done ? "done" : ""}"><i style="width:${done ? 100 : Math.max(3, Math.min(100, p))}%"></i></span><span class="wch ${done ? "done" : "part"}" title="${done ? "最後まで再生済み" : "途中まで再生済み"}">${done ? "✓ 視聴済み" : "▶ " + Math.round(p) + "%"}</span>`;
}
const dummyTh = (i) => `<div class="dm" style="--h:${(i * 47 + 200) % 360}"></div>`;
const card = (e) => cardWith(e, "");
// extra: サムネイルの上に重ねるボタンなど(再生リストから外す×)
const cardWith = ([id, v], extra) => {
  if (v.dummy) { const pg = v.pct ? `<span class="pg"><i style="width:${v.pct}%"></i></span>` : ""; return `<div class="c ${subCls(v)}"><div class="th">${dummyTh(v.n)}${v.duration ? `<span class="dur">${esc(v.duration)}</span>` : ""}${pg}${extra}</div><b>${esc(v.title)}</b>${cn(v)}</div>`; }
  vmap.set(id, v);
  const pct = progHtml(id, v);
  return `<button class="c ${subCls(v)}" data-v="${esc(id)}"><div class="th"><img loading="lazy" src="${thumb(id)}" alt="">${v.duration ? `<span class="dur">${esc(v.duration)}</span>` : ""}${memHtml(v)}${pct}${bmBtn(id)}${extra}</div>${titleHtml(id, v.title)}${cn(v)}</button>`; // ⋮ は plmenu.js
};
// 再生リストのカード: 押すと「視聴を再開」などと同じ一覧画面で中の動画を表示する
const plCard = (p) => `<button class="c" data-t="list:pl:${esc(p.id)}"><div class="th">${p.dummy ? dummyTh(p.n) : p.thumb ? `<img loading="lazy" src="${esc(p.thumb)}" alt="">` : `<img alt="" src="icons/icon-128.png" style="object-fit:contain;padding:18px">`}<span class="dur">再生リスト</span></div><b>${esc(p.title)}</b><small>${esc(p.channel || "")}</small></button>`;
const seeAll = (key) => key ? `<button class="seeall" data-t="${esc(key)}">すべて表示 ›</button>` : "";
const rail = (title, cards, n, unit = "本", key = "") => `<section class="row"><h2>${key ? `<button class="h2l" data-t="${esc(key)}">${esc(title)}</button>` : esc(title)}<small>${n}${unit}</small>${seeAll(key)}</h2><div class="rail"><button class="arrow l" data-s="-1" aria-label="前へ">‹</button><div class="track">${cards}</div><button class="arrow r" data-s="1" aria-label="次へ">›</button></div></section>`;
// ex: 動画IDから、サムネイルに重ねるボタン(×)を作る関数(なければ付けない)
const row = (title, items, key = "", ex = null) => items.length ? rail(title, items.map((e) => cardWith(e, ex ? ex(e[0]) : "")).join(""), items.length, "本", key) : "";
const note = (title, msg) => `<section class="row"><h2>${esc(title)}</h2><div class="empty" style="margin:6px 32px 14px">${msg}</div></section>`;
const tabsHtml = () => [["all", "すべて"], ["channels", "登録チャンネル"], ...data.folders.filter((f) => !f.parent).map((f) => [f.id, f.name]), ["uncat", "未分類"]].map(([id, n]) => `<button class="tab ${tab === id ? "on" : ""}" data-t="${id}">${esc(n)}</button>`).join("");

// サイドバーでフォルダ名を入力中の状態: { mode: "add" | "sub" | "rename", id?, parent?, value, selectAll? }(channels.js が操作)
let fEdit = null, navRendering = false;
function renderNav() {
  const home = `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M3 11l9-8 9 8v10h-6v-6H9v6H3z"/></svg>`;
  const people = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2a6.5 6.5 0 0 1 3.5 5.8"/></svg>`;
  const fico = (c) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`;
  const cnt = (id) => `<span class="n lbl">${chIn(id).length}</span>`;
  // 新着動画の件数(登録チャンネルの新着のうち、このフォルダのチャンネルのもの。newvids.js)
  const nw = (id) => { const k = typeof newCnt === "function" ? newCnt(id) : 0; return `<span class="n nw lbl ${k ? "has" : ""}" title="新着動画(直近${typeof NEW_DAYS === "number" ? NEW_DAYS : 3}日): ${k}本">${k}</span>`; };
  const item = (id, ico, name, extra = "") => `<button class="ni ${tab === id ? "on" : ""}" data-t="${id}" data-drop="${id === "channels" ? "" : id}" title="${esc(name)}">${ico}<span class="lbl">${esc(name)}</span>${extra}</button>`;
  let h = `<button class="ni ${tab === "all" || tab.startsWith("list:") ? "on" : ""}" data-t="all" title="ホーム">${home}<span class="lbl">ホーム</span></button>`;
  h += `<button class="ni ${tab === "search" ? "on" : ""}" data-t="search" title="検索"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><span class="lbl">検索</span></button>`;
  h += `<button class="ni ${tab === "bookmarks" ? "on" : ""}" data-t="bookmarks" title="ブックマーク"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M6 3h12v18l-6-4-6 4z"/></svg><span class="lbl">ブックマーク</span></button>`;
  h += typeof musicNav === "function" ? musicNav(tab) : "";
  h += `<div class="nav-h nav-hh"><span>フォルダ</span><span class="fmode" role="group" aria-label="フォルダを押したときの表示"><button type="button" class="${folderMode === "manage" ? "on" : ""}" data-fmode="manage" title="チャンネルを管理する画面を開く">設定</button><button type="button" class="${folderMode === "list" ? "on" : ""}" data-fmode="list" title="登録されているチャンネルの一覧を開く">一覧</button></span><button type="button" class="fadd" data-act="addfolder" title="フォルダを追加" aria-label="フォルダを追加">＋</button></div>`;
  h += item("channels", people, "すべて", (typeof nvBellHtml === "function" ? nvBellHtml() : "") + cnt("channels")).replace('data-drop=""', "");
  const chev = (f) => kids(f.id).length ? `<span class="chev ${folded.has(f.id) ? "" : "open"}" data-fold="${esc(f.id)}" role="button" aria-label="${folded.has(f.id) ? "開く" : "閉じる"}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></span>` : `<span class="chev-sp"></span>`;
  // フォルダの「⋯」(名前の変更・サブフォルダ・並べ替え・削除のメニュー。右クリックでも開く。channels.js)
  const fmore = (f) => `<span class="fmore lbl" data-fmenu="${esc(f.id)}" role="button" title="フォルダの操作" aria-label="フォルダの操作">⋯</span>`;
  // その場で名前を入力する欄(フォルダの追加・サブフォルダの追加・名前の変更)
  const editRow = (depth, ico) => `<div class="ni ni-edit" style="padding-left:${12 + depth * 12}px">${ico}<input id="fe-in" class="fe-in" maxlength="40" placeholder="${fEdit.mode === "rename" ? "フォルダ名" : "新しいフォルダ名"}" value="${esc(fEdit.value)}" aria-label="フォルダ名"></div>`;
  // フォルダの行: [▸ 開閉] [フォルダ] [タイトル] [新着の件数] [⋯]。ドラッグで並べ替え・入れ子にできる(channels.js)
  // 上へ・下へ(同じ階層の中で入れ替え。マウスを乗せたときだけ出る。channels.js)
  const fmv = (f) => { const sib = data.folders.filter((x) => (x.parent || "") === (f.parent || "")), i = sib.indexOf(f); return `<span class="fmv fplus" data-fsub="${esc(f.id)}" role="button" title="サブフォルダを追加" aria-label="サブフォルダを追加">＋</span><span class="fmv ${i <= 0 ? "dis" : ""}" data-fmove="up|${esc(f.id)}" role="button" title="上へ" aria-label="上へ">▲</span><span class="fmv ${i >= sib.length - 1 ? "dis" : ""}" data-fmove="down|${esc(f.id)}" role="button" title="下へ" aria-label="下へ">▼</span>`; };
  const fRow = (f, depth) => `<button class="ni fd ${depth ? "sub" : ""} ${tab === f.id ? "on" : ""}" style="padding-left:${8 + depth * 12}px" draggable="true" data-fdrag="${esc(f.id)}" data-t="${esc(f.id)}" data-drop="${esc(f.id)}" title="${esc(f.name)}">${chev(f)}<span class="fbg" ${f.bg ? `style="background:${esc(f.bg)}"` : ""}>${f.img ? `<img class="fimg" decoding="async" loading="lazy" src="${esc(f.img)}" alt="">` : fico(f.color || "#ccc")}</span><span class="lbl">${esc(f.name)}</span>${nw(f.id)}${fmv(f)}${fmore(f)}</button>`;
  const tree = (parent, depth) => data.folders.filter((x) => (x.parent || "") === parent && (parent || !x.parent)).map((f) => (fEdit?.mode === "rename" && fEdit.id === f.id
    ? editRow(depth, fico(f.color || "#ccc"))
    : fRow(f, depth))
    + (folded.has(f.id) && !document.body.classList.contains("rail") ? "" : tree(f.id, depth + 1))
    + (fEdit?.mode === "sub" && fEdit.parent === f.id ? editRow(depth + 1, fico("#888")) : "")).join("");
  h += tree("", 0);
  h += item("uncat", fico("#777"), "未分類", nw("uncat"));
  h += fEdit?.mode === "add" ? editRow(0, fico("#888")) : "";
  navRendering = true; $("nav-list").innerHTML = h; navRendering = false;
  // 入力欄があれば、そこにカーソルを置く(名前の変更は最初だけ全体を選択)
  const fe = $("fe-in");
  if (fe) { fe.focus(); if (fEdit.selectAll) { fe.select(); fEdit.selectAll = false; } else fe.setSelectionRange(fe.value.length, fe.value.length); }
  $("test-nav").classList.toggle("on", tab === "test" && $("set").hidden); // テストの印(アカウント欄の設定の左)
  if (!$("set").hidden) $("nav-list").querySelectorAll(".on").forEach((x) => x.classList.remove("on")); // 設定を開いている間は設定だけを選択中にする
  // 上部のタブバーは廃止(サイドバーで切り替える)
}

// ホーム上部の大きなプレビュー(ヒーロー)に出す動画。保存した動画がなければ、視聴を再開・後で見る・自分の再生リストから選ぶ
// (使い方は検討中。とりあえず表示できるものを順に使う)
function heroList() {
  const real = (l) => (l || []).filter(([, v]) => v && !v.dummy);
  const later = laterPl(), own = plsOf("pl");
  const pick = ls.get("tf-hero-src", "auto"); // 設定で選んだ再生リスト(auto = 下の順に自動で選ぶ)
  if (pick === "resume") return [real(resumeItems()), "続きから"];
  if (pick === "later") return [real(later ? (useDummy ? dummyPlItems(later) : cache.later?.[later.id]) : []), "TubeFolio2 後で見る"];
  if (pick === "ytlater") return [real(ytLaterItems()), "YouTube の後で見る"];
  if (pick !== "auto") {
    const p = pls().find((x) => plId(x) === pick && kindOf(x) === "own"); // 選べるのは自分で作成した再生リストだけ
    if (p) {
      const l = real(p.dummy ? dummyPlItems(p) : (later && p.id === later.id ? cache.later?.[p.id] : cache.pl?.[p.id]) || cache.pl?.[p.id] || cache.later?.[p.id]);
      if (!l.length && !p.dummy && !plFetched.has(p.id)) fetchPl(p).then(() => { saveCache(); swapHero(); });
      return [l, plTitle(p)];
    }
  }
  const srcs = [
    [all(), "最近保存"],
    [resumeItems(), "続きから"],
    [later ? cache.later?.[later.id] : [], "後で見る"],
    [own.flatMap((p) => cache.pl?.[p.id] || []), "再生リスト"],
  ];
  for (const [l, label] of srcs) { const r = real(l); if (r.length) return [r, label]; }
  return [[], ""];
}
function renderHero() {
  const [list, label] = heroList();
  const picks = list.slice(0, 5);
  if (!picks.length) return "";
  heroI %= picks.length;
  const [id, v] = picks[heroI];
  picks.forEach(([i, x]) => vmap.set(i, x)); // 「再生する」で開けるように
  const fn = data.folders.find((f) => v.folders?.includes(f.id));
  return `<section class="hero"><div class="hero-bg" data-hv="${id}" style="background-image:url(${thumb(id, "hqdefault")})"></div>
    <div class="hero-in"><span class="badge">${heroI === 0 ? label : "ピックアップ"}</span><h1>${esc(v.title)}</h1><p>${esc(v.channel)}${fn ? " ・ " + esc(fn.name) : ""}</p>
    <div class="btns"><button class="btn p" data-v="${id}">▶ 再生する</button></div></div>
    <div class="dots">${picks.map(([i], n) => `<button class="${n === heroI ? "on" : ""}" data-h="${n}" style="background-image:url(${thumb(i)})" aria-label="${n + 1}"></button>`).join("")}</div></section>`;
}

function swapHero() { // ヒーローだけ差し替える(横スクロール中の行の位置を保つため、全体は描画し直さない)
  const el = $("main").querySelector(".hero"); if (!el) return;
  const t = document.createElement("div"); t.innerHTML = renderHero();
  if (t.firstElementChild) el.replaceWith(t.firstElementChild);
  fixHeroBg();
}
// ヒーローの背景: まず必ずある hqdefault を出し、maxresdefault が本物(幅320px以上)のときだけ差し替える。
// maxresdefault がない動画は、YouTube が 120x90 の灰色の画像を返し(エラーにならない)、CSSの代わりの指定が効かないため
function fixHeroBg() {
  const bg = $("main").querySelector(".hero-bg[data-hv]"); if (!bg) return;
  const id = bg.dataset.hv, im = new Image();
  im.onload = () => { if (im.naturalWidth >= 320 && bg.isConnected && bg.dataset.hv === id) bg.style.backgroundImage = `url(${im.src})`; }; // 本物の大きな画像があるときだけ、差し替える(まず hqdefault を出しておく)
  im.src = thumb(id, "maxresdefault");
}
function render() {
  renderNav();
  // 検索画面を表示中の描き直し(保存データの更新など)は、結果の部分だけ更新する。画面全体を作り直すと、結果が一度消えてちらつく
  if (tab === "search" && $("s-form") && $("main").contains($("s-form")) && typeof paintSearch === "function") return paintSearch();
  let h = "";
  if (tab === "all") {
    h += renderHero();
    for (const k of fullOrder()) if (k.startsWith("pl:") ? !hpl.has(k.slice(3)) : on(k)) h += secHtml(k);
  } else {
    h += tab.startsWith("list:") ? listView(tab.slice(5)) : tab === "search" ? searchView() : tab === "bookmarks" ? bookmarksView() : tab === "music" ? musicView() : tab === "test" ? testView() : (folderMode === "list" && (tab === "uncat" || data.folders.some((f) => f.id === tab))) ? folderListView(tab) : channelsView(tab);
  }
  // 描き直しても、横スクロールの行の位置はそのままにする(×で外したときなど)。行は見出しの名前で見分ける(件数は変わるので含めない)
  const rowKey = (r) => (r.querySelector("h2 .h2l") || r.querySelector("h2"))?.firstChild?.textContent || "";
  const pos = new Map([...$("main").querySelectorAll(".row")].map((r) => [rowKey(r), r.querySelector(".track")?.scrollLeft || 0]));
  // ヒーローが前回と同じ動画なら作り直さない(起動直後に何度も描き直されて、上のサムネが一瞬読み込み直されるのを防ぐ)
  const oldHero = tab === "all" ? $("main").querySelector(".hero") : null;
  $("main").innerHTML = h;
  const newHero = oldHero && $("main").querySelector(".hero");
  const heroSig = (e) => (e.querySelector(".hero-bg")?.dataset.hv || "") + e.querySelector(".hero-in")?.innerHTML + e.querySelector(".dots")?.innerHTML;
  if (newHero && heroSig(oldHero) === heroSig(newHero)) newHero.replaceWith(oldHero);
  else fixHeroBg();
  for (const r of $("main").querySelectorAll(".row")) { const x = pos.get(rowKey(r)), tr = r.querySelector(".track"); if (x && tr) tr.scrollLeft = x; }
  clearInterval(heroT);
  if ($("main").querySelector(".hero")) heroT = setInterval(() => { if (!$("pl").open) { heroI++; swapHero(); } }, 8000);
}

// 再生方法(設定): "embed" = このページ内の埋め込み / "yt" = YouTubeを新しいタブで開く(YouTubeの履歴に残る)
// 設定はクリックのたびに読むので、変えるとすぐに反映される
// スマホ(タッチ操作だけの端末)とパソコンで、別々に決められる(スマホ: tf-play-mode-m / パソコン: tf-play-mode)。どちらもドライブ同期の対象
const touchOnly = () => { try { return matchMedia("(pointer:coarse)").matches && !matchMedia("(pointer:fine)").matches; } catch { return false; } };
const playKey = () => (touchOnly() ? "tf-play-mode-m" : "tf-play-mode");
const playOnYt = () => ls.get(playKey(), "embed") === "yt";
function openV(id, start) { // start: 再生を始める秒(ブックマークのメモから)
  const v = data.videos[id] || vmap.get(id), short = v?.kind === "short"; // ショートは縦長のプレイヤーで再生する
  const at = start > 0 ? Math.floor(start) : 0;
  const ytUrl = short && !at ? `https://www.youtube.com/shorts/${encodeURIComponent(id)}` : `https://www.youtube.com/watch?v=${encodeURIComponent(id)}${at ? `&t=${at}s` : ""}`;
  if (playOnYt()) { // 新しいタブで再生。スマホは m.youtube.com を拡張機能から開く(window.open だと YouTube アプリに飛んでしまう)
    const u = touchOnly() ? ytUrl.replace("https://www.youtube.com", "https://m.youtube.com") : ytUrl;
    return void (chrome.tabs?.create ? chrome.tabs.create({ url: u }) : window.open(u, "_blank", "noopener"));
  }
  if (!v) return;
  $("pl").classList.toggle("short", short);
  $("pl-f").src = `https://www.youtube.com/embed/${id}?autoplay=1&rel=0&enablejsapi=1${at ? "&start=" + at : ""}${short ? "&loop=1&playlist=" + encodeURIComponent(id) : ""}`; // ショートは YouTube と同じく繰り返し再生
  $("pl-t").textContent = v.title; $("pl-m").textContent = v.channel || v.views || ""; $("pl-o").href = ytUrl;
  $("pl-bm").dataset.bm = id; $("pl-bm").classList.toggle("on", isBm(id));
  $("pl").showModal();
}
// マウスの中クリック: YouTube を裏のタブで開き、この画面はそのまま(再生方法の設定に関係なく)
document.addEventListener("mousedown", (e) => { if (e.button === 1 && e.target.closest("[data-v]")) e.preventDefault(); }); // 自動スクロールのアイコンを出さない
document.addEventListener("auxclick", (e) => {
  if (e.button !== 1) return;
  const b = e.target.closest("[data-v]"); if (!b) return;
  e.preventDefault();
  const id = b.dataset.v, v = data.videos[id] || vmap.get(id);
  const u = v?.kind === "short" ? `https://www.youtube.com/shorts/${encodeURIComponent(id)}` : `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
  if (chrome.tabs?.create) chrome.tabs.create({ url: u, active: false }); else window.open(u, "_blank", "noopener");
});
$("pl").addEventListener("close", () => { $("pl-f").src = "about:blank"; });
$("pl-x").onclick = () => $("pl").close();
$("pl").addEventListener("click", (e) => { if (e.target === $("pl")) $("pl").close(); });

document.addEventListener("click", (e) => {
  const t = (s) => e.target.closest(s);
  let b;
  if ((b = t("[data-fold]"))) { const id = b.dataset.fold; folded.has(id) ? folded.delete(id) : folded.add(id); ls.set("tf-home-folded", JSON.stringify([...folded])); return renderNav(); }
  if ((b = t("[data-rsrm]"))) { e.preventDefault(); return hideResume(b.dataset.rsrm); }
  if ((b = t("[data-plrm]"))) { e.preventDefault(); const [pl, vid] = b.dataset.plrm.split("|"); return removeFromPl(pl, vid, b); }
  if ((b = t("[data-bm]"))) { e.preventDefault(); return bmToggle(b.dataset.bm); }
  if ((b = t("[data-v]"))) return openV(b.dataset.v);
  if ((b = t("[data-t]"))) { showSettings(false); tab = b.dataset.t; scrollTo(0, 0); if (innerWidth <= 820) document.body.classList.remove("nav-on"); return render(); }
  if ((b = t("[data-h]"))) { heroI = +b.dataset.h; return swapHero(); }
  if ((b = t("[data-s]"))) { const tr = b.parentElement.querySelector(".track"); railScroll(tr, +b.dataset.s * tr.clientWidth * 0.8); }
});
// 棚を左右の矢印で送る。ブラウザの smooth スクロールは、自動の横スクロール(autoStep)が毎フレーム位置を書き換えると打ち消されるので、
// 自分で動かし、動かしている間と少しの間は autoStep を止める(railHold)
const railHold = new WeakMap(); // track -> この時刻(performance.now)までは自動で動かさない
function railScroll(tr, dx) {
  const from = tr.scrollLeft, to = Math.max(0, Math.min(tr.scrollWidth - tr.clientWidth, from + dx)), t0 = performance.now(), dur = 350;
  railHold.set(tr, t0 + dur + 1500);
  const step = (now) => { const p = Math.min(1, (now - t0) / dur); tr.scrollLeft = from + (to - from) * (1 - Math.pow(1 - p, 3)); if (p < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
// 検索結果のショートの棚(#s-out の中の横並び)の上でマウスのホイールを回すと、左右に動かす(下へ回すと右へ)
// ホームの行は対象にしない(ホイールはページの縦スクロールのまま)
// 端まで行ったら、いつもどおりページを縦にスクロールする(棚の上で止まってしまわないように)
document.addEventListener("wheel", (e) => {
  if (e.ctrlKey || e.shiftKey) return; // 拡大縮小・Shift+ホイール(ブラウザの横スクロール)はそのまま
  const tr = e.target.closest?.("#s-out .rail")?.querySelector(".track"); if (!tr) return;
  if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; // タッチパッドの横スクロールは、そのまま
  const d = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY, max = tr.scrollWidth - tr.clientWidth;
  if (max <= 0 || (d < 0 && tr.scrollLeft <= 0) || (d > 0 && tr.scrollLeft >= max - 1)) return;
  e.preventDefault();
  railHold.set(tr, performance.now() + 1500); // ホイールで動かしている間も、自動の横スクロールは止める
  tr.scrollLeft += d * 1.5;
}, { passive: false });
$("menu").onclick = () => {
  if (innerWidth <= 820) document.body.classList.toggle("nav-on");
  else { document.body.classList.toggle("rail"); ls.set("tf-home-rail", document.body.classList.contains("rail") ? "1" : "0"); }
};
if (ls.get("tf-home-rail", "0") === "1") document.body.classList.add("rail");

chrome.storage.local.get(KEY).then(async (r) => { if (r[KEY]) data = r[KEY]; await removeSamples(); render(); });
// 初回インストール時に入れていたサンプルの動画(【サンプル】…)としおりを一度だけ消す。フォルダは使っているかもしれないので残す
const SAMPLE_IDS = ["dQw4w9WgXcQ", "aaaaaaaaaaa", "bbbbbbbbbbb"];
async function removeSamples() {
  if (data.samplesRemoved) return;
  const cur = (await chrome.storage.local.get(KEY))[KEY]; if (!cur) return;
  const ids = SAMPLE_IDS.filter((id) => /^【サンプル】/.test(cur.videos?.[id]?.title || ""));
  ids.forEach((id) => delete cur.videos[id]);
  cur.bookmarks = (cur.bookmarks || []).filter((b) => !ids.includes(b.videoId));
  cur.samplesRemoved = true;
  await chrome.storage.local.set({ [KEY]: cur });
  data = cur;
}
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
// ドライブ同期のアカウントと違わないかも、合わせて確かめる(drivesync.js の dsCheckAcct)
const acctCheck = () => { if (typeof dsCheckAcct === "function") dsCheckAcct(); };
let acctAt = 0;
async function refreshAccount() {
  acctAt = Date.now();
  try { const a = await fetchAccount(); if (a) { showAccount(a); if (a.signedOut) ls.set("tf-acct", "null"); else ls.set("tf-acct", JSON.stringify(a)); } } catch { if (!ls.get("tf-acct", "")) { $("acct-name").textContent = "YouTube"; $("acct-sub").textContent = "取得できませんでした"; } }
  acctCheck();
}
(async () => {
  try { const c = JSON.parse(ls.get("tf-acct", "null")); if (c) showAccount(c); } catch {}
  await refreshAccount();
})();
// 別のタブで YouTube のアカウントを切り替えて戻ってきたときにも、取り直す(30秒に1回まで)
document.addEventListener("visibilitychange", () => { if (!document.hidden && Date.now() - acctAt > 30000) refreshAccount(); });

/* ---------- ホームの一覧: 視聴を再開 / 後で見る / 残りの再生リスト ---------- */
let useDummy = ls.get("tf-home-dummy", "1") === "1";
const mk = (n, title, channel, extra = {}) => [`dummy${n}`, { dummy: true, n, title, channel, duration: "12:34", ...extra }];
const DUMMY = {
  resume: [["【ダミー】作業用BGM 集中できる音楽", "Dummy Music", 35], ["【ダミー】はじめてのプログラミング入門", "Dummy Academy", 62], ["【ダミー】世界の絶景ドライブ 4K", "Dummy Travel", 18], ["【ダミー】15分で作る簡単晩ごはん", "Dummy Kitchen", 80], ["【ダミー】英会話フレーズ集", "Dummy English", 45], ["【ダミー】猫のおもしろ動画まとめ", "Dummy Pets", 27]].map(([t, c, p], i) => mk(i + 1, t, c, { pct: p })),
  later: [["【ダミー】あとで見たい解説動画 1", "Dummy Channel A"], ["【ダミー】あとで見たい解説動画 2", "Dummy Channel B"], ["【ダミー】あとで見たいライブ配信", "Dummy Channel C"], ["【ダミー】あとで見たいレビュー", "Dummy Channel D"], ["【ダミー】あとで見たい講義", "Dummy Channel E"]].map(([t, c], i) => mk(i + 11, t, c)),
  own: ["お気に入り", "作業用", "勉強", "料理レシピ", "旅行"].map((t, i) => ({ dummy: true, id: `dummy-pl${i + 21}`, n: i + 21, title: `【ダミー】${t}`, channel: "" })),
  saved: ["おすすめ音楽ミックス", "人気の解説シリーズ", "プログラミング講座", "ライブ映像まとめ"].map((t, i) => ({ dummy: true, id: `dummy-pl${i + 31}`, n: i + 31, title: `【ダミー】${t}`, channel: "Dummy Channel" })),
};
// 再生リスト = YouTube から直接読んだもの(作成・保存。コピーは持たない) + TubeFolio に保存しているもの(URLで追加)
const pls = () => {
  if (useDummy) return [...DUMMY.own.map((p) => ({ ...p, kind: "own" })), ...DUMMY.saved.map((p) => ({ ...p, kind: "saved" }))];
  const live = PLLIVE.list(), ids = new Set(live.map((p) => p.id));
  return [...live, ...(data.playlists || []).filter((p) => !ids.has(p.id))];
};
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
// 新しい形式(lockupViewModel)の動画から、カードに出す情報(タイトル・チャンネル・長さ・公開日・再生回数)を取り出す
// 1行目 = チャンネル名、2行目 = 「123万 回視聴」「3 週間前」
const PUB_RE = /前|ago|配信|Streamed|Premiered|プレミア/i;
function lockupInfo(lv) {
  const rows = lv.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows || [];
  const parts = (i) => (rows[i]?.metadataParts || []).map((x) => x.text?.content || "").filter(Boolean);
  // 視聴履歴などでは1行目に「チャンネル名」と「22万 回視聴」が並ぶことがあるので、チャンネル名だけを取り出す
  const all = [...parts(0), ...parts(1)];
  const isViews = (t) => /視聴|views?|^[\d.,]+\s*(万|億|千|[KMB])?(\s*回)?$/i.test(t); // 「636」のように数字だけの場合も再生回数として扱う
  let dur = ""; (function w(x) { if (dur || !x || typeof x !== "object") return; if (x.thumbnailBadgeViewModel?.text) { dur = x.thumbnailBadgeViewModel.text; return; } Object.values(x).forEach(w); })(lv.contentImage);
  return { title: lv.metadata?.lockupMetadataViewModel?.title?.content || lv.contentId, channel: parts(0).filter((t) => !isViews(t) && !PUB_RE.test(t)).join(" "), chUrl: chUrlOf(lv.metadata), duration: dur, pub: all.find((t) => PUB_RE.test(t)) || "", views: all.find(isViews) || "", pct: watchedPct(lv.contentImage), mem: memOnly(lv) || undefined };
}
// チャンネルへのリンク先(/@ハンドル か /channel/UC…)。チャンネル名やアイコンに付いているリンクから探す
function chUrlOf(o) {
  let u = "";
  (function w(x) {
    if (u || !x || typeof x !== "object") return;
    const b = x.browseEndpoint;
    if (b?.browseId?.startsWith("UC")) { u = b.canonicalBaseUrl || "/channel/" + b.browseId; return; }
    Object.values(x).forEach(w);
  })(o);
  return u;
}
// 視聴履歴ページから、途中まで見た動画(進捗バー付き)を集める
function collectResume(root) {
  const out = new Map();
  const prog = watchedPct;
  (function walk(n) {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(walk);
    const r = n.videoRenderer;
    if (r?.videoId) { const pct = prog(r); if (pct > 0 && pct < 96 && !out.has(r.videoId)) out.set(r.videoId, { title: txt(r.title), channel: txt(r.ownerText) || txt(r.longBylineText), chUrl: chUrlOf(r.ownerText || r.longBylineText), duration: txt(r.lengthText), pub: txt(r.publishedTimeText), pct, mem: memOnly(r.badges) || undefined }); }
    const lv = n.lockupViewModel;
    if (lv && /VIDEO/.test(lv.contentType || "") && lv.contentId) {
      const pct = prog(lv.contentImage);
      if (pct > 0 && pct < 96 && !out.has(lv.contentId)) out.set(lv.contentId, { ...lockupInfo(lv), pct });
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
    if (r?.videoId) out.set(r.videoId, { title: txt(r.title), channel: txt(r.shortBylineText), chUrl: chUrlOf(r.shortBylineText), duration: txt(r.lengthText), pub: txt(r.videoInfo).split("•").slice(1).join(" ").trim(), mem: memOnly(r.badges) || undefined });
    const lv = n.lockupViewModel;
    if (lv && /VIDEO/.test(lv.contentType || "") && lv.contentId && !out.has(lv.contentId)) out.set(lv.contentId, lockupInfo(lv));
    Object.values(n).forEach(walk);
  })(root);
  return [...out.entries()];
}
/* 続きから(旧: 視聴を再開): ×で外した動画は覚えておき、YouTube の視聴履歴に残っていても二度と出さない */
const rsHidden = new Set((() => { try { return JSON.parse(ls.get("tf-resume-hidden", "[]")); } catch { return []; } })());
const resumeItems = () => { const l = (useDummy ? DUMMY.resume : cache.resume || []).filter(([id]) => !rsHidden.has(id)); needDet(l); return withDet(l); };

/* 視聴履歴には公開日が載っていないので、動画ページから公開日(と長さ)を補って、ほかの行と同じ表示にする。
   結果は cache.det に残し、一度調べた動画は調べ直さない */
const detQ = new Set(); let detRun = false;
const withDet = (items) => items.map(([id, v]) => { const d = cache.det?.[id]; return d && (d.pubDate || d.duration || d.ch) ? [id, { ...v, pubDate: v.pubDate || d.pubDate, duration: v.duration || d.duration, channel: v.channel || d.ch || "", chUrl: v.chUrl || (d.chId ? "/channel/" + d.chId : "") }] : [id, v]; });
function needDet(items) {
  // 公開日が分からない動画と、チャンネル名が分からない動画(視聴履歴では空のことがある)を調べる
  for (const [id, v] of items) { const d = cache.det?.[id]; if (!v.dummy && ((!v.pub && !v.pubDate && !d) || (!v.channel && !(d && "ch" in d)))) detQ.add(id); }
  if (detQ.size && !detRun) setTimeout(runDet, 0);
}
async function runDet() {
  if (detRun) return; detRun = true;
  try {
    while (detQ.size) {
      const ids = [...detQ].slice(0, 4); ids.forEach((id) => detQ.delete(id)); // 4本ずつ(動画ページは重いので一度に取りすぎない)
      await Promise.all(ids.map(async (id) => {
        const d = { t: Date.now(), ch: "" }; // 取れなくても調べ済みとして残す(繰り返し取りに行かない)
        try {
          const html = await (await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(id)}`)).text();
          const len = (html.match(/"lengthSeconds":"(\d+)"/) || [])[1], pd = (html.match(/"(?:publishDate|uploadDate)":"(\d{4}-\d{2}-\d{2})/) || [])[1];
          if (len && +len > 0) d.duration = fmtLen(len);
          if (pd) d.pubDate = pd;
          d.ch = (html.match(/"ownerChannelName":"((?:[^"\\]|\\.)*)"/) || [])[1] || "";
          try { d.ch = JSON.parse(`"${d.ch}"`); } catch {} // あ などのエスケープを戻す
          const cid = (html.match(/"channelId":"(UC[\w-]{22})"/) || [])[1]; if (cid) d.chId = cid; // チャンネルへのリンク用
        } catch {}
        (cache.det ||= {})[id] = d;
      }));
      // 古いものから消して、最大600本分だけ残す
      const ks = Object.keys(cache.det); if (ks.length > 600) ks.sort((a, b) => cache.det[a].t - cache.det[b].t).slice(0, ks.length - 600).forEach((k) => delete cache.det[k]);
      saveCache();
      if (tab === "all" || tab === "list:resume") render(); // ほかの画面は描き直さない
      else if (tab === "search") paintSearch(); // 検索ページは結果の部分だけ(入力中の文字を消さない)
    }
  } finally { detRun = false; }
}
const rsBtn = (vid) => `<span class="rm" data-rsrm="${esc(vid)}" role="button" title="続きからから外す(今後も表示しません)" aria-label="続きからから外す">✕</span>`;
function hideResume(vid) {
  rsHidden.add(vid);
  ls.set("tf-resume-hidden", JSON.stringify([...rsHidden].slice(-1000)));
  render(); toast("続きからから外しました(今後も表示しません)");
}
const RS_T = "続きから(途中まで見た動画)";
const resumeRow = () => { const l = resumeItems(); return l.length ? row(RS_T, l, "list:resume", rsBtn) : note(RS_T, !useDummy && !cache.resume ? cache.resumeErr || "読み込み中…" : cache.resumeErr || "途中まで見た動画はありません"); };
function laterRow() {
  if (useDummy) return row("TubeFolio2 後で見る", DUMMY.later, "list:later");
  const p = laterPl();
  if (!p) return note("TubeFolio2 後で見る", !PLLIVE.loaded() ? esc(PLLIVE.state().error || "YouTubeから読み込み中…") : "「TubeFolio2 後で見る」という名前の再生リストが見つかりません。");
  const items = cache.later?.[p.id];
  return items?.length ? row("TubeFolio2 後で見る", items, "list:later", (vid) => rmBtn(p, vid)) : note("TubeFolio2 後で見る", cache.laterErr || "読み込み中…");
}
// YouTube 自身の「後で見る」(再生リスト WL)。再生リストの一覧には出てこないので、別に読む
const YTL_T = "YouTube の後で見る";
const ytLaterItems = () => useDummy ? DUMMY.later.map(([id, v]) => [id + "w", { ...v, n: v.n + 50 }]) : cache.ytlater || [];
const ytLaterRow = () => { const l = ytLaterItems(); return l.length ? row(YTL_T, l, "list:ytlater") : note(YTL_T, cache.ytlaterErr || "読み込み中…"); };
const kindOf = (p) => p.kind || "manual";
// 再生リスト = 自分で作成したもの(「後で見る」を除く)
const plsOf = (k) => pls().filter((p) => !LATER(p) && (k === "pl" ? kindOf(p) === "own" : kindOf(p) !== "own") && !hpl.has(plId(p)));
const savedRow = () => { const l = all(); return l.length ? row("ライブラリ: 保存した動画", l, "list:saved") : ""; }; // 保存した動画がないときは行ごと出さない
const SEC = { resume: () => resumeRow(), later: () => laterRow(), ytlater: () => ytLaterRow(), trend: () => trendRow(), pl: () => otherPlRow(), savedpl: () => savedPlRow(), saved: savedRow };
// 「すべて表示」ページ
function listView(k) {
  if (k === "trend") return trendView(); // 急上昇(trend.js)
  const back = `<button class="seeall back" data-t="all">‹ ホームへ戻る</button>`;
  const T = Object.fromEntries(SECTIONS);
  let items = [], cards = "", unit = "本";
  if (k.startsWith("pl:")) {
    const p = pls().find((x) => x.id === k.slice(3)), items = p ? plItems(p) : [];
    if (p) loadPl(p); // 保存した再生リストなど、まだ中身を持っていなければ取りに行く(開くたびに最新にする)
    const msg = !p ? "再生リストが見つかりません。" : cache.plErr?.[p.id] || (cache.pl?.[p.id] ? "表示できる項目がありません。" : "読み込み中…");
    const vis = plVis(plOrdered(items));
    return `<section class="row">${back}<div class="lh-row"><h2>${esc(p ? plTitle(p) : "再生リスト")}<small>${plCnt(vis, items)}本</small></h2>${items.length ? playBar(plOrdered(items)) : ""}</div>${typeof taBar === "function" ? taBar(p) : ""}${items.length ? vbar(ordSeg() + plHideRow()) + (vis.length ? vgrid(vis.map((e) => cardWith(e, rmBtn(p, e[0]) + wbBtn(e) + (typeof taBadge === "function" ? taBadge(p, e[0]) : ""))).join("")) : plAllHidden()) : `<div class="empty" style="margin-top:0">${esc(msg)}</div>`}</section>`;
  }
  let lp = null;
  if (k === "resume") items = resumeItems();
  else if (k === "later") { lp = laterPl(); items = plOrdered(useDummy ? DUMMY.later : (lp && cache.later?.[lp.id]) || []); }
  else if (k === "ytlater") items = plOrdered(ytLaterItems());
  const isPl = k === "later" || k === "ytlater", all0 = items;
  if (isPl) items = plVis(items); // 視聴済み・メン限を隠す
  else if (k === "saved") items = all();
  if (k === "pl" || k === "savedpl") { const l = plsOf(k); cards = l.map(plCard).join(""); items = l; unit = "件"; }
  else cards = items.map((e) => cardWith(e, (k === "later" ? rmBtn(lp, e[0]) : k === "resume" ? rsBtn(e[0]) : "") + (isPl ? wbBtn(e) : ""))).join("");
  if (isPl) return `<section class="row">${back}<div class="lh-row"><h2>${esc(T[k] || "一覧")}<small>${plCnt(items, all0)}本</small></h2>${all0.length ? playBar(all0) : ""}</div>${all0.length ? vbar(ordSeg() + plHideRow()) + (items.length ? vgrid(cards) : plAllHidden()) : `<div class="empty" style="margin-top:0">表示できる項目がありません。</div>`}</section>`;
  return `<section class="row">${back}<h2>${esc(T[k] || "一覧")}<small>${items.length}${unit}</small></h2>${items.length ? vbar() + vgrid(cards) : `<div class="empty" style="margin-top:0">表示できる項目がありません。</div>`}</section>`;
}
/* 再生リストの一覧: 「視聴済み・メン限を隠す」(押すたびに切り替え。tf-pl-hidew / tf-pl-hidem。ドライブ同期の対象) */
let plHideW = ls.get("tf-pl-hidew", "0") === "1", plHideM = ls.get("tf-pl-hidem", "0") === "1";
const plVis = (items) => items.filter(([id, v]) => !(plHideW && isDone(id, v)) && !(plHideM && v.mem));
const plCnt = (vis, all) => (vis.length === all.length ? all.length : `${vis.length} / ${all.length}`);
const plAllHidden = () => `<div class="empty" style="margin-top:0">「隠す」の設定で、すべての動画が隠れています。</div>`;
const plHideRow = () => `<div class="grp s-hide"><span class="s-cl">隠す</span><button type="button" class="tab ${plHideW ? "on" : ""}" data-plhide="w" aria-pressed="${plHideW}" title="最後まで見た動画(✓ 視聴済み)を出さない">✓ 視聴済み</button><button type="button" class="tab ${plHideM ? "on" : ""}" data-plhide="m" aria-pressed="${plHideM}" title="チャンネルメンバー限定の動画を出さない">メン限</button></div>`;
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-plhide]"); if (!b) return;
  if (b.dataset.plhide === "w") { plHideW = !plHideW; ls.set("tf-pl-hidew", plHideW ? "1" : "0"); } else { plHideM = !plHideM; ls.set("tf-pl-hidem", plHideM ? "1" : "0"); }
  render();
});
/* 削除・非公開になった動画: Wayback Machine(インターネットアーカイブ)で、残っている記録を探す */
const GONE_RE = /^\[(削除された動画|非公開動画|Deleted video|Private video)\]$/;
const wbBtn = ([id, v]) => (!v.dummy && GONE_RE.test((v.title || "").trim()) ? `<span class="wb" data-wb="${esc(id)}" role="button" title="削除・非公開になった動画を、Wayback Machine で探します(新しいタブ)">📼 Wayback で探す</span>` : "");
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-wb]"); if (!b) return;
  e.preventDefault(); e.stopPropagation();
  window.open(`https://web.archive.org/web/2*/https://www.youtube.com/watch?v=${encodeURIComponent(b.dataset.wb)}*`, "_blank", "noopener");
}, true);
// 「すべて表示」画面で、サムネイルの左下に出す「この再生リストから外す」ボタン(自分で作成したリストだけ。YouTubeにも反映)
const rmBtn = (p, vid) => p && !p.dummy && kindOf(p) === "own" ? `<span class="rm" data-plrm="${esc(p.id)}|${esc(vid)}" role="button" title="この再生リストから外す(YouTubeにも反映)" aria-label="再生リストから外す">✕</span>` : "";
async function removeFromPl(plId, vid, el) {
  const p = pls().find((x) => x.id === plId); if (!p || el?.classList.contains("busy")) return;
  el?.classList.add("busy");
  try { await YTA.removeVideo(plId, vid); }
  catch (e) { el?.classList.remove("busy"); return toast(`外せませんでした: ${e.message}`); }
  // 表示中の一覧から消す(YouTube から読み直したときも、外した状態になっている)
  for (const m of [cache.pl, cache.later]) if (m?.[plId]) m[plId] = m[plId].filter(([id]) => id !== vid);
  saveCache(); render();
  toast(`「${p.title}」から外しました`);
}
// 自分の再生リストは、1つずつ行にして中の動画を並べる
const plTitle = (p) => p.title;
const dummyPlItems = (p) => [1, 2, 3, 4, 5].map((i) => mk(100 + p.n * 10 + i, `【ダミー】${p.title.replace("【ダミー】", "")}の動画 ${i}`, `Dummy Channel ${"ABCDE"[i - 1]}`));
const plItems = (p) => p.dummy ? dummyPlItems(p) : cache.pl?.[p.id] || [];
function plVideoRow(p) {
  const items = plItems(p);
  return items.length ? row(plTitle(p), items, `list:pl:${p.id}`, (vid) => rmBtn(p, vid)) : note(plTitle(p), cache.plErr?.[p.id] || "読み込み中…");
}
const otherPlRow = () => plsOf("pl").map(plVideoRow).join("");
// ホームの並び順: 「再生リスト」は自分の再生リストごとの項目("pl:<id>")に分けて、1つずつ並べ替え・表示切り替えできる
const ownPls = () => pls().filter((p) => !LATER(p) && kindOf(p) === "own");
const plByKey = (k) => ownPls().find((p) => "pl:" + plId(p) === k);
const secHtml = (k) => k.startsWith("pl:") ? (plByKey(k) ? plVideoRow(plByKey(k)) : "") : SEC[k]();
function fullOrder() {
  const pk = ownPls().map((p) => "pl:" + plId(p));
  const keys = [...KEYS.filter((k) => k !== "pl"), ...pk];
  let o = [];
  for (const k of order) { if (k === "pl") o.push(...pk.filter((x) => !order.includes(x))); else if (keys.includes(k)) o.push(k); } // 以前の「再生リスト」の位置に展開
  o = [...new Set(o)];
  const miss = keys.filter((k) => !o.includes(k)), mp = miss.filter((k) => k.startsWith("pl:"));
  if (mp.length) { // 新しい再生リストは、ほかの再生リストの後ろ(なければ「後で見る」の後ろ)に入れる
    let at = o.map((k) => k.startsWith("pl:")).lastIndexOf(true); if (at < 0) at = o.indexOf("later");
    o.splice(at + 1, 0, ...mp);
  }
  return [...o, ...miss.filter((k) => !k.startsWith("pl:"))];
}
// ライブラリ = 保存した再生リスト(他人の再生リストなど)と、保存した動画
function savedPlRow() {
  const sv = plsOf("savedpl");
  return sv.length ? rail("ライブラリ", sv.map(plCard).join(""), sv.length, "件", "list:savedpl") : "";
}
// 再生リスト1つの中身を YouTube から取ってキャッシュする
const plFetched = new Set(); // このページを開いてから取得済みの再生リスト
async function fetchPl(p) {
  cache.pl ||= {}; cache.plErr ||= {}; plFetched.add(p.id);
  try { const it = collectPlVideos(await ytInit(`https://www.youtube.com/playlist?list=${encodeURIComponent(p.id)}`)); cache.pl[p.id] = it; cache.plErr[p.id] = it.length ? "" : "この再生リストに動画がありません"; }
  catch { cache.plErr[p.id] = cache.pl[p.id]?.length ? "" : "再生リストを取得できませんでした"; }
}
// 一覧画面で開いたとき: このページでまだ取っていなければ取りに行き、終わったら描き直す
async function loadPl(p) {
  if (p.dummy || plFetched.has(p.id)) return;
  await fetchPl(p); saveCache();
  if (tab === `list:pl:${p.id}`) render();
}
// 自分の再生リストの中身を取る(force でなければ、まだ持っていないものだけ)
async function refreshPls(force) {
  const ps = pls().filter((p) => !LATER(p) && kindOf(p) === "own" && (force || !cache.pl?.[p.id])).slice(0, 20);
  if (!ps.length) return false;
  cache.pl ||= {}; cache.plErr ||= {};
  await Promise.all(ps.map(fetchPl));
  return true;
}
async function refreshHome(force) {
  if (useDummy) return;
  if (!force && Date.now() - (cache.at || 0) < 10 * 60 * 1000) { if (await refreshPls(false)) { saveCache(); render(); } return; }
  let changed = await refreshPls(true);
  try { cache.resume = collectResume(await ytInit("https://www.youtube.com/feed/history")); cache.resumeErr = cache.resume.length ? "" : "途中まで見た動画はありません(YouTubeにログインし、再生履歴がオンか確認してください)"; changed = true; }
  catch { cache.resumeErr = cache.resume?.length ? "" : "視聴履歴を取得できませんでした(YouTubeへのログインを確認してください)"; }
  try { const it = collectPlVideos(await ytInit("https://www.youtube.com/playlist?list=WL")); cache.ytlater = it; cache.ytlaterErr = it.length ? "" : "YouTube の「後で見る」に動画がありません"; }
  catch { cache.ytlaterErr = cache.ytlater?.length ? "" : "YouTube の「後で見る」を取得できませんでした(YouTubeへのログインを確認してください)"; }
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
// 再生リストは YouTube から直接読む(開いたとき・この画面に戻ったとき・3分ごと。処理は plsync.js)。
// 読み直すたびに、再生リストの中身・後で見る・視聴を再開も YouTube から取り直す(続けて起きたときは1分に1回まで)
let lastFull = 0;
PLLIVE.onChange(() => {
  const s = PLLIVE.state();
  if (!useDummy && !s.loading && PLLIVE.loaded() && Date.now() - lastFull > 60 * 1000) {
    lastFull = Date.now(); plFetched.clear();
    refreshHome(true);
  } else render();
});
chrome.storage.local.get(KEY).then(() => PLLIVE.migrate()).then(() => PLLIVE.start());

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

/* ---------- 保存した動画・ブックマークの「長さ」と「公開日」を補う ----------
   保存時にはタイトルとチャンネルしか分からないので、動画ページから長さ(lengthSeconds)と公開日(publishDate)を読む。
   一度調べた動画は detAt を付けて、取れなくても繰り返し取りに行かない。 */
const fmtLen = (s) => { s = +s; const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = String(s % 60).padStart(2, "0"); return h ? `${h}:${String(m).padStart(2, "0")}:${x}` : `${m}:${x}`; };
let detBusy = false;
async function fillDetails() {
  if (detBusy || useDummy) return; detBusy = true;
  try {
    const need = (v) => v && !v.detAt && (!v.duration || !v.pubDate);
    const ids = [...new Set([...Object.entries(data.videos || {}), ...Object.entries(data.marks || {})].filter(([, v]) => need(v)).map(([id]) => id))].slice(0, 30);
    for (let i = 0; i < ids.length; i += 4) { // 4本ずつ(動画ページは重いので一度に取りすぎない)
      const got = {};
      await Promise.all(ids.slice(i, i + 4).map(async (id) => {
        try {
          const html = await (await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(id)}`)).text();
          const len = (html.match(/"lengthSeconds":"(\d+)"/) || [])[1], pd = (html.match(/"(?:publishDate|uploadDate)":"(\d{4}-\d{2}-\d{2})/) || [])[1];
          got[id] = { duration: len && +len > 0 ? fmtLen(len) : "", pubDate: pd || "" };
        } catch { got[id] = { duration: "", pubDate: "" }; }
      }));
      const cur = (await chrome.storage.local.get(KEY))[KEY]; if (!cur) return;
      for (const [id, m] of Object.entries(got)) for (const v of [cur.videos?.[id], cur.marks?.[id]]) {
        if (!v) continue;
        if (!v.duration && m.duration) v.duration = m.duration;
        if (!v.pubDate && m.pubDate) v.pubDate = m.pubDate;
        v.detAt = Date.now();
      }
      await chrome.storage.local.set({ [KEY]: cur }); // onChanged で描き直される
    }
  } finally { detBusy = false; }
}
chrome.storage.local.get(KEY).then(() => setTimeout(fillDetails, 1500));

/* ---------- 設定 ---------- */
function paintSettings() {
  const T = Object.fromEntries(SECTIONS);
  const fo = fullOrder();
  // 再生リストの項目は、表示切り替えを下の「再生リストの表示」と同じ hpl で持つ(data-p)
  const chk = (k) => k.startsWith("pl:") ? `data-p="${esc(k.slice(3))}" ${hpl.has(k.slice(3)) ? "" : "checked"}` : `data-k="${esc(k)}" ${on(k) ? "checked" : ""}`;
  const name = (k) => k.startsWith("pl:") ? plTitle(plByKey(k)) : T[k];
  const hs = ls.get("tf-hero-src", "auto");
  // 見出しごとに閉じたり開いたりできる(閉じている見出しは tf-set-home-fold に覚える。ドライブ同期の対象)
  const shut = new Set((() => { try { return JSON.parse(ls.get("tf-set-home-fold", "[]")); } catch { return []; } })());
  const sec = (id, title, body) => `<div class="set-sec ${shut.has(id) ? "shut" : ""}" data-sec="${id}"><button type="button" class="set-h set-hb" data-secb="${id}" aria-expanded="${!shut.has(id)}"><i>▾</i>${title}</button><div class="set-sb">${body}</div></div>`;
  let h = sec("hero", "ホームのピックアップ動画", `<label class="set-row"><span>参照する場所 <small>上部の大きなプレビューに出す動画の取得元。自動は、最近保存 → 続きから → 後で見る → 再生リストの順に探します</small></span><select class="sel" data-hero>`
    + `<option value="auto">自動(おまかせ)</option>`
    + `<option value="resume" ${hs === "resume" ? "selected" : ""}>続きから</option><option value="later" ${hs === "later" ? "selected" : ""}>TubeFolio2 後で見る</option><option value="ytlater" ${hs === "ytlater" ? "selected" : ""}>YouTube の後で見る</option>`
    + pls().filter((p) => !LATER(p) && kindOf(p) === "own").map((p) => `<option value="${esc(plId(p))}" ${hs === plId(p) ? "selected" : ""}>${esc(plTitle(p))}</option>`).join("") + `</select></label>`);
  h += sec("order", "ホームの並び順と表示 <small>(行をドラッグして並べ替え)</small>", `<div id="set-ord">` + fo.map((k, i) => `<div class="set-row" data-ok="${esc(k)}"><label><input type="checkbox" ${chk(k)}> <span>${esc(name(k))}</span></label></div>`).join("") + `</div>`);
  $("set-list").innerHTML = h;
}
// 就寝のお知らせを使わないときは、時刻の欄を薄くする
function bedUi() { const on = $("set-bed")?.value === "on"; for (const id of ["set-bed-from", "set-bed-to"]) { const x = $(id); if (x) x.disabled = !on; } }
/* 新着のお知らせ: いつも通知するタイトルの文字(tf-nv-words)。追加(「,」区切りでまとめて)・✕で削除・初期に戻す */
const NVW_DEF = ["LIVE", "ライブ", "生配信", "生放送", "配信中", "緊急", "速報", "重大発表", "ゲリラ"];
async function paintNvw() {
  const box = $("nvw"); if (!box) return;
  const r = await chrome.storage.local.get("tf-nv-words"), w = Array.isArray(r["tf-nv-words"]) ? r["tf-nv-words"] : NVW_DEF;
  box.innerHTML = w.map((x, i) => `<span class="kw-chip">${esc(x)}<button type="button" data-nvwdel="${i}" aria-label="「${esc(x)}」を削除">✕</button></span>`).join("")
    + `<span class="nvw-add"><input class="kw-in" id="nvw-in" placeholder="文字を追加(「,」区切りでまとめて・Enter)"><button type="button" class="btn s kw-add" data-nvw="add">追加</button><button type="button" class="kw-rs" data-nvw="reset" title="初めの文字(${esc(NVW_DEF.join("・"))})に戻す">初期に戻す</button></span>`;
}
async function nvwSet(fn) { const r = await chrome.storage.local.get("tf-nv-words"), w = Array.isArray(r["tf-nv-words"]) ? [...r["tf-nv-words"]] : [...NVW_DEF]; await chrome.storage.local.set({ "tf-nv-words": fn(w) }); await paintNvw(); }
const nvwAdd = () => { const add = ($("nvw-in")?.value || "").split(/[\n,、，､]+/).map((x) => x.trim().slice(0, 30)).filter(Boolean); if (!add.length) return; nvwSet((w) => [...new Set([...w, ...add])]).then(() => $("nvw-in")?.focus()); };
document.addEventListener("click", (e) => {
  const d = e.target.closest("[data-nvwdel]"); if (d) return void nvwSet((w) => w.filter((_, i) => i !== +d.dataset.nvwdel));
  const b = e.target.closest("[data-nvw]"); if (!b) return;
  if (b.dataset.nvw === "add") nvwAdd(); else nvwSet(() => [...NVW_DEF]);
});
document.addEventListener("keydown", (e) => { if (e.target.id === "nvw-in" && e.key === "Enter" && !e.isComposing) { e.preventDefault(); nvwAdd(); } });
function openSettings() {
  paintNvw();
  paintSettings();
  // data-cs の付いた選択(chrome.storage の設定)は、まとめて読む
  const cs = [...document.querySelectorAll("select[data-cs]")];
  chrome.storage.local.get(cs.map((x) => x.dataset.cs)).then((r) => { for (const x of cs) { const v = r[x.dataset.cs]; x.value = v == null ? x.dataset.def : String(v); if (!x.value) x.value = x.dataset.def; } });
  if ($("set-ryd")) $("set-ryd").value = ls.get("tf-ryd", "on") === "off" ? "off" : "on";
  chrome.storage.local.get(["tf-break", "tf-bed", "tf-bed-from", "tf-bed-to"]).then((r) => { const b = $("set-break"); if (b) b.value = String(+r["tf-break"] || 0); if (!b?.value && b) b.value = "0"; const on = $("set-bed"); if (on) on.value = r["tf-bed"] === "on" ? "on" : "off"; if ($("set-bed-from")) $("set-bed-from").value = r["tf-bed-from"] || "23:00"; if ($("set-bed-to")) $("set-bed-to").value = r["tf-bed-to"] || "06:00"; bedUi(); });
  chrome.storage.local.get(["tf-pip-btn", "tf-pip-auto"]).then((r) => { const a = $("set-pipbtn"), b = $("set-pipauto"); if (a) a.value = r["tf-pip-btn"] === "off" ? "off" : "on"; if (b) b.value = r["tf-pip-auto"] === "on" ? "on" : "off"; });
  chrome.storage.local.get(["tf-mini", "tf-mini-size"]).then((r) => { const m = $("set-mini"), z = $("set-minisize"); if (m) m.value = ["br", "bl", "tr", "tl", "off"].includes(r["tf-mini"]) ? r["tf-mini"] : "br"; if (z) z.value = ["s", "m", "l"].includes(r["tf-mini-size"]) ? r["tf-mini-size"] : "m"; });
  chrome.storage.local.get(["tf-cm-hidemode", "tf-rel-mode", "tf-end-mode", "tf-end-tf"]).then((r) => { const en = $("set-endmode"), et = $("set-endtf"); if (en) { en.value = r["tf-end-mode"] || "show"; if (!en.value) en.value = "show"; } if (et) et.value = r["tf-end-tf"] === "on" ? "on" : "off"; paintEndSlots();  const a = $("set-cmhide"), b = $("set-relmode"); if (a) a.value = r["tf-cm-hidemode"] || "show"; if (a && !a.value) a.value = "show"; if (b) b.value = r["tf-rel-mode"] || "show"; if (b && !b.value) b.value = "show"; }); // YouTube の再生画面のコメント欄(content.js が読む)
  $("set-auto").checked = autoScroll;
  $("set-date").value = dateMode;
  $("set-play").value = playOnYt() ? "yt" : "embed";
  fillWlSelect(); // 🕒ボタンの追加先(plmenu.js)
  if (typeof setSetTab === "function") setSetTab(document.querySelector("[data-settab].on")?.dataset.settab || "gen"); // channels.js
  showSettings(true);
}
// 設定はメイン画面の代わりに表示する(サイドバーの項目を押すか「ホームへ戻る」で閉じる)
function showSettings(on) {
  if (!on && $("set").hidden) return;
  $("set").hidden = !on; $("main").hidden = on;
  $("settings").classList.toggle("on", on);
  if (on && innerWidth <= 820) document.body.classList.remove("nav-on");
  renderNav(); scrollTo(0, 0);
}
$("test-nav").onclick = (e) => { e.stopPropagation(); showSettings(false); tab = "test"; render(); scrollTo(0, 0); }; // テストのページ(今後のテスト用)
$("settings").onclick =(e) => { e.stopPropagation(); openSettings(); }; // アカウント欄の中にあるので、アカウント欄のクリックにしない
document.addEventListener("change", (e) => { if (e.target.id === "set-cmhide") chrome.storage.local.set({ "tf-cm-hidemode": e.target.value });
  if (e.target.id === "set-relmode") chrome.storage.local.set({ "tf-rel-mode": e.target.value });
  if (e.target.id === "set-mini") chrome.storage.local.set({ "tf-mini": e.target.value });
  if (e.target.matches?.("select[data-cs]")) { const k = e.target.dataset.cs; chrome.storage.local.set({ [k]: k === "tf-seek" ? +e.target.value : e.target.value }); }
  if (e.target.id === "set-break") chrome.storage.local.set({ "tf-break": +e.target.value });
  if (e.target.id === "set-bed") { chrome.storage.local.set({ "tf-bed": e.target.value }); bedUi(); }
  if ((e.target.id === "set-bed-from" || e.target.id === "set-bed-to") && /^\d{2}:\d{2}$/.test(e.target.value)) chrome.storage.local.set({ [e.target.id === "set-bed-from" ? "tf-bed-from" : "tf-bed-to"]: e.target.value });
  if (e.target.id === "set-pipbtn") chrome.storage.local.set({ "tf-pip-btn": e.target.value });
  if (e.target.id === "set-pipauto") chrome.storage.local.set({ "tf-pip-auto": e.target.value });
  if (e.target.id === "set-minisize") chrome.storage.local.set({ "tf-mini-size": e.target.value });
  if (e.target.id === "set-endmode") chrome.storage.local.set({ "tf-end-mode": e.target.value });
  if (e.target.id === "set-endtf") { chrome.storage.local.set({ "tf-end-tf": e.target.value }); paintEndSlots(); }
  if (e.target.id === "set-endat") chrome.storage.local.set({ "tf-end-at": +e.target.value });
  if (e.target.dataset.endslot != null) saveEndSlots(); });
$("set-close").onclick = () => { showSettings(false); if (tab !== "all") { tab = "all"; render(); } };
$("set-list").addEventListener("change", (e) => {
  const k = e.target.dataset.k, p = e.target.dataset.p;
  if (e.target.dataset.hero !== undefined) { ls.set("tf-hero-src", e.target.value); heroI = 0; return render(); }
  if (k) { e.target.checked ? hidden.delete(k) : hidden.add(k); ls.set("tf-home-hidden", JSON.stringify([...hidden])); }
  else if (p) { e.target.checked ? hpl.delete(p) : hpl.add(p); ls.set("tf-home-hpl", JSON.stringify([...hpl])); }
  else return;
  render();
});
$("set-list").addEventListener("click", (e) => {
  const sb = e.target.closest("[data-secb]");
  if (sb) { // 見出しを押して、閉じる・開く
    const sc = sb.closest(".set-sec"), id = sb.dataset.secb, now = sc.classList.toggle("shut");
    sb.setAttribute("aria-expanded", String(!now));
    let l = []; try { l = JSON.parse(ls.get("tf-set-home-fold", "[]")); } catch {}
    l = l.filter((x) => x !== id); if (now) l.push(id); ls.set("tf-set-home-fold", JSON.stringify(l));
    return;
  }
});
// 並び順の行を、行のどこでもつかんで上下にドラッグして入れ替える
// (マウス: 少し動かすと始まる / タッチ: 少し長押ししてから。チェックボックスを押すだけなら、これまでどおり表示の切り替え)
$("set-list").addEventListener("pointerdown", (e) => {
  const row = e.target.closest("#set-ord .set-row"), box = $("set-ord"); if (!row || !box || e.button > 0) return;
  const y0 = e.clientY, touch = e.pointerType === "touch"; let on = false, timer = 0, moved = false;
  const start = () => { on = true; row.classList.add("drag"); try { row.setPointerCapture(e.pointerId); } catch {} };
  if (touch) timer = setTimeout(start, 280);
  const move = (ev) => {
    if (!on) { if (Math.abs(ev.clientY - y0) > 5) { if (touch) return end(false); start(); } else return; }
    moved = true; ev.preventDefault();
    const rows = [...box.children].filter((r) => r !== row);
    const nx = rows.find((r) => { const b = r.getBoundingClientRect(); return ev.clientY < b.top + b.height / 2; });
    if (nx) { if (row.nextElementSibling !== nx) box.insertBefore(row, nx); } else if (box.lastElementChild !== row) box.append(row);
    if (ev.clientY < 60) scrollBy(0, -12); else if (ev.clientY > innerHeight - 60) scrollBy(0, 12); // 端に近づいたら、ページをスクロール
  };
  const tm = (ev) => { if (on) ev.preventDefault(); }; // 長押しで始まったあとは、ページを動かさない
  const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); }; // ドラッグしたあとの「クリック」で、チェックが切り替わらないように
  function end(commit = true) {
    clearTimeout(timer);
    document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); document.removeEventListener("pointercancel", cancel); document.removeEventListener("touchmove", tm);
    row.classList.remove("drag");
    if (moved) { document.addEventListener("click", swallow, { capture: true, once: true }); setTimeout(() => document.removeEventListener("click", swallow, true), 50); }
    if (!commit || !moved) return;
    const ks = [...box.children].map((r) => r.dataset.ok);
    if (ks.join() === fullOrder().join()) return;
    order = [...ks, ...order.filter((x) => x.startsWith("pl:") && !ks.includes(x))]; // 今は読み込めていない再生リストの位置も残す
    ls.set("tf-home-order", JSON.stringify(order)); paintSettings(); render();
  }
  const up = () => end(true), cancel = () => end(false);
  document.addEventListener("pointermove", move); document.addEventListener("pointerup", up); document.addEventListener("pointercancel", cancel); document.addEventListener("touchmove", tm, { passive: false });
});
$("set-play").onchange = () => ls.set(playKey(), $("set-play").value);
$("set-reload").onclick = () => { showSettings(false); refreshHome(true); };
document.addEventListener("change", (e) => { if (e.target.id !== "set-dummy") return; useDummy = e.target.checked; ls.set("tf-home-dummy", useDummy ? "1" : "0"); render(); if (!useDummy) refreshHome(true); });

/* ---------- 一覧(横スクロールの行)を自動でゆっくり動かす ---------- */
let autoScroll = ls.get("tf-home-auto", "1") === "1";
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const AS = new WeakMap(); // track -> { x, dir, wait }
let lastT = 0;
function autoStep(now) {
  const dt = Math.min(0.1, (now - (lastT || now)) / 1000); lastT = now;
  if (autoScroll && !reduceMotion.matches && !$("pl").open && $("set").hidden && !$("pm") && !$("fd").open && !$("chd").open) {
    for (const tr of document.querySelectorAll(".track")) {
      const max = tr.scrollWidth - tr.clientWidth; if (max <= 4) continue;
      let st = AS.get(tr); if (!st) AS.set(tr, st = { x: tr.scrollLeft, dir: 1, wait: 1 });
      // 触っている間は止める。左右の矢印は .track の外(.rail の中)にあるので、.rail ごと見る
      // (.track だけ見ていると、矢印を押したときも動かし続けて、矢印のなめらかなスクロールを毎フレーム打ち消していた)
      const area = tr.closest(".rail") || tr;
      if ((railHold.get(tr) || 0) > now || area.matches(":hover") || area.contains(document.activeElement)) { st.x = tr.scrollLeft; continue; }
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

/* 動画の終わりの「TubeFolio3 のおすすめ(4本)」: 4つの枠それぞれに、おすすめを選ぶ再生リストを指定する(content の endscreen.js が読む)
   保存: "tf-end-slots" = [{ id, title } | null] ×4 */
async function paintEndSlots() {
  const box = $("set-endslots"), mode = $("set-endtf")?.value === "on" ? "tf" : ""; if (!box) return;
  box.hidden = mode !== "tf"; if (box.hidden) return;
  const got = await chrome.storage.local.get(["tf-end-slots", "tf-end-at"]), cur = got["tf-end-slots"] || [], atv = String(+got["tf-end-at"] || 0);
  const AT = [["0", "動画が終わったとき"], ["5", "終わる5秒前"], ["10", "終わる10秒前"], ["20", "終わる20秒前"], ["30", "終わる30秒前"], ["60", "終わる1分前"]];
  const atRow = `<label class="set-row sub"><span>表示するタイミング <small>「終わる◯秒前」では、動画の上に重ねて出します(再生は続きます)</small></span><select class="sel" id="set-endat">${AT.map(([v, l]) => `<option value="${v}" ${v === atv ? "selected" : ""}>${l}</option>`).join("")}</select></label>`;
  const list = pls().filter((p) => !p.dummy);
  const name = ["1番目", "2番目", "3番目", "4番目"], note = ["見ている動画がこのリストにあれば、その次の動画。なければリストからランダム", "リストからランダム", "リストからランダム", "リストからランダム"];
  box.innerHTML = atRow + name.map((n, i) => {
    const sel = cur[i]?.id || "";
    const opts = `<option value="">(使わない)</option>` + list.map((p) => `<option value="${esc(p.id)}" ${p.id === sel ? "selected" : ""}>${esc(p.title)}</option>`).join("")
      + (sel && !list.some((p) => p.id === sel) ? `<option value="${esc(sel)}" selected>${esc(cur[i].title || sel)}</option>` : "");
    return `<label class="set-row sub"><span>${n}の動画 <small>${note[i]}</small></span><select class="sel" data-endslot="${i}">${opts}</select></label>`;
  }).join("") + (list.length ? "" : `<p class="hint">再生リストを読み込み中です。少し待ってから開き直してください。</p>`);
}
async function saveEndSlots() {
  const slots = [...document.querySelectorAll("[data-endslot]")].map((s) => { const o = s.selectedOptions[0]; return s.value ? { id: s.value, title: o?.textContent || "" } : null; });
  await chrome.storage.local.set({ "tf-end-slots": slots });
}
// 以前の形式(「YouTube のおすすめ」の選択肢の中に TubeFolio3 のおすすめがあった)からの移し替え
chrome.storage.local.get("tf-end-mode").then((r) => { if (r["tf-end-mode"] === "tf") chrome.storage.local.set({ "tf-end-mode": "show", "tf-end-tf": "on" }); });

/* 再生リストの「すべて表示」: 登録順の 新しい順 / 古い順 を切り替える(すべての再生リストで共通。"tf-pl-ord")
   YouTube の再生リストの並び(追加した動画が後ろに付く)を「古い順」とし、「新しい順」はその逆にする */
let plOrd = ls.get("tf-pl-ord", "old") === "new" ? "new" : "old";
const plOrdered = (items) => (plOrd === "new" ? [...items].reverse() : items);
const ordSeg = () => `<span class="pord"><div class="vseg grp" role="radiogroup" aria-label="登録順の並び"><span class="s-cl">登録順</span>${[["new", "新しい順"], ["old", "古い順"]].map(([v, l]) => `<button type="button" class="${plOrd === v ? "on" : ""}" data-plord="${v}" role="radio" aria-checked="${plOrd === v}" title="登録した順で${l}に並べる">${l}</button>`).join("")}</div></span>`;
document.addEventListener("click", (e) => { const b = e.target.closest("[data-plord]"); if (!b || b.dataset.plord === plOrd) return; plOrd = b.dataset.plord; ls.set("tf-pl-ord", plOrd); render(); });

/* ページの中に出す確認の画面(confirm() の代わり)。モバイル版のブラウザでは、拡張機能のページで confirm() が表示されないことがあるため
   askDlg(題, 本文, [[値, ボタンの文字, "p"(強調) | "s"], ...]) → 押したボタンの値(閉じたときは "") */
function askDlg(title, msg, btns) {
  return new Promise((res) => {
    const d = document.createElement("dialog"); d.className = "ask";
    d.innerHTML = `<h3></h3><p></p><div class="ask-b"></div>`;
    d.querySelector("h3").textContent = title; d.querySelector("h3").hidden = !title; d.querySelector("p").textContent = msg;
    let val = "";
    for (const [v, label, cls] of btns) { const b = document.createElement("button"); b.type = "button"; b.className = "btn " + (cls || "s"); b.textContent = label; b.onclick = () => { val = v; d.close(); }; d.querySelector(".ask-b").append(b); }
    d.addEventListener("close", () => { d.remove(); res(val); });
    d.addEventListener("click", (e) => { if (e.target === d) d.close(); }); // 外側を押したら閉じる(やめる)
    document.body.append(d); d.showModal();
    d.querySelector(".btn.p")?.focus();
  });
}
const uiConfirm = async (msg, ok = "OK") => (await askDlg("", msg, [["ok", ok, "p"], ["", "キャンセル", "s"]])) === "ok";

/* 設定の「ログ」タブ: log.js が残した記録(このパソコンだけ)を新しい順に見る。コピーして送れば、不具合の調べに使える */
let logLv = "all";
async function paintLog() {
  const box = $("set-log"); if (!box) return;
  const all = ((await chrome.storage.local.get("tf-log"))["tf-log"] || []).slice().reverse();
  const list = logLv === "all" ? all : all.filter((e) => (logLv === "error" ? e.lv === "error" : e.lv !== "info"));
  const n = (f) => all.filter(f).length, LV = { info: "情報", warn: "注意", error: "エラー" };
  const seg = (v, l) => `<button type="button" class="${logLv === v ? "on" : ""}" data-loglv="${v}">${l}</button>`;
  const when = (t) => new Date(t).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  box.innerHTML = `<p class="hint kw-hint">同期の流れやエラーの記録です(このパソコンだけに残り、ドライブには同期しません。新しい 500件まで)。うまく動かないときは「コピー」して送ってください。</p>`
    + `<div class="kw-bar"><div class="kw-seg">${seg("all", `すべて ${all.length}`)}${seg("warn", `注意とエラー ${n((e) => e.lv !== "info")}`)}${seg("error", `エラー ${n((e) => e.lv === "error")}`)}</div>`
    + `<span class="kw-fa"><button type="button" class="btn s" data-log="reload">↻ 更新</button><button type="button" class="btn s" data-log="copy">コピー</button><button type="button" class="btn s" data-log="clear">消す</button></span></div>`
    + (list.length ? `<div class="log-l">${list.map((e) => `<div class="log-r ${esc(e.lv)}"><span class="log-t">${when(e.t)}</span><span class="log-lv">${LV[e.lv] || esc(e.lv)}</span><span class="log-c">${esc(e.cat)}<small>${esc(e.where || "")}</small></span><span class="log-m">${esc(e.msg)}</span></div>`).join("")}</div>`
      : `<p class="kw-empty">記録はまだありません。</p>`);
}
document.addEventListener("click", async (e) => {
  const lv = e.target.closest?.("[data-loglv]"); if (lv) { logLv = lv.dataset.loglv; return paintLog(); }
  const b = e.target.closest?.("[data-log]"); if (!b) return;
  const a = b.dataset.log;
  if (a === "reload") return paintLog();
  if (a === "clear") { if (!await uiConfirm("ログをすべて消しますか?")) return; await chrome.storage.local.set({ "tf-log": [] }); return paintLog(); }
  if (a === "copy") {
    const all = (await chrome.storage.local.get("tf-log"))["tf-log"] || [];
    const text = `TubeFolio3 ログ(${navigator.userAgent})\n` + all.map((x) => `${new Date(x.t).toLocaleString("ja-JP")} [${x.lv}] ${x.cat}/${x.where}: ${x.msg}`).join("\n");
    try { await navigator.clipboard.writeText(text); toast(`ログ ${all.length}件をコピーしました`); } catch { toast("コピーできませんでした"); }
  }
});
chrome.storage.onChanged.addListener((c) => { if (c["tf-log"] && !$("set-log")?.hidden) paintLog(); });

/* 設定「一般」の「お知らせの確認」: テスト通知 / 今すぐ確認(background.js の nvDeliver / nvCheck) */
async function paintNvLast() {
  const s = $("nv-last"); if (!s) return;
  const t = (await chrome.storage.local.get("tf-nv-last"))["tf-nv-last"];
  s.textContent = t ? `(最後に確認: ${new Date(t).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })})` : "(まだ確認していません)";
}
paintNvLast();
document.addEventListener("click", async (e) => {
  const b = e.target.closest?.("[data-nv]"); if (!b) return;
  b.disabled = true;
  try {
    if (b.dataset.nv === "test") { const r = await chrome.runtime.sendMessage({ tf: "nv-test" }); toast(r?.ok ? "テスト通知を出しました(出ないときは、Windows とブラウザの通知の設定を見てください)" : "テスト通知を出せませんでした: " + (r?.error || "")); }
    else { toast("新着を確認しています…"); const r = await chrome.runtime.sendMessage({ tf: "nv-check" }); toast(!r?.ok ? "確認できませんでした: " + (r?.error || "") : r.first ? `新着 ${r.count}本を覚えました(次の確認から、新しい動画を知らせます)` : `新着 ${r.count}本を確認しました(お知らせ ${r.notified}本)`); }
  } catch (err) { toast("拡張機能に接続できませんでした: " + (err?.message || err)); }
  finally { b.disabled = false; paintNvLast(); }
});
