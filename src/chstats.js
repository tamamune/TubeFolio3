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
async function tabAges(id, tab, info) {
  const ages = []; let partial = false;
  let page = await ytPage(`https://www.youtube.com/channel/${encodeURIComponent(id)}/${tab}?hl=ja`); // ytPage / ytMore は search.js
  if (info) { if (page.desc) info.desc = page.desc.slice(0, 800); info.titles.push(...page.list.map((v) => v.title).filter(Boolean)); } // 登録補助で使う: 概要欄と動画のタイトル
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
  const info = { desc: "", titles: [] };
  for (const [k, tab] of [["video", "videos"], ["live", "streams"]]) { const r = await tabAges(c.id, tab, info); s[k] = bucket(r.ages); s.last[k] = latest(r.ages); if (r.partial) s.part.push(k); }
  const sh = await shortAges(c.id); s.short = bucket(sh.ages); s.last.short = latest(sh.ages); if (sh.partial) s.part.push("short");
  // 登録補助(フォルダの候補)のために、概要欄と最近の動画タイトルを覚えておく(ドライブ同期の対象。大きくなりすぎないよう短く)
  c.desc = info.desc; c.titles = [...new Set(info.titles)].slice(0, 30).map((t) => t.slice(0, 80));
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
    <div class="chr-h">${av}<div class="chr-t"><span class="chr-nl">${name}${rateBtn(c)}${skipBtn(c)}${notifyBtn(c)}</span><small>${esc(handleTxt(c.handle))}${c.subscribed === false ? " ・ 登録解除済み" : ""}</small></div>
      <button class="chr-i ${fl.length ? "on named" : ""}" data-chf="${esc(c.id)}" title="フォルダ: ${fl.length ? esc(fl.join("・")) : "未分類"}(押すと選べます)" aria-label="フォルダを選ぶ">${ICO_FOLDER}${fl.length ? `<span class="chr-fn">${esc(fl[0])}</span>${fl.length > 1 ? `<i>+${fl.length - 1}</i>` : ""}` : ""}</button>
      <div class="chr-s">${sum}</div>
      <button class="chr-i ${busy ? "spin" : ""}" data-chstat="${esc(c.id)}" ${busy ? "disabled" : ""} title="${s ? "もう一度調べる" : "動画・ライブ配信・ショートの投稿を調べる"}" aria-label="${s ? "再調査" : "調べる"}">${ICO_REFRESH}</button>${from ? `<button class="chr-x" data-chrm="${esc(c.id)}" data-from="${esc(from)}" title="このフォルダから外す" aria-label="このフォルダから外す">✕</button>` : ""}${thBtn(c)}</div>
    ${chSugHtml(c)}
    ${open ? `<div class="chr-d">${statTable(c)}</div>` : ""}</div>`;
}
// 登録補助: 一覧の上に件数と「候補を表示/隠す」ボタン(候補そのものは、各チャンネルの行に出す)
let sgShow = ls.get("tf-ch-sug", "1") === "1"; // 候補を出すか(設定はドライブ同期の対象)
// 候補の計算結果は、画面を描く間(最長5秒)使い回す。描き直しの先頭(channelsView)で捨てる
let sgMemo = null, sgMemoAt = 0, sgTm = null;
function sgMemoGet() { if (!sgMemo || Date.now() - sgMemoAt > 5000) { sgMemo = new Map(); sgMemoAt = Date.now(); sgTm = null; } return sgMemo; }
function chSuggestM(c) { const m = sgMemoGet(); let r = m.get(c.id); if (!r) { if (!sgTm) sgTm = titlesByChannel(); m.set(c.id, r = chSuggest(c, sgTm)); } return r; }
function sgCount(list) { let n = 0; for (const c of list) n += chSuggestM(c).length; return n; } // 候補の数(ボタンに出す)
// チャンネル名で検索(名前・ハンドル名。入力中は一覧だけ絞り込み、入力欄はそのまま)
let chQ = "", chQTimer = 0;
const chQOk = (c) => { const q = nz(chQ.trim()); return !q || nz(c.name).includes(q) || nz(c.handle).includes(q); };
document.addEventListener("input", (e) => {
  if (e.target.id !== "ch-q") return;
  chQ = e.target.value; clearTimeout(chQTimer);
  chQTimer = setTimeout(() => { const a = e.target.selectionStart; render(); const i = $("ch-q"); if (i) { i.focus({ preventScroll: true }); try { i.setSelectionRange(a, a); } catch {} } }, 180);
});
document.addEventListener("click", (e) => { if (!e.target.closest("[data-sgshow]")) return; sgShow = !sgShow; ls.set("tf-ch-sug", sgShow ? "1" : "0"); render(); });
// 各チャンネルの行の候補: チャンネル名の下に1行で、フォルダ名だけの小さなボタンを並べる。押すと登録、✕で候補から外す
function chSugHtml(c) {
  if (!sgShow) return "";
  const s = chSuggestM(c); if (!s.length) return "";
  return `<div class="chr-sg"><span class="chr-sgl">候補</span>${s.map(({ f, k, where }) => `<span class="chr-sgc"><button type="button" class="chr-sga" data-sgadd="${esc(c.id)}|${esc(f.id)}" title="「${esc(folderPath(f.id))}」に登録する(「${esc(k)}」← ${esc(where)})">＋ ${esc(folderPath(f.id))}</button><button type="button" class="chr-sgx" data-sgx="${esc(c.id)}|${esc(f.id)}" title="このフォルダの候補から外す" aria-label="候補から外す">✕</button></span>`).join("")}</div>`;
}
let curFolderForRow = "";

/* ---------- チャンネルごとの再生速度(c.rate)。YouTube の再生画面で、このチャンネルの動画を開いたら自動でこの速さにする(chrate.js) ---------- */
const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const rateTxt = (r) => r + "x";
const rateBtn = (c) => `<button type="button" class="chr-rate ${c.rate ? "on" : ""}" data-chrate="${esc(c.id)}" title="${c.rate ? `このチャンネルの動画は ${rateTxt(c.rate)} で再生します(押すと変えられます)` : "このチャンネルの動画の再生速度を決める"}">⏩ ${c.rate ? rateTxt(c.rate) : "倍速"}</button>`;
function rateMenu(btn) {
  document.querySelector(".rate-pop")?.remove();
  const id = btn.dataset.chrate, c = data.channels?.[id]; if (!c) return;
  const m = document.createElement("div"); m.className = "rate-pop"; m.setAttribute("role", "menu");
  m.innerHTML = `<div class="rate-h">再生速度 <small>${esc(c.name)}</small></div>`
    + `<button type="button" role="menuitem" data-rateset="" class="${c.rate ? "" : "on"}">指定しない<small>YouTube の速さのまま</small></button>`
    + `<div class="rate-g">${RATES.map((r) => `<button type="button" role="menuitem" data-rateset="${r}" class="${c.rate === r ? "on" : ""}">${rateTxt(r)}</button>`).join("")}</div>`;
  document.body.appendChild(m);
  const b = btn.getBoundingClientRect(), w = m.offsetWidth, h = m.offsetHeight;
  m.style.left = Math.max(8, Math.min(innerWidth - w - 8, b.left)) + "px";
  m.style.top = (b.bottom + 6 + h > innerHeight ? Math.max(8, b.top - h - 6) : b.bottom + 6) + "px";
  m.dataset.ratech = id;
}
document.addEventListener("click", async (e) => {
  const nb = e.target.closest("[data-chnotify]");
  if (nb) { e.preventDefault(); e.stopPropagation(); const c = data.channels?.[nb.dataset.chnotify]; if (!c) return; c.notify = !c.notify; if (!c.notify) delete c.notify; await persist(); paintRow(c.id); return toast(c.notify ? `「${c.name}」の新着をお知らせします` : `「${c.name}」の新着のお知らせを止めました(LIVE・緊急などはお知らせします)`); }
  const sb = e.target.closest("[data-chskip]");
  if (sb) { e.preventDefault(); e.stopPropagation(); return document.querySelector(`.sk-pop[data-skch="${CSS.escape(sb.dataset.chskip)}"]`) ? document.querySelector(".rate-pop").remove() : skipMenu(sb); }
  const b = e.target.closest("[data-chrate]");
  if (b) { e.preventDefault(); e.stopPropagation(); return document.querySelector(`.rate-pop[data-ratech="${CSS.escape(b.dataset.chrate)}"]`) ? document.querySelector(".rate-pop").remove() : rateMenu(b); }
  const pop = document.querySelector(".rate-pop"); if (!pop) return;
  const s = e.target.closest("[data-rateset]");
  if (s && pop.contains(s)) {
    const c = data.channels?.[pop.dataset.ratech];
    if (c) { const r = +s.dataset.rateset; if (r) c.rate = r; else delete c.rate; await persist(); paintRow(c.id); toast(r ? `「${c.name}」の動画を ${rateTxt(r)} で再生します` : `「${c.name}」の再生速度の指定を外しました`); }
  }
  if (!pop.contains(e.target) || s) pop.remove();
}, true);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") document.querySelector(".rate-pop")?.remove(); });

/* ---------- チャンネル別: 冒頭の〇秒を飛ばす / 最後の〇秒で止める(c.skip = { head, tail }。YouTube の再生画面で chrate.js が使う) ---------- */
const SK_HEAD = [0, 5, 10, 15, 20, 30, 45, 60, 90, 120], SK_TAIL = [0, 5, 10, 15, 20, 30, 45, 60, 90, 120];
const skipTxt = (c) => { const h = +c.skip?.head || 0, t = +c.skip?.tail || 0; return h || t ? [h ? `冒頭${h}秒` : "", t ? `最後${t}秒` : ""].filter(Boolean).join("・") : ""; };
const skipBtn = (c) => `<button type="button" class="chr-rate ${skipTxt(c) ? "on" : ""}" data-chskip="${esc(c.id)}" title="${skipTxt(c) ? `冒頭を飛ばす・最後で止める: ${skipTxt(c)}(押すと変えられます)` : "このチャンネルの動画で、冒頭の〇秒を飛ばす・最後の〇秒で止める"}">⏭ ${skipTxt(c) || "スキップ"}</button>`;
function skipMenu(btn) {
  document.querySelector(".rate-pop")?.remove();
  const id = btn.dataset.chskip, c = data.channels?.[id]; if (!c) return;
  const m = document.createElement("div"); m.className = "rate-pop sk-pop"; m.dataset.skch = id;
  const sel = (k, list, label) => `<label class="sk-r"><span>${label}</span><select class="sel wsel" data-skset="${k}">${list.map((n) => `<option value="${n}" ${(+c.skip?.[k] || 0) === n ? "selected" : ""}>${n ? n + "秒" : "しない"}</option>`).join("")}</select></label>`;
  m.innerHTML = `<div class="rate-h">冒頭を飛ばす・最後で止める <small>${esc(c.name)}</small></div>${sel("head", SK_HEAD, "冒頭を飛ばす")}${sel("tail", SK_TAIL, "最後の〇秒で止める")}<small class="sk-n">オープニングや、終わりのお知らせ・エンドカードを飛ばすのに使います。途中から開いたときは飛ばしません。</small>`;
  document.body.appendChild(m);
  const b = btn.getBoundingClientRect(), w = m.offsetWidth, h = m.offsetHeight;
  m.style.left = Math.max(8, Math.min(innerWidth - w - 8, b.left)) + "px";
  m.style.top = (b.bottom + 6 + h > innerHeight ? Math.max(8, b.top - h - 6) : b.bottom + 6) + "px";
}
document.addEventListener("change", async (e) => {
  const s = e.target.closest?.("[data-skset]"); if (!s) return;
  const id = s.closest(".sk-pop")?.dataset.skch, c = data.channels?.[id]; if (!c) return;
  c.skip = { ...(c.skip || {}), [s.dataset.skset]: +s.value };
  if (!c.skip.head && !c.skip.tail) delete c.skip;
  await persist(); paintRow(id);
});
/* ---------- チャンネル別: 新着のお知らせ(c.notify。PC の通知。background.js が15分ごとに確かめる) ---------- */
const notifyBtn = (c) => `<button type="button" class="chr-rate chr-bell ${c.notify ? "on" : ""}" data-chnotify="${esc(c.id)}" title="${c.notify ? "新着をお知らせします(押すと止める)" : "新着をお知らせしない(押すとお知らせする)。タイトルに LIVE・緊急などがある動画は、この設定に関係なくお知らせします"}" aria-pressed="${!!c.notify}">${c.notify ? "🔔" : "🔕"}</button>`;
addEventListener("scroll", () => document.querySelector(".rate-pop")?.remove(), true);
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
  sgMemo = null; // 描き直しのたびに、候補は計算し直す(フォルダ・キーワード・登録の変更を反映)
  const all = chIn(t), list = (chPer >= 0 || chKind !== "all" ? all.filter(chPassPer) : all).filter(chQOk), f = data.folders.find((x) => x.id === t), miss = all.filter((c) => !c.stats).length;
  curFolderForRow = f ? f.id : "";
  const last = +ls.get("tf-ch-sync", "0");
  // YouTubeと同期: めったに使わないので、見出しの右端に小さく置く
  const sync = t === "channels" || t === "uncat" ? `<span class="ch-sync"><span class="sync-i">${useDummy ? "ダミー表示中(設定で切り替え)" : last ? "最終同期 " + new Date(last).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "未同期"}</span><button type="button" class="s-op" data-act="sync" ${syncing ? "disabled" : ""} title="YouTubeの登録チャンネルを取り込み直します">${syncing ? "同期中…" : "⟳ YouTubeと同期"}</button></span>` : "";
  const sib = f ? data.folders.filter((x) => (x.parent || "") === (f.parent || "")) : [], si = f ? sib.indexOf(f) : -1;
  const mv = f ? `<button class="btn s" data-act="up" data-id="${esc(f.id)}" ${si <= 0 ? "disabled" : ""} title="フォルダを上へ">▲ 上へ</button><button class="btn s" data-act="down" data-id="${esc(f.id)}" ${si >= sib.length - 1 ? "disabled" : ""} title="フォルダを下へ">▼ 下へ</button>${f.parent ? `<button class="btn s" data-act="unnest" data-id="${esc(f.id)}" title="親フォルダの外(ひとつ上の階層)へ出します">入れ子を解除</button>` : ""}` : "";
  const fa = ""; // フォルダの操作(上へ・下へ・名前の変更・削除など)は、サイドバーのフォルダ行の ▲▼ と「⋯」メニューで行う
  const modeSw = `<span class="s-chips" role="radiogroup" aria-label="表示の切り替え"><span class="s-cl">表示</span><button type="button" class="tab ${statMode === "count" ? "on" : ""}" data-statmode="count" role="radio" aria-checked="${statMode === "count"}">投稿数</button><button type="button" class="tab ${statMode === "last" ? "on" : ""}" data-statmode="last" role="radio" aria-checked="${statMode === "last"}">最新の投稿</button></span>`;
  // 調べるための操作(検索の「記号」と同じ小さなボタン)
  // 右: 調べる操作(1段目「期間別に調べる」、2段目「未取得を取得」と調査の進み具合)
  const tools = all.length ? `<div class="ch-tools"><div class="ch-tr"><span class="s-cl">調べる</span><button type="button" class="s-op s-dice" data-act="statsall" ${statBusy.size ? "disabled" : ""} title="表示中のチャンネルの、動画・ライブ配信・ショートの投稿数を期間ごとに調べます">📊 期間別に調べる(${all.length}件)</button></div><div class="ch-tr"><span class="sync-i" id="cs-bar">${statBusy.size ? `調査中 ${statRun.done} / ${statRun.total}` : ""}</span><button type="button" class="s-op" data-act="statsmiss" ${statBusy.size || !miss ? "disabled" : ""} title="まだ調べていないチャンネルだけを、調べます">未取得を取得(${miss}件)</button></div></div>` : "";
  // 区切り線の下: 左にチャンネル名の検索、右に「候補を隠す」「すべて開く」
  const sgN = sgCount(list);
  const bar2 = all.length ? `<div class="ch-bar2"><label class="ch-q">${SEARCH_ICO}<input type="search" id="ch-q" placeholder="チャンネル名で検索" value="${esc(chQ)}" autocomplete="off"></label>${chPerNote(all, list)}${chQ ? `<span class="sync-i">${list.length}件</span>` : ""}<span class="ch-tr ch-b2r">${sgN ? `<button type="button" class="s-op ${sgShow ? "on" : ""}" data-sgshow aria-pressed="${sgShow}" title="${sgShow ? "フォルダ登録の補助機能を非表示にする" : "フォルダ登録の補助機能を表示する"}">${sgShow ? "登録補助を非表示" : "登録補助を表示"}(${sgN})</button>` : ""}<button type="button" class="s-op" data-act="statsopen">${list.length && list.every((c) => chOpen.has(c.id)) ? "投稿履歴を閉じる" : "投稿履歴を開く"}</button></span></div>` : "";
  const empty = t === "channels"
    ? (useDummy ? "ダミーのチャンネルを準備しています…" : "登録チャンネルがありません。「YouTubeと同期」を押すと、YouTubeの登録チャンネルを取り込みます。")
    : "このフォルダにはチャンネルがありません。チャンネルの📁ボタンか、ドラッグで追加できます。";
  const crumb = f && f.parent ? `<div class="crumb"><button class="tab" data-t="${esc(f.parent)}">↑ ${esc(folderPath(f.parent))}</button></div>` : "";
  return `<section class="row"><h2 class="ch-h">${esc(folderName(t))}<small>${list.length !== all.length ? `${list.length} / ${all.length}` : list.length}チャンネル</small>${sync}</h2>
    <div class="fm2">
    <div class="fm2-main">${crumb}${all.length ? `<div class="ch-panel"><div class="ch-filters"><div class="ch-fr">${modeSw}${chPerBar(1)}</div><div class="ch-fr">${chPerBar(2)}</div></div>${tools}</div>${bar2}` : ""}
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
    if (b.dataset.act === "statsmiss") return runStats(list.filter((c) => !c.stats).map((c) => c.id));
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
// 出す種類(設定): チェックを外した種類は出さない。全部外したら、プレビュー自体を出さない
const pvKinds = new Set((ls.get("tf-ch-pvk", "video,live,short,pop") || "").split(",").filter(Boolean));
for (const cb of $("set-pvk").querySelectorAll("input")) {
  cb.checked = pvKinds.has(cb.value);
  cb.onchange = () => { cb.checked ? pvKinds.add(cb.value) : pvKinds.delete(cb.value); ls.set("tf-ch-pvk", PV_SECTIONS.map(([k]) => k).filter((k) => pvKinds.has(k)).join(",")); hidePv(); };
}
let pvOn = ls.get("tf-ch-pvon", "1") !== "0"; // マウスオーバーのプレビューを出すか(設定。ドライブ同期の対象)
$("set-pvon").checked = pvOn;
$("set-pvon").onchange = () => { pvOn = $("set-pvon").checked; ls.set("tf-ch-pvon", pvOn ? "1" : "0"); if (!pvOn) hidePv(); };
const pvOff = () => !pvOn || pvN === 0 || !pvKinds.size;
const pvCache = new Map(); // チャンネルID -> { at, data | promise }
let pvTimer = 0, pvHide = 0, pvId = "", pvLast = null;

// チャンネルページを読む(動画一覧と、並び替え「人気」の続きのトークンを取り出す)
async function ytRaw(url) {
  const html = await (await fetch(url, { credentials: "include" })).text();
  const a = html.indexOf("ytInitialData = "), b = html.indexOf(";</script>", a);
  if (a < 0 || b < 0) throw new Error("data");
  YTA.useHtml(html);
  const root = JSON.parse(html.slice(a + 16, b));
  let pop = "";
  (function w(n) { if (pop || !n || typeof n !== "object") return; const cv = n.chipViewModel; if (cv && /人気|Popular/i.test(cv.text || "")) { pop = cv.tapCommand?.innertubeCommand?.continuationCommand?.token || ""; return; } Object.values(n).forEach(w); })(root);
  return { list: collectVideos(root).list, pop, desc: root.metadata?.channelMetadataRenderer?.description || "" };
}
async function fetchPreview(c) {
  const base = c.base || `https://www.youtube.com/channel/${encodeURIComponent(c.id)}`, none = { list: [], pop: "", desc: "" };
  const [v, l, s] = await Promise.all(["videos", "streams", "shorts"].map((t) => ytRaw(`${base}/${t}?hl=ja`).catch(() => none)));
  let pop = [];
  if (v.pop) { try { pop = collectVideos(await YTA.browse(v.pop)).list; } catch {} }
  return { desc: v.desc || l.desc || s.desc, video: v.list, live: l.list, short: s.list.map((x) => ({ ...x, kind: "short" })), pop };
}
function pvCard(v, c) {
  vmap.set(v.id, { ...(vmap.get(v.id) || {}), ...v, channel: v.channel || c.name });
  return `<button type="button" class="pv-c ${v.kind === "short" ? "sh" : ""}" data-v="${esc(v.id)}" title="${esc(v.title)}"><span class="pv-th"><img loading="lazy" src="${thumb(v.id)}" alt="">${v.duration ? `<em>${esc(v.duration)}</em>` : ""}</span><span class="pv-x"><span class="pv-t">${esc(v.title)}</span>${v.pub ? `<small>${esc(v.pub)}</small>` : ""}</span></button>`;
}
// 説明文: 日本語でない行は日本語に翻訳する(翻訳は動画の表示とは別に行い、できたら差し替える)。4行より長ければ「続きを読む」で下に開く
const JA_RE = /[぀-ヿ一-鿿]/, LET_RE = /[\p{L}]/u;
async function pvTrDesc(d) {
  if (d.ja !== undefined || d.jaP) return d.jaP;
  const lines = d.desc.split(/\r?\n/), idx = [];
  lines.forEach((s, i) => { if (idx.length < 40 && LET_RE.test(s) && !JA_RE.test(s)) idx.push(i); });
  if (!idx.length) { d.ja = d.desc; return; }
  return d.jaP = Promise.race([YTA.translateMany(idx.map((i) => lines[i])), new Promise((r) => setTimeout(() => r(null), 20000))]).then((out) => {
    const L = lines.slice(); (out || []).forEach((r, k) => { if (r?.text) L[idx[k]] = r.text; });
    d.ja = L.join("\n");
  }).catch(() => { d.ja = d.desc; });
}
function pvDescFit(el) {
  const p = el?.querySelector(".pv-d"), b = el?.querySelector("[data-pvm]"); if (!p || !b) return;
  const open = p.classList.contains("open");
  b.hidden = !open && p.scrollHeight <= p.clientHeight + 1;
}
async function pvDescInit(el, d, t) {
  if (!d?.desc) return;
  pvDescFit(el);
  if (d.ja === undefined) {
    await pvTrDesc(d);
    const p = $("pv")?.querySelector(".pv-d"); if (!p || $("pv") !== el) return;
    p.textContent = d.ja ?? d.desc; pvDescFit(el); placePv(t);
  }
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-pvm]"); if (!b) return;
  const p = b.parentElement.querySelector(".pv-d"); p.classList.toggle("open"); b.textContent = p.classList.contains("open") ? "閉じる ▴" : "続きを読む ▾";
  const t = pvLast; if (t) placePv(t);
});
function pvHtml(c, d) {
  const secs = PV_SECTIONS.filter(([k]) => pvKinds.has(k));
  const cols = secs.map(([k, n]) => `<div class="pv-s"><h4>${n}</h4>${d ? (d[k].length ? d[k].slice(0, pvN).map((v) => pvCard(v, c)).join("") : `<p class="pv-e">ありません</p>`) : `<p class="pv-e">読み込み中…</p>`}</div>`).join("");
  return `<div class="pv-h"><b>${esc(c.name)}</b></div>${d?.desc ? `<div class="pv-dw"><p class="pv-d">${esc(d.ja ?? d.desc)}</p><button type="button" class="pv-m" data-pvm hidden>続きを読む ▾</button></div>` : ""}<div class="pv-g" style="--pvc:${secs.length};--pvc2:${Math.min(2, secs.length)}">${cols}</div>`;
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
  const h = e.target.closest(".chr-h"); if (!h || e.target.closest(".chr-rate,.chr-i,.chr-x")) return null; // 倍速・フォルダなどのボタンの上では出さない(押しやすく)
  const c = data.channels?.[h.closest(".chr")?.dataset.chid];
  return c ? { key: c.id, ck: c.id, c, anchor: h, side: "right" } : null;
}
async function showPv(t) {
  if (!t || pvOff()) return;
  const { c, key, anchor, side } = t;
  hidePv(); pvId = key; t.rect = anchor.getBoundingClientRect();
  const el = document.createElement("div"); el.id = "pv"; el.setAttribute("role", "tooltip"); document.body.append(el);
  if (c.dummy) { el.innerHTML = `<div class="pv-h"><b>${esc(c.name)}</b></div><p class="pv-e" style="padding:8px 4px">ダミーのチャンネルのため、動画は表示できません。</p>`; return placePv(t); }
  const ck = t.ck || key; let ent = pvCache.get(ck);
  if (!ent || Date.now() - ent.at > 30 * 60 * 1000) { ent = { at: Date.now(), data: null, p: fetchPreview(c).then((d) => { ent.data = d; return d; }).catch(() => { pvCache.delete(ck); return null; }) }; pvCache.set(ck, ent); }
  pvLast = t; el.innerHTML = pvHtml(c, ent.data); placePv(t); pvDescInit(el, ent.data, t);
  if (!ent.data) { await ent.p; if (pvId !== key || !$("pv")) return; if (ent.data) setTimeout(() => pvDescInit(el, ent.data, t), 0); el.innerHTML = ent.data ? pvHtml(c, ent.data) :`<div class="pv-h"><b>${esc(c.name)}</b></div><p class="pv-e" style="padding:8px 4px">読み込めませんでした(YouTubeへのログインや通信を確認してください)</p>`; placePv(t); }
}
function hidePv() { clearTimeout(pvTimer); clearTimeout(pvHide); $("pv")?.remove(); pvId = ""; }
document.addEventListener("mouseover", (e) => {
  if (pvOff()) return;
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

/* フォルダを押したときの「一覧」表示: そのフォルダに登録されているチャンネルの動画を、新しい順に並べる(チャンネルの管理は「設定」側の画面)
   動画は YouTube の「登録チャンネルの新着」から読み(search.js の S.sub)、そのフォルダ(サブフォルダを含む)のチャンネルのものだけを出す */
function folderListView(t) {
  const f = data.folders.find((x) => x.id === t), list = chIn(t);
  curFolderForRow = f ? f.id : "";
  const crumb = f && f.parent ? `<div class="crumb"><button class="tab" data-t="${esc(f.parent)}">↑ ${esc(folderPath(f.parent))}</button></div>` : "";
  if (!S.sub.started) loadSub(true); // 新着をまだ読んでいなければ、読み始める(読むたびに paintFolderList で描き直す)
  setTimeout(paintFolderList, 0);
  // 一覧: 見出しの右に「▶ 連続再生」、その下に 隠す・表示(グリッド/リスト)・列数(再生リストのページと同じ操作バー)。「投稿が〇日以内」の絞り込みは使わない
  return `<section class="row"><div class="lh-row"><h2>${esc(folderName(t))}<small>${list.length}チャンネル</small></h2><span id="fl-pq"></span></div>${crumb}${vbar(plHideRow())}<div id="fl-out"></div></section>`;
}
function paintFolderList() {
  const box = $("fl-out"); if (!box || folderMode !== "list") return;
  const t = tab, ids = new Set(chIn(t).map((c) => c.id)), st = S.sub;
  let h = "";
  if (!ids.size) h = `<div class="empty" style="margin:0">このフォルダにはチャンネルがありません。「設定」にして、📁ボタンかドラッグで追加できます。</div>`;
  else {
    const items = shown(st.list).filter((v) => { const c = v.channel ? subMap().get(subNorm(v.channel)) : null; return c && ids.has(c.id) && !(plHideW && isDone(v.id, v)) && !(plHideM && v.mem); }).sort((a, b) => (vDate(b)?.getTime() || 0) - (vDate(a)?.getTime() || 0));
    const pq = $("fl-pq"); if (pq) pq.innerHTML = items.length ? playBar(items.map((v) => [v.id, v])) : ""; // 連続再生(playq.js)
    if (st.err) h += `<div class="empty" style="margin:12px 0">${esc(st.err)}</div>`;
    if (items.length) h += mixedGrid(items);
    if (st.busy) h += `<div class="s-load">読み込み中…${items.length ? `(${items.length}本)` : ""}</div>`;
    else {
      if (!items.length && !st.err) h += `<div class="empty" style="margin:0">最近の動画が見つかりません。下の「さらに過去を読む」で、もっと前の動画まで読み込めます。</div>`;
      h += `<div class="s-more"><button class="btn s" data-act="fl-more">さらに過去を読む(+7日)</button>${st.started ? `<button class="btn s" data-act="fl-reload">⟳ 読み込み直す</button>` : ""}</div>`;
    }
  }
  if (box._h === h) return; // 中身が同じなら描き直さない(ちらつき防止)
  box._h = h; box.innerHTML = h;
}
document.addEventListener("click", (e) => {
  const m = e.target.closest('[data-act="fl-more"],[data-act="fl-reload"]'); if (!m) return;
  e.preventDefault(); e.stopPropagation();
  const st = S.sub;
  if (m.dataset.act === "fl-more") { st.extra = (st.extra || 0) + 7; st.done = false; loadSub(false); }
  else { st.extra = 0; loadSub(true); }
}, true);
document.addEventListener("click", (e) => { // サイドバーの「設定 / 一覧」の切り替え
  const b = e.target.closest("[data-fmode]"); if (!b) return;
  e.preventDefault(); e.stopPropagation();
  folderMode = b.dataset.fmode === "manage" ? "manage" : "list"; ls.set("tf-folder-mode", folderMode); render();
}, true);

/* ---------- 期間で絞り込む(「3日以内」など) ----------
   ・設定モードのチャンネル一覧: 「最新の投稿が 〇〇 以内」のチャンネルだけを出す(調べ済みのチャンネルが対象。動画・ライブ・ショートのどれかが期間内)
   ・一覧モードの動画: 投稿から 〇〇 以内の動画だけを出す(期間が長いときは、新着をさかのぼって読み込む) */
let chPer = +ls.get("tf-ch-per", "-1"); if (!(chPer >= 0 && chPer <= PERIODS.length)) chPer = -1; // PERIODS.length(7) = 1年以上
let chKind = ls.get("tf-ch-kind", "all"); if (!["all", "video", "live", "short"].includes(chKind)) chKind = "all"; // 絞り込みで見る投稿の種類
let flPer = +ls.get("tf-fl-per", "-1"); if (!(flPer >= 0 && flPer < PERIODS.length)) flPer = -1;
const chPassPer = (c) => {
  if (!c.stats) return false;
  const idx = STAT_KINDS.filter(([k]) => chKind === "all" || chKind === k).map(([k]) => lastInfo(c.stats, k).idx).filter((i) => i >= 0);
  if (!idx.length) return false;
  if (chPer === PERIODS.length) return idx.every((i) => i === PERIODS.length); // 1年以上: いちばん新しい投稿でも1年より前
  return chPer < 0 || idx.some((i) => i <= chPer);
};
const perButtons = (cur, attr, over) => `<button type="button" class="tab ${cur < 0 ? "on" : ""}" data-${attr}="-1">すべて</button>` + PERIODS.map(([n], i) => `<button type="button" class="tab ${cur === i ? "on" : ""}" data-${attr}="${i}">${n}</button>`).join("")
  + (over ? `<button type="button" class="tab ${cur === PERIODS.length ? "on" : ""}" data-${attr}="${PERIODS.length}">1年以上</button>` : "");
// 絞り込み: 「最新の投稿が」〔種類〕「の」〔期間〕以内(検索の「対象」「種類」と同じ見た目)
const chPerBar = (part) => (part === 2 ? "" : `<span class="s-chips" role="group" aria-label="投稿の種類"><span class="s-cl">種類</span>${[["all", "すべて"], ...STAT_KINDS].map(([k, n]) => `<button type="button" class="tab ${chKind === k ? "on" : ""}" data-chkind="${k}">${k === "all" ? "すべて" : n}</button>`).join("")}</span>`)
  + (part === 1 ? "" : `<span class="s-chips" role="group" aria-label="最新の投稿の期間で絞り込む"><span class="s-cl">最新の投稿</span>${perButtons(chPer, "chper", true)}</span>`);
// 絞り込み中の件数(調べていないチャンネルは対象外)
function chPerNote(all, list) {
  if (chPer < 0 && chKind === "all") return "";
  const miss = all.filter((c) => !c.stats).length;
  return `<span class="sync-i">絞り込み ${list.length}件${miss ? ` ・ 未調査の${miss}件は対象外` : ""}</span>`;
}
document.addEventListener("click", (e) => { // 投稿の種類(すべて / 動画 / ライブ配信 / ショート)
  const b = e.target.closest("[data-chkind]"); if (!b) return;
  e.preventDefault(); e.stopPropagation(); chKind = b.dataset.chkind; ls.set("tf-ch-kind", chKind); render();
}, true);
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-chper],[data-flper]"); if (!b) return;
  e.preventDefault(); e.stopPropagation();
  if (b.dataset.chper !== undefined) { chPer = +b.dataset.chper; ls.set("tf-ch-per", String(chPer)); return render(); }
  flPer = +b.dataset.flper; ls.set("tf-fl-per", String(flPer));
  if (flPer >= 0 && !useDummy) { // 選んだ期間まで新着が読み込まれていなければ、さかのぼって読む
    const need = Math.max(0, PERIODS[flPer][1] - S_DAYS), st = S.sub;
    if ((st.extra || 0) < need) { st.extra = need; if (st.started) { st.done = false; loadSub(false); } }
  }
  render();
}, true);
