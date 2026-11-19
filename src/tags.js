/* ===== 設定の「タグ」タブ: YouTube で見た動画のタグ・ハッシュタグを、まとめて管理する =====
   記録は YouTube の再生画面(content.js の logTags)が chrome.storage.local の "tf-taglog" に入れる。
   { v: { 動画ID: { t: 題名, ch: チャンネル, at: 見た日時(ミリ秒), tags: [タグ], hash: [ハッシュタグ(#なし)] } },
     keep: ["tag:名前" / "hash:名前"](取り置き。自動では消さない),
     block: [同じ形](削除したタグ。今後も記録しない),
     max: タグ・ハッシュタグの種類の最大数(0 = 無制限。超えたら、取り置き以外で最後に見たのが古いものから消す) }
   ここでは、タグ/ハッシュタグごとに「何本の動画に付いていたか」を数えて一覧にする。
   ※ 自動で消す処理(tgPrune)は content.js にも同じものがある(記録したときに消すため) */
const TAGLOG = "tf-taglog";
const tg = { kind: "all", sort: "count", q: "", open: "", limit: 200, log: null, view: [], selMode: false, sel: new Set() };
const TG_KIND = { tag: "タグ", hash: "ハッシュタグ" };
const TG_MAX = [[0, "無制限"], [100, "100種類"], [200, "200種類"], [300, "300種類"], [500, "500種類"], [1000, "1000種類"], [2000, "2000種類"], [3000, "3000種類"], [5000, "5000種類"]];
const tgId = (e) => e.kind + ":" + e.name; // 取り置き・除外に入れる形(大文字・小文字はそのまま)
const tgKey = (e) => tgId(e).toLowerCase(); // 比べるときの形
const tgLabel = (e) => (e.kind === "hash" ? "#" : "") + e.name;
const tgSet = (a) => new Set((a || []).map((s) => String(s).toLowerCase()));
function tgAgo(ms) {
  const d = Math.floor((Date.now() - ms) / 86400000);
  if (d <= 0) return "今日"; if (d === 1) return "昨日"; if (d < 30) return d + "日前"; if (d < 365) return Math.floor(d / 30) + "か月前"; return Math.floor(d / 365) + "年前";
}
const tgNorm = (l) => { l ||= {}; l.v ||= {}; l.keep ||= []; l.block ||= []; l.max = +l.max || 0; return l; };
async function tgLoad() { tg.log = tgNorm((await chrome.storage.local.get(TAGLOG))[TAGLOG]); }
const tgSave = () => chrome.storage.local.set({ [TAGLOG]: tg.log });
// 記録から、keys(比べる形)のタグを消す。タグが1つも残らない動画の記録も消す
function tgRemove(log, keys) {
  for (const [id, r] of Object.entries(log.v)) {
    r.tags = (r.tags || []).filter((n) => !keys.has(("tag:" + n).toLowerCase()));
    r.hash = (r.hash || []).filter((n) => !keys.has(("hash:" + n).toLowerCase()));
    if (!r.tags.length && !r.hash.length) delete log.v[id];
  }
}
// 最大数を超えていたら、取り置き以外で、最後に見たのが古いものから消す。消した種類の数を返す
function tgPrune(log) {
  if (!log.max) return 0;
  const last = new Map();
  for (const r of Object.values(log.v)) for (const [kind, list] of [["tag", r.tags || []], ["hash", r.hash || []]]) for (const n of list) { const k = (kind + ":" + n).toLowerCase(); last.set(k, Math.max(last.get(k) || 0, r.at || 0)); }
  if (last.size <= log.max) return 0;
  const keep = tgSet(log.keep);
  const drop = new Set([...last].filter(([k]) => !keep.has(k)).sort((a, b) => a[1] - b[1]).slice(0, last.size - log.max).map(([k]) => k));
  tgRemove(log, drop); return drop.size;
}
// タグ/ハッシュタグごとにまとめる(大文字・小文字は同じものとして数える)
function tgAgg() {
  const m = new Map(), keep = tgSet(tg.log.keep);
  for (const [vid, r] of Object.entries(tg.log.v)) {
    for (const [kind, list] of [["tag", r.tags || []], ["hash", r.hash || []]]) for (const name of list) {
      const k = (kind + ":" + name).toLowerCase();
      let e = m.get(k); if (!e) m.set(k, (e = { kind, name: String(name), vids: [], last: 0, kept: keep.has(k) }));
      e.vids.push(vid); if ((r.at || 0) > e.last) e.last = r.at || 0;
    }
  }
  return [...m.values()];
}
async function paintTags() {
  const box = $("set-tags"); if (!box) return;
  if (!tg.log) await tgLoad();
  const all = tgAgg(), nV = Object.keys(tg.log.v).length, nT = all.filter((e) => e.kind === "tag").length, nH = all.length - nT, nK = all.filter((e) => e.kept).length;
  const q = tg.q.trim().toLowerCase().replace(/^[#＃]/, "");
  const list = all.filter((e) => (tg.kind === "all" || (tg.kind === "keep" ? e.kept : e.kind === tg.kind)) && (!q || e.name.toLowerCase().includes(q)));
  list.sort(tg.sort === "recent" ? (a, b) => b.last - a.last || b.vids.length - a.vids.length
    : tg.sort === "name" ? (a, b) => a.name.localeCompare(b.name, "ja")
    : (a, b) => b.vids.length - a.vids.length || b.last - a.last);
  tg.view = list;
  const seg = (name, cur, opts) => `<div class="tg-seg">${opts.map(([v, t]) => `<button type="button" class="${cur === v ? "on" : ""}" data-tg${name}="${v}">${t}</button>`).join("")}</div>`;
  const rows = list.slice(0, tg.limit).map((e, i) => {
    const open = !tg.selMode && tg.open === tgKey(e), picked = tg.selMode && tg.sel.has(tgKey(e));
    const vids = open ? e.vids.map((id) => [id, tg.log.v[id]]).filter(([, r]) => r).sort((a, b) => (b[1].at || 0) - (a[1].at || 0)) : [];
    return `<div class="tg-r${open ? " open" : ""}${picked ? " picked" : ""}"><button type="button" class="tg-n" data-tgopen="${i}">${tg.selMode ? `<span class="tg-ck" aria-hidden="true">${picked ? "✓" : ""}</span>` : ""}${e.kept ? `<span class="tg-pin" title="取り置き(自動では消しません)">📌</span>` : ""}<span class="tg-name ${e.kind}">${esc(tgLabel(e))}</span><span class="tg-c">${e.vids.length}</span><span class="tg-d">${tgAgo(e.last)}</span></button>`
      + (open ? `<ul class="tg-v">${vids.map(([id, r]) => `<li><a href="https://www.youtube.com/watch?v=${esc(id)}" target="_blank" rel="noopener">${esc(r.t || id)}</a><small>${esc(r.ch || "")}${r.ch ? " ・ " : ""}見た日: ${tgAgo(r.at || 0)}</small></li>`).join("")}</ul>` : "")
      + `</div>`;
  }).join("");
  const n = tg.sel.size;
  const selBar = tg.selMode ? `<div class="tg-selbar"><b>${n}件を選択中</b><button type="button" class="btn s" data-tgkeep ${n ? "" : "disabled"}>📌 取り置きにする</button><button type="button" class="btn s" data-tgunkeep ${n ? "" : "disabled"}>取り置きを外す</button><button type="button" class="btn s tg-delbtn" data-tgdel ${n ? "" : "disabled"}>削除(今後も記録しない)</button><span class="tg-sp"></span><button type="button" class="tg-lk" data-tgall>表示中をすべて選択</button><button type="button" class="tg-lk" data-tgnone ${n ? "" : "disabled"}>選択を解除</button><button type="button" class="btn p" data-tgsel>選別を終わる</button></div>` : "";
  const blk = tg.log.block;
  box.innerHTML = `<p class="hint kw-hint">YouTube で見た動画の「タグ」(投稿者が設定した、画面には出ないキーワード)と、概要欄の「<span class="tg-name hash">#ハッシュタグ</span>」です。動画を開いて4秒ほどたつと記録されます(新しい3000本まで)。マウスを乗せると Wikipedia の検索結果(外国語は日本語訳も)、押すと付いていた動画を表示します。数字は動画の本数です。</p>`
    + `<div class="tg-stat"><span>記録した動画 <b>${nV}</b>本</span><span>タグ <b>${nT}</b>種類</span><span>ハッシュタグ <b>${nH}</b>種類</span><span>📌 取り置き <b>${nK}</b>種類</span>`
    + `<label class="tg-max">最大保存数 <select class="sel" id="tg-max">${TG_MAX.map(([v, t]) => `<option value="${v}" ${tg.log.max === v ? "selected" : ""}>${t}</option>`).join("")}</select><small>${tg.log.max ? `いま ${all.length} / ${tg.log.max}種類。超えたら、取り置き以外で最後に見たのが古いものから自動で消します` : "タグとハッシュタグの種類の合計"}</small></label></div>`
    + `<div class="tg-bar">${seg("kind", tg.kind, [["all", "すべて"], ["tag", "タグ"], ["hash", "ハッシュタグ"], ["keep", "📌 取り置き"]])}${seg("sort", tg.sort, [["count", "多い順"], ["recent", "最近見た順"], ["name", "名前順"]])}<input class="kw-in tg-q" id="tg-q" placeholder="絞り込み" value="${esc(tg.q)}">`
    + (tg.selMode ? "" : `<button type="button" class="btn s" data-tgsel ${all.length ? "" : "disabled"} title="取り置きにするタグ・削除するタグを選びます">選別する</button>`)
    + `<button type="button" class="btn s tg-copyall" data-tgcopyall>表示中をコピー</button><button type="button" class="btn s tg-clear" data-tgclear ${nV ? "" : "disabled"}>記録をすべて消す</button></div>`
    + selBar
    + (list.length ? `<div class="tg-list${tg.selMode ? " selmode" : ""}">${rows}</div>` + (list.length > tg.limit ? `<button type="button" class="btn s tg-more" data-tgmore>さらに表示(残り ${list.length - tg.limit}件)</button>` : "")
      : `<p class="hint">${nV ? "一致するものがありません。" : "まだ記録がありません。YouTube で動画を見ると、ここにたまっていきます。"}</p>`)
    + (blk.length ? `<details class="tg-blk"${tg.blkOpen ? " open" : ""}><summary>記録しないタグ(${blk.length})<small>削除したタグです。✕で元に戻すと、また記録します</small></summary><div class="tg-blkl">${blk.map((s, i) => { const [kind, ...r] = String(s).split(":"), e = { kind, name: r.join(":") }; return `<span class="kw-chip"><span class="tg-name ${kind}">${esc(tgLabel(e))}</span><button type="button" data-tgunblock="${i}" aria-label="「${esc(tgLabel(e))}」を元に戻す" title="元に戻す(また記録する)">✕</button></span>`; }).join("")}</div></details>` : "");
}
const tgCopy = (text, what) => navigator.clipboard.writeText(text).then(() => toast(`${what}をコピーしました`), () => toast("コピーできませんでした"));
// 選んだタグ(tg.sel)を、取り置き・取り置き解除・削除にする。保存の直前に読み直して、再生画面の側で増えた記録を消さない
async function tgApplySel(act) {
  const keys = new Set(tg.sel), picked = tgAgg().filter((e) => keys.has(tgKey(e))); if (!picked.length) return;
  if (act === "del" && !confirm(`${picked.length}件のタグを削除しますか?\n記録から消し、今後も記録しません(下の「記録しないタグ」から元に戻せます)。\n\n${picked.slice(0, 12).map(tgLabel).join("、")}${picked.length > 12 ? " ほか" : ""}`)) return;
  await tgLoad();
  const L = tg.log;
  if (act === "keep") { const have = tgSet(L.keep); for (const e of picked) if (!have.has(tgKey(e))) L.keep.push(tgId(e)); }
  else { L.keep = L.keep.filter((s) => !keys.has(String(s).toLowerCase())); }
  if (act === "del") { const have = tgSet(L.block); for (const e of picked) if (!have.has(tgKey(e))) L.block.push(tgId(e)); tgRemove(L, keys); }
  await tgSave(); tg.sel.clear();
  toast(act === "keep" ? `${picked.length}件を取り置きにしました` : act === "del" ? `${picked.length}件を削除しました` : `${picked.length}件の取り置きを外しました`);
  paintTags();
}
$("set-tags").addEventListener("click", async (ev) => {
  const t = (s) => ev.target.closest(s); let b;
  if ((b = t("[data-tgkind]"))) { tg.kind = b.dataset.tgkind; tg.limit = 200; return paintTags(); }
  if ((b = t("[data-tgsort]"))) { tg.sort = b.dataset.tgsort; return paintTags(); }
  if ((b = t("[data-tgopen]"))) {
    const e = tg.view[+b.dataset.tgopen]; if (tgCardEl) { tgCardEl.hidden = true; tgCardFor = null; } if (!e) return;
    if (tg.selMode) { const k = tgKey(e); if (tg.sel.has(k)) tg.sel.delete(k); else tg.sel.add(k); } // 選別中: 押すと選ぶ / 外す
    else tg.open = tg.open === tgKey(e) ? "" : tgKey(e);
    return paintTags();
  }
  if (t("[data-tgsel]")) { tg.selMode = !tg.selMode; tg.sel.clear(); tg.open = ""; return paintTags(); }
  if (t("[data-tgall]")) { tg.view.forEach((e) => tg.sel.add(tgKey(e))); return paintTags(); }
  if (t("[data-tgnone]")) { tg.sel.clear(); return paintTags(); }
  if (t("[data-tgkeep]")) return tgApplySel("keep");
  if (t("[data-tgunkeep]")) return tgApplySel("unkeep");
  if (t("[data-tgdel]")) return tgApplySel("del");
  if ((b = t("[data-tgunblock]"))) { await tgLoad(); const [s] = tg.log.block.splice(+b.dataset.tgunblock, 1); tg.blkOpen = true; await tgSave(); if (s) toast(`「${s.replace(/^hash:/, "#").replace(/^tag:/, "")}」をまた記録します`); return paintTags(); }
  if (t("[data-tgmore]")) { tg.limit += 300; return paintTags(); }
  if (t("[data-tgcopyall]")) { const l = tg.view.map(tgLabel); return l.length ? tgCopy(l.join(tg.kind === "hash" ? " " : ", "), `${l.length}件`) : toast("コピーするものがありません"); }
  if (t("[data-tgclear]")) {
    if (!confirm("記録したタグ・ハッシュタグを、すべて消しますか?(元に戻せません)\n取り置き・記録しないタグ・最大保存数の設定は残ります。")) return;
    await tgLoad(); tg.log.v = {}; await tgSave(); tg.open = ""; toast("記録をすべて消しました"); paintTags();
  }
});
$("set-tags").addEventListener("toggle", (ev) => { if (ev.target.matches?.(".tg-blk")) tg.blkOpen = ev.target.open; }, true);
$("set-tags").addEventListener("change", async (ev) => {
  if (ev.target.id !== "tg-max") return;
  await tgLoad(); tg.log.max = +ev.target.value || 0;
  const all = tgAgg().length, nKeep = tgAgg().filter((e) => e.kept).length;
  if (tg.log.max && all > tg.log.max && !confirm(`いま ${all}種類あります。最大を ${tg.log.max}種類にすると、取り置き以外で最後に見たのが古い ${Math.min(all - tg.log.max, all - nKeep)}種類を消します。よろしいですか?`)) { tg.log = null; return paintTags(); }
  const n = tgPrune(tg.log); await tgSave();
  toast(n ? `${n}種類を自動で消しました` : tg.log.max ? `最大保存数を ${tg.log.max}種類にしました` : "最大保存数を無制限にしました");
  paintTags();
});
$("set-tags").addEventListener("input", (ev) => {
  if (ev.target.id !== "tg-q") return;
  tg.q = ev.target.value; tg.limit = 200;
  clearTimeout(tg.qt); tg.qt = setTimeout(() => { const pos = ev.target.selectionStart; paintTags().then(() => { const i = $("tg-q"); if (i) { i.focus(); i.setSelectionRange(pos, pos); } }); }, 200);
});
// YouTube で動画を見て記録が増えたら、表示中ならその場で更新する
chrome.storage.onChanged.addListener((c, area) => {
  if (area !== "local" || !c[TAGLOG]) return;
  tg.log = tgNorm(c[TAGLOG].newValue);
  if (!$("set-tags").hidden && document.activeElement?.id !== "tg-q") paintTags();
});
if (!$("set-tags").hidden) paintTags(); // 前回「タグ」タブを開いていたとき(ページを開いた時点で、まだ tags.js が読み込まれていなかったため)

/* ---------- マウスを乗せたら: Wikipedia の検索結果(外国語のタグは日本語に訳してから探す) ----------
   ・日本語を含まないタグは、まず日本語に訳し(ytapi.js の YTA.translate)、訳で日本語版 Wikipedia を探す
   ・日本語版で見つからなければ、元の語で英語版を探し、その説明も日本語に訳す
   ・Wikipedia の検索 API(origin=* で、拡張機能のページからも読める) */
const tgHasJa = (s) => /[぀-ヿ㐀-鿿]/.test(s);
const tgWikiCache = new Map();
async function tgWiki(lang, q) {
  const u = `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrsearch=${encodeURIComponent(q)}&gsrlimit=3&prop=extracts|info&exintro=1&explaintext=1&exsentences=2&inprop=url&redirects=1`;
  const j = await (await fetch(u)).json();
  return Object.values(j.query?.pages || {}).sort((a, b) => a.index - b.index).map((p) => ({ title: p.title, ext: String(p.extract || "").replace(/\s+/g, " ").trim().slice(0, 160), url: p.fullurl }));
}
function tgInfo(e) {
  const k = tgKey(e); if (tgWikiCache.has(k)) return tgWikiCache.get(k);
  const p = (async () => {
    let tr = null, lang = "ja", res = [];
    if (!tgHasJa(e.name) && /\p{L}/u.test(e.name)) { // 外国語のタグ: 日本語に訳す
      try { const r = await YTA.translate(e.name, true); if (r?.text && r.src !== "ja" && r.text.toLowerCase() !== e.name.toLowerCase()) tr = r.text; } catch {}
    }
    try { res = await tgWiki("ja", tr || e.name); } catch {}
    if (!res.length && tr) { try { res = await tgWiki("ja", e.name); } catch {} }
    if (!res.length && !tgHasJa(e.name)) {
      try { const r2 = await tgWiki("en", e.name); if (r2.length) { res = r2; lang = "en"; } } catch {}
      if (res.length) { try { const t = await YTA.translateMany(res.map((x) => x.ext)); res.forEach((x, i) => { if (t?.[i]?.text) x.extJa = t[i].text; }); } catch {} }
    }
    return { tr, lang, res };
  })();
  tgWikiCache.set(k, p); return p;
}
let tgCardEl = null, tgCardFor = null, tgShowT = 0, tgHideT = 0;
function tgCard() {
  if (tgCardEl) return tgCardEl;
  tgCardEl = document.createElement("div"); tgCardEl.className = "tg-card"; tgCardEl.hidden = true; document.body.append(tgCardEl);
  tgCardEl.addEventListener("mouseenter", () => clearTimeout(tgHideT));
  tgCardEl.addEventListener("mouseleave", () => tgHideSoon());
  return tgCardEl;
}
function tgHideSoon() { clearTimeout(tgShowT); clearTimeout(tgHideT); tgHideT = setTimeout(() => { if (tgCardEl) tgCardEl.hidden = true; tgCardFor = null; }, 250); }
function tgPlace(card, anchor) {
  const r = anchor.getBoundingClientRect(), w = card.offsetWidth, h = card.offsetHeight;
  let x = r.left, y = r.bottom + 6;
  if (x + w > innerWidth - 8) x = innerWidth - w - 8;
  if (y + h > innerHeight - 8) y = Math.max(8, r.top - h - 6);
  card.style.left = Math.max(8, x) + "px"; card.style.top = y + "px";
}
async function tgShowCard(btn) {
  const e = tg.view[+btn.dataset.tgopen]; if (!e) return;
  const card = tgCard(); tgCardFor = btn;
  const head = `<div class="tg-ch"><b class="tg-name ${e.kind}">${esc(tgLabel(e))}</b><small>${TG_KIND[e.kind]} ・ ${e.vids.length}本の動画</small></div>`;
  const q = encodeURIComponent(e.name);
  card.innerHTML = head + `<p class="tg-wl">Wikipedia を探しています…</p>`; card.hidden = false; tgPlace(card, btn);
  const info = await tgInfo(e);
  if (tgCardFor !== btn) return; // その間に別のタグへ移った
  const searchQ = encodeURIComponent(info.lang === "ja" && info.tr ? info.tr : e.name);
  card.innerHTML = head
    + (info.tr ? `<div class="tg-tr">日本語訳: <b>${esc(info.tr)}</b></div>` : "")
    + (info.res.length
      ? `<div class="tg-wh">Wikipedia${info.lang === "en" ? "(英語版)" : ""}</div>` + info.res.map((x) => `<div class="tg-wi"><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a>${x.ext ? `<p>${esc(x.extJa || x.ext)}</p>` : ""}${x.extJa ? `<p class="tg-wo">${esc(x.ext)}</p>` : ""}</div>`).join("")
      : `<p class="tg-wl">Wikipedia に見つかりませんでした</p>`)
    + `<a class="tg-wall" href="https://${info.lang}.wikipedia.org/w/index.php?search=${info.lang === "en" ? q : searchQ}" target="_blank" rel="noopener">Wikipedia で検索 ↗</a>`;
  tgPlace(card, btn);
}
$("set-tags").addEventListener("mouseover", (ev) => {
  const btn = ev.target.closest?.(".tg-n"); if (!btn) return;
  clearTimeout(tgHideT);
  if (tgCardFor === btn && !tgCardEl?.hidden) return;
  clearTimeout(tgShowT); tgShowT = setTimeout(() => tgShowCard(btn), 350);
});
$("set-tags").addEventListener("mouseout", (ev) => { const btn = ev.target.closest?.(".tg-n"); if (btn && !btn.contains(ev.relatedTarget)) tgHideSoon(); });
