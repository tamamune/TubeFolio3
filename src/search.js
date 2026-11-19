/* ===== 検索ページ =====
   対象(どのチャンネルの動画か)と種類(動画 / ライブ・配信 / ショート)を選んで一覧を表示する。
   ・キーワードなし
       登録チャンネル     … 登録チャンネルの新着を、日付ごとに5日分。1日分そろうたびに表示し、続きを順に読み込む
       登録していないチャンネル … YouTube のおすすめのうち、登録していないチャンネルのもの
       すべて            … YouTube のおすすめ(登録・未登録の両方)
   ・キーワードあり … YouTube で検索(種類で絞り込み)し、対象で絞り込む
   動画をクリックすると、その場で再生する(🕒・⋮ は plmenu.js) */

const SEARCH_ICO = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>`;
const S_TARGETS = [["all", "すべて"], ["sub", "登録チャンネル"], ["nonsub", "登録していないチャンネル"]];
// すべて: YouTube のホームのように、動画・ライブは並べて表示し、ショートは横並びの棚にまとめる
const S_TYPES = [["all", "すべて"], ["video", "動画"], ["live", "ライブ・配信"], ["short", "ショート"]];
const S_DAYS = 5; // 登録チャンネルを日付ごとに表示する日数
let sTarget = ls.get("tf-s-target", "sub"), sType = ls.get("tf-s-type", "video");
if (!S_TARGETS.some(([k]) => k === sTarget)) sTarget = "sub";
if (!S_TYPES.some(([k]) => k === sType)) sType = "video";
let sq = "";       // 検索中のキーワード("" ならおすすめ・登録チャンネルの一覧)
let sRun = 0;      // 読み込みの番号(切り替えたら古い読み込みの結果は捨てる)

// 読み込み状態: キーワード検索 / 登録チャンネルの新着 / おすすめ
const S = {
  kw: { key: "", list: [], token: "", busy: false, done: false, err: "" },
  sub: { list: [], token: "", busy: false, done: false, err: "", at: 0, started: false, reached: Infinity },
  rec: { list: [], token: "", busy: false, done: false, err: "", at: 0, started: false },
};

/* ---------- YouTube のデータから動画を集める(動画 / ライブ・配信 / ショートを見分ける) ---------- */
const LIVE_RE = /ライブ|LIVE|配信予定|配信中|プレミア|Premier|UPCOMING|Upcoming|視聴中|watching/i;
function collectVideos(root) {
  const out = [], seen = new Set(); let token = "";
  const add = (o) => { if (o.id && !seen.has(o.id)) { seen.add(o.id); if (o.pct) noteWatched(o.id, o.pct); out.push(o); } };
  (function walk(n) {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(walk);
    const r = n.videoRenderer || n.gridVideoRenderer;
    if (r?.videoId) {
      const url = r.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url || "";
      const badges = JSON.stringify([r.badges, r.thumbnailOverlays, r.upcomingEventData ? "UPCOMING" : ""]);
      const pub = txt(r.publishedTimeText);
      const kind = url.startsWith("/shorts/") ? "short" : /LIVE|UPCOMING/.test(badges) || /配信|Streamed/i.test(pub) || r.upcomingEventData ? "live" : "video";
      add({ id: r.videoId, pct: watchedPct(r), title: txt(r.title), channel: txt(r.ownerText) || txt(r.shortBylineText) || txt(r.longBylineText), chUrl: chUrlOf(r.ownerText || r.shortBylineText || r.longBylineText), duration: txt(r.lengthText), pub, views: txt(r.viewCountText) || txt(r.shortViewCountText), kind, badge: liveBadge(badges, pub, r.upcomingEventData) });
      return;
    }
    const lv = n.lockupViewModel;
    if (lv && /VIDEO/.test(lv.contentType || "") && lv.contentId) {
      const info = lockupInfo(lv), s = JSON.stringify(lv.contentImage || {});
      const isLive = /BADGE_STYLE_LIVE|THUMBNAIL_OVERLAY_BADGE_STYLE_LIVE|"(ライブ|LIVE|配信予定|Upcoming|プレミア公開)"/.test(s) || /配信|Streamed/i.test(info.pub);
      add({ id: lv.contentId, ...info, kind: isLive ? "live" : "video", badge: isLive ? liveBadge(s, info.pub) : "" });
      return;
    }
    const sl = n.shortsLockupViewModel;
    if (sl) {
      const id = sl.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId || (sl.entityId || "").replace(/^shorts-shelf-item-/, "");
      if (id) add({ id, title: sl.overlayMetadata?.primaryText?.content || sl.accessibilityText || "", channel: "", duration: "", pub: "", views: sl.overlayMetadata?.secondaryText?.content || "", kind: "short" });
      return;
    }
    const rl = n.reelItemRenderer;
    if (rl?.videoId) { add({ id: rl.videoId, title: txt(rl.headline), channel: "", duration: "", pub: "", views: txt(rl.viewCountText), kind: "short" }); return; }
    const tk = n.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
    if (tk) token = tk;
    Object.values(n).forEach(walk);
  })(root);
  return { list: out, token };
}
// ライブ・配信の印: 配信中 / 配信予定 / 配信済み
function liveBadge(s, pub = "", upcoming = null) {
  if (upcoming || /UPCOMING|配信予定|Upcoming/.test(s)) return "配信予定";
  if (/BADGE_STYLE_LIVE|"LIVE"|"ライブ"|視聴中|watching/i.test(s)) return "ライブ中";
  if (/配信|Streamed/i.test(pub)) return "配信済み";
  return "";
}

/* ---------- 読み込み(ページのHTML → 続きは youtubei) ---------- */
let searchCtx = null; // 検索の続きを読むためのクライアント情報(最初の検索ページから取る)
async function ytPage(url) {
  const html = await (await fetch(url, { credentials: "include" })).text();
  const a = html.indexOf("ytInitialData = "), b = html.indexOf(";</script>", a);
  if (a < 0 || b < 0) throw new Error("data");
  YTA.useHtml(html); // 続きを読むためのクライアント情報(ytapi.js)
  const ctx = jsonAfter(html, '"INNERTUBE_CONTEXT":');
  if (ctx) searchCtx = { context: ctx, version: (html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/) || [])[1] || ctx.client?.clientVersion || "" };
  return collectVideos(JSON.parse(html.slice(a + 16, b)));
}
const ytMore = async (token) => collectVideos(await YTA.browse(token));
async function ytSearchMore(token) { // 検索の続きは search エンドポイント
  if (!searchCtx) throw new Error("ctx");
  const headers = { "Content-Type": "application/json", "X-Youtube-Client-Name": "1", "X-Youtube-Client-Version": searchCtx.version, "X-Origin": "https://www.youtube.com" };
  const auth = await authHeader(); if (auth) { headers.Authorization = auth; headers["X-Goog-AuthUser"] = "0"; }
  const r = await fetch("https://www.youtube.com/youtubei/v1/search?prettyPrint=false", { method: "POST", credentials: "include", headers, body: JSON.stringify({ context: searchCtx.context, continuation: token }) });
  if (!r.ok) throw new Error("http " + r.status);
  return collectVideos(await r.json());
}

/* ---------- 種類・対象で絞り込む ---------- */
const typeOk = (v) => sType === "all" || v.kind === sType;
const targetOk = (v) => sTarget === "all" || (sTarget === "sub" ? isSubV(v) : !isSubV(v)); // isSubV は subtest.js
const SP = { all: "", video: "EgIQAQ==", live: "EgJAAQ==", short: "EgIQCQ==" }; // YouTube 検索の絞り込み(すべて=絞り込みなし / 動画 / ライブ / ショート)

/* ---------- 日付(登録チャンネルを日ごとに分ける) ---------- */
const DAY = 864e5;
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
// 動画の公開日(分かる範囲で)。「3時間前」「2日前」などから求める。配信予定・配信中は今日
function vDate(v) {
  if (v.pubDate) return new Date(v.pubDate + "T00:00:00");
  if (v.badge === "配信予定" || v.badge === "ライブ中") return new Date();
  const p = v.pub || "";
  let m = /(\d+)\s*(秒|分|時間|日|週間|か月|ヶ月|ヵ月|年)前/.exec(p), n, u;
  if (m) { n = +m[1]; u = m[2]; }
  else if ((m = /(\d+)\s*(second|minute|hour|day|week|month|year)s?\s*ago/i.exec(p))) { n = +m[1]; u = { second: "秒", minute: "分", hour: "時間", day: "日", week: "週間", month: "か月", year: "年" }[m[2].toLowerCase()]; }
  else return null;
  const ms = { 秒: 1e3, 分: 6e4, 時間: 36e5, 日: DAY, 週間: 7 * DAY, か月: 30 * DAY, ヶ月: 30 * DAY, ヵ月: 30 * DAY, 年: 365 * DAY }[u];
  return new Date(Date.now() - n * ms);
}
const lastDays = () => { const t = new Date(); t.setHours(0, 0, 0, 0); return [...Array(S_DAYS)].map((_, i) => new Date(t.getTime() - i * DAY)); };
const dayLabel = (d, i) => `${d.getMonth() + 1}月${d.getDate()}日(${"日月火水木金土"[d.getDay()]})${i === 0 ? " ・ 今日" : i === 1 ? " ・ 昨日" : ""}`;

/* ---------- 読み込みの本体 ---------- */
// 登録チャンネルの新着: 1ページ読むたびに表示し、5日より前の動画が出てくるまで続きを読む
async function loadSub(reset) {
  const st = S.sub;
  if (st.busy) return;
  if (reset) Object.assign(st, { list: [], token: "", done: false, err: "", at: Date.now(), started: true, reached: Infinity });
  if (st.done) return paintSearch();
  st.busy = true; paintSearch();
  const oldest = lastDays()[S_DAYS - 1].getTime() - (st.extra || 0) * 864e5; // st.extra: フォルダの一覧で「さらに過去を読む」を押した分の日数
  try {
    for (let n = 0; n < 60; n++) {
      const page = st.token ? await ytMore(st.token) : await ytPage("https://www.youtube.com/feed/subscriptions");
      const have = new Set(st.list.map((x) => x.id));
      st.list.push(...page.list.filter((x) => !have.has(x.id)).map((x) => ({ ...x, sub: true })));
      st.token = page.token;
      needDet(page.list.map((x) => [x.id, x])); // 日付やチャンネル名の分からない動画(ショートなど)は動画ページから補う(home.js)
      // どこまで読めたか: 新着はおおむね新しい順だが、古い配信のアーカイブなどが混ざることがある。
      // 1件の古い動画で「読み終わった」と判断しないよう、ページごとの真ん中の日時を使う
      const pd = page.list.filter((x) => !x.badge || x.badge === "配信済み").map(vDate).filter(Boolean).map((d) => d.getTime()).sort((a, b) => a - b);
      if (pd.length) st.reached = Math.min(st.reached, pd[Math.floor(pd.length / 2)]);
      paintSearch(); // 1日分ずつ見えるように、読むたびに描き直す
      if (!st.token || st.reached < oldest) { st.done = true; break; }
    }
  } catch { st.err = "登録チャンネルの新着を読み込めませんでした(YouTubeへのログインを確認してください)"; }
  finally { st.busy = false; paintSearch(); }
}
// おすすめ: 表示できる動画が足りるまで(最大数ページ)続きを読む
async function loadRec(reset, more = false) {
  const st = S.rec;
  if (st.busy) return;
  if (reset) Object.assign(st, { list: [], token: "", done: false, err: "", at: Date.now(), started: true });
  if (st.done) return paintSearch();
  st.busy = true; paintSearch();
  const want = (more ? shown(st.list).length : 0) + 24;
  try {
    for (let n = 0; n < 8; n++) {
      const page = st.token ? await ytMore(st.token) : await ytPage("https://www.youtube.com/");
      const have = new Set(st.list.map((x) => x.id));
      st.list.push(...page.list.filter((x) => !have.has(x.id)));
      st.token = page.token; if (!st.token) st.done = true;
      paintSearch();
      if (st.done || shown(st.list).length >= want) break;
    }
  } catch { st.err = "おすすめを読み込めませんでした(YouTubeへのログインを確認してください)"; }
  finally { st.busy = false; paintSearch(); }
}
// キーワード検索(種類はYouTube側で絞り込み、対象はこちらで絞り込む)
// 新しいキーワード・種類で検索し直したときは、前の検索の結果は捨てる(sRun で見分ける)
async function loadKw(more) {
  const st = S.kw, key = `${sq}\n${sType}`;
  if (more && st.key === key && (st.busy || st.done)) return;
  const run = ++sRun;
  if (!more || st.key !== key) Object.assign(st, { key, list: [], token: "", done: false, err: "" });
  st.busy = run; paintSearch();
  const want = shown(st.list).length + 20;
  try {
    for (let n = 0; n < 5; n++) {
      const page = st.token ? await ytSearchMore(st.token)
        : await ytPage("https://www.youtube.com/results?search_query=" + encodeURIComponent(sq) + (SP[sType] ? "&sp=" + encodeURIComponent(SP[sType]) : "") + "&hl=ja");
      if (run !== sRun) return;
      const have = new Set(st.list.map((x) => x.id));
      // 種類は YouTube 側で絞り込み済みなので、その種類として扱う(ライブの印などはそのまま)
      st.list.push(...page.list.filter((x) => !have.has(x.id)).map((x) => (sType === "all" ? x : { ...x, kind: sType })));
      st.token = page.token; if (!st.token) st.done = true;
      paintSearch();
      if (st.done || shown(st.list).length >= want) break;
    }
  } catch { if (run === sRun) st.err = "検索できませんでした。YouTubeに接続できるか、ネットワークを確認してください。"; }
  finally { if (st.busy === run) { st.busy = false; paintSearch(); } }
}
// いまの条件で表示する動画
const shown = (list) => withDet(list.map((v) => [v.id, v])).map(([, v]) => v).filter((v) => typeOk(v) && (v.sub ? sTarget !== "nonsub" : targetOk(v)));

/* ---------- 表示 ---------- */
function sCard(v) {
  vmap.set(v.id, v);
  const dur = v.badge ? `<span class="dur ${v.badge === "配信済み" ? "" : "live"}">${esc(v.badge)}</span>` : v.kind === "short" ? `<span class="dur">ショート</span>` : v.duration ? `<span class="dur">${esc(v.duration)}</span>` : "";
  return `<button class="c ${subCls(v)}" data-v="${esc(v.id)}"><div class="th"><img loading="lazy" src="${thumb(v.id)}" alt="">${dur}${progHtml(v.id, v)}${bmBtn(v.id)}${wlBtn(v.id)}</div>${titleHtml(v.id, v.title)}${cn(v)}</button>`; // 🕒・⋮ は plmenu.js
}
// ショートの縦長カード(ホームのショートの棚と同じ見た目)
function shCard(v) {
  vmap.set(v.id, v);
  return `<button class="c sh" data-v="${esc(v.id)}"><div class="th sh-th"><img loading="lazy" src="${thumb(v.id, "hqdefault")}" alt="">${bmBtn(v.id)}${wlBtn(v.id)}</div>${titleHtml(v.id, v.title)}${v.views ? `<small class="cm">${esc(v.views)}</small>` : ""}</button>`;
}
// 一覧を並べる。種類が「すべて」のときは YouTube のホームのように、動画・ライブを並べた途中にショートの棚(横スクロール)を入れる
function mixedGrid(list, label = "ショート") {
  if (sType !== "all") return sType === "short" ? vgrid(list.map(shCard).join("")).replace('class="grid vg', 'class="grid vg sh-grid') : vgrid(list.map(sCard).join(""));
  const long = list.filter((v) => v.kind !== "short"), shorts = list.filter((v) => v.kind === "short");
  const shelf = shorts.length ? rail(label, shorts.map(shCard).join(""), shorts.length, "本") : "";
  const cut = Math.min(long.length, vCols * 2); // 2段分の動画のあとにショートの棚
  return (cut ? vgrid(long.slice(0, cut).map(sCard).join("")) : "") + shelf + (long.length > cut ? vgrid(long.slice(cut).map(sCard).join("")) : "");
}
const chipRow =(label, list, cur, attr) => `<div class="s-chips"><span class="s-cl">${label}</span>${list.map(([k, n]) => `<button type="button" class="tab ${cur === k ? "on" : ""}" ${attr}="${k}" aria-pressed="${cur === k}">${n}</button>`).join("")}</div>`;
const sMode = () => sq ? "kw" : sTarget === "sub" ? "sub" : "rec";

// 「もっと見る」が画面の近くまで来たら、自動で続きを読み込む(ボタンを押さなくてよい)
const searchMoreNow = () => (sMode() === "kw" ? loadKw(true) : loadRec(false, true));
const moreIO = typeof IntersectionObserver === "function" ? new IntersectionObserver((es) => {
  if (!es.some((e) => e.isIntersecting)) return;
  const st = S[sMode()]; if (!st || st.busy || st.err || st.done) return;
  searchMoreNow();
}, { rootMargin: "900px 0px" }) : null;
function paintSearch() { // 結果の部分だけ描き直す(入力欄は触らない)
  if (typeof paintFolderList === "function") paintFolderList(); // フォルダの一覧(chstats.js)も、新着の読み込みに合わせて描き直す
  const box = $("s-out"); if (!box) return;
  const mode = sMode(), st = S[mode];
  const tn = S_TYPES.find(([k]) => k === sType)[1];
  let h = "";
  if (st.err) h += `<div class="empty" style="margin:20px 32px">${esc(st.err)}</div>`;
  if (mode === "sub") {
    // 日付ごと。読み込み中の日は「読み込み中…」、そろった日から表示する
    const list = shown(st.list), days = lastDays();
    const reached = st.reached ?? Infinity; // ここより新しい日はそろっている(loadSub で求める)
    h += `<div class="s-bar"><div class="s-head">登録チャンネルの新着<small>日付ごと</small></div>${vbar()}</div>`;
    // 新しい日から順に。新着は新しい順に届くので、まだそろっていない日が出たら、そこで「読み込み中…」を出して止める
    for (const [i, d] of days.entries()) {
      const k = dayKey(d), items = list.filter((v) => { const x = vDate(v); return x && dayKey(x) === k; });
      const complete = st.done || reached < d.getTime(); // この日より前の動画まで読めていれば、この日はそろっている
      h += `<div class="s-day">${dayLabel(d, i)}<small>${items.length}本${complete ? "" : " ・ 読み込み中…"}</small></div>`
        + (items.length ? mixedGrid(items) : complete ? `<div class="empty s-none">この日の${tn}はありません</div>` : "");
      if (!complete) { if (st.busy) h += `<div class="s-load">読み込み中…</div>`; break; }
    }
    const nodate = list.filter((v) => !vDate(v));
    if (nodate.length && !st.busy) h += `<div class="s-day">日付を確認中<small>${nodate.length}本</small></div>${mixedGrid(nodate)}`;
    if (!st.busy && st.started) h += `<div class="s-more"><button class="btn s" data-act="s-reload">⟳ 読み込み直す</button></div>`;
  } else {
    const list = shown(st.list);
    const head = mode === "kw" ? `「${esc(sq)}」の検索結果` : sTarget === "all" ? "YouTubeのおすすめ" : "おすすめ(登録していないチャンネル)";
    if (list.length) h += `<div class="s-bar"><div class="s-head">${head}<small>${list.length}本</small></div>${vbar()}</div>${mixedGrid(list)}`;
    else if (!st.busy && !st.err && (mode === "kw" || st.started)) h += `<div class="empty">${mode === "kw" ? `「${esc(sq)}」に一致する${tn}は見つかりませんでした。` : `表示できる${tn}がありません。`}</div>`;
    if (st.busy) h += `<div class="s-load">${mode === "kw" ? "検索中…" : "読み込み中…"}</div>`;
    else if (!st.done && (list.length || st.list.length)) h += `<div class="s-more"><button class="btn s" data-act="s-more">もっと見る</button></div>`;
    else if (mode === "rec" && st.started) h += `<div class="s-more"><button class="btn s" data-act="s-reload">⟳ 読み込み直す</button></div>`;
  }
  if (box._h === h) return; // 中身が同じなら描き直さない(ちらつき防止)
  // 横並びの棚(ショート)の左右の位置は、描き直しても保つ
  // (ショートの日付などを後から取ってくるたびに描き直すので、保たないと矢印で送っても先頭に戻ってしまっていた)
  const keepX = new Map([...box.querySelectorAll(".row")].map((r) => [r.querySelector("h2")?.textContent || "", r.querySelector(".track")?.scrollLeft || 0]));
  box._h = h; box.innerHTML = h;
  box.querySelectorAll(".row").forEach((r) => { const x = keepX.get(r.querySelector("h2")?.textContent || ""), tr = r.querySelector(".track"); if (x && tr) tr.scrollLeft = x; });
  if (moreIO) { moreIO.disconnect(); const b = box.querySelector('[data-act="s-more"]'); if (b) moreIO.observe(b); } // 描き直すたびに、新しい「もっと見る」を見張り直す
}

// いまの条件で一覧を出す(必要なら読み込む)
function runSearch(force = false) {
  const mode = sMode();
  if (mode === "kw") return !force && S.kw.key === `${sq}\n${sType}` && (S.kw.list.length || S.kw.busy) ? paintSearch() : loadKw(false);
  const st = S[mode], old = Date.now() - st.at > 10 * 60 * 1000; // 10分たったら読み直す
  if (force || !st.started || (old && !st.busy)) return mode === "sub" ? loadSub(true) : loadRec(true);
  if (mode === "sub" && !st.done) return loadSub(false);
  paintSearch();
}

function searchView() {
  setTimeout(() => { runSearch(); const i = $("s-q"); if (i && !sq) i.focus(); }, 0);
  return `<form class="s-form" id="s-form" role="search">${SEARCH_ICO}<input id="s-q" type="search" placeholder="キーワードで検索(空のままなら一覧を表示)" value="${esc(sq)}" autocomplete="off"><button class="btn p" type="submit">検索</button></form>`
    + `<div class="s-filters">${chipRow("対象", S_TARGETS, sTarget, "data-starget")}${chipRow("種類", S_TYPES, sType, "data-stype")}</div><div id="s-out"></div>`;
}

document.addEventListener("submit", (e) => {
  if (e.target.id !== "s-form") return;
  e.preventDefault(); sq = $("s-q").value.trim(); runSearch(true);
});
// 入力欄を空にしたら(×ボタンなど)、キーワードなしの一覧に戻す
document.addEventListener("search", (e) => { if (e.target.id === "s-q" && !e.target.value && sq) { sq = ""; runSearch(); } }, true);
document.addEventListener("click", (e) => {
  const t = (s) => e.target.closest(s); let b;
  if ((b = t("[data-starget]"))) { sTarget = b.dataset.starget; ls.set("tf-s-target", sTarget); return repaintFilters(); }
  if ((b = t("[data-stype]"))) {
    const prev = sType; sType = b.dataset.stype; ls.set("tf-s-type", sType);
    return repaintFilters(sq && prev !== sType); // キーワード検索は種類ごとに検索し直す
  }
  if (t('[data-act="s-more"]')) { const m = sMode(); return m === "kw" ? loadKw(true) : loadRec(false, true); }
  if (t('[data-act="s-reload"]')) return runSearch(true);
});
function repaintFilters(refetch = false) {
  const f = document.querySelector(".s-filters");
  if (f) f.innerHTML = chipRow("対象", S_TARGETS, sTarget, "data-starget") + chipRow("種類", S_TYPES, sType, "data-stype");
  if (refetch) return runSearch();
  const mode = sMode();
  if (mode !== "kw" && !S[mode].started) return runSearch();
  if (mode === "rec" && !S.rec.busy && !S.rec.done && shown(S.rec.list).length < 12) return loadRec(false, true); // 絞り込みで少なければ続きを読む
  paintSearch();
}
