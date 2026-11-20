importScripts("ytapi.js"); // YouTube への書き込み(YTA)。YouTube のページの拡張機能から、メッセージで呼び出される
// 初回インストール時に空のデータを用意する(既存データは上書きしない)
chrome.runtime.onInstalled.addListener(async () => {
  const cur = await chrome.storage.local.get("tubefolio");
  if (cur.tubefolio) return;
  await chrome.storage.local.set({ tubefolio: { folders: [], videos: {}, bookmarks: [], samplesRemoved: true } });
});

// YouTube埋め込みの「エラー153」対策:
// 拡張機能のページ(chrome-extension://)から埋め込むとHTTP Refererが付かず再生が拒否されるため、
// この拡張機能自身が開く youtube.com/embed/ へのリクエストにだけ Referer を付ける。
// (他のサイト上の埋め込みには影響しない)
const EMBED_REFERER = "https://github.com/tamamune/TubeFolio3";
async function setupEmbedReferer() {
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [1],
    addRules: [{
      id: 1, priority: 1,
      action: { type: "modifyHeaders", requestHeaders: [{ header: "Referer", operation: "set", value: EMBED_REFERER }] },
      condition: {
        urlFilter: "||youtube.com/embed/",
        resourceTypes: ["sub_frame"],
        initiatorDomains: [chrome.runtime.id],
      },
    }],
  });
}
chrome.runtime.onInstalled.addListener(setupEmbedReferer);
chrome.runtime.onStartup.addListener(setupEmbedReferer);

// おすすめのカテゴリ(音楽・ニュースなど)の切り替え:
// YouTubeの内部API(youtubei)へのリクエストを、youtube.com のページから送ったものと同じ扱いにするため
// この拡張機能自身が送るリクエストにだけ Origin / Referer を付ける。
async function setupInnertubeOrigin() {
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [2],
      addRules: [{
        id: 2, priority: 1,
        action: { type: "modifyHeaders", requestHeaders: [
          { header: "Origin", operation: "set", value: "https://www.youtube.com" },
          { header: "Referer", operation: "set", value: "https://www.youtube.com/" },
        ] },
        condition: {
          urlFilter: "||www.youtube.com/youtubei/",
          resourceTypes: ["xmlhttprequest"],
          initiatorDomains: [chrome.runtime.id],
        },
      }],
    });
  } catch (e) { console.warn("TubeFolio3: youtubei header rule failed", e); }
}
chrome.runtime.onInstalled.addListener(setupInnertubeOrigin);
chrome.runtime.onStartup.addListener(setupInnertubeOrigin);

// ブラウザのツールバーのアイコン: 拡張機能を再読み込みして、TubeFolio3 を開く(すでに開いていれば、そのページを再読み込みする)
// 再読み込みするとこの処理も止まるので、開き直す内容を先に保存しておき、再起動後に実行する
const MANAGER_URL = chrome.runtime.getURL("manager.html");
chrome.action.onClicked.addListener(async () => {
  const tabs = await chrome.tabs.query({ url: MANAGER_URL + "*" }).catch(() => []);
  await chrome.storage.local.set({ "tf-reopen": { tabs: tabs.map((t) => t.id), at: Date.now() } });
  chrome.runtime.reload();
});
(async function resumeAfterReload() { // 再読み込みの直後に、保存しておいた内容を実行する
  const got = (await chrome.storage.local.get("tf-reopen"))["tf-reopen"];
  if (!got) return;
  await chrome.storage.local.remove("tf-reopen");
  if (Date.now() - got.at > 30000) return; // 古い指示は無視する
  let first = null;
  for (const id of got.tabs || []) {
    try { await chrome.tabs.get(id); await chrome.tabs.reload(id); first ??= id; } catch {}
  }
  if (first != null) {
    const t = await chrome.tabs.update(first, { active: true }).catch(() => null);
    if (t) chrome.windows.update(t.windowId, { focused: true }).catch(() => {});
  } else chrome.tabs.create({ url: MANAGER_URL }); // 開いていなかった(または再読み込みで閉じられた)ときは、新しく開く
})();

