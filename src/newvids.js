/* ===== サイドバーのフォルダに出す「新着動画の件数」 =====
   YouTube の「登録チャンネルの新着」(登録チャンネルの新しい動画)を、起動時と20分ごとに先頭から数ページ読み、
   直近 NEW_DAYS 日の動画を、そのチャンネルが入っているフォルダ(と、その親フォルダ)ごとに数える。 */
const NEW_DAYS = 3;
let newFeed = [], newBusy = false, newMemo = { key: "", map: new Map() };
async function loadNewFeed() {
  if (newBusy || useDummy) return; newBusy = true;
  try {
    const out = []; let page = await ytPage("https://www.youtube.com/feed/subscriptions"); // ytPage / ytMore は search.js
    out.push(...page.list);
    for (let i = 0; i < 4 && page.token; i++) {
      const ages = page.list.map((v) => vDate(v)).filter(Boolean).map((d) => Date.now() - d.getTime());
      if (ages.length && Math.min(...ages) > NEW_DAYS * 864e5) break; // もう古い動画ばかりなら、続きは読まない
      page = await ytMore(page.token); out.push(...page.list);
    }
    newFeed = out; newMemo.key = ""; renderNav();
  } catch {} finally { newBusy = false; }
}
function newCounts() {
  const key = newFeed.length + "|" + (data.folders || []).length + "|" + Object.keys(data.channels || {}).length + "|" + JSON.stringify((data.folders || []).map((f) => f.parent || "")) + "|" + Object.values(data.channels || {}).reduce((a, c) => a + (c.folders || []).length, 0);
  if (newMemo.key === key) return newMemo.map;
  const map = new Map(), add = (id) => map.set(id, (map.get(id) || 0) + 1), cutoff = Date.now() - NEW_DAYS * 864e5, seen = new Set();
  const byId = new Map((data.folders || []).map((f) => [f.id, f]));
  const ancestors = (id) => { const out = []; let f = byId.get(id), n = 0; while (f && n++ < 20) { out.push(f.id); f = byId.get(f.parent); } return out; };
  for (const v of useDummy ? [] : newFeed) {
    if (seen.has(v.id)) continue; seen.add(v.id);
    const d = vDate(v); if (!d || d.getTime() < cutoff) continue;
    const c = v.channel ? subMap().get(subNorm(v.channel)) : null; // subMap / subNorm は subtest.js
    if (!c) continue; // 登録チャンネルの一覧に無いチャンネル(名前が合わない・登録解除など)は数えない(空の「未分類」に件数が出てしまうため)
    add("channels");
    const fs = (c?.folders || []).filter((id) => byId.has(id));
    if (!fs.length) add("uncat"); else for (const id of new Set(fs.flatMap(ancestors))) add(id);
  }
  newMemo = { key, map };
  return map;
}
const newCnt = (id) => (useDummy ? ({ channels: 12, uncat: 3 }[id] ?? (id.length % 4)) : newCounts().get(id) || 0);
setTimeout(loadNewFeed, 2500);
setInterval(() => { if (!document.hidden) loadNewFeed(); }, 20 * 60 * 1000);
