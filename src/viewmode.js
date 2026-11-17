/* ===== 動画一覧の表示切り替え: グリッド / リスト、グリッドの列数(3〜7) =====
   「すべて表示」・ブックマーク・検索結果の動画一覧で共通に使う */
let vMode = ls.get("tf-vmode", "grid") === "list" ? "list" : "grid";
let vCols = Math.min(7, Math.max(3, +ls.get("tf-vcols", "5") || 5));

const vbar = () => `<div class="vbar">
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
document.addEventListener("input", (e) => {
  if (!e.target.matches("[data-vcols]")) return;
  vCols = +e.target.value; ls.set("tf-vcols", String(vCols));
  document.querySelectorAll(".vg").forEach((g) => g.style.setProperty("--cols", vCols));
  document.querySelectorAll("[data-vcols-n]").forEach((n) => { n.textContent = vCols; });
});
