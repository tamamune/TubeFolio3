/* ===== 急上昇(日本) と Google の急上昇ワード =====
   ・急上昇動画: youtube-trending.info の日別の一覧(最大約200本。取り出しは background.js の trendDay)
     ホームの行「急上昇(日本)」と、すべて表示の画面(日付の移動・ジャンルの選択・連続再生)
   ・急上昇ワード: Google トレンド(日本)。検索画面の「🔥 急上昇」で開く。押すとそのワードで検索 */
const TR_CAT = { "Film & Animation": "映画とアニメ", "Autos & Vehicles": "自動車と乗り物", Music: "音楽", "Pets & Animals": "ペットと動物", Sports: "スポーツ", "Travel & Events": "旅行とイベント", Gaming: "ゲーム", "People & Blogs": "ブログ", Comedy: "コメディー", Entertainment: "エンターテイメント", "News & Politics": "ニュースと政治", "Howto & Style": "ハウツーとスタイル", Education: "教育", "Science & Technology": "科学と技術", "Nonprofits & Activism": "非営利団体と社会活動" };
const trCatName = (c) => TR_CAT[c] || c || "その他";
const trYmd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const trToday = () => trYmd(new Date());
let trDate = "", trCat = ls.get("tf-trd-cat", ""); // 見ている日付("" = いちばん新しい日) / ジャンル("" = すべて。ドライブ同期の対象)
const trData = {}, trErr = {}, trdBusy = new Set();
let trLatest = ""; // データがあった、いちばん新しい日

// 日付の一覧を取る(今日の分がまだなければ、前の日へさかのぼる)
async function trLoad(date) {
  if (trData[date] || trdBusy.has(date)) return;
  trdBusy.add(date);
  const r = await chrome.runtime.sendMessage({ tf: "trend", date }).catch((e) => ({ ok: false, error: e?.message }));
  trdBusy.delete(date);
  if (r?.ok) { trData[date] = r.v; delete trErr[date]; if (!trLatest || date > trLatest) trLatest = date; }
  else trErr[date] = r?.error || "取得できませんでした";
  if (tab === "all" || tab === "list:trend") render();
}
let trFind = null;
function trLatestDay() { // いちばん新しい日を探す(今日 → 昨日 → 一昨日)。探している間は同じ探し方を使い回す
  if (trLatest) return Promise.resolve(trLatest);
  return (trFind ||= (async () => {
    for (let i = 0; i < 3; i++) { const d = trYmd(new Date(Date.now() - i * 864e5)); await trLoad(d); if (trData[d]) return d; }
    return "";
  })().finally(() => { trFind = null; if (tab === "all" || tab === "list:trend") render(); }));
}
const trShift = (date, kind, n) => { const d = new Date(date + "T12:00:00"); if (kind === "M") d.setMonth(d.getMonth() + n); else d.setDate(d.getDate() + n * (kind === "W" ? 7 : 1)); return trYmd(d); };
// 一覧のカードにする([id, v])
const trItems = (list) => (list || []).filter((x) => !trCat || x.cat === trCat).map((x) => [x.id, { title: x.title, channel: x.ch, chUrl: x.chId ? "/channel/" + x.chId : "", duration: String(x.len || "").replace(/^0(\d:)/, "$1"), pub: x.pub ? x.pub.replace(/-/g, "/") + " 公開" : "", views: x.views ? x.views + " 回視聴" : "", rank: x.rank, chg: x.chg }]);
const trRank = ([, v]) => `<span class="trk" title="急上昇の順位${v.chg && v.chg !== "=" ? `(前日から ${esc(v.chg)})` : ""}">#${v.rank}</span>`;
const trLabel = (d) => { const x = new Date(d + "T12:00:00"); return `${x.getMonth() + 1}/${x.getDate()}(${"日月火水木金土"[x.getDay()]})`; };

