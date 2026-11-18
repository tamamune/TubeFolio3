// YouTube のページ本体の側(MAIN world)で動く小さなスクリプト: 再生中の動画のチャンネルIDなどを、拡張機能の側へ渡す。
(() => {
  const info = () => {
    const f = document.querySelector("ytd-watch-flexy");
    const d = f?.playerData?.videoDetails || f?.__data?.playerData?.videoDetails || window.ytInitialPlayerResponse?.videoDetails;
    return d ? { videoId: d.videoId, title: d.title, channel: d.author, channelId: d.channelId } : null;
  };
  addEventListener("message", (e) => {
    if (e.source !== window || e.data?.tf !== "req") return;
    postMessage({ tf: "res", id: e.data.id, info: info() }, "*");
  });
})();
