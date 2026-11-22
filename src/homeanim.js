/* ===== ホームのアニメーション =====
   ・行(.row)は、画面に入ったときに下からふわっと現れ、中のカードが順に並ぶ
   ・一度出た行は、描き直されても(何度も render される)もう動かさない(ちらつき防止)
   ・動きを減らす設定(prefers-reduced-motion)のときは何もしない */
(() => {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
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
  new MutationObserver(() => { if (!t) t = requestAnimationFrame(() => { t = 0; prep(); }); }).observe(main, { childList: true });
  prep();
})();