// ホームの行
function trendRow() {
  const d = trDate || trLatest;
  if (!d) { trLatestDay(); return note("急上昇(日本)", "読み込み中…"); }
  if (!trData[d]) { trLoad(d); return note("急上昇(日本)", esc(trErr[d] || "読み込み中…")); }
  const items = trItems(trData[d]);
  return items.length ? rail(`急上昇(日本) ・ ${trLabel(d)}${trCat ? " ・ " + trCatName(trCat) : ""}`, items.slice(0, 40).map((e) => cardWith(e, trRank(e))).join(""), items.length, "本", "list:trend") : note("急上昇(日本)", `「${esc(trCatName(trCat))}」の動画はこの日の急上昇にありません`);
}
// すべて表示: 日付の移動・ジャンル・連続再生
function trendView() {
  const back = `<button class="seeall back" data-t="all">‹ ホームへ戻る</button>`;
  const d = trDate || trLatest;
  if (!d) { trLatestDay(); return `<section class="row">${back}<h2>急上昇(日本)</h2><div class="empty" style="margin-top:0">読み込み中…</div></section>`; }
  if (!trData[d] && !trErr[d]) trLoad(d);
  const list = trData[d] || [], items = trItems(list), today = trToday();
  const cats = [...new Set(list.map((x) => x.cat).filter(Boolean))].sort((a, b) => list.filter((x) => x.cat === b).length - list.filter((x) => x.cat === a).length);
  const nb = (kind, n, t) => { const to = trShift(d, kind, n); return `<button type="button" data-trgo="${to}" ${to > today ? "disabled" : ""} title="${to}">${t}</button>`; };
  const nav = `<div class="tr-nav"><span class="grp">${nb("M", -1, "-1か月")}${nb("W", -1, "-1週")}${nb("D", -1, "-1日")}</span><label class="grp tr-date"><span class="s-cl">日付</span><input type="date" id="tr-date" value="${d}" max="${today}"></label><span class="grp">${nb("D", 1, "+1日")}${nb("W", 1, "+1週")}${nb("M", 1, "+1か月")}</span>`
    + `<label class="grp"><span class="s-cl">ジャンル</span><select class="wsel" id="tr-cat"><option value="">すべて(${list.length})</option>${[...new Set([...cats, ...(trCat && !cats.includes(trCat) ? [trCat] : [])])].map((c) => `<option value="${esc(c)}" ${c === trCat ? "selected" : ""}>${esc(trCatName(c))}(${list.filter((x) => x.cat === c).length})</option>`).join("")}</select></label>`
    + `<a class="pill" href="https://youtube-trending.info/?date=${d}#section_JP" target="_blank" rel="noopener" title="元のサイトを開く">youtube-trending.info ↗</a></div>`;
  const body = trData[d] ? (items.length ? vbar() + playBar(items) + vgrid(items.map((e) => cardWith(e, trRank(e))).join("")) : `<div class="empty" style="margin-top:0">「${esc(trCatName(trCat))}」の動画は、この日の急上昇にありません。</div>`)
    : `<div class="empty" style="margin-top:0">${esc(trErr[d] || "読み込み中…")}</div>`;
  return `<section class="row">${back}<h2>急上昇(日本) ・ ${trLabel(d)}<small>${items.length}本</small></h2>${nav}${body}</section>`;
}
document.addEventListener("click", (e) => { const b = e.target.closest("[data-trgo]"); if (!b || b.disabled) return; trDate = b.dataset.trgo; render(); });
document.addEventListener("change", (e) => {
  if (e.target.id === "tr-date" && /^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) { trDate = e.target.value > trToday() ? trToday() : e.target.value; render(); }
  if (e.target.id === "tr-cat") { trCat = e.target.value; ls.set("tf-trd-cat", trCat); render(); }
});

