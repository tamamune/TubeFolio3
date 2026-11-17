/* ===== 登録済みチャンネルの見分け方テスト(A〜Dを切り替えて比べる) =====
   動画カードのチャンネル名/カードに、登録済みチャンネルだけ目立たない印を付ける。 */
const SUB_STYLES = [
  ["off", "なし", "印を付けません"],
  ["A", "A: 名前の色", "登録済みのチャンネル名だけ、ほんのり黄色にします"],
  ["B", "B: 小さな✓", "登録済みのチャンネル名の後ろに、小さな✓を付けます"],
  ["C", "C: 小さな点", "登録済みのチャンネル名の前に、小さな点を付けます"],
  ["D", "D: 下線", "登録済みの動画のサムネイルの下に、細いラインを引きます"],
];
let subStyle = ls.get("tf-sub-style", "B");
if (!SUB_STYLES.some(([k]) => k === subStyle)) subStyle = "B";
document.body.dataset.sub = subStyle;
const ACCS = [["amber", "オレンジ(標準)", "#ffb400"], ["green", "緑", "#3ddc84"], ["purple", "紫", "#b388ff"], ["gray", "グレー", "#d0d0d0"]];
let accent = ls.get("tf-accent", "amber");
if (!ACCS.some(([k]) => k === accent)) accent = "amber";
document.body.dataset.acc = accent;

const subNorm = (x) => String(x || "").normalize("NFKC").toLowerCase().trim();
let subMemo = { key: null };
function subMap() { // 登録チャンネル(同期済み)の 名前 -> チャンネル
  const key = data.channels || null, n = key ? Object.keys(key).length : 0;
  if (subMemo.key !== key || subMemo.n !== n || subMemo.d !== useDummy) {
    subMemo = { key, n, d: useDummy, map: new Map(chAll().filter((c) => c.subscribed !== false).map((c) => [subNorm(c.name), c])) };
  }
  return subMemo.map;
}
// ダミー動画は、見え方の確認用に偶数番号を「登録済み」として扱う
const isSubV = (v) => !!v && (v.dummy ? v.n % 2 === 0 : !!v.channel && subMap().has(subNorm(v.channel)));
// 動画のフォルダ名: 保存した動画はそのフォルダ、それ以外はチャンネルが入っているフォルダ
function folderLine(v) {
  let names = [];
  if (v.dummy) { const f = data.folders; if (f.length) names = [f[v.n % f.length].name]; }
  else {
    const ids = v.folders?.length ? v.folders : subMap().get(subNorm(v.channel))?.folders || [];
    names = ids.map((id) => data.folders.find((f) => f.id === id)?.name).filter(Boolean);
  }
  return names.length ? names.slice(0, 2).join("・") + (names.length > 2 ? ` +${names.length - 2}` : "") : "";
}
// 「3日前」などの相対表記から、アップロード日のおおよその日付を求める(か月・年は「約」付きで年月まで)
let dateMode = ls.get("tf-date-mode", ls.get("tf-show-abs", "0") === "1" ? "both" : "rel"); // rel=〇日前 / abs=日付 / both=両方
if (!["rel", "abs", "both"].includes(dateMode)) dateMode = "rel";
// 表記を dateMode に合わせて整える(日付が求められないときは〇日前のまま)
const dateTxt = (pub) => { const a = dateMode === "rel" ? "" : absDate(pub); return dateMode === "abs" ? a || pub : dateMode === "both" && a ? a + " ・ " + pub : pub; };
const UNIT = { "分": 6e4, "時間": 36e5, "日": 864e5, "週間": 6048e5, "か月": 2592e6, "ヶ月": 2592e6, "ヵ月": 2592e6, "年": 31536e6 };
const EN = { minute: "分", hour: "時間", day: "日", week: "週間", month: "か月", year: "年" };
function absDate(rel) {
  let m = /(\d+)\s*(分|時間|日|週間|か月|ヶ月|ヵ月|年)前/.exec(rel || "");
  let n, u;
  if (m) { n = +m[1]; u = m[2]; }
  else if ((m = /(\d+)\s*(minute|hour|day|week|month|year)s?\s*ago/i.exec(rel || ""))) { n = +m[1]; u = EN[m[2].toLowerCase()]; }
  else return "";
  const d = new Date(Date.now() - n * UNIT[u]), p = (x) => String(x).padStart(2, "0");
  return /月|年/.test(u) ? `約${d.getFullYear()}/${p(d.getMonth() + 1)}` : `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}`;
}
// 公開日(YYYY-MM-DD)から「3 週間前」などの表記を作る
function relFromDate(d) {
  const t = Date.now() - new Date(d + "T00:00:00").getTime(), day = 864e5;
  if (!(t >= 0)) return "";
  const [n, u] = t < day ? [0, "今日"] : t < 7 * day ? [Math.floor(t / day), "日"] : t < 30 * day ? [Math.floor(t / (7 * day)), "週間"] : t < 365 * day ? [Math.floor(t / (30 * day)), "か月"] : [Math.floor(t / (365 * day)), "年"];
  return n ? `${n} ${u}前` : u;
}
// 表記を dateMode に合わせる(公開日が正確に分かっているとき)
const dateTxtExact = (d) => { const a = d.replace(/-/g, "/"), r = relFromDate(d); return dateMode === "abs" ? a : dateMode === "both" ? a + " ・ " + r : r; };
// カードの情報: チャンネル名 / アップロード日(〇日前・日付)と、その隣にフォルダ名
// どの一覧でも「サムネイル(長さ) → タイトル → チャンネル → 公開日」の並びにそろえる(再生回数は出さない)
const cn = (v) => {
  const pub = v.pub || (v.dummy ? `${(v.n * 5) % 28 + 1}日前` : ""), fl = folderLine(v), s = isSubV(v);
  const left = v.pubDate ? dateTxtExact(v.pubDate) : pub ? dateTxt(pub) : "";
  // チャンネル名を押すと、そのチャンネルのページを開く(リンク先は data-ch。分からなければチャンネル名から探す。plmenu.js)
  const link = v.channel && !v.dummy ? ` data-ch="${esc(v.chUrl || "")}" data-chn="${esc(v.channel)}" role="link" tabindex="0"` : "";
  return `<small class="cn${s ? " sub" : ""}${link ? " link" : ""}"${link} title="${s ? "登録済みのチャンネル ・ " : ""}${link ? "チャンネルを開く" : ""}">${esc(v.channel)}</small>`
    + (left || fl ? `<small class="cm">${left ? `<span class="cmd">${esc(left)}</span>` : ""}${fl ? `<span class="cf" title="フォルダ">📁 ${esc(fl)}</span>` : ""}</small>` : "");
};
const subCls = (v) => (isSubV(v) ? "subc" : "");

