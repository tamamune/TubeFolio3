/* ===== ページの一番上へ戻るボタン(右下) =====
   下へスクロールしたときだけ出し、一番上では隠す。押すとなめらかに先頭へ戻る */
(() => {
  const b = document.createElement("button");
  b.type = "button"; b.id = "totop"; b.hidden = true; b.title = "ページの一番上へ"; b.setAttribute("aria-label", "ページの一番上へ");
  b.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 14 6-6 6 6"/><path d="M6 6h12"/></svg>`;
  b.onclick = () => scrollTo({ top: 0, behavior: "smooth" });
  document.body.append(b);
  let t = 0;
  const upd = () => { t = 0; const on = (scrollY || document.documentElement.scrollTop || 0) > 400; if (b.hidden === on) b.hidden = !on; };
  addEventListener("scroll", () => { if (!t) t = requestAnimationFrame(upd); }, { passive: true });
  addEventListener("resize", upd); upd();
})();
