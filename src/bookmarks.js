/* ===== ブックマーク: YouTubeの動画を★で登録し、一覧ページで見る ===== */
const bmAll = () => Object.entries(data.marks || {}).sort((a, b) => (b[1].at || "").localeCompare(a[1].at || ""));
const isBm = (id) => !!data.marks?.[id];
const BM_ICO = `<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M6 3h12v18l-6-4-6 4z"/></svg>`;
const bmBtn = (id) => `<span class="bm ${isBm(id) ? "on" : ""}" data-bm="${esc(id)}" role="button" title="${isBm(id) ? "ブックマークから外す" : "ブックマークに追加"}" aria-label="ブックマーク">${BM_ICO}</span>`;

async function bmToggle(id) {
  const v = vmap.get(id) || data.videos?.[id]; if (!v) return;
  data.marks = data.marks || {};
  if (data.marks[id]) delete data.marks[id];
  else data.marks[id] = { title: v.title, channel: v.channel || "", duration: v.duration || "", pub: v.pub || "", at: new Date().toISOString() };
  document.querySelectorAll(`[data-bm="${CSS.escape(id)}"]`).forEach((e) => { e.classList.toggle("on", isBm(id)); e.title = isBm(id) ? "ブックマークから外す" : "ブックマークに追加"; });
  if ($("pl").open && $("pl-bm").dataset.bm === id) $("pl-bm").classList.toggle("on", isBm(id));
  await chrome.storage.local.set({ [KEY]: data });
}

function bookmarksView() {
  const list = bmAll();
  if (!list.length) return `<div class="s-head">ブックマーク</div><div class="empty">ブックマークはまだありません。動画のサムネイル右上の <b>🔖</b> を押すと追加できます(検索結果・ホームの動画から)。</div>`;
  return `<div class="s-head">ブックマーク<small class="bm-n">${list.length}本</small></div>${vbar()}${vgrid(list.map(([id, v]) => { vmap.set(id, v); return `<button class="c ${subCls(v)}" data-v="${esc(id)}"><div class="th"><img loading="lazy" src="${thumb(id)}" alt="">${v.duration ? `<span class="dur">${esc(v.duration)}</span>` : ""}${bmBtn(id)}</div>${titleHtml(id, v.title)}${cn(v)}</button>`; }).join(""))}`;
}
