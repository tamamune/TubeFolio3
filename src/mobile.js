(() => {
  /* ===== m.youtube.com(スマホ版 YouTube)用の、画面下のツールバー =====
     ・縦長の画面(折りたたみ端末のサブ画面など)ではサイドバーが出ないので、下に並べる
     ・左: TubeFolio3 を開く / 動画のページでは ◀| ⟲ ⟳ |▶(1コマ戻る・〇秒戻る・〇秒進む・1コマ進む)・A-B リピート・速さ
     ・〇秒は設定「一般」(tf-seek)と同じ。色は tf-accent(content の色設定)に合わせる */
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const isWatch = () => location.pathname === "/watch";
  const video = () => [...document.querySelectorAll("video")].sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0] || null;
  let seekSec = 10, ab = { a: null, b: null }, rate = 1;
  chrome.storage.local.get("tf-seek").then((r) => { const n = +r["tf-seek"]; if (n > 0) seekSec = n; paint(); });
  chrome.storage.onChanged.addListener((c) => { if (c["tf-seek"]) { const n = +c["tf-seek"].newValue; seekSec = n > 0 ? n : 10; paint(); } });

  const paintAcc = (a) => document.documentElement.setAttribute("data-tf-acc", /^[a-z]{2,12}$/.test(a || "") ? a : "amber");
  chrome.storage.local.get("tf-accent").then((r) => paintAcc(r["tf-accent"]));
  chrome.storage.onChanged.addListener((c) => { if (c["tf-accent"]) paintAcc(c["tf-accent"].newValue); });

  const bar = el("div", "tfm-bar"); bar.hidden = true;
  const btn = (html, title, f, cls) => { const b = el("button", "tfm-b" + (cls ? " " + cls : "")); b.type = "button"; b.innerHTML = html; b.title = title; b.setAttribute("aria-label", title); b.onclick = (e) => { e.stopPropagation(); f(b); }; return b; };
  const seek = (d) => () => { const v = video(); if (v) v.currentTime = Math.max(0, Math.min((v.duration || 1e9) - 0.2, v.currentTime + d)); };
  const step = (d) => () => { const v = video(); if (!v) return; v.pause(); v.currentTime = Math.max(0, v.currentTime + d / 30); };
  const tri = (back) => `<svg viewBox="3 3 18 18" width="22" height="22" fill="currentColor"${back ? ' style="transform:scaleX(-1)"' : ""}><path d="M7 6.5v11l8-5.5z"/><rect x="16" y="6.5" width="2.2" height="11" rx=".6"/></svg>`;
  const sec = (back, n) => `<svg viewBox="1.5 1.5 21 21" width="26" height="26"><g${back ? "" : ' transform="matrix(-1 0 0 1 24 0)"'}><path d="M12 4.2A7.8 7.8 0 1 1 4.2 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M12 1.6 8.2 4.4 12 7.2z" fill="currentColor"/></g><text x="12" y="15.2" text-anchor="middle" font-size="7.6" font-weight="700" fill="currentColor">${n}</text></svg>`;

  const home = btn(`<img src="${chrome.runtime.getURL("icons/icon-32.png")}" width="22" height="22" alt=""><span>TubeFolio3</span>`, "TubeFolio3 を開く", () => chrome.runtime.sendMessage("tf-open-manager"), "tfm-home");
  const tools = el("span", "tfm-tools");
  let abBtn, rateBtn;
  function paint() {
    tools.textContent = "";
    abBtn = btn("A-B", "A-B 区間リピート(1回目で A、2回目で B、3回目で解除)", () => {
      const v = video(); if (!v) return;
      if (ab.a == null) ab.a = v.currentTime; else if (ab.b == null) { ab.b = v.currentTime; if (ab.b <= ab.a) [ab.a, ab.b] = [ab.b, ab.a]; v.currentTime = ab.a; } else ab = { a: null, b: null };
      abLabel();
    }, "tfm-t");
    rateBtn = btn("", "再生の速さ(押すたびに切り替え)", () => {
      const L = [1, 1.25, 1.5, 2, 0.75, 0.5]; const v = video(); rate = L[(L.indexOf(rate) + 1) % L.length] ?? 1; if (v) v.playbackRate = rate; rateBtn.textContent = rate + "x";
    }, "tfm-t");
    rateBtn.textContent = rate + "x";
    tools.append(btn(tri(true), "1コマ戻る(一時停止します)", step(-1)), btn(sec(true, seekSec), `${seekSec}秒戻る`, seek(-seekSec)), btn(sec(false, seekSec), `${seekSec}秒進む`, seek(seekSec)), btn(tri(false), "1コマ進む(一時停止します)", step(1)), abBtn, rateBtn);
    abLabel();
  }
  function abLabel() { if (!abBtn) return; abBtn.textContent = ab.a == null ? "A-B" : ab.b == null ? "A→?" : "A⇄B"; abBtn.classList.toggle("on", ab.a != null); }
  bar.append(tools, home); // TubeFolio3 のボタンは右端

  // YouTube の下のメニュー(ホーム・ショート・登録チャンネル・マイページ)の右端(マイページの横)に、TubeFolio3 のアイコンを足す。押すと TubeFolio3 を開く
  function tfIcon() {
    const pivot = document.querySelector("ytm-pivot-bar-renderer"); if (!pivot) return;
    pivot.querySelector(".tfm-music")?.remove(); // 前の版で足した「ミュージック」が残っていたら消す
    const items = [...pivot.children].filter((x) => !x.classList.contains("tfm-tf"));
    const after = items[items.length - 1]; // 右端 = マイページ
    if (!after) return;
    let m = pivot.querySelector(".tfm-tf");
    if (m && m.previousElementSibling === after) return;
    if (!m) {
      m = after.cloneNode(true); m.classList.add("tfm-tf");
      m.removeAttribute("aria-selected"); m.querySelectorAll("[aria-selected]").forEach((x) => x.removeAttribute("aria-selected"));
      const txt = [...m.querySelectorAll("*")].reverse().find((x) => !x.children.length && x.textContent.trim());
      const icons = [...m.querySelectorAll("img,svg,yt-img-shadow,ytm-profile-icon,[class*=icon],[class*=avatar],[class*=profile]")].filter((x) => !(txt && (x.contains(txt) || txt.contains(x))));
      const first = icons[0]; icons.slice(1).forEach((x) => { if (!first.contains(x)) x.remove(); });
      const img = `<img src="${chrome.runtime.getURL("icons/icon-32.png")}" width="24" height="24" alt="" style="display:block;margin:0 auto;border-radius:6px">`;
      if (first) first.replaceWith(Object.assign(document.createElement("span"), { innerHTML: img, className: "tfm-tf-ic" })); else m.insertAdjacentHTML("afterbegin", img);
      if (txt) txt.textContent = "TubeFolio3";
      m.querySelectorAll("a").forEach((a) => a.removeAttribute("href"));
      m.addEventListener("click", (e) => { e.preventDefault(); e.stopImmediatePropagation(); chrome.runtime.sendMessage("tf-open-manager"); }, true);
    }
    after.after(m);
  }

  // A-B リピート: B を過ぎたら A に戻す
  setInterval(() => { const v = video(); if (v && ab.a != null && ab.b != null && v.currentTime >= ab.b) v.currentTime = ab.a; }, 150);

  // YouTube 自身の下のメニュー(ホーム・ショート・登録チャンネルなど)があるときは、その上に重ねる
  function place() {
    const pivot = document.querySelector("ytm-pivot-bar-renderer");
    const h = pivot && pivot.getBoundingClientRect().height > 0 ? pivot.getBoundingClientRect().height : 0;
    tfIcon();
    document.documentElement.style.setProperty("--tfm-pivot", h + "px");
    const watch = isWatch(); tools.hidden = !watch;
    bar.hidden = !watch; document.documentElement.classList.toggle("tfm-on", watch); // バーは動画の再生ページだけ(ホームなどでは出さない)
    if (watch && video() && video().playbackRate !== rate && rate !== 1 && !video().paused) video().playbackRate = rate;
  }
  const mount = () => { if (!bar.isConnected) document.body.append(bar); place(); };
  new MutationObserver(() => { clearTimeout(mount.t); mount.t = setTimeout(mount, 300); }).observe(document.documentElement, { childList: true, subtree: true });
  addEventListener("yt-navigate-finish", () => { ab = { a: null, b: null }; abLabel(); mount(); });
  addEventListener("resize", place);
  paint(); mount();
})();
