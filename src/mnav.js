/* ===== スマホなど狭い画面(幅820px以下)の、画面下のツールバー =====
   サイドバーが隠れていて、上のバーもないので、ここから操作する: メニュー(サイドバーを開く)・ホーム・検索・ブックマーク・ミュージック・設定
   名前は mn で始める(manager の各 JS はグローバルを共有している) */
(() => {
  const ic = (d) => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const items = [
    ["menu", "メニュー", ic('<path d="M4 6h16M4 12h16M4 18h16"/>')],
    ["all", "ホーム", ic('<path d="M3 11l9-8 9 8v10h-6v-6H9v6H3z"/>')],
    ["search", "検索", ic('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>')],
    ["bookmarks", "ブックマーク", ic('<path d="M6 3h12v18l-6-4-6 4z"/>')],
    ["music", "ミュージック", ic('<path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>')],
    ["settings", "設定", ic('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>')],
  ];
  const bar = document.createElement("nav");
  bar.id = "mnav"; bar.setAttribute("aria-label", "ツールバー");
  bar.innerHTML = items.map(([k, n, svg]) => `<button type="button" data-mn="${k}" aria-label="${n}">${svg}<span>${n}</span></button>`).join("");
  document.body.append(bar);
  bar.addEventListener("click", (e) => {
    const b = e.target.closest("[data-mn]"); if (!b) return;
    const k = b.dataset.mn;
    if (k !== "music" && typeof muOpenSheet === "function") muOpenSheet(false); // ミュージックのプレーヤーを開いていたら、閉じる(再生は続く)
    if (k === "menu") return $("menu").click();
    if (k === "settings") { document.body.classList.remove("nav-on"); return openSettings(); }
    document.body.classList.remove("nav-on");
    showSettings(false);
    if (k === "music" && typeof muWantOpen !== "undefined") muWantOpen = true;
    tab = k; scrollTo(0, 0); render(); mark();
  });
  function mark() {
    const cur = !$("set").hidden ? "settings" : tab === "all" || tab.startsWith("list:") ? "all" : tab;
    bar.querySelectorAll("[data-mn]").forEach((x) => x.classList.toggle("on", x.dataset.mn === cur));
  }
  setInterval(mark, 400); mark();
})();
