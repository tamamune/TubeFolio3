/* ===== ホームのアニメーション =====
   ・行(.row)は、画面に入ったときに下からふわっと現れ、中のカードが順に並ぶ
   ・一度出た行は、描き直されても(何度も render される)もう動かさない(ちらつき防止)
   ・動きを減らす設定(prefers-reduced-motion)のときは何もしない */
(() => {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  // サイドバー: 最初に項目が入ったときだけ順に出す(描き直しのたびには動かさない)
  const nl = document.getElementById("nav-list");
  if (nl) {
    const nmo = new MutationObserver(() => {
      if (!nl.children.length) return;
      nmo.disconnect();
      [...nl.children].forEach((c, i) => { c.style.setProperty("--ni", Math.min(i, 14)); c.classList.add("ni-in"); });
    });
    nmo.observe(nl, { childList: true });
  }
  // サムネ: 初めて読み込めた画像だけ、ぼかしからくっきり表示。一度読めた画像は、描き直しでも最初から表示(ちらつき防止)
  const loaded = new Set();
  const ld = (im) => { if (im.tagName === "IMG" && im.closest(".th")) { loaded.add(im.currentSrc || im.src); im.classList.add("ld"); } };
  document.addEventListener("load", (e) => ld(e.target), true);
  const main = document.getElementById("main"); if (!main) return;
  const seen = new Set();
  const key = (r) => (r.querySelector("h2")?.textContent || "").replace(/\d+/g, "").trim();
  const io = new IntersectionObserver((es) => {
    for (const e of es) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
  }, { threshold: 0.08 });
  const prep = () => {
    for (const r of main.querySelectorAll(".row:not([data-an])")) {
      r.dataset.an = "1";
      const k = key(r);
      r.querySelectorAll(".track .c").forEach((c, i) => c.style.setProperty("--i", Math.min(i, 12)));
      if (seen.has(k)) continue; // 前に出た行は、そのまま表示
      seen.add(k);
      r.classList.add("rv");
      io.observe(r);
    }
  };
  let t = 0;
  new MutationObserver((ms) => {
    for (const m of ms) for (const n of m.addedNodes) if (n.querySelectorAll) n.querySelectorAll(".th img").forEach((i) => { if (loaded.has(i.src)) i.classList.add("ld", "nf"); });
    if (!t) t = requestAnimationFrame(() => { t = 0; prep(); }); }).observe(main, { childList: true, subtree: true });
  prep();
  main.querySelectorAll(".th img").forEach((i) => i.complete && ld(i));
})();