/* ---------- Google の急上昇ワード(検索画面) ---------- */
let gtOpen = ls.get("tf-gt-open", "0") === "1", gtHours = +ls.get("tf-gt-hours", "24"); if (![4, 24, 48, 168].includes(gtHours)) gtHours = 24;
let gtData = null, gtErr = "", gtBusy = false;
async function gtLoad(force) {
  if (gtBusy || (!force && gtData?.hours === gtHours && Date.now() - gtData.at < 30 * 60000)) return;
  gtBusy = true; gtPaint();
  const r = await chrome.runtime.sendMessage({ tf: "gtrends", hours: gtHours }).catch((e) => ({ ok: false, error: e?.message }));
  gtBusy = false;
  if (r?.ok) { gtData = r.r; gtErr = ""; } else gtErr = r?.error || "取得できませんでした";
  gtPaint();
}
const gtBtn = () => `<button type="button" class="pill ${gtOpen ? "on" : ""}" data-gt="toggle" aria-expanded="${gtOpen}" title="Google トレンド(日本)の急上昇ワード。押したワードで検索します">🔥 急上昇 ${gtOpen ? "▴" : "▾"}</button>`;
const gtPanel = () => `<div class="gt" id="gt" ${gtOpen ? "" : "hidden"}></div>`;
function gtPaint() {
  const box = $("gt"); if (!box) return;
  box.hidden = !gtOpen; if (!gtOpen) return;
  const per = [[4, "4時間"], [24, "24時間"], [48, "48時間"], [168, "7日間"]];
  const head = `<div class="gt-h"><span class="grp"><span class="s-cl">Google の急上昇ワード</span>${per.map(([h, t]) => `<button type="button" class="tab ${gtHours === h ? "on" : ""}" data-gth="${h}">${t}</button>`).join("")}</span><button type="button" class="pill" data-gt="reload" title="取り直す">⟳</button><small>${gtData && !gtBusy ? `${new Date(gtData.at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })} 時点 ・ ${gtData.items.length}語 ・ 乗せるとニュース・押すとキーワード欄へ` : ""}</small></div>`;
  const words = gtBusy && !gtData ? `<div class="gt-n">読み込み中…</div>` : gtErr && !gtData ? `<div class="gt-n">${esc(gtErr)}</div>`
    : `<div class="gt-l">${(gtData?.items || []).map((x, i) => `<button type="button" class="gt-w" data-gtw="${esc(x.w)}" aria-label="${esc(x.w)}"><i>${i + 1}</i>${esc(x.w)}${x.vol ? `<small>${x.vol >= 10000 ? Math.round(x.vol / 10000) + "万+" : x.vol >= 1000 ? Math.round(x.vol / 1000) + "千+" : x.vol + "+"}</small>` : ""}</button>`).join("")}</div>`;
  box.innerHTML = head + words;
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-gt],[data-gth],[data-gtw]"); if (!b) return;
  if (b.dataset.gt === "toggle") { gtOpen = !gtOpen; ls.set("tf-gt-open", gtOpen ? "1" : "0"); b.outerHTML = gtBtn(); gtPaint(); if (gtOpen) gtLoad(false); return; }
  if (b.dataset.gt === "reload") return gtLoad(true);
  if (b.dataset.gth) { gtHours = +b.dataset.gth; ls.set("tf-gt-hours", String(gtHours)); gtData = null; gtPaint(); return gtLoad(true); }
  if (b.dataset.gtw) { // そのワードをキーワード欄に入れる(検索は、検索ボタンか Enter で)
    const i = $("s-q"); if (!i) return;
    i.value = b.dataset.gtw; i.focus(); i.setSelectionRange(i.value.length, i.value.length);
    i.dispatchEvent(new Event("input", { bubbles: true })); gnHide();
  }
});
/* マウスを乗せたら、そのワードのニュースを3件出す(Bing ニュース / Google ニュース。押すと記事を新しいタブで開く) */
const gnCache = new Map(); let gnTimer = 0, gnFor = "", gnHideT = 0;
const gnHide = () => { clearTimeout(gnTimer); clearTimeout(gnHideT); gnFor = ""; document.querySelector(".gn-pop")?.remove(); };
const gnAgo = (d) => { const t = Date.parse(d); if (!t) return ""; const m = Math.round((Date.now() - t) / 60000); return m < 60 ? `${Math.max(1, m)}分前` : m < 1440 ? `${Math.round(m / 60)}時間前` : `${Math.round(m / 1440)}日前`; };
function gnShow(btn, q, news) {
  document.querySelector(".gn-pop")?.remove();
  const p = document.createElement("div"); p.className = "gn-pop";
  p.innerHTML = `<div class="gn-h">📰 「${esc(q)}」のニュース</div>` + (news == null ? `<div class="gn-n">読み込み中…</div>` : news.length ? news.map((n) => `<a class="gn-i" href="${esc(n.url)}" target="_blank" rel="noopener">${n.img ? `<img src="${esc(n.img)}" alt="" loading="lazy">` : ""}<span><b>${esc(n.title)}</b><small>${esc([n.source, gnAgo(n.date)].filter(Boolean).join(" ・ "))}</small></span></a>`).join("") : `<div class="gn-n">ニュースが見つかりませんでした</div>`)
    + `<div class="gn-f">押すとキーワード欄に入ります</div>`;
  document.body.appendChild(p);
  const r = btn.getBoundingClientRect(), w = p.offsetWidth, h = p.offsetHeight;
  p.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left)) + "px";
  p.style.top = (r.bottom + 6 + h > innerHeight - 8 ? Math.max(8, r.top - h - 6) : r.bottom + 6) + "px";
  p.addEventListener("mouseenter", () => clearTimeout(gnHideT)); p.addEventListener("mouseleave", () => { gnHideT = setTimeout(gnHide, 250); });
}
document.addEventListener("mouseover", (e) => {
  const b = e.target.closest?.("[data-gtw]");
  if (!b) { if (gnFor && !e.target.closest?.(".gn-pop")) { clearTimeout(gnTimer); clearTimeout(gnHideT); gnHideT = setTimeout(gnHide, 250); } return; }
  const q = b.dataset.gtw; clearTimeout(gnHideT); if (q === gnFor) return;
  clearTimeout(gnTimer); gnFor = q;
  gnTimer = setTimeout(async () => {
    if (gnFor !== q) return;
    if (gnCache.has(q)) return gnShow(b, q, gnCache.get(q));
    gnShow(b, q, null);
    const r = await chrome.runtime.sendMessage({ tf: "gnews", q }).catch(() => null);
    const news = r?.news || []; gnCache.set(q, news);
    if (gnFor === q && b.isConnected) gnShow(b, q, news);
  }, 350);
});
