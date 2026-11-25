/* ===== 動画を再生リストに登録する(ホーム) =====
   ・検索結果のサムネイル左下の🕒ボタン: 設定で選んだ再生リストにワンクリックで追加(もう一度押すと外す)
   ・動画カードのタイトル横の ⋮: YouTube と同じように再生リストの一覧をメニューで開き、チェックで追加・解除
   どちらも YouTube の再生リストに直接書き込む(ytapi.js の YTA)。home.js・search.js より後に読み込むこと */

// 自分で作成した再生リスト(「後で見る」も含む)
const myPls = () => pls().filter((p) => kindOf(p) === "own" && !p.dummy);
// 再生リストの中身(読み込み済みなら [動画ID, 情報] の配列。まだなら undefined)
const plList = (p) => (LATER(p) ? cache.later : cache.pl)?.[p.id];
const inPl = (p, vid) => !!plList(p)?.some(([id]) => id === vid);

/* ---------- 🕒ボタンの追加先(設定) ---------- */
function wlTarget() {
  const id = ls.get("tf-wl-pl", ""), ps = myPls();
  // 未設定なら「TubeFolio3 後で見る」→「TubeFolio2 後で見る」→ 先頭の順
  return ps.find((p) => p.id === id) || ps.find((p) => /TubeFolio3/i.test(p.title) && /後で見る/.test(p.title)) || laterPl() || ps[0] || null;
}
function fillWlSelect() {
  const sel = $("set-wl"); if (!sel) return;
  const ps = myPls(), cur = wlTarget();
  sel.innerHTML = ps.length ? ps.map((p) => `<option value="${esc(p.id)}" ${cur?.id === p.id ? "selected" : ""}>${esc(p.title)}</option>`).join("") : `<option value="">(作成した再生リストがありません)</option>`;
  sel.disabled = !ps.length;
}
$("set-wl").onchange = () => { ls.set("tf-wl-pl", $("set-wl").value); chrome.storage.local.set({ "tf-wl-pl": $("set-wl").value }); // 通知の「後で見る」(YouTube側)も同じ追加先にする
 document.querySelectorAll("[data-wl]").forEach(paintWl); };

/* ---------- 追加・解除(YouTube に反映し、表示中の一覧も合わせる) ---------- */
async function setInPl(p, vid, on) {
  try { await (on ? YTA.addVideo(p.id, vid) : YTA.removeVideo(p.id, vid)); }
  catch (e) { toast(`${on ? "追加" : "外す"}ことができませんでした: ${e.message}`); return false; }
  const m = LATER(p) ? (cache.later ||= {}) : (cache.pl ||= {});
  if (m[p.id]) m[p.id] = on ? [...m[p.id].filter(([id]) => id !== vid), [vid, vmap.get(vid) || { title: vid, channel: "" }]] : m[p.id].filter(([id]) => id !== vid);
  saveCache();
  if (tab !== "search") render(); // 検索結果は入力欄や読み込み済みの結果を保つため描き直さない
  toast(on ? `「${p.title}」に追加しました` : `「${p.title}」から外しました`);
  document.querySelectorAll(`[data-wl="${CSS.escape(vid)}"]`).forEach(paintWl);
  return true;
}

