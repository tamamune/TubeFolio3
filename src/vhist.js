/* ===== 視聴履歴(サイドバーの「視聴履歴」) =====
   YouTube の視聴履歴ページ(/feed/history)を読み、ダッシュボードのように見せる。
   上から: 今日のまとめ + 数字カード6枚 / 日ごとの棒グラフ(本数)と線(分) / 曜日別・長さ別・見終わった割合・動画の新しさ /
   よく見るチャンネル・カレンダー・ちょっとした発見 / 続きから見る / 日ごとの動画一覧(絞り込み・リストとグリッドの切り替え)。
   最初の1ページだけ読み、「さらに過去を読み込む」で過去へ。結果はこのページを開いている間だけ覚える。 */
const vh = { items: [], token: "", busy: false, err: "", loaded: false, q: "", f: "all", mode: ls.get("tf-vh-mode", "list") === "grid" ? "grid" : "list" };
const VH_C = { a: "#2de2d3", b: "#8f7cf5", c: "#5568e8", r: "#f06b8b", y: "#f5b94a", g: "#566070" };
const VH_WD = "日月火水木金土";
const vhI = (d, s = 16) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const VH_ICO = {
  film: vhI(`<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3z"/>`),
  clock: vhI(`<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>`),
  day: vhI(`<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>`),
  part: vhI(`<circle cx="12" cy="12" r="9"/><path d="M12 12V3"/><path d="M12 12l6 4"/>`),
  user: vhI(`<circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M21 20c0-2.6-1.6-4.8-4-5.6"/>`),
  len: vhI(`<path d="M4 12h16M4 12l3-3M4 12l3 3M20 12l-3-3M20 12l-3 3"/>`),
  fire: vhI(`<path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.2 1-3.7 2.2-4.8.3 1.7 1.2 2.8 2.3 3.3C11 9 11 6 12 3z"/>`),
  star: vhI(`<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>`),
  trophy: vhI(`<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H4.5a3 3 0 0 0 3.5 4M16 6h3.5a3 3 0 0 1-3.5 4M12 13v4M8 21h8M9.5 17h5"/>`),
  loop: vhI(`<path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/>`),
  lock: vhI(`<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>`),
  bolt: vhI(`<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>`),
  list: vhI(`<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>`, 15),
  grid: vhI(`<rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/>`, 15),
  play: vhI(`<path d="m8 5 11 7-11 7z"/>`, 14),
};
// チャンネルのアイコン画像(新しい形式の avatarViewModel と、古い形式の channelThumbnail の両方を探す)
function vhAv(o) {
  let u = "";
  (function w(x) { if (u || !x || typeof x !== "object") return; const s = x.avatarViewModel?.image?.sources || x.channelThumbnailWithLinkRenderer?.thumbnail?.thumbnails; if (s?.length) { u = s[0].url || ""; return; } Object.values(x).forEach(w); })(o);
  return u.startsWith("//") ? "https:" + u : u;
}
// 履歴ページの1画面分から、動画と「どの日の見出しの下か」を集める。続きを読むトークンも返す
function collectHist(root) {
  const out = [], seen = new Set(vh.items.map((x) => x.id)); let token = "", day = vh.items.length ? vh.items[vh.items.length - 1].day : "";
  (function walk(n) {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(walk);
    const sec = n.itemSectionRenderer;
    if (sec) { const h = txt(sec.header?.itemSectionHeaderRenderer?.title); if (h) day = h; }
    const cc = n.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token; if (cc && !token) token = cc;
    const r = n.videoRenderer;
    if (r?.videoId && !seen.has(r.videoId)) { seen.add(r.videoId); const by = r.ownerText || r.longBylineText; out.push({ id: r.videoId, title: txt(r.title), channel: txt(by), chUrl: chUrlOf(by), av: vhAv(r.channelThumbnailSupportedRenderers || r), duration: txt(r.lengthText), pub: txt(r.publishedTimeText), views: txt(r.viewCountText) || txt(r.shortViewCountText), pct: watchedPct(r), mem: memOnly(r.badges) || undefined, short: !!r.navigationEndpoint?.reelWatchEndpoint, day }); }
    const lv = n.lockupViewModel;
    if (lv && /VIDEO/.test(lv.contentType || "") && lv.contentId && !seen.has(lv.contentId)) { seen.add(lv.contentId); out.push({ id: lv.contentId, ...lockupInfo(lv), av: vhAv(lv.metadata), short: !!lv.rendererContext?.commandContext?.onTap?.innertubeCommand?.reelWatchEndpoint, day }); }
    const sl = n.shortsLockupViewModel; // 履歴の中の「ショート」の棚
    if (sl) { const id = sl.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId || String(sl.entityId || "").replace(/^shorts-shelf-item-/, ""); if (id && !seen.has(id)) { seen.add(id); out.push({ id, title: sl.overlayMetadata?.primaryText?.content || sl.accessibilityText || "ショート", channel: "", chUrl: "", duration: "", pub: "", views: sl.overlayMetadata?.secondaryText?.content || "", pct: 0, short: true, day }); } }
    Object.values(n).forEach(walk);
  })(root);
  return { out, token };
}
async function vhLoad(more) {
  if (vh.busy) return; vh.busy = true; vh.err = ""; if (vh.loaded) render();
  try {
    const root = more && vh.token ? await YTA.browse(vh.token) : await ytInit("https://www.youtube.com/feed/history");
    const { out, token } = collectHist(root);
    if (!more) vh.items = []; vh.items.push(...out); vh.token = token; vh.loaded = true;
    if (!vh.items.length) vh.err = "視聴履歴がありません(YouTubeにログインし、再生履歴がオンか確認してください)";
  } catch { vh.err = "視聴履歴を取得できませんでした(YouTubeへのログインや通信を確認してください)"; vh.loaded = true; }
  vh.busy = false; if (tab === "vhist") render();
}

