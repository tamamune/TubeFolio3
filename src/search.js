/* ===== 検索ページ: YouTubeの動画を検索する(結果をクリックすると、その場で再生) ===== */
let sq = "", sres = [], stoken = "", sctx = null, sbusy = false, serr = "", sdone = false;

const SEARCH_ICO = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>`;

// 検索結果から動画と「続き」のトークンを集める
function collectSearch(root) {
  const out = [], seen = new Set(); let token = "";
  const add = (o) => { if (o.id && !seen.has(o.id)) { seen.add(o.id); out.push(o); } };
  (function walk(n) {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(walk);
    const r = n.videoRenderer;
    if (r?.videoId) {
      add({ id: r.videoId, title: txt(r.title), channel: txt(r.ownerText) || txt(r.longBylineText), duration: txt(r.lengthText), pub: txt(r.publishedTimeText), views: txt(r.viewCountText) });
      return;
    }
    const lv = n.lockupViewModel;
    if (lv && /VIDEO/.test(lv.contentType || "") && lv.contentId) {
      const rows = lv.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows || [];
      const parts = (i) => (rows[i]?.metadataParts || []).map((x) => x.text?.content || "").filter(Boolean);
      let dur = ""; (function w(x) { if (dur || !x || typeof x !== "object") return; if (x.thumbnailBadgeViewModel?.text) { dur = x.thumbnailBadgeViewModel.text; return; } Object.values(x).forEach(w); })(lv.contentImage);
      add({ id: lv.contentId, title: lv.metadata?.lockupMetadataViewModel?.title?.content || lv.contentId, channel: parts(0).join(" "), duration: dur, pub: parts(1)[1] || "", views: parts(1)[0] || "" });
      return;
    }
    const tk = n.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
    if (tk) token = tk;
    Object.values(n).forEach(walk);
  })(root);
  return { list: out, token };
}

async function searchFirst(q) {
  const url = "https://www.youtube.com/results?search_query=" + encodeURIComponent(q) + "&sp=" + encodeURIComponent("EgIQAQ==") + "&hl=ja";
  const html = await (await fetch(url, { credentials: "include" })).text();
  const a = html.indexOf("ytInitialData = "), b = html.indexOf(";</script>", a);
  if (a < 0 || b < 0) throw new Error("data");
  sctx = jsonAfter(html, '"INNERTUBE_CONTEXT":');
  sctx = sctx ? { context: sctx, version: (html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/) || [])[1] || sctx.client?.clientVersion || "" } : null;
  return collectSearch(JSON.parse(html.slice(a + 16, b)));
}
async function searchMore() {
  const headers = { "Content-Type": "application/json", "X-Youtube-Client-Name": "1", "X-Youtube-Client-Version": sctx.version, "X-Origin": "https://www.youtube.com" };
  const auth = await authHeader(); if (auth) { headers.Authorization = auth; headers["X-Goog-AuthUser"] = "0"; }
  const r = await fetch("https://www.youtube.com/youtubei/v1/search?prettyPrint=false", { method: "POST", credentials: "include", headers, body: JSON.stringify({ context: sctx.context, continuation: stoken }) });
  if (!r.ok) throw new Error("http " + r.status);
  return collectSearch(await r.json());
}

async function doSearch(q, more) {
  if (sbusy) return;
  q = q.trim(); if (!q && !more) return;
  sbusy = true; serr = "";
  if (!more) { sq = q; sres = []; stoken = ""; sdone = false; }
  paintSearch();
  try {
    const page = more ? await searchMore() : await searchFirst(q);
    const have = new Set(sres.map((x) => x.id)), fresh = page.list.filter((x) => !have.has(x.id));
    sres.push(...fresh);
    stoken = fresh.length ? page.token : "";
    sdone = !stoken;
  } catch (e) { serr = "検索できませんでした。YouTubeに接続できるか、ネットワークを確認してください。"; }
  sbusy = false;
  if (tab === "search") paintSearch();
}

function sCard(v) {
  vmap.set(v.id, v);
  return `<button class="c ${subCls(v)}" data-v="${esc(v.id)}"><div class="th"><img loading="lazy" src="${thumb(v.id)}" alt="">${v.duration ? `<span class="dur">${esc(v.duration)}</span>` : ""}${bmBtn(v.id)}</div><b>${esc(v.title)}</b>${cn(v)}</button>`;
}

function paintSearch() { // 結果の部分だけ描き直す(入力欄は触らない)
  const box = $("s-out"); if (!box) return;
  let h = "";
  if (serr) h += `<div class="empty" style="margin:20px 32px">${esc(serr)}</div>`;
  else if (!sq) h += `<div class="empty">キーワードを入力して、YouTubeの動画を検索できます。</div>`;
  else if (!sres.length && !sbusy) h += `<div class="empty">「${esc(sq)}」に一致する動画は見つかりませんでした。</div>`;
  if (sres.length) h += `<div class="s-head">「${esc(sq)}」の検索結果</div>${vbar()}${vgrid(sres.map(sCard).join(""))}`;
  if (sbusy) h += `<div class="s-load">検索中…</div>`;
  else if (sres.length && !sdone) h += `<div class="s-more"><button class="btn s" data-act="searchmore">もっと見る</button></div>`;
  box.innerHTML = h;
}

function searchView() {
  setTimeout(() => { paintSearch(); const i = $("s-q"); if (i && !sq) i.focus(); }, 0);
  return `<form class="s-form" id="s-form" role="search">${SEARCH_ICO}<input id="s-q" type="search" placeholder="YouTubeの動画を検索" value="${esc(sq)}" autocomplete="off"><button class="btn p" type="submit">検索</button></form><div id="s-out"></div>`;
}

document.addEventListener("submit", (e) => { if (e.target.id === "s-form") { e.preventDefault(); doSearch($("s-q").value); } });
document.addEventListener("click", (e) => { if (e.target.closest('[data-act="searchmore"]')) doSearch("", true); });