/* ---------- 🕒ボタン(検索結果のサムネイル左下) ---------- */
const CLOCK_ICO = `<span class="wl-e" aria-hidden="true">🕒</span>`; // 絵文字の時計
const CHECK_ICO = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>`;
// 追加済みなら✓、まだなら🕒。説明には追加先の名前を出す
const wlState = (vid) => { const p = wlTarget(), on = !!(p && inPl(p, vid)); return { on, ico: on ? CHECK_ICO : CLOCK_ICO, title: !p ? "設定で追加先の再生リストを選んでください" : on ? `「${p.title}」から外す` : `「${p.title}」に追加` }; };
let wlLoading = null;
function wlBtn(vid) {
  const p = wlTarget();
  // 追加先の中身をまだ読んでいなければ読み込み、✓の表示を合わせる
  if (p && !plList(p) && !wlLoading) wlLoading = loadPlFor(p).then(() => { wlLoading = null; document.querySelectorAll("[data-wl]").forEach(paintWl); });
  const s = wlState(vid);
  return `<span class="wl${s.on ? " on" : ""}" data-wl="${esc(vid)}" role="button" title="${esc(s.title)}" aria-label="${esc(s.title)}">${s.ico}</span>`;
}
function paintWl(el) {
  const s = wlState(el.dataset.wl);
  el.classList.toggle("on", s.on); el.innerHTML = s.ico; el.title = s.title; el.setAttribute("aria-label", s.title);
}
async function toggleWl(el) {
  const p = wlTarget();
  if (!p) return toast("追加先の再生リストがありません。設定で選んでください");
  if (el.classList.contains("busy")) return;
  el.classList.add("busy");
  if (!plList(p)) await loadPlFor(p); // 入っているかどうかを確かめてから
  await setInPl(p, el.dataset.wl, !inPl(p, el.dataset.wl));
  el.classList.remove("busy");
}
// 再生リストの中身を読み込む(入っているかどうかの表示用)
async function loadPlFor(p) {
  if (LATER(p)) {
    try { (cache.later ||= {})[p.id] = collectPlVideos(await ytInit(`https://www.youtube.com/playlist?list=${encodeURIComponent(p.id)}`)); } catch {}
  } else await fetchPl(p);
  saveCache();
}

/* ---------- ⋮ メニュー(タイトルの横) ---------- */
const moreBtn = (vid) => `<span class="more" data-more="${esc(vid)}" role="button" title="再生リストに保存" aria-label="メニュー">⋮</span>`;
// タイトルと ⋮ を横に並べる(ダミーの動画には付けない)
const titleHtml = (vid, title, dummy = false) => dummy ? `<b>${esc(title)}</b>` : `<div class="ct"><b>${esc(title)}</b>${moreBtn(vid)}</div>`;
let pmVid = null;
function closeMenu() { $("pm")?.remove(); pmVid = null; }
function paintMenu() {
  const box = $("pm"); if (!box) return;
  const ps = myPls();
  box.innerHTML = `<div class="pm-h">再生リストに保存</div>`
    + (ps.length ? ps.map((p) => `<label class="pm-i"><input type="checkbox" data-pmpl="${esc(p.id)}" ${inPl(p, pmVid) ? "checked" : ""} ${plList(p) ? "" : "data-unknown"}><span>${esc(p.title)}</span></label>`).join("")
      : `<div class="pm-e">${PLLIVE.loaded() ? "作成した再生リストがありません" : "再生リストを読み込み中…"}</div>`)
    + `<button type="button" class="pm-new" data-pmnew>＋ 新しい再生リストを作成</button>`;
}
function openMenu(btn) {
  closeMenu();
  pmVid = btn.dataset.more;
  const box = document.createElement("div");
  box.id = "pm"; box.className = "pm"; box.setAttribute("role", "menu");
  document.body.append(box); paintMenu();
  // ⋮ の位置に合わせて出す(画面からはみ出さないように)
  const r = btn.getBoundingClientRect(), w = box.offsetWidth, h = box.offsetHeight;
  box.style.left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + "px";
  box.style.top = (r.bottom + 4 + h > innerHeight - 8 ? Math.max(8, r.top - h - 4) : r.bottom + 4) + "px";
  // 中身をまだ読んでいない再生リストは読み込んで、チェックを正しくする
  const need = myPls().filter((p) => !plList(p));
  if (need.length) Promise.all(need.map(loadPlFor)).then(() => { if ($("pm")) paintMenu(); });
}
document.addEventListener("change", async (e) => {
  const id = e.target.dataset?.pmpl; if (!id || !pmVid) return;
  const p = myPls().find((x) => x.id === id); if (!p) return;
  e.target.disabled = true;
  if (!(await setInPl(p, pmVid, e.target.checked))) e.target.checked = !e.target.checked;
  e.target.disabled = false;
});
/* ---------- チャンネル名を押したら、そのチャンネルのページを開く(新しいタブ) ---------- */
function openChannel(el, bg) { // bg: 裏のタブで開く(中クリック)
  let url = el.dataset.ch || "";
  const name = el.dataset.chn || "";
  if (!url) { // リンク先が分からない動画(保存した動画など)は、登録チャンネルから名前で探す
    const c = subMap().get(subNorm(name));
    if (c && !c.dummy) url = c.handle ? "/" + c.handle.replace(/^\/?/, "") : "/channel/" + c.id;
  }
  if (url && !/^(https?:\/\/(www\.)?youtube\.com)?\/(@|channel\/|c\/|user\/)/.test(url)) url = ""; // チャンネルのリンクでなければ(動画のリンクなどは)使わない
  if (!url) url = `/results?search_query=${encodeURIComponent(name)}&sp=EgIQAg%253D%253D`; // それでも分からなければチャンネル検索
  const full = url.startsWith("http") ? url : "https://www.youtube.com" + url;
  try { toast("チャンネルを開きます: " + full.replace("https://www.youtube.com", "")); } catch {}
  if (bg && chrome.tabs?.create) chrome.tabs.create({ url: full, active: false }); else window.open(full, "_blank", "noopener");
}
// 中クリックでもチャンネルを開く(動画の中クリック=裏のタブで再生、より先に受けて止める)
document.addEventListener("mousedown", (e) => { if (e.button === 1 && e.target.closest?.("[data-ch]")) e.preventDefault(); }, true); // 自動スクロールのアイコンを出さない
document.addEventListener("auxclick", (e) => { if (e.button !== 1) return; const b = e.target.closest?.("[data-ch]"); if (!b) return; e.preventDefault(); e.stopImmediatePropagation(); openChannel(b, true); }, true);
document.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches?.("[data-ch]")) { e.preventDefault(); e.stopPropagation(); openChannel(e.target); } }, true);

