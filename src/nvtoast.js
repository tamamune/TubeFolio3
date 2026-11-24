(() => {
  /* ===== 新着のお知らせ(YouTube の画面の右下。TubeFolio2 と同じ) =====
     background.js の nvDeliver から { tf: "nv-toast", items } が届いたら、サムネ+タイトルのカードを右下に出す。
     ・押すとその動画を開く。✕で閉じる。配信中は自分で閉じるまで、ほかは 12秒で消える(マウスを乗せている間は消えない)
     ・一度に出すのは 6件まで。それより多いときは「ほか 〇本」を出す */
  const KIND = { live: "🔴 配信中", kw: "⚡ LIVE・緊急", new: "🔔 新着", test: "🔔 テスト" };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const yta = (op, ...args) => new Promise((res, rej) => chrome.runtime.sendMessage({ tf: "yta", op, args }, (r) => (chrome.runtime.lastError ? rej(new Error(chrome.runtime.lastError.message)) : r?.ok ? res(r.r) : rej(new Error(r?.error || "失敗しました")))));
  // 追加先: ホームの設定で選んだ再生リスト(tf-wl-pl)→「TubeFolio3 後で見る」→「TubeFolio2 後で見る」→ 名前に「後で見る」が付くもの
  async function addLater(vid) {
    const list = await yta("ownPlaylists", vid), want = (await chrome.storage.local.get("tf-wl-pl"))["tf-wl-pl"];
    const p = list.find((x) => x.id === want) || list.find((x) => /TubeFolio3/i.test(x.title) && /後で見る/.test(x.title)) || list.find((x) => /TubeFolio2/i.test(x.title) && /後で見る/.test(x.title)) || list.find((x) => /後で見る/.test(x.title));
    if (!p) throw new Error("「後で見る」の再生リストがありません");
    if (!p.has) await yta("addVideo", p.id, vid);
    return p.title;
  }
  function show(items) {
    let box = document.getElementById("tf-nvt");
    if (!box) { box = el("div"); box.id = "tf-nvt"; document.body.append(box); }
    items.slice(0, 6).forEach((it, i) => setTimeout(() => {
      const t = el("div", "tf-nvt " + (it.kind || "new"));
      const img = el("img"); img.alt = ""; if (it.id) img.src = `https://i.ytimg.com/vi/${encodeURIComponent(it.id)}/mqdefault.jpg`;
      const body = el("div", "tf-nvt-b");
      const row = el("div", "tf-nvt-r"); row.append(el("div", "tf-nvt-k", KIND[it.kind] || KIND.new)); // 1行目: 種類 + (右端)後で見る
      body.append(row, el("div", "tf-nvt-t", it.title || ""), el("div", "tf-nvt-c", it.ch || ""));
      const x = el("button", "tf-nvt-x", "✕"); x.type = "button"; x.title = "閉じる";
      const close = () => { t.classList.remove("in"); setTimeout(() => t.remove(), 350); };
      if (it.id) { // 「後で見る」: 再生リストに追加して、押した動画は開かない
        const lb = el("button", "tf-nvt-l", "🕒 後で見る"); lb.type = "button"; lb.title = "後で見る再生リストに追加";
        lb.onclick = async (e) => {
          e.stopPropagation(); if (lb.disabled) return; lb.disabled = true; lb.textContent = "追加中…";
          try { lb.textContent = it.kind === "test" ? "✓ 追加済み(テスト表示)" : "✓ 追加済み"; if (it.kind !== "test") lb.title = "「" + await addLater(it.id) + "」に追加しました"; lb.classList.add("ok"); setTimeout(close, 1800); }
          catch (err) { lb.disabled = false; lb.textContent = "🕒 後で見る"; lb.title = "追加できませんでした: " + (err.message || err); lb.classList.add("ng"); }
        };
        row.append(lb);
      }
      t.append(img, body, x);
      x.onclick = (e) => { e.stopPropagation(); close(); };
      t.onclick = () => {
        close();
        const path = it.url || (it.id ? "/watch?v=" + encodeURIComponent(it.id) : "");
        if (!path) return;
        if (location.protocol === "chrome-extension:") chrome.tabs.create({ url: path.startsWith("http") ? path : "https://www.youtube.com" + path }); // TubeFolio3 の画面では、新しいタブで開く
        else location.assign(path);
      };
      box.append(t);
      requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add("in")));
      if (it.kind !== "live") { let tm = setTimeout(close, 12000); t.onmouseenter = () => clearTimeout(tm); t.onmouseleave = () => { tm = setTimeout(close, 4000); }; }
    }, i * 250));
    if (items.length > 6) setTimeout(() => show([{ title: `ほか ${items.length - 6}本の新着があります`, ch: "", kind: "new", url: "/feed/subscriptions" }]), 1700);
  }
  chrome.runtime.onMessage.addListener((m, s, reply) => { if (m?.tf === "nv-toast") { show(m.items || []); reply({ ok: true }); } });
})();
