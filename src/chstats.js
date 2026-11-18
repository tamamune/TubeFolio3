/* ===== チャンネルごとの投稿数(種類 × 期間)と、フォルダ管理の2ペイン表示 =====
   データ: data.channels[id].stats = { at, video:[n×8], live:[n×8], short:[n×8], part:[種類…] }
   n×8 は「3日以内 / 7日以内 / 14日以内 / 1か月以内 / 3か月以内 / 6か月以内 / 1年以内 / 1年以上」の件数(以内は累計)。
   ・動画 / ライブ配信 はチャンネルの「動画」「ライブ」タブを新しい順に1年より前まで読んで数える
   ・ショートのタブには投稿日が出ないため、チャンネルの更新フィード(新しい順の直近15件)と突き合わせて数える */
const PERIODS = [["3日以内", 3], ["7日以内", 7], ["14日以内", 14], ["1か月以内", 30], ["3か月以内", 90], ["6か月以内", 180], ["1年以内", 365]];
const STAT_KINDS = [["video", "動画"], ["live", "ライブ配信"], ["short", "ショート"]];
const chOpen = new Set();   // 期間の表を開いているチャンネル
const statBusy = new Set(); // 調査中のチャンネル
let statRun = { total: 0, done: 0 };

const bucket = (ages) => [...PERIODS.map(([, d]) => ages.filter((a) => a <= d * DAY).length), ages.filter((a) => a > 365 * DAY).length];
const ageOf = (v) => { const d = vDate(v); return d ? Date.now() - d.getTime() : null; }; // vDate は search.js

