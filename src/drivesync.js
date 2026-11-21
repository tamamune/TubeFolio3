/* ===== Google ドライブでの同期(別のパソコンでも同じ環境で使う) =====
   Google アカウントでログイン(OAuth)して、Google ドライブの API で読み書きする。パソコンの「Google ドライブ」アプリは不要。
   保存先はドライブの「アプリ専用フォルダ」(appDataFolder)。自分のドライブの一覧には出ず、このアプリだけが読み書きできる。
   別のパソコンでも、同じクライアントIDで同じ Google アカウントにログインすれば、同じ内容を読み込める。
   ・同期するもの: フォルダ・保存した動画・ブックマーク・チャンネルのフォルダ分けと調査結果・設定(表示や並び順など)・設定「タグ」の記録(取り置き・削除したタグも)
   ・同期しないもの: YouTube 側で共有されるもの(再生リスト・登録チャンネル・視聴履歴・アカウント)と、このパソコン固有の値
   ・書き換える前の内容は tubefolio-sync.prev.json に残す
   ・ログインは chrome.identity.launchWebAuthFlow を使う(Chrome・Vivaldi・Edge など)。クライアントIDは、設定の「同期」で入力する */
const DS_TAGLOG = "tf-taglog"; // tags.js の TAGLOG と同じ
const DS_FILE = "tubefolio-sync.json", DS_PREV = "tubefolio-sync.prev.json";
const DS_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const DS_SKIP = new Set(["tf-acct", "tf-ch-sync", "tf-watched", "tf-home-dummy", "tf-sync-dirty", "tf-sync-base", "tf-sync-rat", "tf-sync-dev", "tf-sync-last", "tf-sync-conn", "tf-sync-tok", "tf-sync-hash", "tf-sync-thash", "tf-sync-fid", "tf-sync-acct", "tf-ryd-cache", "tf-mu-state", "tf-pl-live"]);
let dsConnLost = false; // ログインが切れて、自動同期が止まっているか
let dsSkipStore = false, dsBusy = false, dsApplying = false, dsMsg = "", dsTimer = 0, dsWarned = false;
let dsView = "", dsToken = null; // { v: アクセストークン, exp: 期限(ms) }
const dsIds = {};    // ファイル名 → ドライブ上のファイルID

/* ---------- このパソコンの変更を覚える ---------- */
const dsKeys = () => { const out = []; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith("tf-") && !DS_SKIP.has(k)) out.push(k); } } catch {} return out; };
const dsMarkLocal = () => { if (!dsApplying) ls.set("tf-sync-dirty", "1"); }; // 時計のずれに左右されないよう、時刻ではなく「変更あり」の印で覚える
(function hookLocalChanges() {
  const orig = ls.set;
  ls.set = (k, v) => { orig(k, v); if (k.startsWith("tf-") && !DS_SKIP.has(k)) { dsMarkLocal(); dsSoon(); } };
  chrome.storage.onChanged.addListener((c) => { if (!c[KEY]) return; if (dsSkipStore) { dsSkipStore = false; return; } if (!dsApplying) { dsMarkLocal(); dsSoon(); } });
})();
// YouTube の再生画面のコメント表示の設定(chrome.storage の tf-cm-…)。拡張機能のどのページからも読み書きされるので、localStorage ではなくこちらに持つ
const DS_CMKEYS = [...["on", "side", "size", "hs", "width", "name", "icon", "sort", "tr", "loop", "auto"].map((k) => "tf-cm-" + k), "tf-cm-hidemode", "tf-mini", "tf-mini-size", "tf-mini-pos", "tf-pip-btn", "tf-pip-auto", "tf-break", "tf-bed", "tf-bed-from", "tf-bed-to", "tf-seek", "tf-step", "tf-vf", "tf-tts", "tf-tts-rate", "tf-sub-mode", "tf-adff", "tf-quality", "tf-h264", "tf-pubdate", "tf-notify", "tf-notify-os", "tf-accent", "tf-mu-adff", "tf-chp-watched", "tf-chp-members", "tf-ta-set", "tf-ta-led", "tf-nv-words", "tf-rel-mode", "tf-end-mode", "tf-end-tf", "tf-end-slots", "tf-end-at", ...["on", "bar", "notice", "cats"].map((k) => "tf-sb-" + k)];
let dsCmSkipUntil = 0;
chrome.storage.onChanged.addListener((c) => { if (Date.now() < dsCmSkipUntil || dsApplying) return; if (DS_CMKEYS.some((k) => k in c)) { dsMarkLocal(); dsSoon(); } });
const dsSoon = (ms = 3000) => { clearTimeout(dsTimer); dsTimer = setTimeout(() => { dsTimer = 0; dsSync("auto", false); }, ms); };
// 設定「タグ」の記録(chrome.storage の tf-taglog)。YouTube で動画を見るたびに増えるので、変更の1分後にまとめて書き出す
let dsTagSkipUntil = 0;
chrome.storage.onChanged.addListener((c) => { if (!c[DS_TAGLOG] || dsApplying || Date.now() < dsTagSkipUntil) return; dsSoon(60000); }); // 変更の3秒後に自動で同期する(画面を閉じる・切り替えるときは、待たずにすぐ)
// 保存データの指紋。最後に同期したときと違えば、このページを開いていない間の変更(YouTube の画面でのメモやフォルダ登録など)があったとわかる
const dsHash = (o) => { const s = JSON.stringify(o || {}); let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36) + "." + s.length; };

