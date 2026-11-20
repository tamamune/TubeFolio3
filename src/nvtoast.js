(() => {
  /* ===== 新着のお知らせ(YouTube の画面の右下。TubeFolio2 と同じ) =====
     background.js の nvDeliver から { tf: "nv-toast", items } が届いたら、サムネ+タイトルのカードを右下に出す。
     ・押すとその動画を開く。✕で閉じる。配信中は自分で閉じるまで、ほかは 12秒で消える(マウスを乗せている間は消えない)
     ・一度に出すのは 6件まで。それより多いときは「ほか 〇本」を出す */
  const KIND = { live: "🔴 配信中", kw: "⚡ LIVE・緊急", new: "🔔 新着", test: "🔔 テスト" };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  function show(items) {
    let box = document.getElementById("tf-nvt");
    if (!box) { box = el("div"); box.id = "tf-nvt"; document.body.append(box); }
    items.slice(0, 6).forEach((it, i) => setTimeout(() => {
      const t = el("div", "tf-nvt " + (it.kind || "new"));
      const img = el("img"); img.alt = ""; if (it.id) img.src = `https://i.ytimg.com/vi/${encodeURIComponent(it.id)}/mqdefault.jpg`;
      const body = el("div", "tf-nvt-b");
      body.append(el("div", "tf-nvt-k", KIND[it.kind] || KIND.new), el("div", "tf-nvt-t", it.title || ""), el("div", "tf-nvt-c", it.ch || ""));
      const x = el("button", "tf-nvt-x", "✕"); x.type = "button"; x.title = "閉じる";
      t.append(img, body, x);
      const close = () => { t.classList.remove("in"); setTimeout(() => t.remove(), 350); };
      x.onclick = (e) => { e.stopPropagation(); close(); };
      t.onclick = () => { close(); if (it.url) location.assign(it.url); else if (it.id) location.assign("/watch?v=" + encodeURIComponent(it.id)); };
      box.append(t);
      requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add("in")));
      if (it.kind !== "live") { let tm = setTimeout(close, 12000); t.onmouseenter = () => clearTimeout(tm); t.onmouseleave = () => { tm = setTimeout(close, 4000); }; }
    }, i * 250));
    if (items.length > 6) setTimeout(() => show([{ title: `ほか ${items.length - 6}本の新着があります`, ch: "", kind: "new", url: "/feed/subscriptions" }]), 1700);
  }
  chrome.runtime.onMessage.addListener((m, s, reply) => { if (m?.tf === "nv-toast") { show(m.items || []); reply({ ok: true }); } });
})();
