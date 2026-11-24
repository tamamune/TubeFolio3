/* ===== チャンネルの行の最後のボタン: 動画のサムネイルの一覧を開く =====
   チャンネルの「動画」「ライブ」「ショート」を、サムネイルの一覧(ダイアログ)で見る。「もっと見る」で続きを読む。
   サムネイルを押すと、ほかの動画と同じ方法で再生する(openV)。ytPage / ytMore は search.js、vmap は home.js */
const ICO_GRID = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/></svg>`;
const thBtn = (c) => c.dummy ? "" : `<button type="button" class="chr-i" data-chthumbs="${esc(c.id)}" title="サムネイルの一覧を開く" aria-label="サムネイルの一覧">${ICO_GRID}</button>`;
const CHT_TABS = [["videos", "動画"], ["streams", "ライブ配信"], ["shorts", "ショート"]];
const cht = { id: "", tab: "videos", st: {}, d: null }; // d = { desc, ja }: チャンネルの説明文 // st[tab] = { list, token, busy, err, done }

function chtPaint() {
  const dlg = $("cht"); if (!dlg) return;
  const c = data.channels?.[cht.id], s = cht.st[cht.tab] || { list: [] };
  dlg.innerHTML = `<div class="cht-h"><b>${esc(c?.name || "")}</b><span class="cht-tabs">${CHT_TABS.map(([k, n]) => `<button type="button" class="${k === cht.tab ? "on" : ""}" data-chtt="${k}">${n}</button>`).join("")}</span><button type="button" class="cht-x" data-chtx aria-label="閉じる">✕</button></div>
    <div class="cht-b">${cht.d?.desc ? `<div class="pv-dw cht-d"><p class="pv-d">${esc(cht.d.ja ?? cht.d.desc)}</p><button type="button" class="pv-m" data-pvm hidden>続きを読む ▾</button></div>` : ""}<div class="cht-g ${cht.tab === "shorts" ? "sh" : ""}">${s.list.map((v) => { vmap.set(v.id, { ...(vmap.get(v.id) || {}), ...v, channel: v.channel || c?.name || "" }); return `<button type="button" class="cht-c" data-v="${esc(v.id)}" title="${esc(v.title)}"><span class="cht-th"><img loading="lazy" src="${thumb(v.id)}" alt="">${v.duration ? `<em>${esc(v.duration)}</em>` : ""}</span><span class="cht-t">${esc(v.title)}</span>${v.pub ? `<small>${esc(v.pub)}</small>` : ""}</button>`; }).join("")}</div>
    ${s.busy ? `<p class="cht-n">読み込み中…</p>` : s.err ? `<p class="cht-n bad">${esc(s.err)}</p>` : !s.list.length ? `<p class="cht-n">この種類の動画はありません</p>` : ""}
    ${!s.busy && s.token ? `<div class="cht-m"><button type="button" class="btn s" data-chtmore>もっと見る</button></div>` : ""}</div>`;
  const p = dlg.querySelector(".pv-d"), b = dlg.querySelector("[data-pvm]"); if (p && b) b.hidden = !p.classList.contains("open") && p.scrollHeight <= p.clientHeight + 1;
}
async function chtLoad(more) {
  const c = data.channels?.[cht.id]; if (!c) return;
  const tab = cht.tab, s = (cht.st[tab] ||= { list: [], token: "", busy: false, err: "" });
  if (s.busy || (s.done && !more)) return;
  s.busy = true; s.err = ""; chtPaint();
  try {
    const base = c.base || `https://www.youtube.com/channel/${encodeURIComponent(c.id)}`;
    const page = more && s.token ? await ytMore(s.token) : await ytPage(`${base}/${tab}?hl=ja`);
    const seen = new Set(s.list.map((v) => v.id));
    s.list.push(...page.list.filter((v) => !seen.has(v.id)).map((v) => tab === "shorts" ? { ...v, kind: "short" } : v));
    s.token = page.token || ""; s.done = true;
    if (!cht.d && page.desc) { cht.d = { desc: page.desc.slice(0, 1500) }; chtDesc(cht.d); } // 説明文(日本語でなければ翻訳して差し替える)
  } catch (e) { s.err = "読み込めませんでした(" + (e?.message || e) + ")"; }
  s.busy = false; if ($("cht")?.open && cht.tab === tab) chtPaint();
}
function chtOpen(id) {
  let dlg = $("cht");
  if (!dlg) { dlg = document.createElement("dialog"); dlg.id = "cht"; document.body.append(dlg); dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); }); }
  if (cht.id !== id) { cht.id = id; cht.tab = "videos"; cht.st = {}; cht.d = null; }
  chtPaint(); if (!dlg.open) dlg.showModal(); chtLoad(false);
}
document.addEventListener("click", (e) => {
  let b;
  if ((b = e.target.closest("[data-chthumbs]"))) { e.stopPropagation(); e.preventDefault(); return chtOpen(b.dataset.chthumbs); }
  if (!e.target.closest("#cht")) return;
  if ((b = e.target.closest("[data-chtt]"))) { cht.tab = b.dataset.chtt; chtPaint(); chtLoad(false); }
  else if (e.target.closest("[data-chtmore]")) chtLoad(true);
  else if (e.target.closest("[data-chtx]")) $("cht").close();
}, true);

// 説明文を表示し、日本語でない行は翻訳して差し替える(pvTrDesc は chstats.js)。4行より長ければ「続きを読む」
async function chtDesc(d) {
  const fit = () => { const w = $("cht"), p = w?.querySelector(".pv-d"), b = w?.querySelector("[data-pvm]"); if (p && b) b.hidden = !p.classList.contains("open") && p.scrollHeight <= p.clientHeight + 1; };
  chtPaint(); fit();
  await pvTrDesc(d);
  if (cht.d !== d) return;
  const p = $("cht")?.querySelector(".pv-d"); if (p) { p.textContent = d.ja ?? d.desc; fit(); }
}
