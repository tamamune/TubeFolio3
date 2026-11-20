/* ===== 動画一覧の表示切り替え: グリッド / リスト、グリッドの列数(3〜7) =====
   「すべて表示」・ブックマーク・検索結果の動画一覧で共通に使う */
let vMode = ls.get("tf-vmode", "grid") === "list" ? "list" : "grid";
let vCols = Math.min(7, Math.max(3, +ls.get("tf-vcols", "5") || 5));

const vbar = (pre = "") => `<div class="vbar">${pre}
  <div class="vseg grp" role="radiogroup" aria-label="表示形式">
    <button type="button" class="${vMode === "grid" ? "on" : ""}" data-vmode="grid" role="radio" aria-checked="${vMode === "grid"}" title="グリッド表示"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/></svg>グリッド</button>
    <button type="button" class="${vMode === "list" ? "on" : ""}" data-vmode="list" role="radio" aria-checked="${vMode === "list"}" title="リスト表示"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><rect x="3" y="4" width="18" height="4" rx="1.5"/><rect x="3" y="10" width="18" height="4" rx="1.5"/><rect x="3" y="16" width="18" height="4" rx="1.5"/></svg>リスト</button>
  </div>
  <label class="vcols grp" ${vMode === "list" ? "hidden" : ""} title="横に並べる列数(マウスのホイールでも変えられます)"><span class="s-cl">列数</span><select class="wsel" data-vcols aria-label="横に並べる列数">${[3, 4, 5, 6, 7].map((n) => `<option value="${n}" ${n === vCols ? "selected" : ""}>${n}列</option>`).join("")}</select></label>
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
}
document.addEventListener("input", (e) => { if (e.target.matches("[data-vcols]")) setCols(+e.target.value); });
// 選ぶリスト(select.wsel)の上でマウスのホイールを回すと、1つずつ変える(上へ回すと大きく)。その間、ページはスクロールしない
// 列数・検索のランダムの個数などで共通に使う。変えたら change と input を送る(選んだのと同じ扱い)
let vWheelAt = 0;
document.addEventListener("wheel", (e) => {
  const sel = e.target.closest?.("select.wsel") || e.target.closest?.(".vcols:not([hidden])")?.querySelector("select.wsel");
  if (!sel || sel.disabled) return;
  e.preventDefault();
  const d = e.deltaY || e.deltaX; if (!d) return;
  const now = performance.now(); if (now - vWheelAt < 120) return; // タッチパッドなどで一度に何回も届くのを、1つずつにする
  vWheelAt = now;
  const i = Math.min(sel.options.length - 1, Math.max(0, sel.selectedIndex + (d < 0 ? 1 : -1)));
  if (i === sel.selectedIndex) return;
  sel.selectedIndex = i;
  sel.dispatchEvent(new Event("input", { bubbles: true })); sel.dispatchEvent(new Event("change", { bubbles: true }));
}, { passive: false });
