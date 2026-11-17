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
  };
})();
