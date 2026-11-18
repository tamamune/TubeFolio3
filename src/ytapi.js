/* ===== YouTube への書き込み(再生リストの同期用) =====
   youtube.com 自身が使っている非公式の youtubei API を、ログイン中のアカウントとして呼び出す。
   公式APIではないので、YouTube の仕様変更で動かなくなることがある。
   ※ 本物のアカウントに書き込む。自分の再生リストの削除は YouTube 上でも元に戻せない。 */
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
        for (const c of items) { const s = (c.text || "").replace(/\s+/g, " ").trim(); if (s && !seen.has(s)) { seen.add(s); out.push({ text: s.slice(0, 140), name: c.name, icon: c.icon || "", likes: String(c.likes || ""), time: c.time }); } }
      }
      return out;
    },
    // コメントの翻訳(日本語へ)。公開コメントの文だけを、Google 翻訳の無料の窓口に送る。返すのは { text: 翻訳, src: 元の言語 }
    translate: async (text) => {
      const j = await (await fetch("https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ja&dt=t&q=" + encodeURIComponent(String(text).slice(0, 400)))).json();
      return { text: (j[0] || []).map((x) => x[0]).join(""), src: j[2] || "" };
    },
    // チャンネル登録・解除(params は YouTube の登録ボタンが使っている固定の値)
    subscribe: (channelId) => post("subscription/subscribe", { channelIds: [channelId], params: "EgIIAhgA" }),
    unsubscribe: (channelId) => post("subscription/unsubscribe", { channelIds: [channelId], params: "CgIIAhgA" }),
    // @ハンドルや動画のURLから、チャンネルID を調べる(ページのHTMLを読む)
    channelIdOf: async (url) => { const h = await (await fetch(url, { credentials: "include" })).text(); return (h.match(/"channelId":"(UC[\w-]{22})"/) || h.match(/"externalId":"(UC[\w-]{22})"/) || [])[1] || ""; },
  };
})();