// チャンネル名は、ほかのクリック処理(動画の再生)より先に、最初の段階(capture)で受けて止める
document.addEventListener("click", (e) => { const b = e.target.closest?.("[data-ch]"); if (!b) return; e.preventDefault(); e.stopImmediatePropagation(); openChannel(b); }, true);
document.addEventListener("click", async (e) => {
  const t = (s) => e.target.closest(s);
  let b;
  if ((b = t("[data-ch]"))) { e.preventDefault(); e.stopPropagation(); return openChannel(b); } // 動画の再生より先に
  if ((b = t("[data-wl]"))) { e.preventDefault(); e.stopPropagation(); return toggleWl(b); }
  if ((b = t("[data-more]"))) { e.preventDefault(); e.stopPropagation(); return pmVid === b.dataset.more && $("pm") ? closeMenu() : openMenu(b); }
  if ((b = t("[data-pmnew]"))) {
    e.preventDefault();
    const vid = pmVid, title = prompt("新しい再生リストの名前(非公開で作成します)");
    if (!title?.trim()) return;
    try {
      const id = await YTA.create(title.trim(), "PRIVATE");
      const p = { id, title: title.trim(), channel: "", thumb: "", kind: "own", addedAt: new Date().toISOString() };
      await PLLIVE.markAdded(p);
      (cache.pl ||= {})[id] = [];
      await setInPl(p, vid, true);
      if ($("pm")) paintMenu();
    } catch (err) { toast(`作成できませんでした: ${err.message}`); }
    return;
  }
  if ($("pm") && !t("#pm")) closeMenu(); // メニューの外を押したら閉じる
}, true);
addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });
addEventListener("scroll", (e) => { const t = e.target; if (!$("pm")?.contains(t) && (t === document || t === document.scrollingElement || t.id === "nav-scroll")) closeMenu(); }, true); // ページ全体のスクロールで閉じる(メニューの中や、ホームの行の自動スクロールでは閉じない)
addEventListener("resize", closeMenu);