// ヘッダーのボタンから管理ページを開く / YouTube のページから、再生リスト・チャンネル登録の操作を受け付ける
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg === "tf-open-manager") { chrome.tabs.create({ url: chrome.runtime.getURL("manager.html") }); return; }
  // SponsorBlock: 動画IDのハッシュの先頭4文字で問い合わせ、返ってきた候補から、その動画の区間だけを返す
  if (msg?.tf === "sb") {
    if (!/^[0-9a-f]{4}$/.test(msg.prefix || "") || !/^[\w-]{11}$/.test(msg.vid || "")) { reply({ ok: false, error: "動画IDが正しくありません" }); return; }
    const q = new URLSearchParams({ categories: JSON.stringify(msg.cats || ["sponsor"]), actionTypes: JSON.stringify(["skip", "mute", "full", "poi"]) });
    fetch(`https://sponsor.ajay.app/api/skipSegments/${msg.prefix}?${q}`)
      .then((r) => (r.status === 404 ? [] : r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
      .then((list) => reply({ ok: true, r: (Array.isArray(list) ? list : []).find((x) => x.videoID === msg.vid)?.segments || [] }), (e) => reply({ ok: false, error: e?.message || String(e) }));
    return true;
  }
  if (msg?.tf === "yta" && typeof YTA?.[msg.op] === "function") {
    YTA[msg.op](...(msg.args || [])).then((r) => reply({ ok: true, r }), (e) => reply({ ok: false, error: e?.message || String(e) }));
    return true; // 非同期で返事をする
  }
});

/* ===== 新着動画のお知らせ(PC の通知) =====
   15分ごとに YouTube の「登録チャンネルの新着」を読み、まだ知らせていない動画のうち
   ・フォルダ設定で 🔔 にしたチャンネルの動画
   ・タイトルに LIVE・ライブ・生配信・緊急・速報 などがある動画、または配信中の動画(チャンネルの設定に関係なく、いつも)
   を通知する。設定「一般」の「新着のお知らせ」(tf-notify: on/off。既定 on)で全体を止められる。
   知らせた動画は tf-nv-seen(このパソコンだけ)に覚える。初めて読んだときは、今ある動画を覚えるだけで通知しない */
