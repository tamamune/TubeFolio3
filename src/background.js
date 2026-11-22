importScripts("ytapi.js", "log.js"); // YouTube への書き込み(YTA)。YouTube のページの拡張機能から、メッセージで呼び出される
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

// モバイル版のブラウザ(Android の Vivaldi など)対策:
// スマホの User-Agent だと、www.youtube.com へのリクエストが m.youtube.com(スマホ版)に転送され、
// 管理ページのホーム・検索などが読み込めなかった(m.youtube.com は形式が違い、権限もない)。
// モバイルのときだけ、この拡張機能自身が出す youtube.com へのリクエストを、PC 版として送る(YouTube のタブには影響しない)
const isMobile = () => !!navigator.userAgentData?.mobile || /Android|Mobile|iPhone|iPad/i.test(navigator.userAgent);
async function setupDesktopUa() {
  if (!isMobile()) { await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [3] }); return; }
  const ver = (navigator.userAgent.match(/Chrome\/(\d+)/) || [])[1] || "140";
  const ua = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${ver}.0.0.0 Safari/537.36`;
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [3],
    addRules: [{
      id: 3, priority: 1,
      action: { type: "modifyHeaders", requestHeaders: [
        { header: "User-Agent", operation: "set", value: ua },
        { header: "Sec-CH-UA-Mobile", operation: "set", value: "?0" },
        { header: "Sec-CH-UA-Platform", operation: "set", value: '"Windows"' },
      ] },
      condition: { requestDomains: ["youtube.com"], initiatorDomains: [chrome.runtime.id], resourceTypes: ["xmlhttprequest", "other"] },
    }],
  });
  tfLog?.("info", "モバイル", "モバイルのブラウザなので、この拡張機能から YouTube への読み込みを PC 版として送ります");
}
chrome.runtime.onInstalled.addListener(setupDesktopUa);
chrome.runtime.onStartup.addListener(setupDesktopUa);
setupDesktopUa().catch((e) => tfLog?.("error", "モバイル", `PC 版として読む設定に失敗: ${e?.message || e}`));

// (ルールの番号: 1=埋め込みの Referer / 2=youtubei の Origin / 3=モバイルのとき PC 版として送る。番号が重なると、後から入れたルールが前のルールを消してしまう)
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
  if (msg === "tf-open-music") { chrome.tabs.create({ url: chrome.runtime.getURL("manager.html") + "#music" }); return; }
  if (msg?.tf === "open-search") { // タグを押したとき: すでに開いている TubeFolio3 のタブで検索する(なければ新しく開く)。タブが増えないように
    (async () => {
      const url = chrome.runtime.getURL("manager.html"), hash = "#search=" + encodeURIComponent(String(msg.q || "").slice(0, 200));
      const tabs = await chrome.tabs.query({ url: url + "*" }).catch(() => []);
      const t = tabs.find((x) => x.active) || tabs[0];
      if (!t) return void chrome.tabs.create({ url: url + hash });
      await chrome.tabs.update(t.id, { url: url + hash, active: true }).catch(() => {}); // 同じページの中身(#以降)だけが変わる。ページは読み込み直さない
      chrome.windows.update(t.windowId, { focused: true }).catch(() => {});
    })();
    return;
  }
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

/* ===== 新着動画のお知らせ(TubeFolio2 と同じ知らせ方) =====
   15分ごとに YouTube の「登録チャンネルの新着」を、ログイン中のアカウントとして読み(YTA.subsFeed。だめならページのHTML)、
   まだ知らせていない動画のうち
   ・フォルダ設定で 🔔 にしたチャンネルの動画
   ・タイトルに LIVE・ライブ・生配信・緊急・速報 などがある動画、または配信中の動画(チャンネルの設定に関係なく、いつも)
   を知らせる。知らせ方は TubeFolio2 と同じで、
   ・開いている YouTube のタブの右下に、サムネ+タイトルのお知らせ(content.js の nvToast)
   ・PC の通知(アイコンは動画のサムネ。4件以上はまとめて1つ)
   の両方。設定「一般」の「新着のお知らせ」(tf-notify: on/off。既定 on)で全体を止められる。
   知らせた動画は tf-nv-seen(このパソコンだけ)に覚える。配信は「L:動画ID」でも覚え、あとから配信が始まった動画も1回知らせる。
   初めて読んだときは、今ある動画を覚えるだけで通知しない。確認の結果はログ(設定の「ログ」)に残す */
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
      const upcoming = !!r.upcomingEventData;
      out.push({ id: r.videoId, title: txt(r.title), ch: txt(r.ownerText) || txt(r.shortBylineText), uc: ucOf(r.ownerText || r.shortBylineText), live, upcoming });
      return;
    }
    const lv = n.lockupViewModel;
    if (lv && /VIDEO/.test(lv.contentType || "") && lv.contentId && !seen.has(lv.contentId)) {
      seen.add(lv.contentId);
      const m = lv.metadata?.lockupMetadataViewModel, rows = m?.metadata?.contentMetadataViewModel?.metadataRows || [];
      const img = JSON.stringify(lv.contentImage || {});
      const live = /BADGE_STYLE_LIVE|THUMBNAIL_OVERLAY_BADGE_STYLE_LIVE/.test(img);
      const upcoming = /UPCOMING|予定/.test(img + JSON.stringify(rows));
      out.push({ id: lv.contentId, title: m?.title?.content || "", ch: rows[0]?.metadataParts?.[0]?.text?.content || "", uc: ucOf(lv.metadata), live, upcoming });
      return;
    }
    Object.values(n).forEach(walk);
  })(root);
  return out;
}
// 登録チャンネルの新着を読む。まずログイン中のアカウントとして API で、だめならページのHTMLから
async function nvFeed() {
  try { const list = nvCollect(await YTA.subsFeed()); if (list.length) return list; tfLog("warn", "新着", "登録チャンネルの新着(API)が空でした。ページから読み直します"); }
  catch (e) { tfLog("warn", "新着", `登録チャンネルの新着(API)を読めませんでした: ${e?.message || e}。ページから読み直します`); }
  const r = await fetch("https://www.youtube.com/feed/subscriptions?hl=ja", { credentials: "include" });
  if (!r.ok) throw new Error(`YouTube が ${r.status} を返しました`);
  const html = await r.text(), a = html.indexOf("ytInitialData = "), b = html.indexOf(";</script>", a);
  if (a < 0 || b < 0) throw new Error("ページの形式が読めませんでした(YouTube にログインしていない可能性があります)");
  return nvCollect(JSON.parse(html.slice(a + 16, b)));
}
let nvBusy = false;
async function nvCheck(manual = false) {
  if (nvBusy) return { ok: false, error: "確認中です" };
  nvBusy = true;
  try {
    const st = await chrome.storage.local.get(["tf-notify", "tf-nv-seen", "tubefolio", "tf-nv-words"]);
    const words = Array.isArray(st["tf-nv-words"]) ? st["tf-nv-words"] : NV_WORDS;
    if (st["tf-notify"] === "off" && !manual) return { ok: true, off: true };
    let list;
    try { list = (await nvFeed()).slice(0, 80); }
    catch (e) { tfLog("error", "新着", `登録チャンネルの新着を確認できませんでした: ${e?.message || e}`); return { ok: false, error: e?.message || String(e) }; }
    if (!list.length) { tfLog("warn", "新着", "登録チャンネルの新着が0本でした(YouTube にログインしているか確かめてください)"); return { ok: false, error: "新着が0本でした" }; }
    const first = !Array.isArray(st["tf-nv-seen"]), seen = new Set(st["tf-nv-seen"] || []);
    const chs = st.tubefolio?.channels || {};
    const byName = new Map(Object.values(chs).map((c) => [String(c.name || "").normalize("NFKC").toLowerCase().trim(), c]));
    const out = [];
    for (const v of list) {
      const c = chs[v.uc] || byName.get(String(v.ch).normalize("NFKC").toLowerCase().trim());
      // 配信中: 前は配信前・通常で知らせなかった動画でも、配信が始まったら1回知らせる(TubeFolio2 と同じ)
      if (v.live && !seen.has("L:" + v.id)) { seen.add("L:" + v.id); seen.add(v.id); if (!first) out.push({ ...v, kind: "live", bell: !!c?.notify }); continue; }
      if (seen.has(v.id)) continue; seen.add(v.id);
      if (first || v.upcoming) continue;
      const kw = nvHit(v.title, words);
      if (kw) seen.add("L:" + v.id); // タイトルのキーワードで知らせた動画は、あとで配信中の印が付いても、もう一度は知らせない(⚡ と 🔴 の二重通知になっていた)
      if (kw || c?.notify) out.push({ ...v, kind: kw ? "kw" : "new", bell: !!c?.notify });
    }
    await chrome.storage.local.set({ "tf-nv-seen": [...seen].slice(-1500), "tf-nv-last": Date.now() });
    tfLog("info", "新着", `${manual ? "手動" : "定期"}の確認: 新着 ${list.length}本${first ? "(初めてなので、今ある動画を覚えただけ)" : ""} → お知らせ ${out.length}本`);
    if (out.length && st["tf-notify"] !== "off") await nvDeliver(out);
    return { ok: true, count: list.length, notified: out.length, first };
  } finally { nvBusy = false; }
}
// PC の通知のアイコンを、動画のサムネにする(通知は外の画像URLを使えないので、取ってきて data URL にする。真ん中を正方形に切り抜く)
async function nvThumb(v) {
  try {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 4000);
    const r = await fetch(`https://i.ytimg.com/vi/${encodeURIComponent(v)}/mqdefault.jpg`, { credentials: "omit", signal: ctl.signal }).finally(() => clearTimeout(t));
    if (!r.ok) return null;
    const bmp = await createImageBitmap(await r.blob()), s = Math.min(bmp.width, bmp.height);
    const cv = new OffscreenCanvas(192, 192); cv.getContext("2d").drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, 192, 192);
    const buf = new Uint8Array(await (await cv.convertToBlob({ type: "image/jpeg", quality: 0.85 })).arrayBuffer());
    let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return "data:image/jpeg;base64," + btoa(bin);
  } catch { return null; }
}
const NV_KIND = { live: "🔴 配信中", kw: "⚡", new: "🔔", test: "🔔" };
const nvIcon = () => chrome.runtime.getURL("icons/icon-128.png"); // service worker は src/ にあるので、相対パスでは見つからない(通知が出なかった原因)
const nvCreate = (id, opt) => new Promise((res) => {
  try { chrome.notifications.create(id, opt, () => { const e = chrome.runtime.lastError; if (e) tfLog("error", "新着", `PC の通知を出せませんでした: ${e.message}`); res(!e); }); }
  catch (e) { tfLog("error", "新着", `PC の通知を出せませんでした: ${e?.message || e}`); res(false); }
});
const nvUrl = new Map(); // 通知ID → 押したときに開くURL
async function nvDeliver(items, why = "") {
  // 通知の履歴(TubeFolio3 のサイドバーのベルで見られる。新しい順に100件まで。このパソコンだけ・同期しない)
  try {
    const now = Date.now(), add = items.map((x) => ({ id: x.id || "", title: x.title || "", ch: x.ch || "", kind: x.kind || "new", url: x.url || "", t: now }));
    if (add.length) { const h = (await chrome.storage.local.get("tf-nv-hist"))["tf-nv-hist"]; await chrome.storage.local.set({ "tf-nv-hist": [...add, ...(Array.isArray(h) ? h : [])].slice(0, 100) }); }
  } catch {}
  tfLog("info", "新着", `${why ? why + ": " : ""}${items.length}本を知らせます ` + items.slice(0, 5).map((x) => `${NV_KIND[x.kind] || ""}${x.ch}「${x.title}」`).join("、"));
  // YouTube のタブの右下(サムネ+タイトル)。開いているタブのうち、いちばん最近使ったものに出す
  const tabs = (await chrome.tabs.query({ url: "https://www.youtube.com/*" })).sort((a, b) => (b.active - a.active) || (b.lastAccessed || 0) - (a.lastAccessed || 0));
  for (const t of tabs) { try { const r = await chrome.tabs.sendMessage(t.id, { tf: "nv-toast", items }); if (r?.ok) break; } catch { /* 拡張機能を入れ直す前に開いたタブなど */ } }
  // TubeFolio3 の管理ページが開いていれば、そちらの右下にも出す(拡張機能のページ全部に送る。開いていなければ、エラーになるので無視する)
  try { await chrome.runtime.sendMessage({ tf: "nv-toast", items }); } catch { /* 管理ページが開いていない */ }
  if ((await chrome.storage.local.get("tf-notify-os"))["tf-notify-os"] === "off") return; // 設定「PC の通知」を使わないとき
  // PC の通知(YouTube を見ていないときにも気づけるように、いつも出す)
  const urgent = items.filter((x) => x.kind !== "new"), rest = items.filter((x) => x.kind === "new");
  const single = async (it) => {
    const id = "tfnv:" + it.id + ":" + Date.now().toString(36);
    nvUrl.set(id, it.url || "https://www.youtube.com/watch?v=" + encodeURIComponent(it.id));
    await nvCreate(id, { type: "basic", iconUrl: (it.id && (await nvThumb(it.id))) || nvIcon(), title: `${NV_KIND[it.kind] || "🔔"} ${it.ch || "新着動画"}`, message: it.title || "新しい動画", contextMessage: "TubeFolio3", priority: it.kind === "new" ? 1 : 2, requireInteraction: it.kind === "live" });
  };
  for (const it of urgent) await single(it);
  if (rest.length <= 3) { for (const it of rest) await single(it); }
  else {
    const id = "tfnv:many:" + Date.now().toString(36); nvUrl.set(id, "https://www.youtube.com/feed/subscriptions");
    await nvCreate(id, { type: "list", iconUrl: nvIcon(), title: `🔔 新着 ${rest.length}本`, message: "", items: rest.slice(0, 5).map((x) => ({ title: x.ch || "", message: x.title || "" })), contextMessage: "TubeFolio3", priority: 1 });
  }
}
chrome.notifications?.onClicked.addListener((nid) => {
  if (!nid.startsWith("tfnv:")) return;
  const parts = nid.split(":"), url = nvUrl.get(nid) || (parts[1] && parts[1] !== "many" ? "https://www.youtube.com/watch?v=" + encodeURIComponent(parts[1]) : "https://www.youtube.com/feed/subscriptions");
  chrome.tabs.create({ url }); chrome.notifications.clear(nid);
});
// 設定「一般」の「テスト通知」「今すぐ確認」
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.tf === "nv-test") { nvDeliver([{ id: "dQw4w9WgXcQ", title: "テスト通知です(押すと動画を開きます)", ch: "TubeFolio3", kind: "test" }], "テスト").then(() => reply({ ok: true }), (e) => reply({ ok: false, error: e?.message || String(e) })); return true; }
  if (msg?.tf === "nv-check") { nvCheck(true).then(reply, (e) => reply({ ok: false, error: e?.message || String(e) })); return true; }
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

