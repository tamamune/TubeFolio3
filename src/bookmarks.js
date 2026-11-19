/* ===== ブックマーク: YouTube の再生中に B キーで書いたメモ(content.js)と、登録した動画を一覧で見る =====
   データ: data.marks = { [動画ID]: { title, channel, duration, pub, at, notes: [{ t: 秒, text, at }] } }
   ・サムネイルの🔖ボタンはやめた(bmBtn は空を返す)。埋め込みプレーヤーの🔖(pl-bm)は残す */
const bmAll = () => Object.entries(data.marks || {}).sort((a, b) => (b[1].at || "").localeCompare(a[1].at || ""));
const isBm = (id) => !!data.marks?.[id];
const bmBtn = () => "";
const bmFmt = (s) => { s = Math.max(0, Math.floor(+s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60; return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0"); };
let bmQ = "";

async function bmToggle(id) {
  const v = vmap.get(id) || data.videos?.[id]; if (!v) return;
  data.marks = data.marks || {};
  if (data.marks[id]) delete data.marks[id];
  else data.marks[id] = { title: v.title, channel: v.channel || "", duration: v.duration || "", pub: v.pub || "", at: new Date().toISOString() };
  if ($("pl").open && $("pl-bm").dataset.bm === id) $("pl-bm").classList.toggle("on", isBm(id));
  await chrome.storage.local.set({ [KEY]: data });
}

function bookmarksView() {
  const list = bmAll();
  if (!list.length) return `<div class="s-head">ブックマーク</div><div class="empty">ブックマークはまだありません。<br>YouTube で動画を再生しているときにキーボードの <kbd>B</kbd> を押すと、その時間にメモを書けます。書いたメモはここに並びます。</div>`;
  const q = bmQ.trim().toLowerCase(); let shown = 0;
  const nNotes = list.reduce((s, [, v]) => s + (v.notes?.length || 0), 0);
  return `<div class="s-bar"><div class="s-head">ブックマーク<small class="bm-n">${list.length}本 ・ メモ ${nNotes}件</small></div><input type="search" id="bm-q" class="bm-q" placeholder="メモ・タイトル・チャンネルで探す" value="${esc(bmQ)}"></div>`
    + `<p class="bm-hint">YouTube で再生中に <kbd>B</kbd> を押すと、その時間のメモを追加できます。時間を押すと、その場面から再生します。</p>`
    + `<div class="bm-list">${list.map(([id, v]) => {
      vmap.set(id, v);
      const notes = (v.notes || []).slice().sort((a, b) => a.t - b.t);
      const hay = [v.title, v.channel, ...notes.map((n) => n.text)].join("\n").toLowerCase();
      const ok = !q || hay.includes(q); if (ok) shown++;
      const scene = (v.notes || []).filter((n) => n.img).sort((a, b) => (b.at || "").localeCompare(a.at || ""))[0]; // いちばん新しくメモした場面の画像
      return `<div class="bm-r" data-bmhay="${esc(hay)}"${ok ? "" : " hidden"}>${scene ? `<button class="bm-th" data-bmt="${esc(id)}|${scene.t}" title="${bmFmt(scene.t)} から再生"><img loading="lazy" src="${esc(scene.img)}" alt=""><span class="dur">${bmFmt(scene.t)}</span></button>` : `<button class="bm-th" data-v="${esc(id)}" title="再生"><img loading="lazy" src="${thumb(id)}" alt="">${v.duration ? `<span class="dur">${esc(v.duration)}</span>` : ""}</button>`}`
        + `<div class="bm-b"><div class="bm-tt"><button class="bm-ti" data-v="${esc(id)}">${esc(v.title || id)}</button><button type="button" class="bm-rm" data-bmrm="${esc(id)}" title="ブックマークから外す(メモも消えます)">✕</button></div>`
        + `<small class="bm-ch">${esc(v.channel || "")}${v.at ? ` ・ ${esc(v.at.slice(0, 10).replace(/-/g, "/"))}` : ""}</small>`
        + (notes.length ? `<ul class="bm-ns">${notes.map((n) => `<li>${n.img && notes.length > 1 ? `<button type="button" class="bm-ni" data-bmt="${esc(id)}|${n.t}" title="${bmFmt(n.t)} から再生"><img loading="lazy" src="${esc(n.img)}" alt=""></button>` : ""}<button type="button" class="bm-t" data-bmt="${esc(id)}|${n.t}" title="${bmFmt(n.t)} から再生">${bmFmt(n.t)}</button><span class="bm-x" data-bmed="${esc(id)}|${esc(n.at)}" role="button" tabindex="0" title="押すと編集">${n.text ? esc(n.text) : `<i>(メモなし ・ 押すと書けます)</i>`}</span><button type="button" class="bm-eb" data-bmedit="${esc(id)}|${esc(n.at)}" title="このメモを書き直す">✎ 編集</button><button type="button" class="bm-nd" data-bmnd="${esc(id)}|${esc(n.at)}" title="このメモを消す">✕</button></li>`).join("")}</ul>` : "")
        + `</div></div>`;
    }).join("")}</div><p class="bm-none"${shown ? " hidden" : ""}>一致するブックマークはありません。</p>`;
}
function bmFilter() {
  const q = bmQ.trim().toLowerCase(); let n = 0;
  document.querySelectorAll(".bm-r").forEach((r) => { const ok = !q || r.dataset.bmhay.includes(q); r.hidden = !ok; if (ok) n++; });
  const e = document.querySelector(".bm-none"); if (e) e.hidden = n > 0;
}
document.addEventListener("input", (e) => { if (e.target.id === "bm-q") { bmQ = e.target.value; bmFilter(); } });
document.addEventListener("click", async (e) => {
  const t = (s) => e.target.closest(s); let b;
  if ((b = t("[data-bmt]"))) { e.preventDefault(); e.stopPropagation(); const [id, s] = b.dataset.bmt.split("|"); return openV(id, +s); }
  if ((b = t("[data-bmed]")) && !b.querySelector("textarea")) { e.preventDefault(); e.stopPropagation(); return bmEdit(b); }
  if ((b = t("[data-bmedit]"))) { e.preventDefault(); e.stopPropagation(); const s = [...document.querySelectorAll("[data-bmed]")].find((x) => x.dataset.bmed === b.dataset.bmedit); if (s && !s.querySelector("textarea")) bmEdit(s); return; }
  if ((b = t("[data-bmnd]"))) {
    e.preventDefault(); e.stopPropagation(); const [id, at] = b.dataset.bmnd.split("|"), m = data.marks?.[id]; if (!m?.notes) return;
    m.notes = m.notes.filter((n) => n.at !== at); return chrome.storage.local.set({ [KEY]: data }); // onChanged で描き直される
  }
  if ((b = t("[data-bmrm]"))) {
    e.preventDefault(); e.stopPropagation(); const id = b.dataset.bmrm, m = data.marks?.[id]; if (!m) return;
    if (m.notes?.length && !confirm(`「${m.title || id}」をブックマークから外します。メモ ${m.notes.length}件も消えます。よろしいですか?`)) return;
    delete data.marks[id]; return chrome.storage.local.set({ [KEY]: data });
  }
}, true);

// メモの書き直し: 文を押すと入力欄に変わる。Enter か欄の外を押すと保存(Shift+Enter で改行)、Esc で保存せずに戻す
function bmEdit(span) {
  const [id, at] = span.dataset.bmed.split("|"), n = data.marks?.[id]?.notes?.find((x) => x.at === at); if (!n) return;
  const ta = document.createElement("textarea"); ta.className = "bm-ed"; ta.value = n.text || ""; ta.maxLength = 1000; ta.rows = Math.min(8, Math.max(2, ta.value.split("\n").length));
  const hint = document.createElement("small"); hint.className = "bm-edh"; hint.textContent = "Enter で保存 ・ Shift+Enter で改行 ・ Esc でやめる";
  const keep = span.innerHTML; span.replaceChildren(ta, hint); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
  let done = false;
  const end = async (save) => {
    if (done) return; done = true;
    const text = ta.value.trim();
    if (!save || text === (n.text || "")) { span.innerHTML = keep; return; }
    n.text = text; await chrome.storage.local.set({ [KEY]: data }); // onChanged で描き直される
  };
  ta.addEventListener("keydown", (e) => {
    if (e.isComposing) return;
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); end(true); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); end(false); }
  });
  ta.addEventListener("blur", () => end(true)); // 欄の外を押したときは、書いた分を保存する
}
document.addEventListener("keydown", (e) => { const s = e.target.closest?.("[data-bmed]"); if (s && e.target === s && e.key === "Enter") { e.preventDefault(); bmEdit(s); } });
