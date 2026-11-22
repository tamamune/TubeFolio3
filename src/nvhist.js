/* ===== サイドバー「すべて」のベル: 通知の履歴 + 新着が増えたときの「鳴る」アニメーション =====
   履歴は background.js の nvDeliver が chrome.storage.local の tf-nv-hist(新しい順・100件まで)に書く。
   ・ベルを押すと履歴の一覧が開く(動画を押すと新しいタブで開く / 「すべて既読」「履歴を消す」)
   ・ベルの赤い数は、最後に履歴を開いてから増えた通知の数(tf-nv-readat。このパソコンだけ)
   ・新着が増えたら、ベルが揺れる */
(() => {
  const HK = "tf-nv-hist", RK = "tf-nv-readat";
  const KIND = { live: "🔴 配信中", kw: "⚡ LIVE・緊急", new: "🔔 新着", test: "🔔 テスト" };
  let hist = [], ringUntil = 0, panel = null;
  const readAt = () => +(localStorage.getItem(RK) || 0);
  const unread = () => hist.filter((x) => x.t > readAt()).length;
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const ago = (t) => { const m = Math.max(0, Math.floor((Date.now() - t) / 60000)); return m < 1 ? "たった今" : m < 60 ? `${m}分前` : m < 1440 ? `${Math.floor(m / 60)}時間前` : `${Math.floor(m / 1440)}日前`; };
  const bellSvg = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>`;
  // サイドバー(home.js の renderNav)から呼ばれる。「すべて」の名前と件数の間に入る
  window.nvBellHtml = () => { const n = unread(); return `<span class="nvbell ${n ? "has" : ""} ${Date.now() < ringUntil ? "ring" : ""}" data-nvbell role="button" tabindex="0" title="通知の履歴" aria-label="通知の履歴${n ? `(未読 ${n}件)` : ""}">${bellSvg}${n ? `<b>${n > 99 ? "99+" : n}</b>` : ""}</span>`; };
  const repaintBell = () => { if (typeof renderNav === "function") renderNav(); if (panel) paintPanel(); };
  const ring = () => {
    ringUntil = Date.now() + 1600;
    document.querySelectorAll(".nvbell").forEach((b) => { b.classList.remove("ring"); void b.offsetWidth; b.classList.add("ring"); });
    setTimeout(() => document.querySelectorAll(".nvbell").forEach((b) => b.classList.remove("ring")), 1700);
  };
  const load = async (animate) => {
    const r = await chrome.storage.local.get(HK), now = Array.isArray(r[HK]) ? r[HK] : [];
    const grew = animate && now.length && (!hist.length || now[0].t > hist[0].t);
    hist = now; repaintBell(); if (grew) ring();
  };
  chrome.storage.onChanged.addListener((c) => { if (c[HK]) load(true); });
  load(false);

  function paintPanel() {
    if (!panel) return;
    panel.innerHTML = `<div class="nvp-h"><b>通知の履歴</b><span><button type="button" data-nvp="read">すべて既読</button><button type="button" data-nvp="clear">履歴を消す</button></span></div>`
      + (hist.length ? `<div class="nvp-l">${hist.map((x, i) => `<button type="button" class="nvp-i ${x.t > seenAt ? "new" : ""} ${esc(x.kind)}" data-nvi="${i}">${x.id ? `<img alt="" src="https://i.ytimg.com/vi/${encodeURIComponent(x.id)}/mqdefault.jpg">` : "<i></i>"}<span class="nvp-b"><small>${KIND[x.kind] || KIND.new} ・ ${ago(x.t)}</small><b>${esc(x.title)}</b><em>${esc(x.ch)}</em></span></button>`).join("")}</div>` : `<p class="nvp-e">通知の履歴はまだありません</p>`);
  }
  let seenAt = 0; // 開く前の「既読の時刻」。開いている間は、これより新しいものに「新しい」印を付ける
  function open(anchor) {
    close(); seenAt = readAt(); panel = document.createElement("div"); panel.className = "nvp"; panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "通知の履歴");
    document.body.append(panel); paintPanel();
    const r = anchor.getBoundingClientRect(), pw = Math.min(380, innerWidth - 16);
    panel.style.width = pw + "px"; panel.style.left = Math.max(8, Math.min(r.left, innerWidth - pw - 8)) + "px";
    panel.style.top = Math.min(r.bottom + 6, innerHeight - 160) + "px"; panel.style.maxHeight = Math.max(200, innerHeight - r.bottom - 20) + "px";
    ls.set(RK, String(Date.now())); // 開いたら既読にする(ベルの赤い数は閉じたときに消える)
  }
  function close() { if (!panel) return; panel.remove(); panel = null; repaintBell(); }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-nvbell]");
    if (b) { e.stopPropagation(); e.preventDefault(); panel ? close() : open(b); return; } // 「すべて」を開く動きは止める
    if (!panel) return;
    const it = e.target.closest("[data-nvi]"), a = e.target.closest("[data-nvp]");
    if (it) { const x = hist[+it.dataset.nvi]; const u = x?.url || (x?.id ? "/watch?v=" + encodeURIComponent(x.id) : ""); if (u) chrome.tabs.create({ url: u.startsWith("http") ? u : "https://www.youtube.com" + u }); return; }
    if (a) { if (a.dataset.nvp === "clear") { hist = []; ls.set("tf-nv-clearat", String(Date.now())); chrome.storage.local.set({ [HK]: [] }); } else { ls.set(RK, String(Date.now())); seenAt = Date.now(); } paintPanel(); return; }
    if (!e.target.closest(".nvp")) close();
  }, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && panel) close(); else if ((e.key === "Enter" || e.key === " ") && e.target.matches?.("[data-nvbell]")) { e.preventDefault(); e.target.click(); } });
  addEventListener("resize", close);
})();
