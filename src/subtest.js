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
const ACCS = [["blue", "ブルー", "#7b8ff0"], ["lavender", "ラベンダー", "#b39dff"], ["violet", "バイオレット", "#a855f7"], ["pink", "ピンク", "#ff4fa0"], ["rose", "ローズゴールド", "#e8b0a8"], ["mauve", "モーブ", "#d0708c"], ["crimson", "クリムゾン", "#ff4d5e"], ["yolk", "山吹", "#ffc857"], ["lime", "黄緑", "#9ccc65"], ["forest", "深緑", "#5fb38d"], ["mint", "ミント", "#5ee6b0"], ["cyan", "シアン", "#3cc8e6"], ["dune", "砂色", "#b9ab98"], ["white", "白", "#f2f2f2"]];
// 以前の4色(オレンジ・緑・紫・グレー)は外したので、近い色に置き換える。最初の色は「山吹」
const ACC_OLD = { amber: "yolk", green: "mint", purple: "lavender", gray: "white" };
let accent = ls.get("tf-accent", "yolk");
if (ACC_OLD[accent]) { accent = ACC_OLD[accent]; ls.set("tf-accent", accent); }
if (!ACCS.some(([k]) => k === accent)) accent = "yolk";
document.body.dataset.acc = accent;
chrome.storage?.local.set({ "tf-accent": accent }); // YouTube の再生画面のツール(content.js)も、同じ色にする

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
const isSubV = (v) => !!v && (v.dummy ? v.n % 2 === 0 : v.sub === true || (!!v.channel && subMap().has(subNorm(v.channel))));
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

function paintLook() { const el = $("set-appear"); if (el) el.innerHTML = appearHtml(); } // 設定「一般」の先頭: 差し色・登録済みチャンネルの見分け方
function appearHtml() { // 設定の他の項目と同じ「ラベル + 右に操作」の行
  return `<div class="set-row"><span>色の変更 <small>ボタン・選択中の項目・進捗バーなどの色</small></span><span class="acc-dots" role="radiogroup">${ACCS.map(([k, n, col]) => `<button type="button" class="acc-d ${accent === k ? "on" : ""}" data-accent="${k}" role="radio" aria-checked="${accent === k}" title="${n}" style="background:${col}"></button>`).join("")}</span></div>
    <label class="set-row"><span>登録済みチャンネルの見分け方</span><select class="sel" id="set-substyle">${SUB_STYLES.map(([k, n]) => `<option value="${k}" ${subStyle === k ? "selected" : ""}>${n}</option>`).join("")}</select></label>`;
}
// テストのページ(サイドバー下のテストボタン)。今後のテスト項目をここに置く
function testView() {
  return `<section class="tp"><header class="tp-h"><h2>テスト</h2><p>テスト中の項目を置くページです。</p></header>
    <div class="tp-card"><label class="tp-r"><span class="tp-t"><b>ダミー表示</b><small>YouTube由来の動画・再生リストを、ダミーのデータで表示します</small></span><span class="tp-sw"><input type="checkbox" id="set-dummy" ${useDummy ? "checked" : ""}><i></i></span></label></div>${ttCard()}</section>`;
}
document.addEventListener("change", (e) => {
  if (e.target.id !== "set-substyle") return;
  subStyle = e.target.value; ls.set("tf-sub-style", subStyle); document.body.dataset.sub = subStyle; render(); paintLook();
});

$("set-date").onchange = () => { dateMode = $("set-date").value; ls.set("tf-date-mode", dateMode); render(); };
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-accent]"); if (!b) return;
  accent = b.dataset.accent; ls.set("tf-accent", accent); document.body.dataset.acc = accent; chrome.storage?.local.set({ "tf-accent": accent }); render(); paintLook();
});

/* ---------- テストの表示ボタン(就寝画面・おすすめ動画・通知) ---------- */
const TT_ROWS = [
  ["bed", "就寝画面", "就寝時間のお知らせ(ぷよんの音つき)を、開いている YouTube の画面に出します。「夜ふかし」ボタンの確認もできます"],
  ["end", "おすすめ動画", "動画の終わりに出る「TubeFolio3 のおすすめ」(音つき)を、いま開いている動画の上に出します。再生リストが未設定でも、見た目を確かめられます"],
  ["pk", "ピックアップ", "ホームの上に降りてくる「ピックアップ」を、ダミーの動画ですぐに見せます(待ち時間なし。「別の動画」「元の動画」も試せます)"],
  ["nv", "通知", "新着の通知(YouTube 画面の右下とパソコンの通知)を、テストで出します"],
];
const ttCard = () => `<div class="tp-card tt-card">${TT_ROWS.map(([k, t, d]) => `<div class="tp-r tt-r"><span class="tp-t"><b>${t}</b><small>${d}</small></span><button type="button" class="btn s" data-tt="${k}">表示する</button></div>`).join("")}</div>`;
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-tt]"); if (!b) return;
  const k = b.dataset.tt; if (k === "pk") return pkShowTest();
  b.disabled = true;
  try {
    const r = k === "nv" ? await chrome.runtime.sendMessage({ tf: "nv-test" }) : await chrome.runtime.sendMessage({ tf: "test-yt", what: k === "bed" ? "test-bed" : "test-end" });
    toast(r?.ok ? (k === "nv" ? "テスト通知を出しました(出ないときは、Windows とブラウザの通知の設定を見てください)" : "YouTube の画面に出しました") : "出せませんでした: " + (r?.error || "不明なエラー"));
  } catch (err) { toast("拡張機能に接続できませんでした: " + (err?.message || err)); }
  b.disabled = false;
});
