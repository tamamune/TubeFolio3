/* ===== 音楽の自動登録(管理ページの側) =====
   急上昇の「音楽」を、決めた再生リストに自動で入れる機能の設定・確認の画面。処理の本体は background.js(taRun)。
   ・再生リストのページ(自分の再生リスト)の上に「🎵 急上昇の自動登録」を置き、押すと設定のパネルを開く
   ・取り方(スクレイピング / API)の切り替え、保管日数、確認の目安、今すぐ確認
   ・自動で入れた動画のカードに「あと〇日」の印(押すと取り置き)
   ・手動で入れて一定期間(既定60日)たった動画は、パネルの「確認」に並べる(取り置き / 削除を選ぶ)
   グローバルの名前は taUi… で始める(manager の JS は全部つながっているため) */
const TAUI_SET = "tf-ta-set", TAUI_LED = "tf-ta-led", TAUI_KEY = "tf-ta-key";
const taUi = { set: { on: false, src: "scrape", pid: "", days: 30, ask: 60 }, led: { added: {}, removed: {}, seen: {}, keep: {}, last: 0, lastOk: 0, msg: "" }, key: "", open: false, busy: false };
function taUiApply(r) {
  if (r[TAUI_SET]) Object.assign(taUi.set, r[TAUI_SET]);
  if (r[TAUI_LED]) taUi.led = { added: {}, removed: {}, seen: {}, keep: {}, last: 0, lastOk: 0, msg: "", ...r[TAUI_LED] };
  if (r[TAUI_KEY] != null) taUi.key = r[TAUI_KEY];
}
chrome.storage.local.get([TAUI_SET, TAUI_LED, TAUI_KEY]).then((r) => { taUiApply(r); if (tab.startsWith("list:pl:")) render(); });
chrome.storage.onChanged.addListener((c) => {
  const r = {}; for (const k of [TAUI_SET, TAUI_LED, TAUI_KEY]) if (c[k]) r[k] = c[k].newValue;
  if (!Object.keys(r).length) return;
  taUiApply(r);
  if (tab.startsWith("list:pl:") && !document.activeElement?.matches?.("#ta-key")) render(); // APIキーを入力している間だけは描き直さない
});
const taUiSaveSet = () => chrome.storage.local.set({ [TAUI_SET]: taUi.set });
const taUiWhen = (t) => (t ? new Date(t).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "まだありません");
const taUiLeft = (a) => Math.max(0, Math.ceil(taUi.set.days - (Date.now() - a.at) / 86400000));

