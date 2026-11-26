/* ===== 設定「一般」を項目別(サブタブ)に分ける =====
   manager.html の #set-gen に並んでいる項目を、中にある入力欄の id から分類して、サブタブごとにまとめ直す。
   項目の id・中身はそのまま(動かすだけ)なので、ほかのスクリプトは今までどおり動く。
   選んだサブタブは tf-set-gcat に覚える。新しい項目を足したら、下の CATS の ids に id を足す(書かないと「表示」に入る) */
(() => {
  const gen = document.getElementById("set-gen"); if (!gen) return;
  const CATS = [
    ["look", "表示・サムネ", ["set-appear", "set-date", "set-ryd", "set-tps", "set-tpv", "set-tpvol", "set-auto", "set-shwheel"]],
    ["home", "ホーム", ["set-list"]],
    ["play", "再生・検索", ["set-play", "set-cmhide", "set-relmode", "set-pubdate"]],
    ["tools", "再生画面のツール", ["set-seek", "set-step", "set-quality", "set-h264", "set-adff"]],
    ["pip", "ワイプ・PiP", ["set-mini", "set-minisize", "set-pipbtn", "set-pipauto"]],
    ["end", "動画の終わり", ["set-endmode", "set-endtf", "set-endslots"]],
    ["notify", "お知らせ", ["set-notify", "set-notify-os", "nv-last", "nvw"]],
    ["care", "休憩・就寝", ["set-break", "set-bed"]],
  ];
  const catOf = (el) => {
    if (el.classList.contains("set-h")) return "tools"; // 見出し「再生画面のツール」
    const id = el.id || el.querySelector("[id]")?.id || "";
    const c = CATS.find(([, , ids]) => ids.includes(id));
    return c ? c[0] : "look";
  };
  const groups = Object.fromEntries(CATS.map(([k]) => [k, document.createElement("div")]));
  for (const [k, g] of Object.entries(groups)) { g.className = "gcat"; g.dataset.gcat = k; g.hidden = true; }
  for (const el of [...gen.children]) groups[catOf(el)].append(el);
  const bar = document.createElement("div"); bar.className = "set-tabs gsub"; bar.setAttribute("role", "tablist");
  bar.innerHTML = CATS.map(([k, n]) => `<button type="button" class="tab" role="tab" data-gsub="${k}">${n}</button>`).join("");
  gen.append(bar, ...Object.values(groups));
  const show = (k) => {
    if (!groups[k]) k = CATS[0][0];
    for (const [x, g] of Object.entries(groups)) g.hidden = x !== k;
    bar.querySelectorAll("[data-gsub]").forEach((b) => { const on = b.dataset.gsub === k; b.classList.toggle("on", on); b.setAttribute("aria-selected", on); });
    try { localStorage.setItem("tf-set-gcat", k); } catch {}
  };
  bar.addEventListener("click", (e) => { const b = e.target.closest("[data-gsub]"); if (b) show(b.dataset.gsub); });
  let cur = "look"; try { cur = localStorage.getItem("tf-set-gcat") || cur; } catch {}
  show(cur);
})();