// いつも知らせるタイトルの文字(設定「一般」で追加・削除できる。tf-nv-words。ドライブ同期の対象)
const NV_WORDS = ["LIVE", "ライブ", "生配信", "生放送", "配信中", "緊急", "速報", "重大発表", "ゲリラ"];
// 英字だけの語は、単語として探す(「deliver」を LIVE と見なさない)。ほかは、含まれていればよい
const nvHit = (title, words) => { const t = String(title || "").normalize("NFKC").toLowerCase(); return words.some((w) => { const k = String(w).normalize("NFKC").toLowerCase().trim(); if (!k) return false; if (!/^[a-z0-9 ]+$/.test(k)) return t.includes(k); let i = t.indexOf(k); while (i >= 0) { const a = t[i - 1] || " ", b = t[i + k.length] || " "; if (!/[a-z0-9]/.test(a) && !/[a-z0-9]/.test(b)) return true; i = t.indexOf(k, i + 1); } return false; }); };
function nvCollect(root) {
  const out = [], seen = new Set();
  const txt = (o) => o?.simpleText || o?.runs?.map((r) => r.text).join("") || o?.content || "";
  const ucOf = (o) => { let u = ""; (function w(x) { if (u || !x || typeof x !== "object") return; const id = x.browseEndpoint?.browseId; if (id?.startsWith("UC")) { u = id; return; } Object.values(x).forEach(w); })(o); return u; };
  (function walk(n) {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(walk);
    const r = n.videoRenderer || n.gridVideoRenderer;
    if (r?.videoId && !seen.has(r.videoId)) {
      seen.add(r.videoId);
      const live = /BADGE_STYLE_TYPE_LIVE_NOW|"LIVE"|ライブ/.test(JSON.stringify([r.badges, r.thumbnailOverlays]));
      out.push({ id: r.videoId, title: txt(r.title), ch: txt(r.ownerText) || txt(r.shortBylineText), uc: ucOf(r.ownerText || r.shortBylineText), live });
      return;
    }
    const lv = n.lockupViewModel;
    if (lv && /VIDEO/.test(lv.contentType || "") && lv.contentId && !seen.has(lv.contentId)) {
      seen.add(lv.contentId);
      const m = lv.metadata?.lockupMetadataViewModel, rows = m?.metadata?.contentMetadataViewModel?.metadataRows || [];
      const live = /BADGE_STYLE_LIVE|THUMBNAIL_OVERLAY_BADGE_STYLE_LIVE/.test(JSON.stringify(lv.contentImage || {}));
      out.push({ id: lv.contentId, title: m?.title?.content || "", ch: rows[0]?.metadataParts?.[0]?.text?.content || "", uc: ucOf(lv.metadata), live });
      return;
    }
    Object.values(n).forEach(walk);
  })(root);
  return out;
}
async function nvCheck() {
  const st = await chrome.storage.local.get(["tf-notify", "tf-nv-seen", "tubefolio", "tf-nv-words"]);
  const words = Array.isArray(st["tf-nv-words"]) ? st["tf-nv-words"] : NV_WORDS;
  if (st["tf-notify"] === "off") return;
  let html;
  try { const r = await fetch("https://www.youtube.com/feed/subscriptions?hl=ja", { credentials: "include" }); if (!r.ok) return; html = await r.text(); } catch { return; }
  const a = html.indexOf("ytInitialData = "), b = html.indexOf(";</script>", a); if (a < 0 || b < 0) return;
  let list; try { list = nvCollect(JSON.parse(html.slice(a + 16, b))).slice(0, 80); } catch { return; }
  if (!list.length) return;
  const first = !Array.isArray(st["tf-nv-seen"]), seen = new Set(st["tf-nv-seen"] || []);
  const chs = st.tubefolio?.channels || {};
  const byName = new Map(Object.values(chs).map((c) => [String(c.name || "").normalize("NFKC").toLowerCase().trim(), c]));
  let n = 0;
  for (const v of list) {
    if (seen.has(v.id)) continue; seen.add(v.id);
    if (first) continue;
    const c = chs[v.uc] || byName.get(String(v.ch).normalize("NFKC").toLowerCase().trim());
    const urgent = v.live || nvHit(v.title, words);
    if (!(urgent || c?.notify) || n >= 5) continue; // 一度に出すのは5件まで
    n++;
    chrome.notifications.create("tfnv:" + v.id, { type: "basic", iconUrl: "icons/icon-128.png", title: `${urgent ? "🔴 " : "🔔 "}${v.ch || "新着動画"}`, message: v.title || "新しい動画", contextMessage: urgent ? "TubeFolio3 ・ LIVE・緊急の新着" : "TubeFolio3 ・ 新着動画", priority: urgent ? 2 : 0 });
  }
  await chrome.storage.local.set({ "tf-nv-seen": [...seen].slice(-600) });
}
chrome.notifications?.onClicked.addListener((nid) => {
  if (!nid.startsWith("tfnv:")) return;
  chrome.tabs.create({ url: "https://www.youtube.com/watch?v=" + encodeURIComponent(nid.slice(5)) });
  chrome.notifications.clear(nid);
});
const nvSetup = () => chrome.alarms?.create("tf-nv", { periodInMinutes: 15, delayInMinutes: 1 });
chrome.runtime.onInstalled.addListener(nvSetup);
chrome.runtime.onStartup.addListener(nvSetup);
chrome.alarms?.onAlarm.addListener((a) => { if (a.name === "tf-nv") nvCheck(); });
chrome.alarms?.get("tf-nv").then((a) => { if (!a) nvSetup(); }).catch(() => {});

/* ===== 急上昇動画(日本・日付ごと・最大約200本): youtube-trending.info の日別ページを読んで取り出す =====
   https://youtube-trending.info/video_list?date=YYYY-MM-DD&contry_code=JP(送るのは日付と国コードだけ)
   過去の日付は変わらないので chrome.storage に覚える(tf-trdc-日付。取り直せるので同期しない)。今日の分は30分だけメモリに覚える */
