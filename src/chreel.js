/* ===== ホームの「日本の登録者数 TOP50」(横にスクロールするリール) =====
   日本のチャンネルを、登録者数の多い順に50件。出すのは、チャンネルのアイコン・名前・登録者数。押すと YouTube のチャンネルを新しいタブで開く。
   順位と登録者数は NoxInfluencer の日本のランキング(登録者数順)から読む。アイコンは各チャンネルのページから取る。
   結果は12時間、この端末に覚えておく(localStorage "tf-chrank")。自分の登録チャンネルは使わない。 */
const CR_URL = "https://jp.noxinfluencer.com/youtube-channel-rank/top-100-jp-all-youtuber-sorted-by-subs-weekly", CR_KEY = "tf-chrank", CR_TTL = 12 * 36e5, CR_N = 50;
const chSubsTxt = (n) => {
  const f = (v, u) => (v >= 100 ? Math.round(v) : Math.round(v * 10) / 10) + u;
  return n >= 1e8 ? f(n / 1e8, "億人") : n >= 1e4 ? f(n / 1e4, "万人") : n.toLocaleString("ja-JP") + "人";
};
const CR_ORIGIN = "https://*.noxinfluencer.com/*"; // www.noxinfluencer.com は jp.noxinfluencer.com に転送されるので、サブドメインすべて
let crNoPerm = false, crBusy = false, crErr = "", crErrAt = 0; const crTried = new Set(); // アイコンを一度取りに行ったチャンネル(取れなくても、起動中はやり直さない)
const crCache = () => { try { const o = JSON.parse(ls.get(CR_KEY, "null")); return o && Array.isArray(o.list) ? o : null; } catch { return null; } };
const crSave = (o) => { try { ls.set(CR_KEY, JSON.stringify(o)); } catch {} };
// ランキングの表(順位・チャンネル名・チャンネルID・登録者数)を読む
const rowOf = (tr) => { const td = [...tr.querySelectorAll("td")], a = td[1]?.querySelector("a[href*='/channel/']"), nm = [...(td[1]?.querySelectorAll("a") || [])].map((x) => x.textContent.trim()).find(Boolean) || (td[1]?.textContent || "").trim(), sc = td.slice(2, 5).find((c) => /^\s*[\d.,]+\s*(億|万)?/.test(c.textContent)); return { href: a?.getAttribute("href") || "", name: nm, subs: sc?.textContent.trim() || "" }; };
const crNum = (t) => { const m = /([\d.,]+)\s*(億|万)?/.exec(t || ""); if (!m) return 0; const v = parseFloat(m[1].replace(/,/g, "")); return Math.round(v * (m[2] === "億" ? 1e8 : m[2] === "万" ? 1e4 : 1)); };
async function crRows() { // 行: { href, name, subs(文字) }。まず直接読み、通信を止められたら(Failed to fetch)裏のタブで開いて読む
  try {
    const res = await fetch(CR_URL); if (!res.ok) throw new Error("HTTP " + res.status);
    const doc = new DOMParser().parseFromString(await res.text(), "text/html");
    return [...doc.querySelectorAll("table tbody tr")].map(rowOf);
  } catch (e) {
    const r = await chrome.runtime.sendMessage({ tf: "nox-rank", url: CR_URL }).catch(() => null);
    if (!r?.ok) throw new Error((e?.message || e) + (r?.error ? " → 裏のタブでも失敗: " + r.error : r ? "" : " → 裏のタブの機能が使えません(拡張機能を再読み込みしてください)"));
    return r.rows;
  }
}
async function crFetchList() {
  const out = [];
  for (const r of await crRows()) {
    const id = /\/channel\/(UC[\w-]{22})/.exec(r.href || "")?.[1], subs = crNum(r.subs);
    if (id && subs > 0) out.push({ id, name: r.name, subs });
    if (out.length >= CR_N) break;
  }
  if (out.length < 10) throw new Error("ランキングの表を読み取れませんでした(" + out.length + "件)");
  return out;
}
// アイコン: チャンネルのページの og:image(同時に3件ずつ。8件ごとに画面へ反映)
async function crFetchIcons(o) {
  const todo = o.list.filter((c) => !c.img && !crTried.has(c.id)); let i = 0, n = 0;
  const worker = async () => {
    while (i < todo.length) {
      const c = todo[i++]; crTried.add(c.id);
      try {
        const html = await (await fetch(`https://www.youtube.com/channel/${encodeURIComponent(c.id)}?hl=ja`)).text();
        const u = /<meta property="og:image" content="([^"]+)"/.exec(html)?.[1];
        if (u) c.img = u.replace(/=s\d+[^"]*$/, "=s176-c-k-c0x00ffffff-no-rj");
      } catch {}
      if (++n % 8 === 0) { crSave(o); if (tab === "all") render(); }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  crSave(o); if (tab === "all") render();
}
async function crRun() {
  if (crBusy) return; const c = crCache();
  if (c && Date.now() - c.at < CR_TTL && c.list.every((x) => x.img || crTried.has(x.id))) return;
  if (crErr && Date.now() - crErrAt < 3 * 6e4) return;
  crBusy = true;
  try {
    if (!(await chrome.permissions.contains({ origins: [CR_ORIGIN] }))) { crNoPerm = true; crBusy = false; if (tab === "all") render(); return; } // 外部サイトを読む許可がまだ無い(下のボタンで申請する)
    crNoPerm = false;
    let o = c && Date.now() - c.at < CR_TTL ? c : null;
    if (!o) { const list = await crFetchList(), old = new Map((c?.list || []).map((x) => [x.id, x.img])); o = { at: Date.now(), list: list.map((x) => ({ ...x, img: old.get(x.id) || "" })) }; crSave(o); crErr = ""; if (tab === "all") render(); }
    await crFetchIcons(o);
  } catch (e) { console.warn("[chreel]", e); const gr = await chrome.permissions.contains({ origins: [CR_ORIGIN] }).catch(() => null); crErr = "ランキングを取得できませんでした(" + (e?.message || e) + " / 許可: " + (gr ? "あり" : "なし") + " / v" + chrome.runtime.getManifest().version + "・" + (chrome.runtime.getManifest().optional_host_permissions ? "新" : "旧") + "マニフェスト)。"; crErrAt = Date.now(); if (tab === "all") render(); }
  crBusy = false;
}
function chReelRow() {
  const T = "日本の登録者数 TOP50", c = crCache();
  setTimeout(crRun, 0);
  if (!c && crNoPerm) return note(T, `ランキングを読むには、NoxInfluencer(noxinfluencer.com)へのアクセス許可が必要です。 <button type="button" class="btn s" data-crperm>許可する</button>`);
  if (!c) return note(T, crErr ? esc(crErr) + ` <button type="button" class="btn s" data-crretry>もう一度取得</button>` : "ランキングを取得しています…");
  const hue = (id) => ([...id].reduce((a, ch) => a + ch.charCodeAt(0), 0) * 37) % 360;
  const cards = c.list.map((x, i) => `<a class="chc" href="https://www.youtube.com/channel/${encodeURIComponent(x.id)}" target="_blank" rel="noopener" title="${i + 1}位 ${esc(x.name)}(${chSubsTxt(x.subs)})">
    <span class="chc-av">${x.img ? `<img loading="lazy" src="${esc(x.img)}" alt="">` : `<span class="chc-ph" style="--h:${hue(x.id)}">${esc([...(x.name || "?")][0])}</span>`}<em class="chc-n ${i < 3 ? "top" : ""}">${i + 1}</em></span>
    <b class="chc-t">${esc(x.name)}</b><small class="chc-s">登録者 ${chSubsTxt(x.subs)}</small></a>`).join("");
  return rail(T, cards, c.list.length, "チャンネル", "");
}
document.addEventListener("click", (e) => { if (e.target.closest("[data-crretry]")) { crErr = ""; crErrAt = 0; crRun(); render(); } });
document.addEventListener("click", async (e) => { // 「許可する」: ブラウザの許可の確認が出る(ボタンを押した操作が必要)
  if (!e.target.closest("[data-crperm]")) return;
  try { const ok = await chrome.permissions.request({ origins: [CR_ORIGIN] }); if (ok) { crNoPerm = false; crErr = ""; crErrAt = 0; crRun(); render(); } else toast("許可されませんでした"); }
  catch (err) { toast("許可を申請できませんでした: " + (err?.message || err)); }
});
