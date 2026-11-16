// 初回インストール時にサンプルデータを投入する(既存データは上書きしない)
chrome.runtime.onInstalled.addListener(async () => {
  const cur = await chrome.storage.local.get("tubefolio");
  if (cur.tubefolio) return;
  const res = await fetch(chrome.runtime.getURL("src/data/sample.json"));
  await chrome.storage.local.set({ tubefolio: await res.json() });
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

// ブラウザのツールバーのアイコンから管理ページを開く
chrome.action.onClicked.addListener(() => chrome.tabs.create({ url: chrome.runtime.getURL("manager.html") }));

// ヘッダーのボタンから管理ページを開く
chrome.runtime.onMessage.addListener((msg) => {
  if (msg === "tf-open-manager") chrome.tabs.create({ url: chrome.runtime.getURL("manager.html") });
});