// 動画 / ライブ配信のタブを、1年より前の投稿が出てくるまで読む
async function tabAges(id, tab) {
  const ages = []; let partial = false;
  let page = await ytPage(`https://www.youtube.com/channel/${encodeURIComponent(id)}/${tab}?hl=ja`); // ytPage / ytMore は search.js
  for (let i = 0; ; i++) {
    const ds = page.list.map(ageOf).filter((a) => a != null);
    ages.push(...ds);
    if (ds.some((a) => a > 365 * DAY)) { partial = !!page.token; break; } // 1年より前まで読めた(それより古い分は数えない)
    if (!page.token) break;
    if (i >= 11) { partial = true; break; }
    page = await ytMore(page.token);
  }
  return { ages, partial };
}
// ショート: タブの先頭ページのショートIDと、更新フィード(投稿日つき・直近15件)を突き合わせる
async function shortAges(id) {
  const page = await ytPage(`https://www.youtube.com/channel/${encodeURIComponent(id)}/shorts?hl=ja`);
  const ids = new Set(page.list.map((v) => v.id));
  const xml = await (await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(id)}`)).text();
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const ents = [...doc.getElementsByTagName("entry")].map((e) => ({ id: e.getElementsByTagName("yt:videoId")[0]?.textContent || "", t: Date.parse(e.getElementsByTagName("published")[0]?.textContent || "") })).filter((e) => e.id && !isNaN(e.t));
  const ages = ents.filter((e) => ids.has(e.id)).map((e) => Date.now() - e.t);
  const oldest = ents.length ? Math.max(...ents.map((e) => Date.now() - e.t)) : 0;
  return { ages, partial: ents.length >= 15 && oldest < 365 * DAY }; // フィードの範囲(15件)に収まらない分がありうる
}
function dummyStats(id) { // ダミーのチャンネルは、見え方の確認用に決まった数字を作る
  let h = 0; for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const mk = (m) => { let a = 0; const out = PERIODS.map(([, d], i) => { h = (h * 1103515245 + 12345) >>> 0; a += Math.round(((h >>> 8) % 5) * m * (d / 30 + 0.3)); return a; }); h = (h * 1103515245 + 12345) >>> 0; out.push((h >>> 8) % 60); return out; };
  return { at: Date.now(), video: mk(1), live: mk(0.4), short: mk(0.7) };
}
async function fetchStats(c) {
  if (c.dummy) return dummyStats(c.id);
  const s = { at: Date.now(), part: [], last: {} };
  const latest = (ages) => ages.length ? Date.now() - Math.min(...ages) : null; // いちばん新しい投稿の時刻
  for (const [k, tab] of [["video", "videos"], ["live", "streams"]]) { const r = await tabAges(c.id, tab); s[k] = bucket(r.ages); s.last[k] = latest(r.ages); if (r.partial) s.part.push(k); }
  const sh = await shortAges(c.id); s.short = bucket(sh.ages); s.last.short = latest(sh.ages); if (sh.partial) s.part.push("short");
  return s;
}
// ids のチャンネルを順に調べる(同時に2件まで)。1件終わるごとにその行だけ描き直す
async function runStats(ids) {
  const q = ids.filter((id) => !statBusy.has(id) && data.channels?.[id]);
  if (!q.length) return;
  if (!statBusy.size) statRun = { total: 0, done: 0 };
  q.forEach((id) => statBusy.add(id)); statRun.total += q.length; paintStatBar(); q.forEach(paintRow);
  let i = 0, fail = 0;
  const worker = async () => {
    while (i < q.length) {
      const id = q[i++], c = data.channels?.[id];
      try { if (c) c.stats = await fetchStats(c); } catch { fail++; }
      statBusy.delete(id); statRun.done++; paintRow(id); paintStatBar();
      if (statRun.done % 5 === 0 || !statBusy.size) await persist();
    }
  };
  await Promise.all([worker(), worker()]);
  await persist();
  if (fail) toast(`${fail}件のチャンネルを調べられませんでした(YouTubeへのログインや通信を確認してください)`);
}

/* ---------- 表示 ---------- */
const ICO_FOLDER = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`;
const ICO_REFRESH = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 4v5h-5"/></svg>`;
const handleTxt = (h) => { try { return decodeURIComponent(h || ""); } catch { return h || ""; } };
const nfmt = (n, plus) => `${n}${plus ? "+" : ""}`;
// 表示の切り替え: "count" = 期間ごとの投稿数 / "last" = いちばん新しい投稿がいつか
let statMode = ls.get("tf-ch-statmode", "count"); if (statMode !== "last") statMode = "count";
const relAge = (ms) => { const m = ms / 6e4; return m < 60 ? "1時間以内" : m < 1440 ? `${Math.floor(m / 60)}時間前` : m < 43200 ? `${Math.floor(m / 1440)}日前` : m < 525600 ? `${Math.floor(m / 43200)}か月前` : `${Math.floor(m / 525600)}年前`; };
// 種類 k の最新投稿: { idx: どの期間に入るか(0〜7, なしは -1), text: 〇日前 }。古い結果(日時なし)は件数から期間だけ求める
function lastInfo(s, k) {
  const ts = s.last?.[k];
  if (ts) { const age = Date.now() - ts, i = PERIODS.findIndex(([, d]) => age <= d * DAY); return { idx: i < 0 ? 7 : i, text: relAge(age) }; }
  if (s.last && k in s.last) return { idx: -1, text: (s.part || []).includes(k) ? "不明" : "なし" };
  const c = s[k] || [], j = c.findIndex((x, i) => i < 7 && x > 0);
  return j >= 0 ? { idx: j, text: "" } : c[7] > 0 ? { idx: 7, text: "" } : { idx: -1, text: "なし" };
}
function statTable(c) {
  const s = c.stats;
  if (statBusy.has(c.id)) return `<div class="cs-note">調べています…(投稿が多いチャンネルは少し時間がかかります)</div>`;
  if (!s) return `<div class="cs-note">まだ調べていません。「調べる」を押すと、動画・ライブ配信・ショートの投稿を期間ごとに調べます。</div>`;
  const rows = STAT_KINDS.map(([k, n]) => `<tr><th>${n}</th>${s[k].map((x, i) => `<td class="${x ? "" : "z"}">${nfmt(x, i === 7 && (s.part || []).includes(k))}</td>`).join("")}</tr>`).join("");
  const note = (s.part || []).includes("short") ? "ショートは、投稿日が分かる直近15件までの数です。" : "";
  return `<table class="cs-t"><thead><tr><th></th>${PERIODS.map(([n]) => `<th>${n}</th>`).join("")}<th>1年以上</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="cs-note">${new Date(s.at).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} に調べた結果(以内は累計)${note ? " ・ " + note : ""}${(s.part || []).some((k) => k !== "short") ? " ・ +は、さらに古い投稿が残っている印です" : ""}</div>`;
}
function chRow(c, from) {
  const hue = ([...c.id].reduce((a, ch) => a + ch.charCodeAt(0), 0) * 37) % 360;
  const av = c.thumb && !c.dummy ? `<img class="av-img sm" loading="lazy" src="${esc(c.thumb)}" alt="">` : `<span class="av-img sm av-ph" style="--h:${hue}">${esc(initial(c.name))}</span>`;
  const name = c.dummy ? `<b>${esc(c.name)}</b>` : `<a class="chr-n" href="https://www.youtube.com/channel/${encodeURIComponent(c.id)}" target="_blank" rel="noopener"><b>${esc(c.name)}</b></a>`;
  const fl = (c.folders || []).map((id) => folderName(id)).filter(Boolean);
  const s = c.stats, open = chOpen.has(c.id), busy = statBusy.has(c.id);
  const sum = s && statMode === "last" ? STAT_KINDS.map(([k, n]) => { const li = lastInfo(s, k); return `<span class="cs-chip" title="${n}: いちばん新しい投稿">${n} <b>${li.text || (li.idx >= 0 ? (li.idx < 7 ? PERIODS[li.idx][0] : "1年以上") : "")}</b></span>`; }).join("") + `<small>最新の投稿</small>`
    : s ? STAT_KINDS.map(([k, n]) => `<span class="cs-chip" title="${n}: 1か月以内の投稿数">${n} <b>${s[k][3]}</b></span>`).join("") + `<small>1か月以内</small>` : `<small>未調査</small>`;
  return `<div class="chr ${c.subscribed === false ? "gone" : ""} ${open ? "open" : ""}" draggable="true" data-chid="${esc(c.id)}">
    <div class="chr-h">${av}<div class="chr-t">${name}<small>${esc(handleTxt(c.handle))}${c.subscribed === false ? " ・ 登録解除済み" : ""}</small></div>
      <button class="chr-i ${fl.length ? "on named" : ""}" data-chf="${esc(c.id)}" title="フォルダ: ${fl.length ? esc(fl.join("・")) : "未分類"}(押すと選べます)" aria-label="フォルダを選ぶ">${ICO_FOLDER}${fl.length ? `<span class="chr-fn">${esc(fl[0])}</span>${fl.length > 1 ? `<i>+${fl.length - 1}</i>` : ""}` : ""}</button>
      <div class="chr-s">${sum}</div>
      <button class="chr-i ${busy ? "spin" : ""}" data-chstat="${esc(c.id)}" ${busy ? "disabled" : ""} title="${s ? "もう一度調べる" : "動画・ライブ配信・ショートの投稿を調べる"}" aria-label="${s ? "再調査" : "調べる"}">${ICO_REFRESH}</button>${from ? `<button class="chr-x" data-chrm="${esc(c.id)}" data-from="${esc(from)}" title="このフォルダから外す" aria-label="このフォルダから外す">✕</button>` : ""}</div>
    ${open ? `<div class="chr-d">${statTable(c)}</div>` : ""}</div>`;
}
let curFolderForRow = "";
function paintRow(id) {
  const el = document.querySelector(`.chr[data-chid="${CSS.escape(id)}"]`), c = data.channels?.[id]; if (!el || !c) return;
  const t = document.createElement("div"); t.innerHTML = chRow(c, curFolderForRow); el.replaceWith(t.firstElementChild);
}
function paintStatBar() {
  const el = $("cs-bar"); if (!el) return;
  const run = statBusy.size > 0;
  el.textContent = run ? `調査中 ${statRun.done} / ${statRun.total}` : "";
  const b = document.querySelector("[data-act='statsall']"); if (b) b.disabled = run;
}

// フォルダ管理の画面(登録チャンネル / フォルダ / 未分類): フォルダの切り替えは左のサイドバーで行い、ここにはチャンネルの表を出す
function channelsView(t) {
  const list = chIn(t), f = data.folders.find((x) => x.id === t);
  curFolderForRow = f ? f.id : "";
  const last = +ls.get("tf-ch-sync", "0");
  const sync = t === "channels" ? `<button class="btn s" data-act="sync" ${syncing ? "disabled" : ""}>${syncing ? "同期中…" : "⟳ YouTubeと同期"}</button><span class="sync-i">${useDummy ? "ダミー表示中(設定で切り替え)" : last ? "最終同期 " + new Date(last).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "未同期"}</span>` : "";
  const sib = f ? data.folders.filter((x) => (x.parent || "") === (f.parent || "")) : [], si = f ? sib.indexOf(f) : -1;
  const mv = f ? `<button class="btn s" data-act="up" data-id="${esc(f.id)}" ${si <= 0 ? "disabled" : ""} title="フォルダを上へ">▲ 上へ</button><button class="btn s" data-act="down" data-id="${esc(f.id)}" ${si >= sib.length - 1 ? "disabled" : ""} title="フォルダを下へ">▼ 下へ</button>${f.parent ? `<button class="btn s" data-act="unnest" data-id="${esc(f.id)}" title="親フォルダの外(ひとつ上の階層)へ出します">入れ子を解除</button>` : ""}` : "";
  const fa = ""; // フォルダの操作(上へ・下へ・名前の変更・削除など)は、サイドバーのフォルダ行の ▲▼ と「⋯」メニューで行う
  const modeSw = `<span class="cs-sw" role="radiogroup" aria-label="表示の切り替え"><button type="button" class="tab ${statMode === "count" ? "on" : ""}" data-statmode="count" role="radio" aria-checked="${statMode === "count"}">投稿数</button><button type="button" class="tab ${statMode === "last" ? "on" : ""}" data-statmode="last" role="radio" aria-checked="${statMode === "last"}">最新の投稿</button></span>`;
  const stat = list.length ? modeSw + `<button class="btn s" data-act="statsall" ${statBusy.size ? "disabled" : ""} title="表示中のチャンネルの、動画・ライブ配信・ショートの投稿数を期間ごとに調べます">📊 期間別に調べる(${list.length}件)</button><button class="btn s" data-act="statsopen">${list.every((c) => chOpen.has(c.id)) ? "すべて閉じる" : "すべて開く"}</button><span class="sync-i" id="cs-bar">${statBusy.size ? `調査中 ${statRun.done} / ${statRun.total}` : ""}</span>` : "";
  const empty = t === "channels"
    ? (useDummy ? "ダミーのチャンネルを準備しています…" : "登録チャンネルがありません。「YouTubeと同期」を押すと、YouTubeの登録チャンネルを取り込みます。")
    : "このフォルダにはチャンネルがありません。チャンネルの📁ボタンか、ドラッグで追加できます。";
  const crumb = f && f.parent ? `<div class="crumb"><button class="tab" data-t="${esc(f.parent)}">↑ ${esc(folderPath(f.parent))}</button></div>` : "";
  return `<section class="row"><h2>${esc(folderName(t))}<small>${list.length}チャンネル</small></h2>
    <div class="fm2">
    <div class="fm2-main">${crumb}<div class="ch-bar">${sync}${fa}</div><div class="ch-bar">${stat}</div>${sgPanel(t)}
    ${list.length ? `<div class="chr-list">${list.map((c) => chRow(c, f ? f.id : "")).join("")}</div>` : `<div class="empty" style="margin:0">${empty}</div>`}</div></div></section>`;
}

document.addEventListener("click", (e) => {
  const t = (s) => e.target.closest(s); let b;
  if (t("[data-fmadd]")) return askFolder();
  if ((b = t("[data-chopen]"))) { const id = b.dataset.chopen; chOpen.has(id) ? chOpen.delete(id) : chOpen.add(id); return paintRow(id); }
  if ((b = t("[data-chstat]"))) return runStats([b.dataset.chstat]);
  if ((b = t("[data-act]"))) {
    const list = chIn(tab);
    if (b.dataset.act === "statsall") return runStats(list.map((c) => c.id));
    if (b.dataset.act === "statsopen") { const all = list.every((c) => chOpen.has(c.id)); list.forEach((c) => all ? chOpen.delete(c.id) : chOpen.add(c.id)); return render(); }
  }
});
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-statmode]"); if (!b) return;
  statMode = b.dataset.statmode; ls.set("tf-ch-statmode", statMode); render();
});

