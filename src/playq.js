/* ===== 再生リストの連続再生(再生リストの「すべて表示」・TubeFolio2 後で見る の画面) =====
   ・▶ 未視聴を連続再生: 最後まで見ていない動画を、新しい順 / 古い順 に続けて再生する
   ・⏱ 空き時間: 決めた時間(分)に収まり、いちばん長く見られる未視聴の組み合わせを選んで連続再生する
   ・🌙 就寝時間まで: 今から就寝時間(設定「一般」の就寝のお知らせの始まりの時刻)までに収まるように選んで連続再生する
   再生は YouTube の「動画をまとめて再生」(watch_videos。最大50本)で、新しいタブで開く。
   長さの分からない動画(ライブなど)は、時間に収める再生では選ばない */
const PQ_MAX = 50;
const PQ_FREE = [10, 15, 20, 30, 45, 60, 90, 120, 180];
let pqFree = +ls.get("tf-pq-free", "30"); if (!PQ_FREE.includes(pqFree)) pqFree = 30; // 空き時間(分)。ドライブ同期の対象
let pqItems = []; // いま表示中の一覧([id, v] を、画面の並び順で)

// 「12:34」「1:02:03」→ 秒。分からなければ 0
const pqSec = (d) => { const p = String(d || "").trim().split(":").map(Number); return p.length >= 2 && p.every((x) => isFinite(x)) ? p.reduce((a, x) => a * 60 + x, 0) : 0; };
const pqMin = (s) => (s >= 3600 ? `${Math.floor(s / 3600)}時間${Math.round((s % 3600) / 60)}分` : `${Math.max(1, Math.round(s / 60))}分`);
const pqUnwatched = (items) => items.filter(([id, v]) => !isDone(id, v)); // isDone は home.js(最後まで見た動画)

// 決めた秒数に収まり、合計がいちばん長くなる組み合わせ(並び順はそのまま)。10秒単位で計算する
function pqFit(items, budget) {
  const list = items.map(([id, v]) => ({ id, v, s: pqSec(v.duration) })).filter((x) => x.s > 0 && x.s <= budget).slice(0, 300);
  const U = 10, W = Math.floor(budget / U), w = list.map((x) => Math.ceil(x.s / U));
  const best = new Int32Array(W + 1), take = list.map(() => new Uint8Array(W + 1));
  list.forEach((x, i) => { for (let c = W; c >= w[i]; c--) { const n = best[c - w[i]] + x.s; if (n > best[c]) { best[c] = n; take[i][c] = 1; } } });
  const pick = new Set(); let c = W;
  for (let i = list.length - 1; i >= 0; i--) if (take[i][c]) { pick.add(i); c -= w[i]; }
  const out = list.filter((_, i) => pick.has(i));
  return { list: out.slice(0, PQ_MAX), total: out.slice(0, PQ_MAX).reduce((a, x) => a + x.s, 0) };
}
function pqPlay(ids, msg) {
  if (!ids.length) return toast("再生できる動画がありません");
  if (pqItems.some(([, v]) => v.dummy)) return toast(`${msg}(ダミー表示のため、再生はしません)`);
  window.open("https://www.youtube.com/watch_videos?video_ids=" + ids.slice(0, PQ_MAX).map(encodeURIComponent).join(","), "_blank", "noopener");
  toast(msg + (ids.length > PQ_MAX ? `(先頭の${PQ_MAX}本)` : ""));
}

// 一覧の上に出す操作の行
function playBar(items) {
  pqItems = items;
  const un = pqUnwatched(items).length;
  return `<div class="pq-bar">`
    + `<span class="grp"><span class="s-cl">▶ 未視聴を連続再生 <b>${un}</b>本</span><button type="button" data-pq="new" ${un ? "" : "disabled"} title="最後まで見ていない動画を、新しく登録した順に続けて再生">新しい順</button><button type="button" data-pq="old" ${un ? "" : "disabled"} title="最後まで見ていない動画を、古く登録した順に続けて再生">古い順</button></span>`
    + `<span class="grp"><span class="s-cl">⏱ 空き時間</span><select class="wsel" data-pqfree aria-label="空き時間" title="この時間に収まる未視聴の動画を選んで続けて再生します(ホイールでも変えられます)">${PQ_FREE.map((m) => `<option value="${m}" ${m === pqFree ? "selected" : ""}>${pqMin(m * 60)}</option>`).join("")}</select><button type="button" data-pq="free" ${un ? "" : "disabled"}>▶ ぴったり再生</button></span>`
    + `<button type="button" class="pill" data-pq="bed" ${un ? "" : "disabled"} title="今から就寝時間(設定「一般」の就寝のお知らせ)までに見終わるように選んで、続けて再生します">🌙 就寝時間までに見終わる</button>`
    + `</div>`;
}
async function pqBedMinutes() {
  const r = await chrome.storage.local.get(["tf-bed", "tf-bed-from", "tf-bed-to"]);
  const from = r["tf-bed-from"] || "23:00", to = r["tf-bed-to"] || "06:00";
  const m = (hm) => { const [h, mi] = hm.split(":").map(Number); return h * 60 + mi; };
  const now = new Date(), t = now.getHours() * 60 + now.getMinutes(), a = m(from), b = m(to);
  const inBed = a < b ? t >= a && t < b : t >= a || t < b;
  return { from, inBed, left: inBed ? 0 : (a - t + 1440) % 1440, set: r["tf-bed"] === "on" };
}
document.addEventListener("change", (e) => { if (!e.target.matches?.("[data-pqfree]")) return; pqFree = +e.target.value; ls.set("tf-pq-free", String(pqFree)); });
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-pq]"); if (!b) return;
  const un = pqUnwatched(pqItems), a = b.dataset.pq;
  if (a === "new" || a === "old") { // 画面の並び(登録順の切り替え)に関係なく、登録した順で並べ直す
    const asc = plOrd === "new" ? [...un].reverse() : un; // plOrd・plOrdered は home.js
    const list = a === "old" ? asc : [...asc].reverse();
    return pqPlay(list.map(([id]) => id), `未視聴 ${list.length}本を${a === "old" ? "古い順" : "新しい順"}に連続再生します`);
  }
  let budget = pqFree * 60, why = `空き時間 ${pqMin(budget)}`;
  if (a === "bed") {
    const bd = await pqBedMinutes();
    if (bd.inBed) return toast(`もう就寝時間(${bd.from}〜)です。おやすみなさい`);
    budget = bd.left * 60; why = `就寝時間 ${bd.from} まで(あと${pqMin(budget)})${bd.set ? "" : "・就寝の時刻は設定「一般」で変えられます"}`;
  }
  const fit = pqFit(un, budget);
  if (!fit.list.length) return toast(`${why}に収まる未視聴の動画がありません`);
  pqPlay(fit.list.map((x) => x.id), `${why}: ${fit.list.length}本・合計 ${pqMin(fit.total)} を連続再生します`);
});