/* ---------- ログイン(OAuth) ---------- */
// このアプリ用の OAuth クライアントID(固定。公開されても問題ない値)
const DS_CID = "553603750505-q34bo61k18v2lvn1km9akth89q6ebomu.apps.googleusercontent.com";
const dsCid = () => DS_CID;
const dsConnected = () => !!dsCid() && ls.get("tf-sync-conn", "0") === "1";
const dsRedirect = () => { try { return chrome.identity.getRedirectURL(); } catch { return ""; } };
// アクセストークンを得る。まず画面を出さずに試し(user=true のときだけ)だめなら、ログイン画面を出す
async function dsAuth(user) {
  if (!dsToken) { try { const s = JSON.parse(ls.get("tf-sync-tok", "null")); if (s?.v) dsToken = s; } catch {} } // 再読み込みしても、期限内なら続けて使う
  if (dsToken && dsToken.exp > Date.now() + 60000) return dsToken.v;
  const cid = dsCid(); if (!cid) throw new Error("クライアントIDが未設定です");
  if (typeof chrome.identity?.launchWebAuthFlow !== "function") throw new Error("このブラウザは Google ログインに対応していません");
  const base = { client_id: cid, response_type: "token", redirect_uri: dsRedirect(), scope: DS_SCOPE };
  // 前にログインしたドライブのアカウント。ブラウザに Google アカウントが複数あると、これを渡さないと
  // Google がどのアカウントか決められず、画面を出さない取り直しが interaction_required で失敗する(1時間ごとにログインが切れていた)
  const hint = dsAcct()?.email || "";
  const urlOf = (extra) => "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({ ...base, ...(hint ? { login_hint: hint } : {}), ...extra });
  // 画面を出さずに取り直すときは prompt=none を付ける(付けないと、許可済みでもアカウント選択画面になり、静かには取れない)
  const run = (interactive) => chrome.identity.launchWebAuthFlow({ url: urlOf(interactive ? { prompt: "select_account" } : { prompt: "none" }), interactive }); // ログイン画面では、アカウントを選び直せるようにする
  const parse = (u) => { try { return new URLSearchParams(new URL(u).hash.slice(1) || new URL(u).search.slice(1)); } catch { return new URLSearchParams(); } };
  // 画面を出さずに試す。失敗すると、例外になるか、error=interaction_required などの付いた結果が返る(どちらも「ログイン画面が必要」)
  let res = null, why = "";
  try { res = await run(false); } catch (e) { why = e?.message || String(e); }
  let p = res ? parse(res) : new URLSearchParams();
  if (!p.get("access_token")) {
    why = p.get("error") || why || "no token";
    tfLog("warn", "同期", `画面を出さないログインに失敗: ${why}${hint ? `(アカウント ${hint})` : "(アカウント未確認)"}`);
    if (!user) { dsConnLost = true; throw new Error("ログインが切れています(設定の「同期」で「今すぐ同期」を押すと、ログイン画面が出ます)"); }
    res = await run(true); p = parse(res);
  }
  const tok = p.get("access_token");
  if (!tok) throw new Error(p.get("error") || "ログインできませんでした");
  dsConnLost = false; tfLog("info", "同期", `ログインしました(アクセストークンを取得・期限 ${Math.round((+p.get("expires_in") || 3000) / 60)}分)`);
  dsToken = { v: tok, exp: Date.now() + (+p.get("expires_in") || 3000) * 1000 };
  ls.set("tf-sync-tok", JSON.stringify(dsToken));
  ls.set("tf-sync-conn", "1");
  return tok;
}
async function dsApi(url, init = {}, user = false, retry = true) {
  const tok = await dsAuth(user);
  const r = await fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: "Bearer " + tok } });
  if (r.status === 401 && retry) { dsToken = null; return dsApi(url, init, user, false); }
  if (!r.ok) { let m = ""; try { m = (await r.json())?.error?.message || ""; } catch {} throw new Error(`ドライブとの通信に失敗しました(${r.status}${m ? " " + m : ""})`); }
  return r;
}

/* ---------- YouTube と Google ドライブのアカウントが違うときのお知らせ ----------
   同期は、ドライブにログインしたアカウントを基準にする(YouTube でアカウントを切り替えても、同期先は変わらない)。
   YouTube 側が別のアカウントだと、再生リストや登録チャンネルが別のパソコンと食い違うので、知らせて YouTube 側をそろえてもらう */