/* ---------- 行をクリックで期間の表を開閉 ---------- */
document.addEventListener("click", (e) => {
  const h = e.target.closest(".chr-h"); if (!h || e.target.closest("button,a,input,select")) return;
  const id = h.closest(".chr")?.dataset.chid; if (!id) return;
  chOpen.has(id) ? chOpen.delete(id) : chOpen.add(id); paintRow(id);
});

/* ---------- チャンネルにマウスを乗せると、最新の動画・ライブ配信・ショート・おすすめの動画を表示 ----------
   件数は設定(種類ごと)。YouTube のチャンネルページから読み、同じチャンネルは30分間覚えておく。 */
let pvN = +ls.get("tf-ch-pvn", "1"); if (!(pvN >= 0 && pvN <= 6)) pvN = 1;
$("set-pvn").value = String(pvN);
$("set-pvn").onchange = () => { pvN = +$("set-pvn").value; ls.set("tf-ch-pvn", String(pvN)); hidePv(); };
const PV_SECTIONS = [["video", "最新の動画"], ["live", "最新のライブ配信"], ["short", "最新のショート"], ["pop", "おすすめの動画(人気順)"]];
const pvCache = new Map(); // チャンネルID -> { at, data | promise }
let pvTimer = 0, pvHide = 0, pvId = "";