// カードの印(自動で入れた動画: あと〇日 / 取り置き)
function taBadge(p, id) {
  if (!p || p.id !== taUi.set.pid || !taUi.set.on) return "";
  const a = taUi.led.added[id], keep = !!taUi.led.keep[id];
  if (!a && !keep) return `<span class="tabdg tabdg-m" data-ta="keep|${esc(id)}" role="button" title="取り置き(手動で入れた動画。確認の欄に出さず、自動でも外しません)">📌</span>`; // 手動で入れた動画: 小さな 📌 だけ
  return `<span class="tabdg ${keep ? "on" : ""}" data-ta="keep|${esc(id)}" role="button" title="${keep ? "取り置き中(押すと解除)" : "押すと取り置き(自動で外さない)"}">${keep ? "📌 取り置き" : "🕒 あと" + taUiLeft(a) + "日"}</span>`;
}
// パネル
function taBar(p) {
  if (!p || p.dummy || kindOf(p) !== "own") return "";
  const { set, led } = taUi, mine = set.pid === p.id, on = mine && set.on;
  if (!mine && !/音楽|music/i.test(plTitle(p))) return ""; // 対象の再生リストと、名前に「音楽」が入った再生リストにだけ出す(ほかには出さない)
  const head = `<button type="button" class="ta-b ta-tg" data-ta="open|${esc(p.id)}">🎵 急上昇の自動登録 <span class="ta-st ${on ? "on" : ""}">${on ? "オン" : "オフ"}</span> <span class="ta-car">${taUi.open ? "▴" : "▾"}</span></button>`;
  if (!taUi.open) return `<div class="ta-box">${head}</div>`;
  const other = set.pid && !mine ? pls().find((x) => x.id === set.pid) : null;
  let h = `<div class="ta-box">${head}<div class="ta-panel">`;
  h += `<div class="ta-row"><button type="button" class="ta-b ${on ? "on" : ""}" data-ta="toggle|${esc(p.id)}">${mine ? (set.on ? "✓ オン中(押すとオフ)" : "オフ中(押すとオン)") : "この再生リストを対象にしてオンにする"}</button>${other ? `<small>いまの対象: 「${esc(plTitle(other))}」(切り替えると、そちらは止まります)</small>` : ""}</div>`;
  if (mine) {
    h += `<div class="ta-row"><span class="ta-l">取り方</span><span class="ta-seg"><button type="button" class="ta-b ${set.src === "scrape" ? "on" : ""}" data-ta="src|scrape" title="youtube-trending.info の日本の急上昇から、ジャンルが「音楽」の動画を読む">スクレイピング</button><button type="button" class="ta-b ${set.src === "api" ? "on" : ""}" data-ta="src|api" title="YouTube Data API の「人気の動画(音楽・日本)」を使う。APIキーが必要">API</button></span></div>`;
    if (set.src === "api") h += `<div class="ta-row"><span class="ta-l">APIキー</span><input type="password" id="ta-key" class="sel" style="min-width:260px" placeholder="YouTube Data API v3 のキー" value="${esc(taUi.key)}" autocomplete="off"><small>このパソコンだけに保存します(ドライブには同期しません)</small></div>`;
    const opt = (list, cur) => list.map((n) => `<option value="${n}" ${n === cur ? "selected" : ""}>${n}日</option>`).join("");
    h += `<div class="ta-row"><span class="ta-l">自動で入れた動画を外す</span><select id="ta-days" class="sel">${opt([14, 30, 45, 60, 90], set.days)}</select><small>登録からこの日数がたったら、再生リストから外します(取り置きは残す)</small></div>`;
    h += `<div class="ta-row"><span class="ta-l">手動で入れた動画の確認</span><select id="ta-ask" class="sel">${opt([30, 60, 90, 120], set.ask)}</select><small>この日数がたった動画は、下に並べて「残す・削除」を聞きます(自動では消しません)</small></div>`;
    h += `<div class="ta-row"><button type="button" class="ta-b ta-go" data-ta="run" ${taUi.busy ? "disabled" : ""}>${taUi.busy ? "確認中…" : "今すぐ確認"}</button><small>最後に成功: ${taUiWhen(led.lastOk)}${led.msg ? " ・ " + esc(led.msg) : ""}</small></div>`;
    h += `<div class="ta-row"><small>自動で入れた動画: ${Object.keys(led.added).length}本 ・ 取り置き: ${Object.keys(led.keep).length}本 ・ 削除済み(再登録しない): ${Object.keys(led.removed).length}本 ・ 確認は1日1回(パソコンの起動中に3時間ごと)</small></div>`;
    // 確認: 手動で入れて、ask 日たった動画
    const now = Date.now(), tl = new Map(plItems(p).map(([id, v]) => [id, v]));
    const ask = Object.entries(led.seen).filter(([id, t]) => !led.keep[id] && !led.added[id] && now - t > set.ask * 86400000 && tl.has(id));
    if (ask.length) {
      h += `<div class="ta-ask"><b>削除の確認(${ask.length}本)</b><small>手動で入れてから${set.ask}日以上たった動画です</small>`;
      h += ask.slice(0, 30).map(([id]) => { const v = tl.get(id); return `<div class="ta-ar"><img loading="lazy" alt="" src="${esc(thumb(id, "default"))}"><span class="ta-at">${esc(v?.title || id)}</span><button type="button" class="ta-b" data-ta="keep|${esc(id)}">📌 取り置き</button><button type="button" class="ta-b ta-del" data-ta="del|${esc(id)}">🗑 削除</button></div>`; }).join("");
      h += `</div>`;
    }
  }
  return h + `</div></div>`;
}
const taUiRefresh = async () => { const p = pls().find((x) => x.id === taUi.set.pid); if (p) { await fetchPl(p); saveCache(); } render(); };
async function taUiRun() {
  if (taUi.busy) return; taUi.busy = true; render();
  const r = await chrome.runtime.sendMessage({ tf: "ta-run" }).catch((x) => ({ ok: false, error: x?.message }));
  taUi.busy = false; toast(r?.ok ? r.msg || "確認しました" : "できませんでした: " + (r?.msg || r?.error || ""));
  return taUiRefresh();
}
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-ta]"); if (!b) return;
  e.preventDefault(); e.stopPropagation();
  const [op, arg] = b.dataset.ta.split("|");
  const refresh = taUiRefresh;
  if (op === "open") { taUi.open = !taUi.open; return render(); }
  if (op === "toggle") {
    const mine = taUi.set.pid === arg;
    if (!mine) { taUi.set.pid = arg; taUi.set.on = true; } else taUi.set.on = !taUi.set.on;
    await taUiSaveSet(); render();
    if (taUi.set.on) await taUiRun(); // オンにしたら、すぐ1回確認する
    return;
  }
  if (op === "src") { taUi.set.src = arg; await taUiSaveSet(); return render(); }
  if (op === "run") return taUiRun();
  if (op === "keep") { const on = !taUi.led.keep[arg]; await chrome.runtime.sendMessage({ tf: "ta-keep", id: arg, on }); toast(on ? "取り置きにしました(自動では外しません)" : "取り置きを解除しました"); return; }
  if (op === "del") {
    if (!confirm("この動画を再生リストから削除します(YouTube にも反映され、今後は自動で入れ直しません)。よろしいですか?")) return;
    const r = await chrome.runtime.sendMessage({ tf: "ta-del", id: arg }).catch((x) => ({ ok: false, error: x?.message }));
    toast(r?.ok ? "削除しました" : "できませんでした: " + (r?.error || "")); return refresh();
  }
}, true);
document.addEventListener("change", (e) => {
  if (e.target.id === "ta-days") { taUi.set.days = +e.target.value || 30; taUiSaveSet(); }
  else if (e.target.id === "ta-ask") { taUi.set.ask = +e.target.value || 60; taUiSaveSet(); }
  else if (e.target.id === "ta-key") { taUi.key = e.target.value.trim(); chrome.storage.local.set({ [TAUI_KEY]: taUi.key }); }
});
