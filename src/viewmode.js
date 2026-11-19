/* ===== 動画一覧の表示切り替え: グリッド / リスト、グリッドの列数(3〜7) =====
   「すべて表示」・ブックマーク・検索結果の動画一覧で共通に使う */
let vMode = ls.get("tf-vmode", "grid") === "list" ? "list" : "grid";
let vCols = Math.min(7, Math.max(3, +ls.get("tf-vcols", "5") || 5));

const vbar = (pre = "") => `<div class="vbar">${pre}
  <div class="vseg" role="radiogroup" aria-label="表示形式">
    <button type="button" class="${vMode === "grid" ? "on" : ""}" data-vmode="grid" role="radio" aria-checked="${vMode === "grid"}" title="グリッド表示"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/></svg>グリッド</button>
    <button type="button" class="${vMode === "list" ? "on" : ""}" data-vmode="list" role="radio" aria-checked="${vMode === "list"}" title="リスト表示"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><rect x="3" y="4" width="18" height="4" rx="1.5"/><rect x="3" y="10" width="18" height="4" rx="1.5"/><rect x="3" y="16" width="18" height="4" rx="1.5"/></svg>リスト</button>
  </div>
  <label class="vcols" ${vMode === "list" ? "hidden" : ""}>列数 <input type="range" min="3" max="7" step="1" value="${vCols}" data-vcols aria-label="横に並べる列数"><b data-vcols-n>${vCols}</b></label>
</div>`;
const vgrid = (cards) => `<div class="grid vg ${vMode === "list" ? "vl" : ""}" style="--cols:${vCols}">${cards}</div>`;

document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-vmode]"); if (!b) return;
  vMode = b.dataset.vmode; ls.set("tf-vmode", vMode); render();
});
function setCols(n) {
  n = Math.min(7, Math.max(3, Math.round(n))); if (n === vCols) return;
  vCols = n; ls.set("tf-vcols", String(vCols));
  document.querySelectorAll(".vg").forEach((g) => g.style.setProperty("--cols", vCols));
  document.querySelectorAll("[data-vcols]").forEach((r) => { if (+r.value !== vCols) r.value = vCols; });
  document.querySelectorAll("[data-vcols-n]").forEach((x) => { x.textContent = vCols; });
}
document.addEventListener("input", (e) => { if (e.target.matches("[data-vcols]")) setCols(+e.target.value); });
// マウスのホイール: 「列数」の上で回すと 1列ずつ変える(上へ回すと増える)。その間、ページはスクロールしない
let vWheelAt = 0;
document.addEventListener("wheel", (e) => {
  const box = e.target.closest?.(".vcols"); if (!box || box.hidden) return;
  e.preventDefault();
  const d = e.deltaY || e.deltaX; if (!d) return;
  const now = performance.now(); if (now - vWheelAt < 120) return; // タッチパッドなどで一度に何回も届くのを、1列ずつにする
  vWheelAt = now; setCols(vCols + (d < 0 ? 1 : -1));
}, { passive: false });
// タッチ・ペン: 指の位置から列数を決める(ブラウザの標準のスライダーは、タッチだとページのスクロールと取り違えて動かないことがある)
// マウスは標準のスライダーのまま。CSS の touch-action:none と組み合わせる
document.addEventListener("pointerdown", (e) => {
  const r = e.target.closest?.("[data-vcols]"); if (!r || e.pointerType === "mouse") return;
  e.preventDefault();
  try { r.setPointerCapture(e.pointerId); } catch {}
  const at = (ev) => { const b = r.getBoundingClientRect(); setCols(+r.min + Math.min(1, Math.max(0, (ev.clientX - b.left) / b.width)) * (+r.max - +r.min)); };
  at(e);
  const end = () => { r.removeEventListener("pointermove", at); r.removeEventListener("pointerup", end); r.removeEventListener("pointercancel", end); };
  r.addEventListener("pointermove", at); r.addEventListener("pointerup", end); r.addEventListener("pointercancel", end);
});