/* ---------- 日付・時間の小さな道具 ---------- */
const vhD0 = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };
const vhKey = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
const vhMD = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
const vhMDW = (d) => `${vhMD(d)}(${VH_WD[d.getDay()]})`;
// 履歴の日の見出し(「今日」「昨日」「月曜日」「11月15日」「2025/11/15」など)を日付にする。分からなければ null
function vhDate(label) {
  const s = String(label || "").trim(), d0 = vhD0(), back = (n) => new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() - n);
  if (/^(今日|Today)$/i.test(s)) return back(0);
  if (/^(昨日|Yesterday)$/i.test(s)) return back(1);
  let m = s.match(/^([日月火水木金土])曜日?$/);
  const w = m ? VH_WD.indexOf(m[1]) : ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].indexOf(s.toLowerCase());
  if (w >= 0) return back((d0.getDay() - w + 7) % 7 || 7);
  if ((m = s.match(/(\d{4})\s*[年/.-]\s*(\d{1,2})\s*[月/.-]\s*(\d{1,2})/))) return new Date(+m[1], m[2] - 1, +m[3]);
  const fix = (d) => { if (d > d0) d.setFullYear(d.getFullYear() - 1); return d; };
  if ((m = s.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/))) return fix(new Date(d0.getFullYear(), m[1] - 1, +m[2]));
  const t = Date.parse(s + " " + d0.getFullYear());
  return isNaN(t) ? null : fix(new Date(t));
}
const vhSec = (d) => { const p = String(d || "").split(":").map(Number); return !d || p.some(isNaN) ? 0 : p.reduce((t, v) => t * 60 + v, 0); };
const vhFmt = (s) => !s ? "—" : s >= 3600 ? Math.floor(s / 3600) + "時間" + (Math.round(s % 3600 / 60) ? Math.round(s % 3600 / 60) + "分" : "") : Math.max(1, Math.round(s / 60)) + "分";
const vhFmtS = (s) => !s ? "—" : s >= 3600 ? (s / 3600).toFixed(1).replace(/\.0$/, "") + "時間" : Math.max(1, Math.round(s / 60)) + "分";
const VH_LEN = [["1分以下", 61], ["1〜5分", 300], ["5〜15分", 900], ["15〜30分", 1800], ["30〜60分", 3600], ["1時間以上", 1e9]];
const VH_LC = [VH_C.r, VH_C.y, VH_C.a, VH_C.b, VH_C.c, VH_C.g];
const vhLenOf = (x) => x.sec ? VH_LEN.findIndex(([, m]) => x.sec < m) : x.short ? 0 : -1;
// 公開日の文字(「3 日前」「2 か月前」など)から、動画の新しさを5段階にする(いまを基準に)
const VH_AGE = ["1日以内", "1週間以内", "1か月以内", "1年以内", "1年より前"];
function vhAge(pub) {
  const s = String(pub || ""), n = +(s.match(/(\d+)/)?.[1] || 1);
  if (/秒|分前|時間|second|minute|hour/i.test(s)) return 0;
  if (/日前|day/i.test(s)) return n <= 1 ? 0 : n <= 7 ? 1 : 2;
  if (/週間|week/i.test(s)) return n <= 1 ? 1 : 2;
  if (/か月|ヶ月|ヵ月|month/i.test(s)) return n <= 1 ? 2 : 3;
  if (/年|year/i.test(s)) return n <= 1 && !/年前/.test(s) ? 3 : 4;
  return -1;
}
const vhHue = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.codePointAt(0)) % 360; return h; };
const vhAvHtml = (name, url, cls = "") => {
  const sub = !url && typeof subMap === "function" ? subMap().get(subNorm(name)) : null, src = url || sub?.thumb || "";
  return `<span class="vh-av ${cls}" style="--h:${vhHue(name)}">${src ? `<img loading="lazy" src="${esc(src)}" alt="" referrerpolicy="no-referrer">` : esc([...String(name || "?")][0] || "?")}</span>`;
};
const vhDone = (x) => x.pct >= 96, vhPart = (x) => x.pct > 0 && x.pct < 96;