/* ===== 音楽の自動登録(急上昇の「音楽」を、決めた再生リストに入れる) =====
   ・1日1回、新しく急上昇に入った音楽の動画を探して、再生リストに入れる(パソコンの起動が不規則なので、3時間ごと+ブラウザの起動時に「前回から20時間たっていたら確認」する)
   ・取り方を切り替えられる: scrape = youtube-trending.info(日本・ジャンル Music) / api = YouTube Data API(mostPopular・音楽。APIキーが必要)
   ・すでに再生リストにある動画・削除した動画は入れない。「削除した」= 自動で入れた動画が再生リストから無くなっていたとき(手動の削除)と、期限で消したとき
   ・自動で入れた動画は、登録から days 日(既定30日)たったら再生リストから外す。取り置き(keep)にした動画は残す
   ・手動で入れた動画は自動では消さない。登録を見つけてから ask 日(既定60日)たったものは、管理ページで「削除するか」を確認する
   ・設定は tf-ta-set(ドライブ同期の対象)、記録(入れた動画・削除した動画・取り置き)は tf-ta-led(同期の対象)。APIキーは tf-ta-key(同期しない) */
const TA_SET = "tf-ta-set", TA_LED = "tf-ta-led", TA_KEY = "tf-ta-key";
const TA_DEF = { on: false, src: "scrape", pid: "", days: 30, ask: 60 };
const DAY = 86400000;
async function taGet() {
  const r = await chrome.storage.local.get([TA_SET, TA_LED, TA_KEY]);
  return { set: { ...TA_DEF, ...(r[TA_SET] || {}) }, led: { added: {}, removed: {}, seen: {}, keep: {}, last: 0, lastOk: 0, msg: "", ...(r[TA_LED] || {}) }, key: r[TA_KEY] || "" };
}
const taSaveLed = (led) => chrome.storage.local.set({ [TA_LED]: led });
// 候補の動画(順位の高い順)
async function taCandidates(set, key) {
  if (set.src === "api") {
    if (!key) throw new Error("APIキーが入力されていません");
    const r = await fetch("https://www.googleapis.com/youtube/v3/videos?part=snippet&chart=mostPopular&videoCategoryId=10&regionCode=JP&maxResults=50&key=" + encodeURIComponent(key));
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error("API: " + (j.error?.message || r.status));
    return (j.items || []).map((x) => ({ id: x.id, title: x.snippet?.title || "" }));
  }
  let last = null;
  for (let back = 0; back < 3; back++) { // 今日の分がまだなければ、前の日へさかのぼる
    const d = ymd(new Date(Date.now() - back * DAY));
    try { const v = await trendDay(d); const m = v.filter((x) => /^Music$/i.test(x.cat)); if (m.length) return m.map((x) => ({ id: x.id, title: x.title })); last = new Error("この日の急上昇に音楽がありません"); }
    catch (e) { last = e; }
  }
  throw last || new Error("取得できませんでした");
}
let taBusy = false;
async function taRun(manual = false) {
  if (taBusy) return { ok: false, error: "確認中です" };
  taBusy = true;
  const { set, led, key } = await taGet();
  const done = async (ok, msg, extra = {}) => { led.last = Date.now(); if (ok) led.lastOk = Date.now(); led.msg = msg; await taSaveLed(led); tfLog(ok ? "info" : "error", "音楽の自動登録", msg); return { ok, msg, ...extra }; };
  try {
    if (!set.pid) return await done(false, "対象の再生リストが決まっていません");
    if (!set.on && !manual) return { ok: true, off: true };
    let ids;
    try { ids = await YTA.playlistIds(set.pid); } catch (e) { return await done(false, `再生リストを読めませんでした: ${e?.message || e}`); }
    if (!ids.length) return await done(false, "再生リストの中身を読めませんでした(空の再生リストか、読み込みの失敗です。念のため何もしません)");
    const inList = new Set(ids), now = Date.now();
    // 手動の削除: 自動で入れた動画が再生リストに無ければ、削除したものとして覚える(あとで入れ直さない)
    for (const id of Object.keys(led.added)) if (!inList.has(id)) { led.removed[id] = now; delete led.added[id]; }
    // 手動で入れた動画を見つけた日(確認の目安に使う)
    for (const id of ids) if (!led.added[id] && !led.seen[id]) led.seen[id] = now;
    for (const id of Object.keys(led.seen)) if (!inList.has(id)) delete led.seen[id];
    for (const id of Object.keys(led.keep)) if (!inList.has(id)) delete led.keep[id];
    for (const id of Object.keys(led.removed)) if (now - led.removed[id] > 400 * DAY) delete led.removed[id];
    // 期限: 自動で入れてから days 日たったら外す(取り置きは残す)
    let expired = 0;
    for (const [id, a] of Object.entries(led.added)) {
      if (led.keep[id] || now - a.at < set.days * DAY) continue;
      try { await YTA.removeVideo(set.pid, id); led.removed[id] = now; delete led.added[id]; inList.delete(id); expired++; } catch (e) { tfLog("warn", "音楽の自動登録", `期限の動画を外せませんでした: ${e?.message || e}`); }
    }
    // 新着を入れる
    let cands;
    try { cands = await taCandidates(set, key); } catch (e) { return await done(false, `候補を取れませんでした(${set.src === "api" ? "API" : "スクレイピング"}): ${e?.message || e}`, { expired }); }
    let added = 0, skipped = 0;
    for (const c of cands.slice(0, 60)) {
      if (inList.has(c.id) || led.removed[c.id]) { skipped++; continue; }
      try { await YTA.addVideo(set.pid, c.id); led.added[c.id] = { at: now, t: c.title }; inList.add(c.id); delete led.seen[c.id]; added++; }
      catch (e) { tfLog("warn", "音楽の自動登録", `入れられませんでした「${c.title}」: ${e?.message || e}`); }
    }
    return await done(true, `確認しました: 候補${cands.length}本 → 追加${added}本・すでにある/削除済み${skipped}本・期限で外した${expired}本`, { added, expired });
  } catch (e) { return await done(false, `失敗しました: ${e?.message || e}`); }
  finally { taBusy = false; }
}
const taDue = async () => { const { set, led } = await taGet(); if (set.on && set.pid && Date.now() - (led.lastOk || 0) > 20 * 3600 * 1000) taRun(false); };
const taSetup = () => chrome.alarms?.create("tf-ta", { periodInMinutes: 180, delayInMinutes: 2 });
chrome.runtime.onInstalled.addListener(taSetup);
chrome.runtime.onStartup.addListener(() => { taSetup(); setTimeout(taDue, 30000); });
chrome.alarms?.onAlarm.addListener((a) => { if (a.name === "tf-ta") taDue(); });
chrome.alarms?.get("tf-ta").then((a) => { if (!a) taSetup(); }).catch(() => {});
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.tf === "ta-run") { taRun(true).then(reply, (e) => reply({ ok: false, error: e?.message || String(e) })); return true; }
  if (msg?.tf === "ta-del") { // 管理ページの「削除」: 再生リストから外し、削除した動画として覚える
    (async () => { const { set, led } = await taGet(); await YTA.removeVideo(set.pid, msg.id); led.removed[msg.id] = Date.now(); delete led.added[msg.id]; delete led.seen[msg.id]; delete led.keep[msg.id]; await taSaveLed(led); })().then(() => reply({ ok: true }), (e) => reply({ ok: false, error: e?.message || String(e) })); return true;
  }
  if (msg?.tf === "ta-keep") { taGet().then(async ({ led }) => { if (msg.on) led.keep[msg.id] = 1; else delete led.keep[msg.id]; await taSaveLed(led); reply({ ok: true }); }); return true; }
});