let dsAcctWarned = "";
const dsAcct = () => { try { return JSON.parse(ls.get("tf-sync-acct", "null")); } catch { return null; } };
const dsYtAcct = () => { try { return JSON.parse(ls.get("tf-acct", "null")); } catch { return null; } };
// ドライブのアカウント(drive.appdata の権限のままで読める)。1時間に1回まで取り直す
async function dsFetchAcct(user, force = false) {
  const cur = dsAcct(); if (!force && cur?.email && Date.now() - (cur.at || 0) < 3600000) return;
  try {
    const u = (await (await dsApi("https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress,photoLink)", {}, user)).json())?.user || {};
    if (!u.emailAddress) return;
    if (cur?.email && cur.email.toLowerCase() !== u.emailAddress.toLowerCase()) tfLog("warn", "同期", `ドライブのアカウントが変わりました: ${cur.email} → ${u.emailAddress}`);
    ls.set("tf-sync-acct", JSON.stringify({ email: u.emailAddress, name: u.displayName || "", photo: u.photoLink || "", at: Date.now() }));
  } catch (e) { tfLog("warn", "同期", `ドライブのアカウントを確認できませんでした: ${e?.message || e}`); }
  dsCheckAcct();
}
// 違っていれば { drive, yt }。どちらかがわからない(未ログイン・メールが取れない)ときは null
function dsAcctMismatch() {
  if (!dsConnected()) return null;
  const d = dsAcct(), y = dsYtAcct();
  const de = (d?.email || "").trim().toLowerCase(), ye = (y?.email || "").trim().toLowerCase();
  return de && ye && de !== ye ? { drive: d, yt: y } : null;
}
function dsCheckAcct() {
  const m = dsAcctMismatch(), el = $("acct");
  if (el) {
    el.classList.toggle("acct-warn", !!m);
    const sub = $("acct-sub"), y = dsYtAcct();
    if (m) { sub.textContent = "⚠ 同期と別のアカウント"; el.title = `YouTube: ${m.yt.email}\nGoogle ドライブ(同期): ${m.drive.email}\n同期はドライブのアカウントを基準にしています`; }
    else if (y && !y.signedOut && sub.textContent.startsWith("⚠")) { sub.textContent = y.email || y.handle || ""; el.title = [y.name, y.email, y.handle].filter(Boolean).join(" / "); }
  }
  const key = m ? m.yt.email + "|" + m.drive.email : "";
  if (key && key !== dsAcctWarned) { // 同じ組み合わせでは、1回だけ知らせる
    tfLog("warn", "同期", `YouTube(${m.yt.email})と Google ドライブ(${m.drive.email})のアカウントが違います。同期はドライブのアカウントを基準にします`);
    toast(`YouTube のアカウントが、同期(Google ドライブ)の ${m.drive.email} と違います。設定の「同期」を見てください`);
  } else if (!key && dsAcctWarned) tfLog("info", "同期", "YouTube と Google ドライブのアカウントがそろいました");
  dsAcctWarned = key;
  if ($("set-sync") && !$("set-sync").hidden) paintSync();
}

