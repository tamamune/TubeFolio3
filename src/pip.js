(() => {
  /* ===== ピクチャインピクチャ(PiP: 動画を小さな別窓で、常に手前に出す) =====
     ・YouTube の再生画面の操作バー(右側)に「PiP」ボタンを付ける。押すと別窓に出す/戻す
     ・別のタブに移ったら、自動で PiP にする(設定でオン/オフ)
       ブラウザの決まりで、ページを操作していないと自動では出せないことがある。そのため2つの方法で試す:
       ① ページ本体(ytpage.js)で、ブラウザの「自動 PiP」(Media Session の enterpictureinpicture)を受け付ける
       ② タブが隠れたときに、こちらから PiP を頼む(だめなら何もしない)
       タブに戻ったら、自動で出した PiP は閉じる
     ・設定(chrome.storage): tf-pip-btn = ボタンを出すか(既定: 出す)、tf-pip-auto = 自動 PiP(既定: 使わない) */
  let btnOn = true, autoOn = false, autoEntered = false;
  const isWatch = () => location.pathname === "/watch";
  const video = () => document.querySelector("ytd-watch-flexy #movie_player video") || document.querySelector("#movie_player video");
  const supported = () => !!document.pictureInPictureEnabled;

  async function enter(v = video()) {
    if (!v || !supported() || document.pictureInPictureElement === v) return false;
    try { v.disablePictureInPicture = false; await v.requestPictureInPicture(); return true; } catch { return false; }
  }
  async function leave() { try { if (document.pictureInPictureElement) await document.exitPictureInPicture(); } catch {} }

  /* ---------- 操作バーの「PiP」ボタン ---------- */
  const ICO = `<svg viewBox="0 0 36 36" width="100%" height="100%"><path fill="#fff" d="M25 17h-8v6h8v-6zm4 8V11c0-1.1-.9-2-2-2H9c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H9V10.98h18v14.04z"/></svg>`;
  function ensureBtn() {
    const old = document.querySelector(".tf-pip-btn");
    if (!btnOn || !supported() || !isWatch()) { old?.remove(); return; }
    const bar = document.querySelector("#movie_player .ytp-right-controls"); if (!bar || old?.isConnected && bar.contains(old)) return;
    old?.remove();
    const b = document.createElement("button");
    b.className = "ytp-button tf-pip-btn"; b.type = "button";
    b.title = "ピクチャインピクチャ(小さな別窓で再生)"; b.setAttribute("aria-label", b.title);
    b.innerHTML = ICO;
    b.addEventListener("click", (e) => { e.stopPropagation(); document.pictureInPictureElement ? leave() : enter(); });
    bar.insertBefore(b, bar.firstChild);
  }

  /* ---------- 別のタブに移ったら自動で PiP ---------- */
  const tellPage = () => postMessage({ tf: "pipauto", on: autoOn && isWatch() }, "*"); // ① ytpage.js
  document.addEventListener("visibilitychange", async () => {
    if (!autoOn || !isWatch()) return;
    const v = video();
    if (document.hidden) { // ② 再生中だけ
      if (v && !v.paused && !v.ended && !document.pictureInPictureElement) autoEntered = await enter(v);
    } else if (autoEntered || document.pictureInPictureElement) { autoEntered = false; leave(); } // 戻ってきたら、自動で出した分は閉じる
  });
  // ブラウザの自動 PiP(①)で出たときも、戻ってきたら閉じられるように覚える
  document.addEventListener("enterpictureinpicture", () => { if (document.hidden && autoOn) autoEntered = true; }, true);

  /* ---------- 設定と、画面の切り替え ---------- */
  const apply = (r) => {
    if (r["tf-pip-btn"] !== undefined) btnOn = r["tf-pip-btn"] !== "off";
    if (r["tf-pip-auto"] !== undefined) autoOn = r["tf-pip-auto"] === "on";
    ensureBtn(); tellPage();
  };
  chrome.storage.local.get(["tf-pip-btn", "tf-pip-auto"]).then(apply);
  chrome.storage.onChanged.addListener((c) => { const r = {}; for (const k of ["tf-pip-btn", "tf-pip-auto"]) if (c[k]) r[k] = c[k].newValue ?? (k === "tf-pip-btn" ? "on" : "off"); if (Object.keys(r).length) apply(r); });
  addEventListener("yt-navigate-finish", () => { ensureBtn(); tellPage(); });
  setInterval(ensureBtn, 2000); // YouTube が操作バーを作り直したときにも付け直す(軽い確認だけ)
})();