// チャンネルページを読む(動画一覧と、並び替え「人気」の続きのトークンを取り出す)
async function ytRaw(url) {
  const html = await (await fetch(url, { credentials: "include" })).text();
  const a = html.indexOf("ytInitialData = "), b = html.indexOf(";</script>", a);
  if (a < 0 || b < 0) throw new Error("data");
  YTA.useHtml(html);
  const root = JSON.parse(html.slice(a + 16, b));
  let pop = "";
  (function w(n) { if (pop || !n || typeof n !== "object") return; const cv = n.chipViewModel; if (cv && /人気|Popular/i.test(cv.text || "")) { pop = cv.tapCommand?.innertubeCommand?.continuationCommand?.token || ""; return; } Object.values(n).forEach(w); })(root);
  return { list: collectVideos(root).list, pop };
}
async function fetchPreview(c) {
  const base = c.base || `https://www.youtube.com/channel/${encodeURIComponent(c.id)}`, none = { list: [], pop: "" };
  const [v, l, s] = await Promise.all(["videos", "streams", "shorts"].map((t) => ytRaw(`${base}/${t}?hl=ja`).catch(() => none)));
  let pop = [];
  if (v.pop) { try { pop = collectVideos(await YTA.browse(v.pop)).list; } catch {} }
  return { video: v.list, live: l.list, short: s.list.map((x) => ({ ...x, kind: "short" })), pop };
}
function pvCard(v, c) {
  vmap.set(v.id, { ...(vmap.get(v.id) || {}), ...v, channel: v.channel || c.name });
  return `<button type="button" class="pv-c ${v.kind === "short" ? "sh" : ""}" data-v="${esc(v.id)}" title="${esc(v.title)}"><span class="pv-th"><img loading="lazy" src="${thumb(v.id)}" alt="">${v.duration ? `<em>${esc(v.duration)}</em>` : ""}</span><span class="pv-x"><span class="pv-t">${esc(v.title)}</span>${v.pub ? `<small>${esc(v.pub)}</small>` : ""}</span></button>`;
}
function pvHtml(c, d) {
  const cols = PV_SECTIONS.map(([k, n]) => `<div class="pv-s"><h4>${n}</h4>${d ? (d[k].length ? d[k].slice(0, pvN).map((v) => pvCard(v, c)).join("") : `<p class="pv-e">ありません</p>`) : `<p class="pv-e">読み込み中…</p>`}</div>`).join("");
  return `<div class="pv-h"><b>${esc(c.name)}</b></div><div class="pv-g">${cols}</div>`;
}
// 表示の大きさ(設定で 1〜100%)
// マウスを乗せてから表示するまでの時間(秒): チャンネルのプレビューにも、サムネイル上の動画再生(thumbpv.js)にも使う
const PV_DELAYS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1, 1.5, 2];
let pvDelay = +ls.get("tf-pv-delay", "0.4"); if (!PV_DELAYS.includes(pvDelay)) pvDelay = 0.4;
$("set-pvd").value = String(pvDelay);
$("set-pvd").onchange = () => { pvDelay = +$("set-pvd").value; ls.set("tf-pv-delay", String(pvDelay)); };
const pvScale = 100; // チャンネルのプレビューは、いつも100%の大きさで出す(大きさの設定は廃止)