/* ---------- ドライブのファイルの読み書き(appDataFolder) ---------- */
// 同じ名前のファイルが2つ以上あるとき(2台が同時に初めて同期すると、それぞれが新しく作ってしまう)は、
// どのパソコンでも同じものを使うよう、いちばん先に作られたものに揃える。ほかは名前を変えて残す(消さない)
let dsDups = 0;
async function dsFind(name, user) {
  if (dsIds[name]) return dsIds[name];
  const q = encodeURIComponent(`name='${name}' and trashed=false`);
  const j = await (await dsApi(`https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&orderBy=createdTime&fields=files(id,name,createdTime)&pageSize=20`, {}, user)).json();
  const files = j.files || [];
  for (const f of files.slice(1)) {
    const tag = (f.createdTime || "").replace(/\D/g, "").slice(0, 14) || f.id.slice(0, 8);
    try { await dsApi(`https://www.googleapis.com/drive/v3/files/${f.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.replace(/\.json$/, `.dup-${tag}.json`) }) }, user); dsDups++; tfLog("warn", "同期", `同じ名前の同期ファイルが重なっていたので、名前を変えて外しました(${name} / 作成 ${f.createdTime || "?"})`); } catch (e) { tfLog("error", "同期", `重なったファイルの名前を変えられませんでした: ${e?.message || e}`); }
  }
  return (dsIds[name] = files[0]?.id || null);
}
async function dsReadText(name, user) {
  const id = await dsFind(name, user); if (!id) return null;
  try { return await (await dsApi(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, {}, user)).text(); }
  catch (e) { if (/\(404/.test(e.message)) { delete dsIds[name]; return null; } throw e; }
}
async function dsWriteText(name, text, user) {
  const id = await dsFind(name, user);
  if (id) { await dsApi(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: text }, user); return; }
  const b = "tfb" + Math.random().toString(36).slice(2);
  const body = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: ["appDataFolder"] })}\r\n--${b}\r\nContent-Type: application/json\r\n\r\n${text}\r\n--${b}--`;
  const j = await (await dsApi("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${b}` }, body }, user)).json();
  dsIds[name] = j.id;
}
async function dsSnapshot(savedAt, rev) {
  const settings = {}; for (const k of dsKeys()) settings[k] = ls.get(k, "");
  const cmSettings = await chrome.storage.local.get(DS_CMKEYS);
  const stored = (await chrome.storage.local.get(KEY))[KEY] || {};
  let dev = ls.get("tf-sync-dev", ""); if (!dev) { dev = Math.random().toString(36).slice(2, 6); ls.set("tf-sync-dev", dev); }
  const tags = (await chrome.storage.local.get(DS_TAGLOG))[DS_TAGLOG] || null;
  return { app: "TubeFolio3", v: 1, savedAt, rev, device: dev, data: stored, settings, cm: cmSettings, tags };
}
function dsParse(text) {
  if (text == null) return null;
  const j = JSON.parse(text);
  if (j?.app !== "TubeFolio3" || !j.data) throw new Error("このファイルは TubeFolio3 の同期ファイルではありません");
  return j;
}

/* ---------- 書き出し / 読み込み ---------- */
async function dsPush(oldText, user) {
  const savedAt = Date.now();
  let rev = 1; try { rev = (JSON.parse(oldText)?.rev || 0) + 1; } catch {} // 版番号(時計のずれに左右されないよう、時刻ではなく版で新旧を判断する)
  if (oldText) await dsWriteText(DS_PREV, oldText, user); // 上書きする前の内容を残す
  const snap = await dsSnapshot(savedAt, rev);
  await dsWriteText(DS_FILE, JSON.stringify(snap), user);
  ls.set("tf-sync-hash", dsHash(snap.data)); ls.set("tf-sync-thash", dsHash(snap.tags));
  tfLog("info", "同期", `ドライブへ書き出し: 版${rev}・${Math.round(JSON.stringify(snap).length / 1024)}KB・フォルダ ${(snap.data.folders || []).length}個`);
  dsApplying = true; ls.set("tf-sync-base", String(rev)); ls.set("tf-sync-rat", String(savedAt)); ls.set("tf-sync-dirty", "0"); ls.set("tf-sync-last", String(Date.now())); dsApplying = false;
}

// フォルダのアイコン(画像・背景色・色)は、新しく変えた方を残す。ドライブの内容を読み込んでも、このパソコンで後から変えたアイコンは消さない
// (icoAt = アイコンを変えた時刻。記録がない古いデータでは、画像がある方を残す)
let dsKept = 0;
function dsKeepIcons(remoteData, local) {
  const data = JSON.parse(JSON.stringify(remoteData || {})), lf = new Map((local.folders || []).map((f) => [f.id, f]));
  let kept = 0;
  for (const rf of data.folders || []) {
    const l = lf.get(rf.id); if (!l) continue;
    const newer = (l.icoAt || 0) > (rf.icoAt || 0) || (!l.icoAt && !rf.icoAt && l.img && !rf.img);
    if (!newer || ((l.img || "") === (rf.img || "") && (l.bg || "") === (rf.bg || "") && l.color === rf.color)) continue;
    for (const k of ["img", "bg", "color", "icoAt"]) { if (l[k] != null) rf[k] = l[k]; else delete rf[k]; }
    kept++;
  }
  return { data, kept };
}
// タグの記録: 動画ごとの記録は両方を合わせ(同じ動画は新しい方)、取り置き・削除したタグ・最大数はドライブの内容に合わせる。削除したタグは、このパソコンの記録からも外す
function dsMergeTags(remote, local) {
  const out = { v: { ...(local?.v || {}) }, keep: [...(remote.keep || [])], block: [...(remote.block || [])], max: +remote.max || 0 };
  for (const [id, r] of Object.entries(remote.v || {})) { const l = out.v[id]; if (!l || (r.at || 0) >= (l.at || 0)) out.v[id] = r; }
  const blk = new Set(out.block.map((x) => String(x).toLowerCase())); if (blk.size) tgRemove(out, blk); // tags.js
  tgPrune(out);
  return out;
}
async function dsPull(remote) {
  const before = JSON.stringify(dsKeys().map((k) => [k, ls.get(k, "")]));
  dsSkipStore = true; // これから書き込む保存データの変更通知は、「このパソコンの変更」と数えない
  if (remote.cm) { dsCmSkipUntil = Date.now() + 2000; await chrome.storage.local.set(remote.cm); } // コメント表示の設定も、ドライブの内容に合わせる
  let tagsDiffer = false;
  if (remote.tags) { // タグの記録も、ドライブの内容を取り込む(このパソコンだけにある記録は残し、あとで書き出す)
    const lt = (await chrome.storage.local.get(DS_TAGLOG))[DS_TAGLOG] || {}, mt = dsMergeTags(remote.tags, lt);
    dsTagSkipUntil = Date.now() + 2000; await chrome.storage.local.set({ [DS_TAGLOG]: mt });
    tagsDiffer = dsHash(mt) !== dsHash(remote.tags);
    ls.set("tf-sync-thash", dsHash(remote.tags)); // このパソコンにだけある記録があれば、次の同期で書き出される
  }
  const local = (await chrome.storage.local.get(KEY))[KEY] || {};
  try { await chrome.storage.local.set({ "tf-sync-backup": { at: Date.now(), data: local } }); } catch {} // 読み込む前の内容を、このパソコンに1つ残す(設定の「同期」から戻せる)
  const { data: merged, kept } = dsKeepIcons(remote.data, local);
  tfLog("info", "同期", `ドライブから読み込み: 版${remote.rev}・フォルダ ${(remote.data.folders || []).length}個(このパソコンは ${(local.folders || []).length}個)${kept ? `・アイコン ${kept}件はこのパソコンの方を残す` : ""}`);
  await chrome.storage.local.set({ [KEY]: merged });
  setTimeout(() => { dsSkipStore = false; }, 1500); // 値が同じで変更通知が来なかったときに、次の本当の変更を見逃さないため
  dsApplying = true; // 設定の書き換えも同じく(同期の処理が終わるまでの、ごく短い間だけ)
  try {
    for (const k of dsKeys()) if (!(k in (remote.settings || {}))) { try { localStorage.removeItem(k); } catch {} }
    for (const [k, v] of Object.entries(remote.settings || {})) if (k.startsWith("tf-") && !DS_SKIP.has(k)) ls.set(k, v);
    const changed = before !== JSON.stringify(dsKeys().map((k) => [k, ls.get(k, "")]));
    ls.set("tf-sync-hash", dsHash(remote.data)); // アイコンを残したときは、ドライブと違うので次の同期で書き出される
    ls.set("tf-sync-base", String(remote.rev || 0)); ls.set("tf-sync-rat", String(remote.savedAt)); ls.set("tf-sync-dirty", kept ? "1" : "0"); ls.set("tf-sync-last", String(Date.now()));
    if (kept) dsKept = kept;
    if (kept || tagsDiffer) setTimeout(() => dsSync("auto", false), 1500);
    return changed;
  } finally { dsApplying = false; }
}

/* 自動の同期でログインが切れていたら、ページの中にポップアップを出して知らせる(ページを開いている間は1回だけ)。
   「ログインする」を押すと、そのままログイン画面を出して同期する */
let dsLoginAsked = false;
async function dsAskLogin() {
  if (dsLoginAsked) return; dsLoginAsked = true;
  const a = await askDlg("ドライブ同期のログインが切れています", "Google ドライブとの同期が止まっています。\nログインし直すと、同期を再開します。", [["login", "ログインする", "p"], ["", "あとで", "s"]]);
  if (a !== "login") { tfLog("info", "同期", "ログイン切れのお知らせを「あとで」で閉じました"); return; }
  while (dsBusy) await new Promise((r) => setTimeout(r, 200)); // 自動の同期が終わるのを待つ
  await dsSync("auto", true);
  if (dsConnLost) toast("ログインできませんでした。設定の「同期」で「今すぐ同期」を押してください");
  else dsLoginAsked = false; // 再開できたら、次に切れたときもまた知らせる
}

/* mode: "auto"(新しい方に合わせる) / "push"(このパソコンの内容でドライブを上書き) / "pull"(ドライブの内容で、このパソコンを上書き)
   user: ボタンを押した操作かどうか(ログイン画面や、競合の確認を出せる) */
async function dsSync(mode = "auto", user = false) {
  if (dsBusy) return; dsBusy = true;
  try {
    if (!dsCid()) { dsMsg = "クライアントIDが未設定です"; return; }
    if (!user && !dsConnected()) return;
    try { await dsAuth(user); }
    catch (e) { dsMsg = e?.message || "ログインできませんでした"; tfLog(user ? "error" : "warn", "同期", `ログインできませんでした: ${dsMsg}`); if (!user) dsAskLogin(); return; }
    await dsFetchAcct(user, user); // 同期の基準になるドライブのアカウントを確かめ、YouTube と違えば知らせる
    const text = await dsReadText(DS_FILE, user), remote = dsParse(text);
    const base = +ls.get("tf-sync-base", "0");
    // このパソコンに変更があるか。まだ一度も同期していないときは、フォルダや動画が入っていれば「変更あり」とみなす(読み込みで消さないため)
    const cur = (await chrome.storage.local.get(KEY))[KEY] || {};
    const hs = ls.get("tf-sync-hash", "");
    const dirty = ls.get("tf-sync-dirty", "0") === "1" || (base > 0 && hs && hs !== dsHash(cur)) || (base === 0 && ((cur.folders || []).length > 0 || Object.keys(cur.videos || {}).length > 0 || (cur.bookmarks || []).length > 0));
    // ドライブの内容が、このパソコンが最後に同期したものと違うか(版が進んだ、または別のファイルに切り替わった)
    const tagCur = (await chrome.storage.local.get(DS_TAGLOG))[DS_TAGLOG], ths = ls.get("tf-sync-thash", "");
    const tagDirty = !!tagCur && Object.keys(tagCur.v || {}).length + (tagCur.keep || []).length + (tagCur.block || []).length > 0 && (ths ? ths !== dsHash(tagCur) : !remote?.tags); // タグの記録だけが変わっていても、書き出す
    const rat = +ls.get("tf-sync-rat", "0"), newer = !!remote && ((remote.rev || 0) > base || (rat > 0 && remote.savedAt !== rat));
    let act = mode;
    if (mode === "auto") {
      if (!remote) act = "push";
      else if (newer && dirty) {
        if (!user) { dsMsg = "ドライブとこのパソコンの両方が変更されています(「今すぐ同期」で選べます)"; if (!dsWarned) { dsWarned = true; toast("ドライブとこのパソコンの両方が変更されています。設定の「同期」で「今すぐ同期」を押してください"); } return; }
        act = await askDlg("ドライブとこのパソコンの両方が変更されています", "どちらの内容を使いますか?\n・ドライブの内容を使う: このパソコンの変更は消えます\n・このパソコンの内容を使う: ドライブを上書きします(前の内容は tubefolio-sync.prev.json に残ります)", [["pull", "ドライブの内容を使う", "p"], ["push", "このパソコンの内容を使う", "s"], ["", "やめる", "s"]]);
        if (!act) { dsMsg = "同期をやめました"; return; }
      } else if (newer) act = "pull";
      else if (dirty || tagDirty) act = "push";
      else act = "none";
    }
    tfLog("info", "同期", `${user ? "手動" : "自動"}の同期(${mode}): ドライブ 版${remote ? remote.rev ?? 0 : "なし"}${remote?.savedAt ? "・" + new Date(remote.savedAt).toLocaleString("ja-JP") : ""}${remote?.device ? "・端末 " + remote.device : ""} / このパソコン 版${base}・変更${dirty ? "あり" : "なし"}${newer ? "・ドライブが新しい" : ""} → ${{ pull: "読み込み", push: "書き出し", none: "何もしない" }[act] || act}`);
    if (act === "pull" && !remote) { dsMsg = "ドライブに同期ファイルがありません"; return; }
    if (act === "pull") { const changed = await dsPull(remote); dsMsg = `ドライブから読み込みました(${new Date(remote.savedAt).toLocaleString("ja-JP")})${dsKept ? `。このパソコンで新しく変えたフォルダのアイコン ${dsKept}件は残し、ドライブへ書き出します` : ""}`; dsKept = 0; if (changed) { toast("ドライブの設定を反映するため、再読み込みします"); setTimeout(() => location.reload(), 800); } }
    else if (act === "push") { await dsPush(text, user); dsMsg = "ドライブへ書き出しました"; }
    else { ls.set("tf-sync-last", String(Date.now())); dsMsg = "同期済みです(変更はありません)"; }
    if (dsDups) { dsMsg += `(ドライブに同期ファイルが重なってできていたので、${dsDups}個を外して1つに揃えました)`; dsDups = 0; }
    tfLog("info", "同期", dsMsg);
  } catch (e) { dsMsg = "同期できませんでした: " + (e?.message || e); tfLog("error", "同期", dsMsg); }
  finally { dsBusy = false; paintSync(); }
}

/* ---------- 同期の内容を見る(何が同期され、何が同期されないか) ---------- */
const DS_NAMES = { "コメント表示の設定": "YouTube の再生画面の設定(コメント表示・SponsorBlock・字幕・読み上げ・ツール・ワイプ・休憩など)", "タグの記録": "設定「タグ」の記録(見た動画のタグ。取り置き・削除も同期)", folders: "フォルダ", videos: "保存した動画", bookmarks: "ブックマーク", channels: "チャンネル(フォルダ分け・調査結果)", playlists: "再生リストの控え",
  "tf-home-cache": "ホームの一覧のキャッシュ", "tf-play-mode": "サムネクリック時の再生(パソコン)", "tf-ta-set": "音楽の自動登録の設定", "tf-ta-led": "音楽の自動登録の記録(入れた・削除した・取り置き)", "tf-play-mode-m": "サムネクリック時の再生(スマホ)", "tf-chp-watched": "チャンネルページ: 視聴済み動画を消す", "tf-chp-members": "チャンネルページ: メンバー限定動画を消す", "tf-mu-set": "ミュージック: シャッフル・リピート・音量・動画で再生", "tf-mu-fold": "ミュージック: 閉じているフォルダ", "tf-mu-open": "ミュージック: 開いている再生リスト", "tf-mu-adff": "ミュージック: 広告の早送り", "tf-accent": "色の変更", "tf-sub-style": "登録済みチャンネルの見分け方", "tf-date-mode": "日付の表記", "tf-home-hidden": "ホームで非表示の行", "tf-home-hpl": "非表示の再生リスト",
  "tf-acct": "YouTubeアカウントの控え", "tf-ch-sync": "登録チャンネルの取得状況", "tf-watched": "視聴済みの印", "tf-home-dummy": "ダミー表示", "tf-sync-cid": "同期のクライアントID", "tf-sync-conn": "同期のログイン状態", "tf-sync-tok": "同期のトークン", "tf-sync-acct": "同期(ドライブ)のアカウント" };
const dsName = (k) => DS_NAMES[k] || k;
const dsSize = (v) => { try { return (typeof v === "string" ? v : JSON.stringify(v ?? "")).length; } catch { return 0; } };
const dsCount = (v) => { let x = v; if (typeof x === "string") { try { x = JSON.parse(x); } catch { return null; } } return Array.isArray(x) ? x.length : x && typeof x === "object" ? Object.keys(x).length : null; };
const dsKb = (n) => (n < 1024 ? n + " B" : (n / 1024).toFixed(n < 10240 ? 1 : 0) + " KB");
async function dsInspect(withRemote) {
  const stored = (await chrome.storage.local.get(KEY))[KEY] || {}, rows = [];
  let remote = null;
  if (withRemote) { try { remote = dsParse(await dsReadText(DS_FILE, true)); } catch (e) { dsMsg = "ドライブの内容を読めませんでした: " + (e?.message || e); } }
  const row = (grp, key, loc, rem, synced) => rows.push({ grp, name: dsName(key), key, n: dsCount(loc), b: dsSize(loc), rn: rem === undefined ? undefined : dsCount(rem), rb: rem === undefined ? undefined : dsSize(rem), synced });
  for (const k of Object.keys(stored)) row("保存データ", k, stored[k], remote ? remote.data?.[k] ?? null : undefined, true);
  for (const k of dsKeys()) row("設定", k, ls.get(k, ""), remote ? remote.settings?.[k] ?? null : undefined, true);
  row("設定", "コメント表示の設定", await chrome.storage.local.get(DS_CMKEYS), remote ? remote.cm ?? null : undefined, true);
  row("設定", "タグの記録", ((await chrome.storage.local.get(DS_TAGLOG))[DS_TAGLOG] || {}).v || {}, remote ? remote.tags?.v ?? null : undefined, true);
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith("tf-") && DS_SKIP.has(k) && k !== "tf-sync-tok") row("このパソコンだけ", k, ls.get(k, ""), undefined, false); } } catch {}
  return { rows, remote };
}
function dsViewHtml(res) {
  const { rows, remote } = res, sec = (t, note, list) => list.length ? `<h4>${t} <small>${note}</small></h4><table class="ds-t"><thead><tr><th>項目</th><th>このパソコン</th>${remote ? "<th>ドライブ</th>" : ""}</tr></thead><tbody>${list.map((r) => {
    const cell = (n, b) => (b === undefined ? "" : n == null && !b ? "—" : `${n != null ? n + " 件 ・ " : ""}${dsKb(b)}`);
    const diff = remote && r.synced && (r.rb !== r.b || r.rn !== r.n) ? " ds-diff" : "";
    return `<tr class="${diff}"><td>${esc(r.name)}${r.name !== r.key ? `<small>${esc(r.key)}</small>` : ""}</td><td>${cell(r.n, r.b)}</td>${remote ? `<td>${r.synced ? cell(r.rn, r.rb) : "(同期しない)"}</td>` : ""}</tr>`;
  }).join("")}</tbody></table>` : "";
  return (remote ? `<p class="hint">ドライブの内容: ${new Date(remote.savedAt).toLocaleString("ja-JP")} ・ 版 ${remote.rev} ・ 書き出したパソコン ${esc(remote.device || "?")}。色の付いた行は、このパソコンと内容が違います。</p>` : "")
    + sec("同期される: 保存データ", "フォルダ・動画・ブックマークなど", rows.filter((r) => r.synced && r.grp === "保存データ"))
    + sec("同期される: 設定", "表示や並び順など(tf-…)", rows.filter((r) => r.synced && r.grp === "設定"))
    + sec("同期されない", "このパソコンだけの値", rows.filter((r) => !r.synced))
    + `<p class="hint">YouTube 側で共有されるもの(再生リスト・登録チャンネル・視聴履歴・アカウント)は、ここには含まれず、各パソコンでYouTubeから取得します。</p>`;
}

/* ---------- 設定画面の「同期」タブ ---------- */
function paintSync() {
  const box = $("set-sync"); if (!box) return;
  const last = +ls.get("tf-sync-last", "0"), base = +ls.get("tf-sync-rat", "0");
  const when = (t) => (t ? new Date(t).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "まだありません");
  const on = dsConnected(), ru = dsRedirect();
  const open = box.querySelector("details")?.open || false;
  const da = on ? dsAcct() : null, mm = dsAcctMismatch();
  box.innerHTML = `<section class="ds-hero ${on ? "on" : ""}">
      <div class="ds-hi"><span class="ds-dot"></span><div><b>${on ? "Google ドライブと同期中" : "未ログイン"}</b><small>${on ? "変更の10秒後と、3分ごとに自動で同期します" : "Google アカウントでログインすると、別のパソコンと同じ内容を使えます"}</small>${da?.email ? `<small class="ds-acct">アカウント: ${esc(da.email)}</small>` : ""}</div></div>
      <div class="ds-hb"><button type="button" class="btn p" data-ds="login">${on ? "⟳ 今すぐ同期" : "🔑 Google でログイン"}</button>${on ? `<button type="button" class="btn s" data-ds="logout">ログアウト</button>` : ""}</div>
      <dl class="ds-dl"><div><dt>最後に同期</dt><dd>${when(last)}</dd></div><div><dt>ドライブ側の更新</dt><dd>${when(base)}</dd></div></dl>
    </section>
    ${mm ? `<section class="ds-warn"><b>⚠ YouTube と Google ドライブで、別のアカウントが使われています</b>
      <dl class="ds-dl"><div><dt>Google ドライブ(同期の基準)</dt><dd>${esc(mm.drive.email)}</dd></div><div><dt>YouTube</dt><dd>${esc(mm.yt.email)}</dd></div></dl>
      <p class="ds-sm">同期は Google ドライブのアカウント(${esc(mm.drive.email)})を基準にしています。YouTube のアカウントを切り替えても、同期先は変わりません。再生リストや登録チャンネルなど YouTube 側のものを別のパソコンとそろえるには、YouTube も ${esc(mm.drive.email)} に切り替えてください。</p>
      <div class="ds-b"><button type="button" class="btn p" data-ds="ytswitch">YouTube のアカウントを切り替える</button></div>
    </section>` : ""}
    ${dsMsg ? `<p class="ds-msg">${esc(dsMsg)}</p>` : ""}
    <section class="ds-card"><h3>同期されるもの</h3>
      <p><b>同期する:</b> フォルダ、保存した動画、ブックマーク、チャンネルのフォルダ分けと調査結果、設定(表示や並び順など)</p>
      <p><b>同期しない:</b> YouTube 側で共有されるもの(再生リスト・登録チャンネル・視聴履歴・アカウント)と、このパソコンだけの値</p>
      <p class="ds-sm">データはドライブの「アプリ専用フォルダ」に保存され、自分のドライブの一覧には出ません。書き換える前の内容は、1世代だけ残ります。2台で同時に変更すると、同期のときにどちらを使うか尋ねます。</p>
    </section>
    <section class="ds-card"><h3>内容を見る</h3>
      <div class="ds-b"><button type="button" class="btn s" data-ds="view">このパソコンの内容</button><button type="button" class="btn s" data-ds="viewr" ${on ? "" : "disabled"} title="ドライブの内容を読み込んで、並べて比べます">ドライブと比べる</button></div>
      <div id="ds-view">${dsView}</div>
    </section>
    <section class="ds-card"><h3>上書きして揃える</h3>
      <p class="ds-sm">通常は自動で同期されます。どちらかの内容に強制的に揃えたいときだけ使ってください。</p>
      <div class="ds-b"><button type="button" class="btn s" data-ds="push" ${on ? "" : "disabled"} title="このパソコンの内容で、ドライブのデータを上書きします">↑ ドライブへ書き出す</button><button type="button" class="btn s" data-ds="pull" ${on ? "" : "disabled"} title="ドライブの内容で、このパソコンの内容を上書きします">↓ ドライブから読み込む</button><button type="button" class="btn s" data-ds="restore" title="最後にドライブから読み込む前の、このパソコンの内容に戻します">↶ 読み込む前に戻す</button></div>
    </section>
    <details class="ds-how" ${open ? "open" : ""}><summary>別のパソコンで使うとき</summary>
      <p class="ds-sm">拡張機能を入れたパソコンごとに、Google Cloud の OAuth クライアントの「承認済みのリダイレクト URI」に、下の URL を追加してください。そのあと同じ Google アカウントでログインします。</p>
      <div class="ds-ru"><code>${esc(ru)}</code><button type="button" class="btn s" data-ds="copy">コピー</button></div>
    </details>`;
}
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-ds]"); if (!b) return;
  const a = b.dataset.ds;
  if (a === "view" || a === "viewr") { dsMsg = a === "viewr" ? "ドライブの内容を読み込んでいます…" : ""; dsView = ""; if (a === "viewr") paintSync(); try { dsView = dsViewHtml(await dsInspect(a === "viewr")); if (a === "viewr") dsMsg = dsMsg.startsWith("ドライブの内容を読めません") ? dsMsg : ""; } catch (err) { dsMsg = "表示できませんでした: " + (err?.message || err); } return paintSync(); }
  if (a === "copy") { try { await navigator.clipboard.writeText(dsRedirect()); toast("リダイレクト URI をコピーしました"); } catch { toast("コピーできませんでした"); } return; }
  if (a === "login") return dsSync("auto", true);
  if (a === "ytswitch") { window.open("https://accounts.google.com/AccountChooser?service=youtube&continue=" + encodeURIComponent("https://www.youtube.com/"), "_blank", "noopener"); return toast("切り替えたら、このページに戻ると確認し直します"); }
  if (a === "logout") { dsToken = null; ls.set("tf-sync-tok", "null"); ls.set("tf-sync-conn", "0"); ls.set("tf-sync-acct", "null"); dsCheckAcct(); dsMsg = "ログアウトしました(自動同期を止めました)"; return paintSync(); }
  if (a === "push") { if (!await uiConfirm("このパソコンの内容で、ドライブのデータを上書きします。よろしいですか?\n(上書き前の内容は tubefolio-sync.prev.json に残ります)")) return; return dsSync("push", true); }
  if (a === "restore") {
    const b = (await chrome.storage.local.get("tf-sync-backup"))["tf-sync-backup"];
    if (!b?.data) return toast("戻せる内容がありません(まだドライブから読み込んでいません)");
    if (!await uiConfirm(`${new Date(b.at).toLocaleString("ja-JP")} にドライブから読み込む前の内容(フォルダ ${(b.data.folders || []).length}個)に戻します。よろしいですか?
戻した内容は、ドライブへ書き出されます。`)) return;
    await chrome.storage.local.set({ [KEY]: b.data }); ls.set("tf-sync-dirty", "1"); dsMsg = "読み込む前の内容に戻しました"; paintSync(); return dsSync("push", true);
  }
  if (a === "pull") { if (!await uiConfirm("ドライブの内容で、このパソコンのフォルダ・動画・設定を上書きします。よろしいですか?")) return; return dsSync("pull", true); }
});

/* ---------- 起動時と定期的な自動同期 ---------- */
(function dsStart() {
  setTimeout(() => { if (dsConnected()) dsSync("auto", false); }, 3000);
  setInterval(() => { if (dsConnected() && !document.hidden) dsSync("auto", false); }, 3 * 60 * 1000);
  document.addEventListener("visibilitychange", () => {
    if (!dsConnected()) return;
    if (!document.hidden) return void dsSync("auto", false);
    if (dsTimer || ls.get("tf-sync-dirty", "0") === "1") { clearTimeout(dsTimer); dsTimer = 0; dsSync("auto", false); } // 別のタブへ移る・閉じる前に、待っている変更をすぐ書き出す
  });
  addEventListener("pagehide", () => { if (dsConnected() && (dsTimer || ls.get("tf-sync-dirty", "0") === "1")) { clearTimeout(dsTimer); dsTimer = 0; dsSync("auto", false); } });
})();