/* ---------- 集計(読み込んだ分すべて) ---------- */
function vhStats(all) {
  const d0 = vhD0(), days = [], dmap = new Map(), chs = new Map();
  for (const x of all) {
    x.sec = vhSec(x.duration);
    let d = dmap.get(x.day);
    if (!d) { d = { day: x.day, date: vhDate(x.day), n: 0, sec: 0, part: 0, chs: new Set(), items: [] }; dmap.set(x.day, d); days.push(d); }
    d.n++; d.sec += x.sec; if (vhPart(x)) d.part++; if (x.channel) d.chs.add(x.channel); d.items.push(x);
    if (x.channel) { const e = chs.get(x.channel) || { name: x.channel, n: 0, sec: 0, chUrl: x.chUrl, av: x.av, done: 0 }; e.n++; e.sec += x.sec; if (vhDone(x)) e.done++; e.chUrl ||= x.chUrl; e.av ||= x.av; chs.set(x.channel, e); }
  }
  // グラフ用の並び(古い→新しい)。日付が分かれば、何も見なかった日も 0 として埋める(最大30日)
  const dated = days.filter((d) => d.date), byKey = new Map(dated.map((d) => [vhKey(d.date), d]));
  let series;
  if (dated.length >= 2) {
    const newest = new Date(Math.max(...dated.map((d) => +d.date))), oldest = new Date(Math.min(...dated.map((d) => +d.date)));
    const span = Math.min(30, Math.round((newest - oldest) / 864e5) + 1);
    series = Array.from({ length: span }, (_, i) => { const dt = new Date(newest.getFullYear(), newest.getMonth(), newest.getDate() - (span - 1 - i)), d = byKey.get(vhKey(dt)); return { label: vhMD(dt), full: vhMDW(dt), date: dt, today: +dt === +d0, n: d?.n || 0, sec: d?.sec || 0, part: d?.part || 0, chn: d?.chs.size || 0 }; });
  } else series = days.slice(0, 30).reverse().map((d) => ({ label: d.date ? vhMD(d.date) : String(d.day || "").slice(0, 6), full: d.day, date: d.date, today: d.day === "今日", n: d.n, sec: d.sec, part: d.part, chn: d.chs.size }));
  const N = all.length, part = all.filter(vhPart).length, done = all.filter(vhDone).length, totSec = all.reduce((t, x) => t + x.sec, 0), withSec = all.filter((x) => x.sec).length;
  const wd = [0, 0, 0, 0, 0, 0, 0], wdDays = [0, 0, 0, 0, 0, 0, 0]; for (const s of series) if (s.date) { wd[s.date.getDay()] += s.n; wdDays[s.date.getDay()]++; }
  const len = VH_LEN.map(() => 0); for (const x of all) { const i = vhLenOf(x); if (i >= 0) len[i]++; }
  const age = VH_AGE.map(() => 0); for (const x of all) { const i = vhAge(x.pub); if (i >= 0) age[i]++; }
  // 連続で見た日数(今日か昨日から数える)
  const keys = new Set(dated.map((d) => vhKey(d.date))); let streak = 0, best = 0, run = 0;
  for (let i = keys.has(vhKey(d0)) ? 0 : 1; keys.has(vhKey(new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() - i))); i++) streak++;
  if (dated.length) { const lo = Math.min(...dated.map((d) => +d.date)); for (let t = new Date(lo); t <= d0; t = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1)) { run = keys.has(vhKey(t)) ? run + 1 : 0; best = Math.max(best, run); } }
  // 同じチャンネルを続けて見た最長の本数
  let binge = { n: 0, name: "" }, cur = { n: 0, name: "" }; for (const x of all) { cur = x.channel && x.channel === cur.name ? { n: cur.n + 1, name: cur.name } : { n: 1, name: x.channel }; if (x.channel && cur.n > binge.n) binge = { ...cur }; }
  const nd = Math.max(1, dated.length >= 2 ? series.length : days.length);
  return {
    N, part, done, totSec, withSec, days, series, wd, wdDays, len, age, streak, best, binge, nd,
    chs: [...chs.values()].sort((a, b) => b.n - a.n || b.sec - a.sec),
    today: dmap.get("今日") || days.find((d) => d.date && +d.date === +d0) || null,
    longest: all.reduce((m, x) => x.sec > (m?.sec || 0) ? x : m, null),
    busiest: days.reduce((m, d) => d.n > (m?.n || 0) ? d : m, null),
    mem: all.filter((x) => x.mem).length, shorts: all.filter((x) => vhLenOf(x) === 0).length,
    fresh: age[0] + age[1], avgPct: (() => { const p = all.filter((x) => x.pct > 0); return p.length ? p.reduce((t, x) => t + Math.min(100, x.pct), 0) / p.length : 0; })(),
  };
}

