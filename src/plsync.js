/* ===== YouTube の再生リストを直接表示する(TubeFolio2 と同じ作り) =====
   作成した再生リスト・ライブラリに保存した再生リストは、TubeFolio にコピーを持たず、毎回 YouTube から読む。
   ・読むタイミング: 画面を開いたとき、画面に戻ってきたとき(YouTubeのタブから戻ったときなど)、表示中は3分ごと
   ・読んだ一覧はこの画面の中だけで持つ(保存しない)。YouTube が正で、TubeFolio 側には同期のずれが生まれない
   ・URLで追加したリスト(YouTubeのアカウントに無いもの)だけは、これまでどおり TubeFolio に保存する
   ・作成・削除の直後は YouTube の一覧に反映されるまで少し時間がかかるので、10分間は操作の結果を上に重ねて表示する
     (data.plRecent に記録するので、ホームを複数のタブで開いていても同じに見える)
   ・YouTube への書き込みは ytapi.js(YTA)。このファイルより先に読み込むこと */
const PLLIVE = (() => {
  const SKEY = "tubefolio";
  const RECENT = 10 * 60 * 1000; // 作成・削除の結果を重ねて表示する時間
  const MIN_GAP = 3 * 1000; // 画面に戻ったときなど、続けて起きたきっかけをまとめる

  // 再生リストのサムネイル: 動画の画像のほか、再生リスト独自の画像や YouTube Music の画像もある
  const img = (o) => {
    let best = null;
    (function w(x) {
      if (!x || typeof x !== "object") return;
      for (const k of ["sources", "thumbnails"]) if (Array.isArray(x[k])) for (const s of x[k]) if (s?.url && (!best || (s.width || 0) > (best.width || 0))) best = s;
      if (!best) Object.values(x).forEach(w);
    })(o.contentImage || o.thumbnail || o);
    const u = best?.url || (JSON.stringify(o).match(/https:\/\/(?:i\.ytimg\.com|[\w-]+\.ggpht\.com|lh\d\.googleusercontent\.com)\/[^"\\]+/) || [""])[0];
    return u.startsWith("//") ? "https:" + u : u;
  };
  // ページのデータから再生リストを集める(非公式・仕様変更で動かなくなる可能性あり)
  function collect(root) {
    const found = new Map();
    (function walk(n) {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) return n.forEach(walk);
      const lv = n.lockupViewModel;
      if (lv && /PLAYLIST/.test(lv.contentType || "") && lv.contentId) {
        // 「作成した」リストは公開設定(非公開/公開/限定公開)が表示され、「保存した」他人のリストは作成者名が表示される
        const rows = lv.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows || [];
        const texts = rows.flatMap((r) => (r.metadataParts || []).map((p) => p.text?.content || "")).filter(Boolean);
        const own = texts.some((t) => /^(非公開|公開|限定公開|Private|Public|Unlisted)$/i.test(t.trim()));
        found.set(lv.contentId, { title: lv.metadata?.lockupMetadataViewModel?.title?.content || lv.contentId, thumb: img(lv), kind: own ? "own" : "saved", channel: own ? "" : (texts[0] || "") });
      }
      for (const k of ["gridPlaylistRenderer", "playlistRenderer"]) {
        const r = n[k];
        if (r?.playlistId) found.set(r.playlistId, { title: r.title?.simpleText || r.title?.runs?.[0]?.text || r.playlistId, thumb: img(r), kind: "own", channel: "" });
      }
      Object.values(n).forEach(walk);
    })(root);
    found.delete("WL"); found.delete("LL");
    return found;
  }
  // 一覧の続きを読むためのトークン(なければ "")
  function contToken(root) {
    let t = "";
    (function walk(n) {
      if (t || !n || typeof n !== "object") return;
      if (Array.isArray(n)) return n.forEach(walk);
      const c = n.continuationItemRenderer;
      if (c) { t = c.continuationEndpoint?.continuationCommand?.token || c.button?.buttonRenderer?.command?.continuationCommand?.token || ""; if (t) return; }
      Object.values(n).forEach(walk);
    })(root);
    return t;
  }

  let live = null; // YouTube から読んだ一覧(まだ読んでいなければ null)
  let recent = { add: [], del: [] }; // 直前の作成・削除(data.plRecent と同じ内容)
  const st = { loading: false, error: "", at: 0 };
  const subs = [];
  const notify = () => subs.forEach((f) => { try { f(); } catch (e) { console.error(e); } });

  // 直前の操作のうち、10分以内で、まだ YouTube の一覧に反映されていないものだけを残す
  function tidyRecent(r = recent) {
    const now = Date.now(), ids = new Set((live || []).map((p) => p.id));
    return {
      add: (r.add || []).filter((x) => now - x.at < RECENT && !ids.has(x.p.id)),
      del: (r.del || []).filter((x) => now - x.at < RECENT && ids.has(x.id)),
    };
  }
  async function readRecent() { recent = (await chrome.storage.local.get(SKEY))[SKEY]?.plRecent || { add: [], del: [] }; }
  // tidy: YouTube の一覧を読み直した直後だけ、反映済みのものを片付ける(それ以外は期限切れだけ外す)
  async function writeRecent(tidy = false) {
    const cur = (await chrome.storage.local.get(SKEY))[SKEY]; if (!cur) return;
    const now = Date.now();
    cur.plRecent = recent = tidy ? tidyRecent(recent) : { add: recent.add.filter((x) => now - x.at < RECENT), del: recent.del.filter((x) => now - x.at < RECENT) };
    await chrome.storage.local.set({ [SKEY]: cur });
  }

  let loadingP = null, lastLoad = 0;
  // YouTube から一覧を読む
  function load({ force = false } = {}) {
    if (loadingP) return loadingP;
    if (!force && Date.now() - lastLoad < MIN_GAP) return Promise.resolve();
    lastLoad = Date.now();
    st.loading = true; notify();
    loadingP = (async () => {
      const html = await (await fetch("https://www.youtube.com/feed/playlists", { credentials: "include" })).text();
      const s = html.indexOf("ytInitialData = "), e = html.indexOf(";</script>", s);
      if (s < 0 || e < 0) throw new Error("YouTubeの再生リストを読み込めませんでした(ログイン状態やYouTubeの仕様変更が原因かもしれません)");
      if (typeof YTA !== "undefined") YTA.useHtml(html);
      const first = JSON.parse(html.slice(s + 16, e));
      const found = collect(first);
      let token = contToken(first); // 多いと分割されて届くので続きも読む
      for (let n = 0; token && n < 30; n++) { const j = await YTA.browse(token); for (const [id, m] of collect(j)) found.set(id, m); token = contToken(j); }
      if (!found.size && !html.includes('"LOGGED_IN":true')) throw new Error("YouTubeにログインしていません。このChromeでYouTubeにログインしてください");
      // 読み込み済みの中身(動画一覧)は引き継ぐ
      const old = new Map((live || []).map((p) => [p.id, p]));
      live = [...found].map(([id, m]) => Object.assign(old.get(id) || {}, { id, title: m.title, channel: m.channel, thumb: m.thumb || old.get(id)?.thumb || "", kind: m.kind }));
      st.error = ""; st.at = Date.now();
      await readRecent();
      const t = tidyRecent();
      if (t.add.length !== (recent.add || []).length || t.del.length !== (recent.del || []).length) await writeRecent(true);
    })().catch((e) => { st.error = e?.message || "YouTubeの再生リストを読み込めませんでした"; })
      .finally(() => { st.loading = false; loadingP = null; notify(); });
    return loadingP;
  }

  // 表示する一覧: YouTube の一覧 + 直前に作成・保存したもの - 直前に削除したもの
  function list() {
    const now = Date.now(), add = (recent.add || []).filter((x) => now - x.at < RECENT);
    const del = new Set((recent.del || []).filter((x) => now - x.at < RECENT).map((x) => x.id));
    const base = (live || []).filter((p) => !del.has(p.id));
    const ids = new Set(base.map((p) => p.id));
    return [...base, ...add.map((x) => x.p).filter((p) => !ids.has(p.id) && !del.has(p.id))];
  }
  const has = (id) => list().some((p) => p.id === id);

  // 作成・保存した直後: YouTube の一覧に出るまでの間も表示する
  async function markAdded(p) {
    await readRecent();
    recent.add = [...recent.add.filter((x) => x.p.id !== p.id), { p: { ...p, items: undefined }, at: Date.now() }];
    recent.del = recent.del.filter((x) => x.id !== p.id);
    await writeRecent(); notify();
  }
  // 削除・ライブラリから外した直後: YouTube の一覧から消えるまでの間も隠す
  async function markDeleted(id) {
    await readRecent();
    recent.del = [...recent.del.filter((x) => x.id !== id), { id, at: Date.now() }];
    recent.add = recent.add.filter((x) => x.p.id !== id);
    await writeRecent(); notify();
  }

  // 自動で読み直す: 開いたとき・画面に戻ってきたとき・表示中は3分ごと。ほかの画面での作成・削除も反映する
  let started = false;
  function start() {
    if (started) return; started = true;
    const go = () => { if (document.visibilityState === "visible") load(); };
    readRecent().then(go);
    document.addEventListener("visibilitychange", go);
    addEventListener("focus", go);
    setInterval(go, 3 * 60 * 1000);
    chrome.storage.onChanged.addListener((c) => {
      const r = c[SKEY]?.newValue?.plRecent;
      if (r && JSON.stringify(r) !== JSON.stringify(recent)) { recent = r; notify(); }
    });
  }
  // 以前の版で TubeFolio に保存していた YouTube の再生リストのコピーを片付ける(URLで追加したもの・分類を手動で変えたものは残す)
  async function migrate() {
    const cur = (await chrome.storage.local.get(SKEY))[SKEY];
    if (!cur?.playlists || cur.plLiveV === 1) return;
    cur.playlists = cur.playlists.filter((p) => !(p.kind === "own" || p.kind === "saved") || p.kindLocked);
    delete cur.plSyncAt;
    cur.plLiveV = 1;
    await chrome.storage.local.set({ [SKEY]: cur });
  }

  return {
    start, load, list, has, markAdded, markDeleted, migrate,
    loaded: () => live !== null,
    state: () => ({ ...st }),
    onChange: (f) => subs.push(f),
  };
})();
