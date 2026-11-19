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
