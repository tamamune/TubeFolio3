// YouTube のページ本体の側(MAIN world)で動く小さなスクリプト: 再生中の動画のチャンネルIDなどを、拡張機能の側へ渡す。
(() => {
  /* ===== H.264 で再生(設定「一般」。ptools.js が youtube.com の localStorage の tf-h264 に写す) =====
     VP9・AV1 を「再生できない」と答えて、パソコンの負荷が軽い H.264 を YouTube に選ばせる(ページを読み込んだときに効く) */
  try {
    if (localStorage.getItem("tf-h264") === "1") {
      const no = (t) => /vp0?9|av01/i.test(String(t || ""));
      const ms = window.MediaSource;
      if (ms?.isTypeSupported) { const o = ms.isTypeSupported.bind(ms); ms.isTypeSupported = (t) => (no(t) ? false : o(t)); }
      const cp = HTMLMediaElement.prototype.canPlayType;
      HTMLMediaElement.prototype.canPlayType = function (t) { return no(t) ? "" : cp.call(this, t); };
    }
  } catch {}

  const info = () => {
    const f = document.querySelector("ytd-watch-flexy"), mp = document.getElementById("movie_player");
    const resp = (() => { try { return mp?.getPlayerResponse?.(); } catch { return null; } })();
    const d = (resp?.videoDetails?.videoId && resp.videoDetails) || f?.playerData?.videoDetails || f?.__data?.playerData?.videoDetails || window.ytInitialPlayerResponse?.videoDetails;
    const mf = (resp?.videoDetails?.videoId === d?.videoId ? resp : f?.playerData)?.microformat?.playerMicroformatRenderer || null; // 公開日時(ptools.js)
    return d ? { videoId: d.videoId, title: d.title, channel: d.author, channelId: d.channelId, keywords: d.keywords || null, description: d.shortDescription ?? null,
      publishDate: mf?.publishDate || "", uploadDate: mf?.uploadDate || "", liveStart: mf?.liveBroadcastDetails?.startTimestamp || "", viewCount: d.viewCount || mf?.viewCount || "" } : null;
  };

  /* ===== 字幕(subtitles.js から頼まれる) =====
     YouTube が字幕を読み込むときのURL(認証の札 pot 付き)を覚えておき、
     同じURLで「原文」と「日本語訳(tlang=ja)」の両方を取り直して、時間つきの字幕の一覧として渡す。
     (YouTube 自身の字幕は原文のまま読み込ませ、画面からは隠す。表示は subtitles.js が行う) */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ttUrls = new Map(); // 動画ID -> YouTube が読み込んだ字幕のURL(新しいものが後ろ)
  const noteTT = (u) => {
    try {
      const x = new URL(u, location.href);
      if (!x.pathname.includes("/api/timedtext")) return;
      const v = x.searchParams.get("v"); if (!v) return;
      const a = ttUrls.get(v) || []; a.push(x.href); ttUrls.set(v, a.slice(-10));
      if (ttUrls.size > 20) ttUrls.delete(ttUrls.keys().next().value);
    } catch {}
  };
  const origFetch = window.fetch;
  window.fetch = function (input, ...rest) { try { noteTT(typeof input === "string" ? input : input?.url || String(input)); } catch {} return origFetch.call(this, input, ...rest); };
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, u, ...rest) { try { noteTT(String(u)); } catch {} return origOpen.call(this, m, u, ...rest); };

  const isJaCode = (c) => /^ja\b/i.test(c || "");
  function trackInfo(p) {
    const resp = p.getPlayerResponse?.() || window.ytInitialPlayerResponse, rd = resp?.captions?.playerCaptionsTracklistRenderer;
    const respVid = resp?.videoDetails?.videoId || "";
    const tracks = (rd?.captionTracks || []).map((t) => ({ languageCode: t.languageCode, kind: t.kind || "", languageName: t.name?.simpleText || t.name?.runs?.map((r) => r.text).join("") || t.languageCode }));
    const idx = rd?.audioTracks?.[0]?.defaultCaptionTrackIndex;
    // 音声の言語
    // 調べた結果: 自動吹き替えのある動画は、音声が複数あり(例: 「日本語(オリジナル)」と「英語(US) 自動吹き替え」)、
    // 自動字幕も音声ごとにある(en/asr と ja/asr)。先頭の自動字幕で決めると、日本語の動画を英語と取り違える。
    // そこで、いま流れている音声のID(「ja.4」「en-US.10」など)から言語を決める。分からなければ、YouTube の既定の音声
    const base = (c) => String(c || "").toLowerCase().split(/[-_.]/)[0];
    const idLang = (o) => { const m = JSON.stringify(o || {}).match(/"id":"([a-z]{2,3}(?:-[A-Za-z]{2,4})?)\.\d+"/i); return m ? base(m[1]) : ""; };
    let audio = "";
    try { audio = idLang(p.getAudioTrack?.()); } catch {}
    if (!audio) audio = base((resp?.streamingData?.adaptiveFormats || []).map((f) => f.audioTrack).find((a) => a?.audioIsDefault)?.id);
    let lang;
    if (audio) lang = (tracks.find((t) => t.kind === "asr" && base(t.languageCode) === audio) || tracks.find((t) => base(t.languageCode) === audio))?.languageCode || audio;
    else lang = (tracks.find((t) => t.kind === "asr") || tracks[idx] || tracks[0])?.languageCode || ""; // 音声が1つの動画: 自動字幕の言語 → 既定の字幕 → 先頭の字幕
    return { tracks, lang, respVid };
  }
  const parseJson3 = (j) => (j?.events || []).filter((e) => e.segs && e.tStartMs != null)
    .map((e) => ({ s: e.tStartMs, e: e.tStartMs + (e.dDurationMs || 3000), t: e.segs.map((g) => g.utf8 || "").join("").replace(/\s+/g, " ").trim() }))
    .filter((c) => c.t);

  async function cap(op, arg) {
    const p = document.getElementById("movie_player"); if (!p) return null;
    // 調べた結果: unloadModule("captions") で消すと、その後 setOption でも字幕が戻らなくなる。
    // CCボタンと同じ toggleSubtitles / toggleSubtitlesOn で切り替える
    if (op === "off") {
      try { if (p.isSubtitlesOn?.()) p.toggleSubtitles(); } catch {}
      return { ok: true };
    }
    const { tracks, lang, respVid } = trackInfo(p);
    // 広告中は、プレーヤーの動画ID・字幕が広告のものになるので、広告かどうかも返す。
    // 動画を切り替えた直後は、字幕の情報がまだ前の動画のことがある(外国語→日本語の動画で、日本語と判定できない)ので、
    // 字幕の情報が入っている動画のID(respVid)も返す
    if (op === "info") return { lang, tracks, vid: respVid, playing: p.getVideoData?.()?.video_id || "", ad: p.classList.contains("ad-showing") };
    if (op === "on") { // arg.tl: true なら日本語で表示する(日本語の字幕があればそれ、なければ自動翻訳)
      try { if (!p.isSubtitlesOn?.()) { p.toggleSubtitlesOn(); await sleep(800); } } catch {}
      // 調べた結果: getOption("captions","tracklist") は空のことが多い。{ languageCode, kind } だけ渡せば YouTube は字幕を切り替える
      const list = tracks.map((t) => ({ languageCode: t.languageCode, kind: t.kind }));
      if (!list.length) return { ok: false, why: "字幕がありません" };
      const src = list.find((t) => t.languageCode === lang && t.kind === "asr") || list.find((t) => t.languageCode === lang) || list.find((t) => !isJaCode(t.languageCode)) || list[0];
      let want = src, how = "orig";
      if (arg?.tl) {
        const ja = list.find((t) => isJaCode(t.languageCode) && t.kind !== "asr");
        if (ja) { want = ja; how = "ja-track"; } else { want = { ...src, translationLanguage: { languageCode: "ja", languageName: "日本語" } }; how = "auto-tr"; }
      }
      const cur = (() => { try { return p.getOption("captions", "track") || {}; } catch { return {}; } })();
      const same = cur.languageCode === want.languageCode && (cur.kind || "") === (want.kind || "") && !cur.translationLanguage === !want.translationLanguage;
      if (!same) { try { p.setOption("captions", "track", want); } catch (err) { return { ok: false, why: String(err) }; } }
      return { ok: true, lang: src.languageCode, kind: src.kind || "", how };
    }
    if (op === "cues") { // arg.lang: 原文の言語。YouTube が字幕を読み込むのを待って、原文と日本語訳を取る
      const vid = arg.vid; if (!vid) return { why: "動画IDが分かりません" }; // 広告の字幕を拾わないように、ページのURLの動画IDを使う
      let u = null;
      const kindOf = (h) => new URL(h).searchParams.get("kind") || "";
      for (let i = 0; i < 48 && !u; i++) {
        const c = [...(ttUrls.get(vid) || [])].reverse().filter((h) => new URL(h).searchParams.get("lang") === arg.lang);
        u = c.find((h) => kindOf(h) === (arg.kind || "")) || c[0] || null;
        if (!u && (i === 12 || i === 32)) { // YouTube が読み込み済みで、URLを覚えていないときは、字幕を一度消して付け直し、読み込み直させる
          try { if (p.isSubtitlesOn?.()) { p.toggleSubtitles(); await sleep(300); } p.toggleSubtitlesOn(); await sleep(500); p.setOption("captions", "track", { languageCode: arg.lang, kind: arg.kind || "" }); } catch {}
        }
        if (!u) await sleep(250);
      }
      if (!u) { // 捕まえられなかったときは、動画の情報にある字幕のURLで試す(認証の札がないので、空のこともある)
        const rd = (p.getPlayerResponse?.() || window.ytInitialPlayerResponse)?.captions?.playerCaptionsTracklistRenderer;
        const ct = rd?.captionTracks || [];
        u = (ct.find((t) => t.languageCode === arg.lang && t.kind === "asr") || ct.find((t) => t.languageCode === arg.lang))?.baseUrl || null;
        if (u) u = new URL(u, location.href).href;
      }
      if (!u) return { why: "YouTube が字幕を読み込みませんでした(動画を再生してください)" };
      const mk = (tl) => { const x = new URL(u); x.searchParams.set("fmt", "json3"); if (tl) x.searchParams.set("tlang", tl); else x.searchParams.delete("tlang"); return x.href; };
      const get = async (h) => { try { const r = await origFetch(h, { credentials: "include" }); return r.ok ? parseJson3(await r.json()) : []; } catch { return []; } };
      const [o, j] = await Promise.all([get(mk("")), isJaCode(arg.lang) ? Promise.resolve([]) : get(mk("ja"))]);
      return { o, j };
    }
    return null;
  }
  /* ===== 再生速度(chrate.js から頼まれる): チャンネルごとに決めた速さにする =====
     2倍までは YouTube の機能(setPlaybackRate)で変える(YouTube の速度メニューの表示もそろう)。2倍より速いときは、動画そのものの速さを変える。
     広告の間は変えない(広告が速くなるだけで、本編に戻ると元に戻るため) */
  function setRate(rate) {
    const p = document.getElementById("movie_player"), v = p?.querySelector("video");
    if (!p || !v) return { ok: false, why: "player" };
    if (p.classList.contains("ad-showing")) return { ok: false, why: "ad" };
    const cur = v.playbackRate;
    if (rate == null) return { ok: true, cur };
    try { if (rate <= 2 && p.setPlaybackRate) p.setPlaybackRate(rate); } catch {}
    if (Math.abs(v.playbackRate - rate) > 0.001) v.playbackRate = rate;
    return { ok: Math.abs(v.playbackRate - rate) < 0.001, cur, now: v.playbackRate };
  }
  /* ===== 別のタブに移ったときの自動 PiP(pip.js から頼まれる) =====
     ブラウザの「自動ピクチャインピクチャ」(Media Session の enterpictureinpicture)を受け付けると、
     動画を再生中にタブを切り替えたとき、ブラウザが自動で PiP にしてくれる(対応していないブラウザでは何もしない) */
  function setAutoPip(on) {
    try {
      navigator.mediaSession.setActionHandler("enterpictureinpicture", on ? () => {
        const v = document.querySelector("#movie_player video");
        if (v && !v.paused) v.requestPictureInPicture().catch(() => {});
      } : null);
    } catch {}
  }
  addEventListener("message", async (e) => {
    if (e.source === window && e.data?.tf === "cap") { let r = null; try { r = await cap(e.data.op, e.data.arg); } catch {} postMessage({ tf: "capres", id: e.data.id, r }, "*"); return; }
    if (e.source === window && e.data?.tf === "quality") { // 画質の固定(ptools.js)
      let ok = false;
      try { const p = document.getElementById("movie_player"), q = e.data.q; if (p && q && q !== "auto") { p.setPlaybackQualityRange?.(q, q); p.setPlaybackQuality?.(q); ok = true; } } catch {}
      postMessage({ tf: "qres", id: e.data.id, r: { ok } }, "*"); return;
    }
    if (e.source === window && e.data?.tf === "pipauto") { setAutoPip(!!e.data.on); return; }
    if (e.source === window && e.data?.tf === "rate") { postMessage({ tf: "rateres", id: e.data.id, r: setRate(e.data.rate) }, "*"); return; }
    if (e.source !== window || e.data?.tf !== "req") return;
    postMessage({ tf: "res", id: e.data.id, info: info() }, "*");
  });
})();
