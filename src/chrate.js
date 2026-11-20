(() => {
  /* ===== チャンネルごとの再生速度 =====
     フォルダ設定のチャンネル名の横で決めた速さ(保存データ data.channels[チャンネルID].rate)を、
     YouTube の再生画面で、そのチャンネルの動画を開いたときに自動でかける。
     ・動画ごとに1回だけかける(見ている途中で自分で速さを変えたら、そのまま)
     ・速さを決めていないチャンネルの動画に移ったら、TubeFolio3 がかける前の速さに戻す
     ・速さの切り替えは ytpage.js(ページ本体の側)が行う */
  const KEY = "tubefolio";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const vidNow = () => (location.pathname === "/watch" ? new URLSearchParams(location.search).get("v") : null);
  const ask = (msg, wait = 800) => new Promise((res) => {
    const id = Math.random().toString(36).slice(2), done = (v) => { removeEventListener("message", h); res(v); };
    const h = (e) => { if (e.source === window && e.data?.id === id && (e.data.tf === "res" || e.data.tf === "rateres")) done(e.data.tf === "res" ? e.data.info : e.data.r); };
    addEventListener("message", h); postMessage({ ...msg, id }, "*"); setTimeout(() => done(null), wait);
  });
  const rateOf = async (cid) => { try { return +((await chrome.storage.local.get(KEY))[KEY]?.channels?.[cid]?.rate) || 0; } catch { return 0; } };
  const skipOf = async (cid) => { try { const s = (await chrome.storage.local.get(KEY))[KEY]?.channels?.[cid]?.skip || {}; return { head: +s.head || 0, tail: +s.tail || 0 }; } catch { return { head: 0, tail: 0 }; } };

  /* ---------- チャンネル別: 冒頭の〇秒を飛ばす / 最後の〇秒で止める(data.channels[id].skip = { head, tail }) ---------- */
  let sk = { vid: "", head: 0, tail: 0, headDone: false, tailDone: false };
  setInterval(() => {
    const v = document.querySelector("#movie_player video"), p = document.getElementById("movie_player");
    if (!v || !sk.vid || sk.vid !== vidNow() || p?.classList.contains("ad-showing") || !(v.duration > 0)) return;
    if (sk.head > 0 && !sk.headDone && v.currentTime < sk.head && sk.head < v.duration - 5) { sk.headDone = true; v.currentTime = sk.head; badge(`⏭ 冒頭の${sk.head}秒を飛ばしました(チャンネルの設定)`); }
    else if (sk.head > 0 && v.currentTime >= sk.head) sk.headDone = true; // 途中から開いた・戻した、などは飛ばさない
    if (sk.tail > 0 && !sk.tailDone && v.duration > sk.tail * 2 && v.currentTime >= v.duration - sk.tail) { sk.tailDone = true; v.pause(); badge(`⏹ 最後の${sk.tail}秒で止めました(チャンネルの設定)`); }
  }, 400);

  let doneVid = "", curCh = "", base = null; // base: TubeFolio3 がかける前の速さ(かけていなければ null)
  let run = 0;
  // 速さをかける。広告中・プレーヤーの準備前は、少し待ってやり直す
  async function setRate(rate, my) {
    for (let i = 0; i < 120 && my === run; i++) {
      const r = await ask({ tf: "rate", rate });
      if (r?.ok) return r;
      await sleep(1000);
    }
    return null;
  }
  async function apply() {
    const v = vidNow(); if (!v || v === doneVid) return;
    doneVid = v; const my = ++run;
    let info = null; // 開いた動画のチャンネルID(切り替わった直後は前の動画のことがあるので、動画IDがそろうまで待つ)
    for (let i = 0; i < 40 && my === run; i++) { info = await ask({ tf: "req" }, 600); if (info?.videoId === v && info.channelId) break; info = null; await sleep(300); }
    if (!info || my !== run) return;
    curCh = info.channelId;
    sk = { vid: v, ...(await skipOf(curCh)), headDone: false, tailDone: false };
    const rate = await rateOf(curCh);
    if (rate) {
      const r = await setRate(rate, my); if (!r || my !== run) return;
      if (base == null) base = Math.abs(r.cur - rate) > 0.001 ? r.cur : 1;
      if (Math.abs(r.cur - rate) > 0.001) badge(`⏩ ${rate}x(チャンネルの設定)`);
    } else if (base != null) { // 決めていないチャンネル: かける前の速さに戻す
      const b = base; base = null;
      const r = await setRate(b, my); if (r && Math.abs(r.cur - b) > 0.001) badge(`▶ ${b}x に戻しました`);
    }
  }
  // 速さを変えたことを、プレーヤーの上に少しだけ出す
  function badge(text) {
    const p = document.getElementById("movie_player"); if (!p) return;
    let b = document.getElementById("tf-rate-badge");
    if (!b) { b = document.createElement("div"); b.id = "tf-rate-badge"; }
    p.appendChild(b); b.textContent = text; b.classList.remove("show"); void b.offsetWidth; b.classList.add("show");
    clearTimeout(badge.t); badge.t = setTimeout(() => b.classList.remove("show"), 2600);
  }

  addEventListener("yt-navigate-finish", () => setTimeout(apply, 200));
  setTimeout(apply, 800);
  // フォルダ設定で、いま見ているチャンネルの速さを変えたら、すぐにかける
  chrome.storage.onChanged.addListener(async (c) => {
    if (!c[KEY] || !curCh || !vidNow()) return;
    const o = +c[KEY].oldValue?.channels?.[curCh]?.rate || 0, n = +c[KEY].newValue?.channels?.[curCh]?.rate || 0;
    if (o === n) return;
    const my = ++run;
    if (n) { const r = await setRate(n, my); if (r) { if (base == null) base = Math.abs(r.cur - rate) > 0.001 ? r.cur : 1; badge(`⏩ ${n}x(チャンネルの設定)`); } }
    else if (base != null) { const b = base; base = null; const r = await setRate(b, my); if (r) badge(`▶ ${b}x に戻しました`); }
  });
})();