/* ---------- グラフの部品(SVG) ---------- */
// 点の並びをなめらかな曲線にする(各点の間を、横方向の中点を使った3次ベジェでつなぐ)
const vhPath = (p) => p.length < 2 ? "" : p.reduce((d, [x, y], i) => i ? d + ` C${((p[i - 1][0] + x) / 2).toFixed(1)},${p[i - 1][1].toFixed(1)} ${((p[i - 1][0] + x) / 2).toFixed(1)},${y.toFixed(1)} ${x.toFixed(1)},${y.toFixed(1)}` : `M${x.toFixed(1)},${y.toFixed(1)}`, "");
const vhPts = (vals, w, h, pad = 3, max = Math.max(1, ...vals)) => vals.map((v, i) => [vals.length < 2 ? w / 2 : (i * w) / (vals.length - 1), h - pad - (v / max) * (h - pad * 2)]);
const vhNice = (v) => { const p = Math.pow(10, Math.floor(Math.log10(Math.max(1, v)))), f = v / p; return Math.max(2, (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p); };
let vhUid = 0;
function vhSpark(vals, color, kind) { // 数字カードの中の小さなグラフ(面 / 線 / 棒)
  const w = 100, h = 34; if (!vals.length) vals = [0];
  if (kind === "bars") { vals = vals.slice(-12); const m = Math.max(1, ...vals), bw = w / vals.length; return `<svg class="vm-sp" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">${vals.map((v, i) => `<rect x="${(i * bw + bw * .2).toFixed(1)}" y="${(h - Math.max(2, (v / m) * (h - 2))).toFixed(1)}" width="${(bw * .6).toFixed(1)}" height="${Math.max(2, (v / m) * (h - 2)).toFixed(1)}" rx="1.5" fill="${color}" opacity="${i === vals.length - 1 ? 1 : .45}"/>`).join("")}</svg>`; }
  const p = vhPts(vals.length > 1 ? vals : [0, vals[0]], w, h, 4), d = vhPath(p), id = "vs" + ++vhUid;
  const area = kind === "area" ? `<defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".4"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs><path d="${d} L${w},${h} L0,${h} Z" fill="url(#${id})"/>` : "";
  return `<svg class="vm-sp" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">${area}<path d="${d}" fill="none" stroke="${color}" stroke-width="1.8" vector-effect="non-scaling-stroke"/></svg>`;
}
// 日ごとの棒(本数・左の目盛り)と線(視聴時間・右の目盛り)。列にマウスを乗せると、その日の数字が出る
function vhCombo(S) {
  const W = 960, H = 250, L = 36, R = 46, T = 14, B = 26, pw = W - L - R, ph = H - T - B, k = S.length;
  const mn = vhNice(Math.max(...S.map((s) => s.n))), mm = vhNice(Math.max(...S.map((s) => s.sec / 60))), bw = pw / k, cx = (i) => L + bw * i + bw / 2, u = ++vhUid;
  const yN = (v) => T + ph - (v / mn) * ph, yM = (v) => T + ph - (v / mm) * ph;
  const grid = [0, .25, .5, .75, 1].map((f) => `<line x1="${L}" x2="${W - R}" y1="${T + ph * (1 - f)}" y2="${T + ph * (1 - f)}" stroke="#1f2631" ${f ? 'stroke-dasharray="2 4"' : ""}/><text x="${L - 7}" y="${T + ph * (1 - f) + 3.5}" fill="#5f6b7c" font-size="10" text-anchor="end">${+(mn * f).toFixed(1)}</text><text x="${W - R + 7}" y="${T + ph * (1 - f) + 3.5}" fill="#6f639f" font-size="10">${+(mm * f).toFixed(1)}分</text>`).join("");
  const step = Math.ceil(k / 12);
  const cols = S.map((s, i) => { const h = Math.max(s.n ? 2 : 0, (s.n / mn) * ph), bwi = Math.min(26, bw * .62); return `<g class="vh-col"><rect class="hl" x="${(L + bw * i).toFixed(1)}" y="${T}" width="${bw.toFixed(1)}" height="${ph}" rx="4"/>${h ? `<rect x="${(cx(i) - bwi / 2).toFixed(1)}" y="${(T + ph - h).toFixed(1)}" width="${bwi.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="url(#vcb${u})" opacity="${s.today ? 1 : .82}"/>` : ""}${(k - 1 - i) % step === 0 ? `<text x="${cx(i).toFixed(1)}" y="${H - 7}" fill="${s.today ? "#e6ebf3" : s.date && (s.date.getDay() % 6 === 0) ? "#7d8aa0" : "#5f6b7c"}" font-size="10" font-weight="${s.today ? 700 : 400}" text-anchor="middle">${s.today ? "今日" : esc(s.label)}</text>` : ""}<title>${esc(s.full)}: ${s.n}本 ・ ${vhFmt(s.sec)}</title></g>`; }).join("");
  const lp = S.map((s, i) => [cx(i), yM(s.sec / 60)]), dots = lp.map(([x, y], i) => S[i].sec ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6" fill="#0f1319" stroke="${VH_C.b}" stroke-width="1.6" pointer-events="none"/>` : "").join("");
  const lpath = vhPath(lp);
  return `<svg class="vh-area" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="日ごとの本数と視聴時間"><defs><linearGradient id="vcb${u}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${VH_C.a}"/><stop offset="1" stop-color="${VH_C.a}" stop-opacity=".35"/></linearGradient><linearGradient id="vcl${u}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${VH_C.b}" stop-opacity=".22"/><stop offset="1" stop-color="${VH_C.b}" stop-opacity="0"/></linearGradient></defs>${grid}${cols}
    ${lpath ? `<path d="${lpath} L${lp[lp.length - 1][0]},${T + ph} L${lp[0][0]},${T + ph} Z" fill="url(#vcl${u})" pointer-events="none"/><path d="${lpath}" fill="none" stroke="${VH_C.b}" stroke-width="2" pointer-events="none"/>` : ""}${dots}</svg>`;
}
// ドーナツ(割合の輪)。vals の合計を一周とする
function vhDonut(vals, colors, labels, center, sub) {
  const r = 46, w = 13, C = 2 * Math.PI * r, tot = vals.reduce((a, b) => a + b, 0) || 1; let off = 0;
  const seg = vals.map((v, i) => { if (!v) return ""; const l = v / tot * C, s = `<circle cx="60" cy="60" r="${r}" fill="none" stroke="${colors[i]}" stroke-width="${w}" stroke-dasharray="${Math.max(0.5, l - 2).toFixed(2)} ${C.toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 60 60)"><title>${esc(labels[i])}: ${v}本(${Math.round(v / tot * 100)}%)</title></circle>`; off += l; return s; }).join("");
  return `<div class="vh-dn"><svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="${r}" fill="none" stroke="#1c232d" stroke-width="${w}"/>${seg}</svg><div class="vh-dc"><b>${center}</b><small>${sub}</small></div></div>`;
}
const vhLegend = (labels, vals, colors) => { const tot = vals.reduce((a, b) => a + b, 0) || 1; return `<ul class="vh-lg">${labels.map((n, i) => `<li><i style="background:${colors[i]}"></i><span>${n}</span><b>${vals[i]}<small>${Math.round(vals[i] / tot * 100)}%</small></b></li>`).join("")}</ul>`; };
const vhHbar = (label, v, max, color, right) => `<div class="vh-hb"><span class="vh-hbl">${label}</span><span class="vh-pb"><i style="width:${max ? Math.max(v ? 3 : 0, v / max * 100) : 0}%;background:${color}"></i></span><b>${right ?? v}</b></div>`;

/* ---------- 画面 ---------- */
const VH_F = [["all", "すべて"], ["part", "途中まで"], ["done", "見終わった"], ["short", "ショート"], ["long", "30分以上"], ["mem", "メン限"]];
const vhPass = (f, x) => f === "part" ? vhPart(x) : f === "done" ? vhDone(x) : f === "short" ? vhLenOf(x) === 0 : f === "long" ? x.sec >= 1800 : f === "mem" ? !!x.mem : true;
function vhRow(x, grid) {
  vmap.set(x.id, { ...(vmap.get(x.id) || {}), title: x.title, channel: x.channel, duration: x.duration, pub: x.pub, views: x.views });
  const p = vhPart(x) ? x.pct : 0, dn = vhDone(x), rest = p && x.sec ? Math.round(x.sec * (1 - p / 100)) : 0;
  const st = dn ? `<span class="vh-st done">✓ 見終わった</span>` : p ? `<span class="vh-st part">▶ ${Math.round(p)}%${rest ? ` ・ 残り${vhFmt(rest)}` : ""}</span>` : "";
  const ch = x.channel ? `<span class="vh-ch" data-ch="${esc(x.chUrl || "")}" data-chn="${esc(x.channel)}" role="link" tabindex="0">${vhAvHtml(x.channel, x.av, "s")}<span>${esc(x.channel)}</span></span>` : "";
  const meta = [x.views, x.pub].filter(Boolean).map(esc).join(" ・ ");
  return `<li class="vh-r ${grid ? "g" : ""} ${dn ? "is-done" : ""}"><button type="button" class="vh-th" data-v="${esc(x.id)}" title="${esc(x.title)}"><img loading="lazy" src="${thumb(x.id)}" alt="">${x.duration ? `<em>${esc(x.duration)}</em>` : vhLenOf(x) === 0 ? `<em>ショート</em>` : ""}${p || dn ? `<i style="width:${dn ? 100 : p}%" class="${dn ? "dn" : ""}"></i>` : ""}<span class="vh-pl">${VH_ICO.play}</span></button>
    <div class="vh-t"><button type="button" class="vh-tt" data-v="${esc(x.id)}">${esc(x.title)}</button>${ch}${meta || x.mem ? `<small>${x.mem ? `<span class="mem">メン限</span>` : ""}${meta}</small>` : ""}${st}</div></li>`;
}
function vhistView() {
  if (!vh.loaded && !vh.busy) vhLoad(false);
  const all = vh.items, S = all.length ? vhStats(all) : null;
  const range = S && S.series.length && S.series[0].date ? `${vhMD(S.series[0].date)} 〜 ${vhMD(S.series[S.series.length - 1].date)}` : "";
  const head = `<div class="s-bar vh-bar"><div class="s-head">視聴履歴${S ? `<small>${S.N}本を読み込み済み${range ? ` ・ ${range}` : ""}</small>` : ""}</div><div class="vh-tools"><input type="search" id="vh-q" class="bm-q" placeholder="タイトル・チャンネルで探す" value="${esc(vh.q)}" autocomplete="off"><button type="button" class="btn s vh-btn" data-vh="reload" ${vh.busy ? "disabled" : ""}>⟳ 読み込み直す</button></div></div>`;
  if (!S) return head + `<div class="empty ${vh.busy ? "ld" : ""}">${vh.busy ? "読み込み中…" : esc(vh.err || "視聴履歴がありません")}</div>`;
  const { N, part, done, totSec, series } = S, avg = N / S.nd;
  const cn = series.map((s) => s.n), cm = series.map((s) => Math.round(s.sec / 60));
  const delta = (v) => { const h = Math.floor(v.length / 2), o = v.slice(0, h).reduce((a, b) => a + b, 0), n = v.slice(-h).reduce((a, b) => a + b, 0); if (v.length < 4 || !o) return ""; const p = Math.round((n - o) / o * 100); return `<span class="vm-bd ${p >= 0 ? "up" : "dn"}" title="後半${h}日と前半${h}日の比較">${p >= 0 ? "▲" : "▼"} ${Math.abs(p)}%</span>`; };
  const metric = (ico, color, label, val, unit, badge, chart, sub) => `<div class="vm" style="--mc:${color}"><div class="vm-h"><span class="vm-ic">${ico}</span>${label}${badge || ""}</div><div class="vm-v"><b>${val}</b>${unit ? `<small>${unit}</small>` : ""}</div>${sub ? `<div class="vm-s">${sub}</div>` : ""}${chart}</div>`;
  const avgLen = S.withSec ? totSec / S.withSec : 0;

  // 今日のまとめ
  const td = S.today, tn = td?.n || 0, ratio = avg ? tn / avg : 0, last = all[0];
  const C = 2 * Math.PI * 40, ringV = Math.min(1, ratio);
  const todayCard = `<section class="vh-c vh-today"><div class="vh-tdh"><h3>今日の視聴</h3><span class="vh-date">${vhMDW(vhD0())}</span></div>
    <div class="vh-tdb"><div class="vh-ring"><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="40" fill="none" stroke="#1c232d" stroke-width="9"/><circle cx="50" cy="50" r="40" fill="none" stroke="url(#vtr)" stroke-width="9" stroke-linecap="round" stroke-dasharray="${(Math.max(.001, ringV) * C).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 50 50)"/><defs><linearGradient id="vtr" x1="0" x2="1"><stop offset="0" stop-color="${VH_C.a}"/><stop offset="1" stop-color="${VH_C.b}"/></linearGradient></defs></svg><div><b>${tn}</b><small>本</small></div></div>
      <ul class="vh-tdl"><li><span>視聴時間</span><b>${vhFmt(td?.sec || 0)}</b></li><li><span>1日平均と比べて</span><b class="${tn >= avg ? "up" : "dn"}">${avg ? (tn >= avg ? "+" : "−") + Math.abs(tn - avg).toFixed(1) + "本" : "—"}</b></li><li><span>チャンネル</span><b>${td?.chs.size || 0}</b></li><li><span>連続視聴</span><b>${S.streak ? S.streak + "日目" : "—"}</b></li></ul></div>
    ${last ? `<button type="button" class="vh-last" data-v="${esc(last.id)}"><img loading="lazy" src="${thumb(last.id)}" alt=""><span><small>最後に見た動画</small><b>${esc(last.title)}</b></span></button>` : ""}</section>`;
  const kpis = `<div class="vm-row">
      ${metric(VH_ICO.film, VH_C.a, "見た動画", N, "本", delta(cn), vhSpark(cn, VH_C.a, "area"), `${S.days.length}日分`)}
      ${metric(VH_ICO.clock, VH_C.b, "推定の視聴時間", vhFmtS(totSec), "", delta(cm), vhSpark(cm, VH_C.b, "area"), "動画の長さ × 本数")}
      ${metric(VH_ICO.day, VH_C.c, "1日あたり", avg.toFixed(1), "本", "", vhSpark(cn, VH_C.c, "bars"), `時間は ${vhFmt(totSec / S.nd)}/日`)}
      ${metric(VH_ICO.user, VH_C.y, "チャンネル", S.chs.length, "", "", vhSpark(series.map((s) => s.chn), VH_C.y, "bars"), S.chs[0] ? `最多: ${esc(S.chs[0].name)}` : "")}
      ${metric(VH_ICO.part, VH_C.r, "途中まで", part, "本", `<span class="vm-bd">${Math.round(part / N * 100)}%</span>`, vhSpark(series.map((s) => s.part), VH_C.r, "bars"), `見終わった ${done}本`)}
      ${metric(VH_ICO.len, "#7fd9ff","平均の長さ", vhFmt(avgLen), "", "", vhSpark(series.map((s) => s.n ? Math.round(s.sec / s.n / 60) : 0), "#7fd9ff", "line"), S.longest ? `最長 ${esc(S.longest.duration)}` : "")}
    </div>`;

  // 曜日別(月〜日)
  const wOrder = [1, 2, 3, 4, 5, 6, 0], wMax = Math.max(1, ...S.wd), wTop = S.wd.indexOf(Math.max(...S.wd));
  const hasWd = S.wd.some(Boolean);
  const week = hasWd ? `<div class="vh-wk">${wOrder.map((i) => `<div class="vh-wkc ${i === wTop ? "top" : ""}" title="${VH_WD[i]}曜日: ${S.wd[i]}本${S.wdDays[i] ? `(平均 ${(S.wd[i] / S.wdDays[i]).toFixed(1)}本)` : ""}"><b>${S.wd[i] || ""}</b><span><i style="height:${Math.max(S.wd[i] ? 4 : 0, S.wd[i] / wMax * 100)}%"></i></span><small class="${i === 0 ? "su" : i === 6 ? "sa" : ""}">${VH_WD[i]}</small></div>`).join("")}</div><p class="vh-note">${VH_WD[wTop]}曜日がいちばん多い</p>` : `<p class="sl-none">日付が分かる履歴がありません。</p>`;
  // 長さ別
  const lenTot = S.len.reduce((a, b) => a + b, 0);
  const lenCard = `<div class="vh-dnw">${vhDonut(S.len, VH_LC, VH_LEN.map((l) => l[0]), vhFmt(avgLen), "平均")}${vhLegend(VH_LEN.map((l) => l[0]), S.len, VH_LC)}</div>`;
  // 見終わった割合
  const none = N - part - done, stCol = [VH_C.a, VH_C.r, "#2a3240"];
  const stCard = `<div class="vh-stk">${[done, part, none].map((v, i) => v ? `<i style="flex:${v};background:${stCol[i]}" title="${["見終わった", "途中まで", "記録なし"][i]}: ${v}本"></i>` : "").join("")}</div>
    ${vhLegend(["見終わった", "途中まで", "記録なし"], [done, part, none], stCol)}
    <div class="vh-big"><b>${Math.round(S.avgPct)}%</b><span>進捗が記録された動画の<br>平均の進み具合</span></div>`;
  // 動画の新しさ
  const ageMax = Math.max(1, ...S.age), ageCol = [VH_C.a, "#4fc7e0", VH_C.c, VH_C.b, VH_C.g];
  const ageCard = VH_AGE.map((l, i) => vhHbar(l, S.age[i], ageMax, ageCol[i])).join("") + `<p class="vh-note">公開から1週間以内の動画が ${Math.round(S.fresh / N * 100)}%</p>`;

  // よく見るチャンネル
  const top = S.chs.slice(0, 8), chMax = Math.max(1, top[0]?.n || 1);
  const chRows = top.map((c, i) => `<li class="vh-rk"><span class="vh-rn ${i < 3 ? "m" + i : ""}">${i + 1}</span><span class="vh-ch big" data-ch="${esc(c.chUrl || "")}" data-chn="${esc(c.name)}" role="link" tabindex="0">${vhAvHtml(c.name, c.av)}<span class="vh-cn"><b>${esc(c.name)}</b><small>${vhFmt(c.sec)}${c.done ? ` ・ 見終わった ${c.done}本` : ""}</small></span></span><span class="vh-rb"><span class="vh-pb"><i style="width:${c.n / chMax * 100}%;background:linear-gradient(90deg,${VH_C.c},${VH_C.a})"></i></span><b>${c.n}<small>本</small></b></span></li>`).join("");
  const chCard = `<section class="vh-c vh-chs"><h3>よく見るチャンネル<small>${S.chs.length}チャンネル中</small></h3>${top.length ? `<ol class="vh-rkl">${chRows}</ol>` : `<p class="sl-none">チャンネルの情報がありません。</p>`}${S.chs.length > 8 ? `<p class="vh-note">ほか ${S.chs.length - 8} チャンネル</p>` : ""}</section>`;

  // カレンダー(直近12週。濃いほど多い。読み込んでいない日は点線)
  const d0 = vhD0(), cnt = new Map(); let oldest = null;
  for (const d of S.days) if (d.date) { cnt.set(vhKey(d.date), d.n); if (!oldest || d.date < oldest) oldest = d.date; }
  const start = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() - ((d0.getDay() + 6) % 7) - 7 * 11), cMax = Math.max(1, ...cnt.values());
  let cells = "", months = "";
  for (let w = 0; w < 12; w++) {
    const ws = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7), we = new Date(ws.getFullYear(), ws.getMonth(), ws.getDate() + 6);
    months += `<span>${w === 0 || ws.getMonth() !== we.getMonth() || ws.getDate() === 1 ? (we.getMonth() + 1) + "月" : ""}</span>`;
    for (let i = 0; i < 7; i++) {
      const dt = new Date(ws.getFullYear(), ws.getMonth(), ws.getDate() + i), n = cnt.get(vhKey(dt)) || 0;
      const cls = dt > d0 ? "fut" : !oldest || dt < oldest ? "nd" : "l" + (n ? Math.ceil(n / cMax * 4) : 0);
      cells += `<i class="${cls} ${+dt === +d0 ? "td" : ""}" title="${vhMDW(dt)}${cls === "nd" ? ": 未読み込み" : cls === "fut" ? "" : `: ${n}本`}"></i>`;
    }
  }
  const calCard = `<section class="vh-c vh-cal"><h3>カレンダー<small>直近12週</small></h3><div class="vh-calw"><div class="vh-cald"><span></span>${"月火水木金土日".split("").map((c, i) => `<span>${i % 2 === 0 ? c : ""}</span>`).join("")}</div><div class="vh-calm"><div class="vh-calh">${months}</div><div class="vh-calg">${cells}</div></div></div>
    <div class="vh-calk"><span>少</span><i class="l0"></i><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i><span>多</span><i class="nd"></i><span>未読み込み</span></div></section>`;

  // ちょっとした発見
  const ins = [
    S.busiest && [VH_ICO.trophy, VH_C.y, "いちばん見た日", `${S.busiest.date ? vhMDW(S.busiest.date) : esc(S.busiest.day)} ・ ${S.busiest.n}本`],
    [VH_ICO.fire, VH_C.r, "連続視聴", S.streak ? `${S.streak}日つづけて視聴中${S.best > S.streak ? `(最長 ${S.best}日)` : ""}` : S.best ? `最長 ${S.best}日` : "—"],
    S.binge.n >= 2 && [VH_ICO.loop, VH_C.b, "続けて見た最多", `${esc(S.binge.name)} を ${S.binge.n}本つづけて`],
    S.longest?.sec && [VH_ICO.len, "#7fd9ff", "いちばん長い動画", `<span class="vh-lk" data-v="${esc(S.longest.id)}" role="button" tabindex="0">${esc(S.longest.title)}</span> ・ ${esc(S.longest.duration)}`],
    [VH_ICO.bolt, VH_C.a, "新しい動画を見た割合", `公開1週間以内が ${Math.round(S.fresh / N * 100)}%`],
    (S.shorts || S.mem) && [VH_ICO.lock, VH_C.c, "ショート / メン限", `${S.shorts}本 / ${S.mem}本`],
  ].filter(Boolean).map(([ic, c, l, v]) => `<li><span class="vh-ii" style="--mc:${c}">${ic}</span><span><small>${l}</small><b>${v}</b></span></li>`).join("");
  const insCard = `<section class="vh-c vh-ins"><h3>ちょっとした発見</h3><ul>${ins}</ul></section>`;

  // 続きから見る
  const resume = all.filter((x) => vhPart(x) && x.pct >= 3).slice(0, 14);
  const resCard = resume.length ? `<section class="vh-c vh-res"><h3>続きから見る<small>${all.filter(vhPart).length}本</small></h3><div class="vh-rs">${resume.map((x) => { const rest = x.sec ? Math.round(x.sec * (1 - x.pct / 100)) : 0; vmap.set(x.id, { ...(vmap.get(x.id) || {}), title: x.title, channel: x.channel, duration: x.duration }); return `<button type="button" class="vh-rc" data-v="${esc(x.id)}" title="${esc(x.title)}"><span class="vh-rct"><img loading="lazy" src="${thumb(x.id)}" alt=""><i style="width:${x.pct}%"></i><em>${rest ? "残り " + vhFmt(rest) : Math.round(x.pct) + "%"}</em><span class="vh-pl">${VH_ICO.play}</span></span><b>${esc(x.title)}</b><small>${esc(x.channel)}</small></button>`; }).join("")}</div></section>` : "";

  // 一覧(絞り込み + 日ごと)
  const q = vh.q.trim().toLowerCase(), rows = all.filter((x) => vhPass(vh.f, x) && (!q || (x.title + "\n" + x.channel).toLowerCase().includes(q)));
  const chips = VH_F.map(([k, l]) => { const n = all.filter((x) => vhPass(k, x)).length; return k !== "all" && !n ? "" : `<button type="button" class="vh-chip ${vh.f === k ? "on" : ""}" data-vhf="${k}">${l}<small>${n}</small></button>`; }).join("");
  let body = "", cur = null;
  const grid = vh.mode === "grid";
  for (const x of rows) {
    if (x.day !== cur) {
      cur = x.day; const d = S.days.find((e) => e.day === cur), dt = d?.date, inDay = rows.filter((r) => r.day === cur);
      body += `${body ? "</ul>" : ""}<div class="vh-d"><b>${esc(cur || "ほか")}</b>${dt && !/\d/.test(cur) ? `<span>${vhMDW(dt)}</span>` : ""}<small>${inDay.length}本 ・ ${vhFmt(inDay.reduce((t, r) => t + r.sec, 0))}</small></div><ul class="vh-ul ${grid ? "grid" : ""}">`;
    }
    body += vhRow(x, grid);
  }
  if (body) body += "</ul>";
  const listCard = `<section class="vh-c vh-list"><div class="vh-lh"><h3>見た動画<small>${q || vh.f !== "all" ? rows.length + "本が一致" : N + "本"}</small></h3><div class="vh-chips">${chips}</div><div class="vh-mode"><button type="button" class="${grid ? "" : "on"}" data-vhm="list" title="リスト">${VH_ICO.list}</button><button type="button" class="${grid ? "on" : ""}" data-vhm="grid" title="グリッド">${VH_ICO.grid}</button></div></div>
      ${rows.length ? body : `<p class="sl-none">一致する履歴はありません。</p>`}
      ${vh.err ? `<p class="sl-none">${esc(vh.err)}</p>` : ""}
      ${vh.token ? `<button type="button" class="btn s vh-btn vh-more" data-vh="more" ${vh.busy ? "disabled" : ""}>${vh.busy ? "読み込み中…" : "さらに過去を読み込む"}</button>` : ""}
    </section>`;

  return head + `<div class="sl-wrap vh2">
    <div class="vh-top">${todayCard}${kpis}</div>
    <section class="vh-c vh-bigc"><div class="vh-ct"><h3>日ごとの視聴<small>${series.length}日間${range ? " ・ " + range : ""}</small></h3><ul class="vh-lg vh-lgh"><li><i style="background:${VH_C.a}"></i>本数</li><li><i style="background:${VH_C.b}"></i>視聴時間(分)</li></ul></div>${vhCombo(series)}</section>
    <div class="vh-g4">
      <section class="vh-c"><h3>曜日別<small>本数の合計</small></h3>${week}</section>
      <section class="vh-c"><h3>動画の長さ<small>${lenTot}本</small></h3>${lenCard}</section>
      <section class="vh-c"><h3>見終わった割合</h3>${stCard}</section>
      <section class="vh-c"><h3>動画の新しさ<small>公開からの経過</small></h3>${ageCard}</section>
    </div>
    <div class="vh-g3">${chCard}<div class="vh-col2">${calCard}${insCard}</div></div>
    ${resCard}
    ${listCard}
  </div>`;
}
document.addEventListener("input", (e) => {
  if (e.target.id !== "vh-q") return;
  vh.q = e.target.value; const pos = e.target.selectionStart;
  clearTimeout(vhistView.t); vhistView.t = setTimeout(() => { render(); const i = $("vh-q"); if (i) { i.focus({ preventScroll: true }); try { i.setSelectionRange(pos, pos); } catch {} } }, 150);
});
document.addEventListener("click", (e) => {
  let b;
  if ((b = e.target.closest("[data-vhf]"))) { vh.f = b.dataset.vhf; return render(); }
  if ((b = e.target.closest("[data-vhm]"))) { vh.mode = b.dataset.vhm; ls.set("tf-vh-mode", vh.mode); return render(); }
  b = e.target.closest("[data-vh]"); if (!b) return;
  if (b.dataset.vh === "more") vhLoad(true); else if (b.dataset.vh === "reload") { vh.loaded = false; vh.items = []; vh.token = ""; vhLoad(false); }
});