// anchor: マウスを乗せた要素。side "right" = 画面右端にそろえる(チャンネル一覧の行) / "left" = 要素の左にそろえる(動画カードのチャンネル名)
function refindAnchor(t) { // 一覧が描き直されて要素が入れ替わったときに、同じチャンネルの要素を探し直す
  if (t.side === "right") return document.querySelector(`.chr[data-chid="${CSS.escape(t.key)}"] .chr-h`);
  const same = t.vid && document.querySelector(`.c[data-v="${CSS.escape(t.vid)}"]`); if (same) return same;
  const list = [...document.querySelectorAll(".c[data-v]")].filter((n) => n.querySelector(".cn[data-chn]")?.dataset.chn === t.c.name), cy = t.rect ? t.rect.top : 0;
  return list.sort((a, b) => Math.abs(a.getBoundingClientRect().top - cy) - Math.abs(b.getBoundingClientRect().top - cy))[0] || null;
}
function placePv(t) {
  let anchor = t.anchor; if (!anchor?.isConnected) anchor = t.anchor = refindAnchor(t);
  const side = t.side;
  const el = $("pv"); if (!el) return; if (!anchor) return hidePv();
  t.rect = anchor.getBoundingClientRect();
  const s = pvScale / 100, maxH = (innerHeight - 16) / s; // 縮小して表示するので、元の大きさで見たときの上限は大きくなる
  // 全体が画面に収まるように: 収まらなければ2列にし、それでも収まらなければ4列、サムネイルを小さくする
  el.classList.remove("wide", "cols4", "tiny"); el.style.maxHeight = maxH + "px";
  if (el.scrollHeight > maxH) el.classList.add("wide");
  if (el.scrollHeight > maxH) { el.classList.remove("wide"); el.classList.add("cols4"); } // 4列(種類ごとに1列)
  if (el.scrollHeight > maxH) el.classList.add("tiny");
  const h = Math.min(el.scrollHeight, maxH) * s, w = el.offsetWidth * s, r = anchor.getBoundingClientRect();
  const below = innerHeight - r.bottom - 14, above = r.top - 14; // 行の右側のアイコンを隠さないよう、下か上を優先する
  el.style.transform = `scale(${s})`; el.style.transformOrigin = side === "left" ? "top left" : "top right";
  if (side === "left") { el.style.right = "auto"; el.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + "px"; }
  else { el.style.right = "14px"; el.style.left = "auto"; }
  el.style.top = (h <= below ? r.bottom + 6 : h <= above ? r.top - h - 6 : Math.max(8, innerHeight - h - 8)) + "px";
}
// マウスを乗せた要素から、プレビューするチャンネルを求める
//  ・チャンネル一覧の行(.chr-h) / 動画カードのチャンネル名(.cn: ホーム・検索・ブックマーク)
function pvTarget(e) { // チャンネル一覧の行にマウスを乗せたときだけ(動画カードの上では動画のプレビュー再生: thumbpv.js)
  const h = e.target.closest(".chr-h"); if (!h) return null;
  const c = data.channels?.[h.closest(".chr")?.dataset.chid];
  return c ? { key: c.id, ck: c.id, c, anchor: h, side: "right" } : null;
}
async function showPv(t) {
  if (!t || pvN === 0) return;
  const { c, key, anchor, side } = t;
  hidePv(); pvId = key; t.rect = anchor.getBoundingClientRect();
  const el = document.createElement("div"); el.id = "pv"; el.setAttribute("role", "tooltip"); document.body.append(el);
  if (c.dummy) { el.innerHTML = `<div class="pv-h"><b>${esc(c.name)}</b></div><p class="pv-e" style="padding:8px 4px">ダミーのチャンネルのため、動画は表示できません。</p>`; return placePv(t); }
  const ck = t.ck || key; let ent = pvCache.get(ck);
  if (!ent || Date.now() - ent.at > 30 * 60 * 1000) { ent = { at: Date.now(), data: null, p: fetchPreview(c).then((d) => { ent.data = d; return d; }).catch(() => { pvCache.delete(ck); return null; }) }; pvCache.set(ck, ent); }
  el.innerHTML = pvHtml(c, ent.data); placePv(t);
  if (!ent.data) { await ent.p; if (pvId !== key || !$("pv")) return; el.innerHTML = ent.data ? pvHtml(c, ent.data) : `<div class="pv-h"><b>${esc(c.name)}</b></div><p class="pv-e" style="padding:8px 4px">読み込めませんでした(YouTubeへのログインや通信を確認してください)</p>`; placePv(t); }
}
function hidePv() { clearTimeout(pvTimer); clearTimeout(pvHide); $("pv")?.remove(); pvId = ""; }
document.addEventListener("mouseover", (e) => {
  if (pvN === 0) return;
  if (e.target.closest("#pv")) { clearTimeout(pvHide); return; }
  const t = pvTarget(e);
  if (t) {
    clearTimeout(pvHide);
    if (t.key === pvId) return;
    clearTimeout(pvTimer); pvTimer = setTimeout(() => showPv(t), pvDelay * 1000); return;
  }
  clearTimeout(pvTimer);
  if ($("pv")) { clearTimeout(pvHide); pvHide = setTimeout(hidePv, 250); }
});
document.addEventListener("dragstart", hidePv);
document.addEventListener("click", (e) => { if (e.target.closest("[data-v]")) setTimeout(hidePv, 0); });
// ページ全体のスクロールで閉じる(ホームの行の自動スクロールなど、要素内のスクロールでは閉じない)
addEventListener("scroll", (e) => { if ($("pv") && (e.target === document || e.target === document.scrollingElement)) hidePv(); }, true);