const trdMem = new Map();
const trdDecode = (t) => String(t || "").replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos);/gi, (m, e) => {
  e = e.toLowerCase(); if (e === "amp") return "&"; if (e === "lt") return "<"; if (e === "gt") return ">"; if (e === "quot") return '"'; if (e === "apos") return "'";
  const n = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(n); } catch { return ""; }
});
function trdParse(html) {
  const out = [];
  html.split('<div class="card ').slice(1).forEach((b) => {
    const h = b.match(/class="card-header">#(\d+)\s*\(([^)]*)\)/), id = (b.match(/data-video-id="([\w-]{11})"/) || [])[1];
    if (!h || !id) return;
    const num = (re) => { const m = b.match(re); return m ? trdDecode(m[1]).trim() : ""; };
    const ch = b.match(/channel_id=([\w-]+)">([^<]*)<\/a>/);
    out.push({ rank: +h[1], chg: h[2], id, title: trdDecode((b.match(/data-title="([^"]*)"/) || [])[1] || ""),
      views: num(/fa-eye"><\/i>\s*([^<]*?)\s*<\/span>/), len: num(/fa-clock"><\/i>\s*([\d:]+)/), pub: num(/Published_at:(\d{4}-\d\d-\d\d)/), cat: num(/Category:([^<]*)</),
      chId: ch ? ch[1] : "", ch: ch ? trdDecode(ch[2]).trim() : "" });
  });
  return out;
}
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
async function trendDay(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("日付の形が正しくありません");
  const today = ymd(new Date());
  const mem = trdMem.get(date); if (mem && Date.now() - mem.at < 30 * 60000) return mem.v;
  const key = "tf-trdc-" + date;
  if (date < today) { const c = (await chrome.storage.local.get(key))[key]; if (c?.length) { trdMem.set(date, { at: Date.now(), v: c }); return c; } }
  const r = await fetch("https://youtube-trending.info/video_list?date=" + date + "&contry_code=JP");
  if (!r.ok) throw new Error("youtube-trending.info から取得できませんでした(" + r.status + ")");
  const v = trdParse(await r.text());
  if (!v.length) throw new Error("この日の急上昇のデータが見つかりません");
  trdMem.set(date, { at: Date.now(), v });
  if (date < today) { // 古い日の控えは60日分まで
    chrome.storage.local.set({ [key]: v }).catch(() => {});
    chrome.storage.local.get(null).then((all) => { const ks = Object.keys(all).filter((k) => k.startsWith("tf-trdc-")).sort(); if (ks.length > 60) chrome.storage.local.remove(ks.slice(0, ks.length - 60)); }).catch(() => {});
  }
  return v;
}

/* ===== Google トレンドの急上昇ワード(日本)。ページに埋め込まれたデータ(ds:0)から。30分は覚えておく(同期しない) ===== */
const gtMem = new Map();
const gtText = (s) => String(s || "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&amp;/g, "&").trim();
async function gTrends(hours) {
  hours = [4, 24, 48, 168].includes(+hours) ? +hours : 24;
  const mem = gtMem.get(hours); if (mem && Date.now() - mem.at < 30 * 60000) return mem;
  const res = await fetch("https://trends.google.co.jp/trending?geo=JP&hours=" + hours + "&hl=ja", { credentials: "omit" });
  if (!res.ok) throw new Error("Google トレンドを取得できませんでした(" + res.status + ")");
  const html = await res.text();
  let items = [];
  try {
    const m = html.match(/AF_initDataCallback\(\{key: 'ds:0', hash: '[0-9]+', data:/);
    if (m) {
      const rest = html.slice(m.index + m[0].length), d = JSON.parse(rest.slice(0, rest.indexOf(", sideChannel")));
      items = (d[1] || []).filter((x) => Array.isArray(x) && x[0]).slice(0, 50).map((x) => ({ w: String(x[0]), vol: +x[6] || 0, pct: +x[8] || 0, start: x[3]?.[0] || 0, rel: (x[9] || []).filter((y) => y && y !== x[0]).slice(0, 8) }));
    }
  } catch {}
  if (!items.length) { // 表から読む(予備)
    const cls = (b, c) => { const mm = b.match(new RegExp('class="' + c + '"[^>]*>([^<]*)<')); return mm ? gtText(mm[1]) : ""; };
    items = (html.match(/<tr[^>]*data-row-id[^]*?<\/tr>/g) || []).map((row) => ({ w: cls(row, "mZ3RIc"), vol: 0, pct: 0, start: 0, rel: [...new Set([...row.matchAll(/data-term="([^"]+)"/g)].map((mm) => gtText(mm[1])))].slice(0, 8) })).filter((x) => x.w);
  }
  if (!items.length) throw new Error("急上昇ワードを読み取れませんでした(Google トレンドのページの作りが変わった可能性があります)");
  const r = { at: Date.now(), hours, items }; gtMem.set(hours, r); return r;
}
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.tf === "trend") { trendDay(msg.date).then((v) => reply({ ok: true, v }), (e) => reply({ ok: false, error: e?.message || String(e) })); return true; }
  if (msg?.tf === "gtrends") { gTrends(msg.hours).then((r) => reply({ ok: true, r }), (e) => reply({ ok: false, error: e?.message || String(e) })); return true; }
});

/* ===== 急上昇ワードのニュース(マウスを乗せたとき): Bing ニュースの RSS から3件(画像つき)。取れなければ Google ニュースの RSS。30分覚えておく ===== */
const gnMem = new Map();
const gnTag = (s, t) => { const m = s.match(new RegExp("<" + t + "(?: [^>]*)?>([^]*?)</" + t + ">")); return m ? gtText(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")) : ""; };
async function newsBing(q) {
  const r = await fetch("https://www.bing.com/news/search?q=" + encodeURIComponent(q) + "&format=rss&setlang=ja&cc=JP", { credentials: "omit" });
  if (!r.ok) throw new Error("bing " + r.status);
  const all = (await r.text()).split("<item>").slice(1, 11).map((raw) => {
    const b = raw.split("</item>")[0]; let url = gnTag(b, "link");
    try { const u = new URL(url).searchParams.get("url"); if (u) url = u; } catch {} // Bing の中継ではなく、記事のアドレスへ
    const img = gnTag(b, "News:Image").replace(/^http:/, "https:");
    return { title: gnTag(b, "title"), url, source: gnTag(b, "News:Source"), date: gnTag(b, "pubDate"), img: img ? img + "&w=120&h=120&c=14" : "" };
  }).filter((n) => n.title && /^https?:\/\//.test(n.url));
  return [...all.filter((n) => n.img), ...all.filter((n) => !n.img)].slice(0, 3);
}
async function newsGoogle(q) {
  const r = await fetch("https://news.google.com/rss/search?q=" + encodeURIComponent(q) + "&hl=ja&gl=JP&ceid=JP:ja", { credentials: "omit" });
  if (!r.ok) throw new Error("google " + r.status);
  return (await r.text()).split("<item>").slice(1, 4).map((raw) => {
    const b = raw.split("</item>")[0]; let title = gnTag(b, "title"); const source = gnTag(b, "source");
    if (source && title.endsWith(" - " + source)) title = title.slice(0, -(source.length + 3));
    return { title, url: gnTag(b, "link"), source, date: gnTag(b, "pubDate"), img: "" };
  }).filter((n) => n.title && /^https?:\/\//.test(n.url));
}
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.tf !== "gnews" || !msg.q) return;
  (async () => {
    const hit = gnMem.get(msg.q); if (hit && Date.now() - hit.at < 30 * 60000) return reply({ ok: true, news: hit.news });
    let news = [];
    try { news = await newsBing(msg.q); } catch {}
    if (!news.length) { try { news = await newsGoogle(msg.q); } catch {} }
    gnMem.set(msg.q, { at: Date.now(), news }); if (gnMem.size > 200) gnMem.delete(gnMem.keys().next().value);
    reply({ ok: true, news });
  })();
  return true;
});