function testView() {
  const mk = (i, name, sub) => `<div class="c ${sub ? "subc" : ""}"><div class="th">${dummyTh(i + 40)}<span class="dur">12:34</span></div><b>【サンプル】動画タイトル ${i}</b><small class="cn${sub ? " sub" : ""}"${sub ? ' title="登録済みのチャンネル"' : ""}>${name}</small><small class="cm"><span class="cmd">${dateTxt(i + "日前")}</span><span class="cf">📁 音楽</span></small></div>`;
  const accHtml = `<h2>テスト: 差し色</h2><p class="hint tst-h">ボタン・選択中の項目・進捗バーなどの色を切り替えます。</p><div class="acc-g" role="radiogroup">${ACCS.map(([k, n, col]) => `<button class="acc-c ${accent === k ? "on" : ""}" data-accent="${k}" role="radio" aria-checked="${accent === k}"><span class="acc-pv" style="--p:${col}"><i></i><em></em><u></u><s></s></span><span class="n">${n}</span></button>`).join("")}</div>`;
  return `<section class="row">${accHtml}<h2>テスト: 登録済みチャンネルの見分け方</h2>
    <p class="hint tst-h">方式を切り替えて見え方を比べます。選んだ方式は、ホーム・検索・ブックマークなど、すべての動画一覧に反映されます。</p>
    <div class="tst-sw" role="radiogroup">${SUB_STYLES.map(([k, n]) => `<button class="tab ${subStyle === k ? "on" : ""}" data-substyle="${k}" role="radio" aria-checked="${subStyle === k}">${n}</button>`).join("")}</div>
    <p class="hint tst-h">${esc(SUB_STYLES.find(([k]) => k === subStyle)[2])}</p>
    <div class="grid">${mk(1, "登録済みチャンネル", true)}${mk(2, "未登録チャンネル", false)}${mk(3, "登録済みチャンネル", true)}${mk(4, "未登録チャンネル", false)}</div></section>`;
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-substyle]"); if (!b) return;
  subStyle = b.dataset.substyle; ls.set("tf-sub-style", subStyle); document.body.dataset.sub = subStyle; render();
});

$("set-date").onchange = () => { dateMode = $("set-date").value; ls.set("tf-date-mode", dateMode); render(); };
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-accent]"); if (!b) return;
  accent = b.dataset.accent; ls.set("tf-accent", accent); document.body.dataset.acc = accent; render();
});
