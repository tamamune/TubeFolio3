/* ===== YouTube への書き込み(再生リストの同期用) =====
   youtube.com 自身が使っている非公式の youtubei API を、ログイン中のアカウントとして呼び出す。
   公式APIではないので、YouTube の仕様変更で動かなくなることがある。
   ※ 本物のアカウントに書き込む。自分の再生リストの削除は YouTube 上でも元に戻せない。 */
/* 翻訳(Google 翻訳の無料の窓口)。
   調べた結果: client=gtx(translate_a/single)は、たくさん送ると「自動送信」と見なされて断られる(HTMLの Sorry ページが返る)。
   client=dict-chrome-ex(translate_a/t)は、q を複数付けると、文ごとに [[訳, 元の言語], …] で返す。こちらを使い、まとめて送る。
   断られたら 1分間は送らず、待っている依頼もすぐに失敗で返す(待たせ続けると、コメントがいつまでも出ないため) */
const trQ = []; let trBusy = false, trBlock = 0;
const TR_BLOCK_MSG = "翻訳の窓口が一時的に断っています(1分ほどで戻ります)";
async function trFetch(texts) { // 返すのは texts と同じ順の { text, src } の配列
  const res = await fetch("https://translate.googleapis.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=ja&" + texts.map((t) => "q=" + encodeURIComponent(t)).join("&"));
  const raw = await res.text(); let j;
  try { j = JSON.parse(raw); } catch { throw Object.assign(new Error(TR_BLOCK_MSG + "(HTTP " + res.status + ")"), { limited: true }); }
  if (!Array.isArray(j)) throw new Error("翻訳の結果を読めませんでした");
  return texts.map((_, i) => { const x = j[i]; return Array.isArray(x) ? { text: String(x[0] ?? ""), src: String(x[1] ?? "") } : typeof x === "string" ? { text: x, src: "" } : null; });
}
async function trPump() {
  if (trBusy) return; trBusy = true;
  while (trQ.length) {
    const job = trQ.shift();
    if (Date.now() < trBlock) { job.reject(new Error(TR_BLOCK_MSG)); continue; }
    try {
      if (job.many) job.resolve(await trFetch(job.many));
      else { const r = (await trFetch([job.text]))[0]; if (!r) throw new Error("翻訳の結果が空でした"); job.resolve(r); }
    } catch (e) {
      if (e.limited) trBlock = Date.now() + 60000;
      job.reject(e);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  trBusy = false;
}
// 文の配列を、URLに入る長さごとにまとめる
function trChunks(texts) {
  const out = []; let cur = [], len = 0;
  for (const t of texts) {
    const n = encodeURIComponent(t).length + 3;
    if (cur.length && len + n > 6000) { out.push(cur); cur = []; len = 0; }
    cur.push(t); len += n;
  }
  if (cur.length) out.push(cur);
  return out;
}
const YTA = (() => {
  let cfg = null; // { context, version }: youtube.com のページに埋め込まれているクライアント情報

  // 文字列中の key の直後にある JSON オブジェクトを取り出す
  function jsonAfter(str, key) {
    const i = str.indexOf(key); if (i < 0) return null;
    const s = str.indexOf("{", i); if (s < 0) return null;
    let depth = 0, inStr = false;
    for (let j = s; j < str.length; j++) {
      const ch = str[j];
      if (inStr) { if (ch === "\\") j++; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) { try { return JSON.parse(str.slice(s, j + 1)); } catch { return null; } }
    }
    return null;
  }
  // すでに取得した youtube.com のHTMLがあれば、そこからクライアント情報を覚えておく(余分な通信を減らす)
  function useHtml(html) {
    const context = jsonAfter(html, '"INNERTUBE_CONTEXT":');
    if (!context) return;
    cfg = { context, version: (html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/) || [])[1] || context.client?.clientVersion || "" };
  }
  async function getCfg() {
    if (!cfg) useHtml(await (await fetch("https://www.youtube.com/feed/playlists", { credentials: "include" })).text());
    if (!cfg) throw new Error("YouTubeの情報を読み込めませんでした");
    return cfg;
  }
  async function sha1hex(s) {
    const b = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s));
    return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
  }
  // youtube.com 自身が付けているのと同じ形式の認証ヘッダー(SAPISID クッキーから作る)
  async function auth() {
    const get = async (name) => (await chrome.cookies.get({ url: "https://www.youtube.com", name }).catch(() => null))?.value || "";
    const sid = (await get("SAPISID")) || (await get("__Secure-3PAPISID"));
    if (!sid) throw new Error("YouTubeにログインしていません");
    const ts = Math.floor(Date.now() / 1000), origin = "https://www.youtube.com";
    const part = async (label, v) => `${label} ${ts}_${await sha1hex(`${ts} ${v} ${origin}`)}`;
    const out = [await part("SAPISIDHASH", sid)];
    const p1 = await get("__Secure-1PAPISID"), p3 = await get("__Secure-3PAPISID");
    if (p1) out.push(await part("SAPISID1PHASH", p1));
    if (p3) out.push(await part("SAPISID3PHASH", p3));
    return out.join(" ");
  }
  async function post(path, body) {
    const { context, version } = await getCfg();
    const headers = { "Content-Type": "application/json", "X-Youtube-Client-Name": "1", "X-Youtube-Client-Version": version, "X-Origin": "https://www.youtube.com", "X-Goog-AuthUser": "0", Authorization: await auth() };
    const r = await fetch(`https://www.youtube.com/youtubei/v1/${path}?prettyPrint=false`, { method: "POST", credentials: "include", headers, body: JSON.stringify({ context, ...body }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(j.error?.message || `YouTubeがエラーを返しました(${r.status})`);
    return j;
  }
  // 再生リストの中身を変える(動画の追加・削除)。失敗すると status が STATUS_SUCCEEDED にならない
  async function edit(playlistId, actions) {
    const j = await post("browse/edit_playlist", { playlistId, actions });
    if (j.status && j.status !== "STATUS_SUCCEEDED") throw new Error("YouTubeで変更できませんでした");
    return j;
  }
  return {
    useHtml,
    browse: (continuation) => post("browse", { continuation }), // 一覧の続きを読む
    // privacy: "PRIVATE"(非公開) / "UNLISTED"(限定公開) / "PUBLIC"(公開)。作成した再生リストのIDを返す
    create: async (title, privacy = "PRIVATE") => {
      const j = await post("playlist/create", { title, privacyStatus: privacy });
      if (!j.playlistId) throw new Error("再生リストを作成できませんでした");
      return j.playlistId;
    },
    remove: (playlistId) => post("playlist/delete", { playlistId }), // 自分の再生リストを削除
    save: (playlistId) => post("like/like", { target: { playlistId } }), // 他人の再生リストをライブラリに保存
    unsave: (playlistId) => post("like/removelike", { target: { playlistId } }), // ライブラリから外す
    // すでに入っている動画は重ねて追加しない(DEDUPE_OPTION_SKIP)
    addVideo: (playlistId, videoId) => edit(playlistId, [{ action: "ACTION_ADD_VIDEO", addedVideoId: videoId, dedupeOption: "DEDUPE_OPTION_SKIP" }]),
    removeVideo: (playlistId, videoId) => edit(playlistId, [{ action: "ACTION_REMOVE_VIDEO_BY_VIDEO_ID", removedVideoId: videoId }]),
    // 動画を入れられる自分の再生リスト一覧(YouTube の「保存」メニューと同じ。containsSelectedVideos が ALL なら、その動画は入っている)
    ownPlaylists: async (videoId) => {
      const j = await post("playlist/get_add_to_playlist", { videoIds: [videoId], excludeWatchLater: false });
      const list = j.contents?.[0]?.addToPlaylistRenderer?.playlists || [];
      return list.map((x) => x.playlistAddToOptionRenderer).filter(Boolean).map((r) => ({ id: r.playlistId, title: r.title?.simpleText || r.title?.runs?.map((t) => t.text).join("") || r.playlistId, has: r.containsSelectedVideos === "ALL" }));
    },
    // 動画のコメント(最大 limit 件)。再生画面のコメント流し用。コメント欄を開かなくても取れる
    // sort: "top"(評価順) / "new"(新着順)。返すのは { text 本文, name 名前, likes 評価の数, time 投稿日 } の配列
    comments: async (videoId, limit = 150, sort = "top") => {
      const walk = (n, fn) => { if (!n || typeof n !== "object") return; fn(n); (Array.isArray(n) ? n : Object.values(n)).forEach((x) => walk(x, fn)); };
      let token = ""; // 動画の情報から、コメント欄を読み込むための続きのトークンを探す
      walk(await post("next", { videoId }), (n) => { if (!token && n.sectionIdentifier === "comment-item-section") walk(n, (m) => { if (!token && m.continuationItemRenderer) token = m.continuationItemRenderer.continuationEndpoint?.continuationCommand?.token || ""; }); });
      const out = [], seen = new Set();
      let wantNew = sort === "new";
      for (let page = 0; token && out.length < limit && page < 10; page++) {
        const j = await post("next", { continuation: token }); token = "";
        if (wantNew) { // 並び替えメニューの「新しい順」(2つ目)のトークンに切り替えて、取り直す
          wantNew = false; let nt = "";
          walk(j, (n) => { const it = n.sortFilterSubMenuRenderer?.subMenuItems; if (it?.[1]?.serviceEndpoint?.continuationCommand?.token) nt = it[1].serviceEndpoint.continuationCommand.token; });
          if (nt) { token = nt; continue; }
        }
        const ent = new Map(), order = [], legacy = [];
        walk(j, (n) => {
          const p = n.commentEntityPayload;
          if (p) ent.set(p.key, { text: p.properties?.content?.content || "", name: p.author?.displayName || "", icon: p.avatar?.image?.sources?.[0]?.url || p.author?.avatarThumbnailUrl || "", likes: p.toolbar?.likeCountNotliked || p.toolbar?.likeCountLiked || "", time: p.properties?.publishedTime || "" });
          const k = n.commentThreadRenderer?.commentViewModel?.commentViewModel?.commentKey; if (k) order.push(k);
          const r = n.commentRenderer;
          if (r?.contentText) legacy.push({ text: r.contentText.runs ? r.contentText.runs.map((x) => x.text).join("") : r.contentText.simpleText || "", name: r.authorText?.simpleText || "", icon: r.authorThumbnail?.thumbnails?.[0]?.url || "", likes: r.voteCount?.simpleText || "", time: r.publishedTimeText?.runs?.[0]?.text || "" });
          if (n.continuationItemRenderer) token = n.continuationItemRenderer.continuationEndpoint?.continuationCommand?.token || token; // 最後のものが「次のページ」
        });
        const items = order.length ? order.map((k) => ent.get(k)).filter(Boolean) : [...ent.values(), ...legacy];
        for (const c of items) { const s = (c.text || "").replace(/\s+/g, " ").trim(); if (s && !seen.has(s)) { seen.add(s); out.push({ text: s.slice(0, 140), raw: String(c.text || "").slice(0, 1500), name: c.name, icon: c.icon || "", likes: String(c.likes || ""), time: c.time }); } }
      }
      return out;
    },
    // 動画のチャプター。返すのは { sec 開始秒, title } の配列(開始の早い順)
    chapters: async (videoId) => {
      const walk = (n, fn) => { if (!n || typeof n !== "object") return; fn(n); (Array.isArray(n) ? n : Object.values(n)).forEach((x) => walk(x, fn)); };
      const tx = (t) => (t?.simpleText || t?.runs?.map((r) => r.text).join("") || "").trim();
      const out = new Map();
      walk(await post("next", { videoId }), (n) => {
        const m = n.macroMarkersListItemRenderer;
        if (m) { const s = m.onTap?.watchEndpoint?.startTimeSeconds; if (s != null && !out.has(+s)) out.set(+s, tx(m.title)); }
        const c = n.chapterRenderer;
        if (c && c.timeRangeStartMillis != null) { const s = Math.floor(c.timeRangeStartMillis / 1000); if (!out.has(s)) out.set(s, tx(c.title)); }
      });
      return [...out].map(([sec, title]) => ({ sec, title })).sort((a, b) => a.sec - b.sec);
    },
    // 動画のタグ(投稿者が設定した、画面には出ないキーワード)
    tags: async (videoId) => (await post("player", { videoId })).videoDetails?.keywords || [],
    // 動画のタグと概要欄(ハッシュタグを取り出す用)。返すのは { keywords, description, title, channel }
    videoMeta: async (videoId) => { const d = (await post("player", { videoId })).videoDetails || {}; return { keywords: d.keywords || [], description: d.shortDescription || "", title: d.title || "", channel: d.author || "" }; },
    // コメントの翻訳(日本語へ)。公開コメントの文だけを、Google 翻訳の無料の窓口に送る。返すのは { text: 翻訳, src: 元の言語 }
    // 一度に大量に送ると、窓口から断られる(HTMLが返る)ので、1件ずつ間を空けて送る。字幕(prio)はコメントより先に処理する。断られたら少し待ってやり直す
    translate: (text, prio) => new Promise((resolve, reject) => {
      const job = { text: String(text).slice(0, 400), resolve, reject };
      if (prio) trQ.unshift(job); else trQ.push(job);
      trPump();
    }),
    // 複数の文をまとめて翻訳する(コメント用)。返すのは texts と同じ順の { text, src } の配列(訳せなかった所は null)
    translateMany: async (texts) => {
      const list = (texts || []).map((t) => String(t).replace(/\s+/g, " ").trim().slice(0, 400)), out = [];
      for (const chunk of trChunks(list)) {
        let r = null;
        try { r = await new Promise((resolve, reject) => { trQ.push({ many: chunk, resolve, reject }); trPump(); }); } catch { r = null; }
        out.push(...(r || chunk.map(() => null)));
      }
      return out;
    },
    // チャンネル登録・解除(params は YouTube の登録ボタンが使っている固定の値)
    subscribe: (channelId) => post("subscription/subscribe", { channelIds: [channelId], params: "EgIIAhgA" }),
    unsubscribe: (channelId) => post("subscription/unsubscribe", { channelIds: [channelId], params: "CgIIAhgA" }),
    // @ハンドルや動画のURLから、チャンネルID を調べる(ページのHTMLを読む)
    channelIdOf: async (url) => { const h = await (await fetch(url, { credentials: "include" })).text(); return (h.match(/"channelId":"(UC[\w-]{22})"/) || h.match(/"externalId":"(UC[\w-]{22})"/) || [])[1] || ""; },
  };
})();
