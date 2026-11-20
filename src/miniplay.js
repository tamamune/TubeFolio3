(() => {
  /* ===== 再生画面のワイプ(小さな画面での再生) =====
     再生画面で下へスクロールして動画が画面の外に出たら、動画を四隅の小さな画面に移して再生を続ける。
     上へ戻って元の場所が見えたら、元に戻す。
     ・設定(chrome.storage): tf-mini = 置き場所(br 右下 / bl 左下 / tr 右上 / tl 左上 / off 使わない)、tf-mini-size = 大きさ(s / m / l)
     ・YouTube のプレーヤー(#movie_player)そのものを固定表示にするので、再生は途切れない
     ・✕ で閉じたら、上へ戻る(元の場所が見える)か、別の動画に移るまで出さない
     ・全画面のときと、再生画面以外では使わない */
  const SIZES = { s: 320, m: 400, l: 520 };
  const CORNERS = ["br", "bl", "tr", "tl"];
  let corner = "br", size = "m", on = false, closed = false, holder = null, raf = 0;
  let pos = null; // 手で動かした位置 { rx, ry }(画面の空いている幅・高さに対する割合。画面の大きさが変わっても同じあたりに出る)。null なら四隅
  const TOP = 56; // YouTube の上の帯の高さ(ここより上には置かない)

  const player = () => document.querySelector("ytd-watch-flexy #movie_player");
  const isWatch = () => location.pathname === "/watch";
  const root = document.documentElement;

  // ✕ と「↑ 戻る」のボタン(ワイプの上に重ねる)
  const bar = document.createElement("div");
  bar.id = "tf-mini-bar";
  bar.innerHTML = `<button type="button" data-tfmini="move" class="tf-mini-move" title="ドラッグで好きな場所へ動かす(ダブルクリックで四隅に戻す)">✥ 移動</button><button type="button" data-tfmini="top" title="動画の場所へ戻る">↑ 戻る</button><button type="button" data-tfmini="close" title="ワイプを閉じる(上へ戻るか、別の動画に移ると、また使えます)">✕</button>`;
  bar.addEventListener("click", (e) => {
    const b = e.target.closest("[data-tfmini]"); if (!b || b.dataset.tfmini === "move") return;
    e.stopPropagation();
    if (b.dataset.tfmini === "close") { closed = true; leave(); }
    else scrollTo({ top: 0, behavior: "smooth" });
  });

  // YouTube のプレーヤーに、大きさが変わったことを知らせる(動画と操作バーの幅を合わせ直す)
  const resized = () => { dispatchEvent(new Event("resize")); setTimeout(() => dispatchEvent(new Event("resize")), 250); };

  // 手で動かした位置を、プレーヤーに直接付ける(四隅の CSS より優先)。ワイプでないときは外す
  const PROPS = ["left", "top", "right", "bottom"];
  function setXY(p, x, y) {
    if (x == null) { for (const k of PROPS) p.style.removeProperty(k); return; }
    p.style.setProperty("left", x + "px", "important"); p.style.setProperty("top", y + "px", "important");
    p.style.setProperty("right", "auto", "important"); p.style.setProperty("bottom", "auto", "important");
  }
  const room = () => { const w = SIZES[size] || SIZES.m, h = Math.round(w * 9 / 16); return { w, h, mx: Math.max(0, innerWidth - w), my: Math.max(0, innerHeight - TOP - h) }; };
  function place() {
    const w = SIZES[size] || SIZES.m;
    root.style.setProperty("--tf-mini-w", w + "px");
    for (const c of CORNERS) root.classList.toggle("tf-mini-" + c, on && c === corner);
    const pl = player();
    if (pl) { if (on && pos) { const r = room(); setXY(pl, Math.round(pos.rx * r.mx), Math.round(TOP + pos.ry * r.my)); } else setXY(pl, null); }
    if (!on) return;
    if (!bar.isConnected) document.body.appendChild(bar);
    const r = player()?.getBoundingClientRect(); if (!r) return;
    bar.style.left = r.right - 8 + "px"; bar.style.top = r.top + 8 + "px"; // 右上の内側に置く(左端は CSS で自分の幅だけずらす)
  }
  function enter() {
    const p = player(); if (!p || on) return;
    holder = p.parentElement;
    if (holder) holder.style.minHeight = holder.getBoundingClientRect().height + "px"; // 元の場所の高さを保つ(ページが詰まらないように)
    on = true; root.classList.add("tf-mini"); place(); resized();
  }
  function leave() {
    if (!on) return;
    on = false; root.classList.remove("tf-mini"); place();
    const pl = player(); if (pl) setXY(pl, null);
    if (holder) holder.style.minHeight = ""; holder = null;
    bar.remove(); resized();
  }
  // 元の場所(プレーヤーの入れ物)が、ほとんど画面の外に出たらワイプにする
  function check() {
    raf = 0;
    if (corner === "off" || !isWatch() || document.fullscreenElement) return leave();
    const p = player(); if (!p) return leave();
    const box = (on ? holder : p.parentElement) || p, r = box.getBoundingClientRect();
    if (!r.height) return leave();
    const away = r.bottom < 56 + r.height * 0.25; // 56 = YouTube の上の帯の高さ
    if (!away) { closed = false; return leave(); }
    if (!closed) enter();
  }
  const soon = () => { if (!raf) raf = requestAnimationFrame(check); };

  /* ---------- 「✥ 移動」をドラッグして、好きな場所へ動かす ---------- */
  bar.addEventListener("pointerdown", (e) => {
    const b = e.target.closest("[data-tfmini='move']"); if (!b || !on) return;
    e.preventDefault(); e.stopPropagation();
    const pl = player(); if (!pl) return;
    const r0 = pl.getBoundingClientRect(), sx = e.clientX, sy = e.clientY, rm = room();
    try { b.setPointerCapture(e.pointerId); } catch {}
    root.classList.add("tf-mini-drag");
    let x = r0.left, y = r0.top;
    const move = (ev) => {
      x = Math.min(rm.mx, Math.max(0, r0.left + ev.clientX - sx)); y = Math.min(TOP + rm.my, Math.max(TOP, r0.top + ev.clientY - sy));
      setXY(pl, Math.round(x), Math.round(y));
      bar.style.left = x + rm.w - 8 + "px"; bar.style.top = y + 8 + "px";
    };
    const up = () => {
      b.removeEventListener("pointermove", move); b.removeEventListener("pointerup", up); b.removeEventListener("pointercancel", up);
      root.classList.remove("tf-mini-drag");
      if (Math.abs(x - r0.left) < 2 && Math.abs(y - r0.top) < 2) return; // 動かしていない(押しただけ)
      pos = { rx: rm.mx ? x / rm.mx : 0, ry: rm.my ? (y - TOP) / rm.my : 0 };
      chrome.storage.local.set({ "tf-mini-pos": pos }); // 次のワイプも、この場所に出す
    };
    b.addEventListener("pointermove", move); b.addEventListener("pointerup", up); b.addEventListener("pointercancel", up);
  });
  bar.addEventListener("dblclick", (e) => { if (!e.target.closest("[data-tfmini='move']")) return; e.stopPropagation(); pos = null; chrome.storage.local.remove("tf-mini-pos"); place(); resized(); });

  addEventListener("scroll", soon, { passive: true });
  addEventListener("resize", () => { if (on) place(); else soon(); });
  document.addEventListener("fullscreenchange", soon);
  addEventListener("yt-navigate-finish", () => { closed = false; leave(); setTimeout(soon, 300); });

  const apply = (r) => {
    if (r["tf-mini"] !== undefined) corner = [...CORNERS, "off"].includes(r["tf-mini"]) ? r["tf-mini"] : "br";
    if (r["tf-mini-size"] !== undefined) size = SIZES[r["tf-mini-size"]] ? r["tf-mini-size"] : "m";
    if ("tf-mini-pos" in r) pos = r["tf-mini-pos"] && isFinite(r["tf-mini-pos"].rx) ? r["tf-mini-pos"] : null;
    if (on) { place(); resized(); }
    soon();
  };
  chrome.storage.local.get(["tf-mini", "tf-mini-size", "tf-mini-pos"]).then((r) => apply({ "tf-mini-pos": null, ...r }));
  chrome.storage.onChanged.addListener((c) => {
    const r = {}; for (const k of ["tf-mini", "tf-mini-size", "tf-mini-pos"]) if (c[k]) r[k] = c[k].newValue ?? null;
    if (c["tf-mini"] && c["tf-mini-pos"] === undefined && pos) { r["tf-mini-pos"] = null; chrome.storage.local.remove("tf-mini-pos"); } // 設定で置き場所を選び直したら、手で動かした位置は忘れる
    if (Object.keys(r).length) apply(r);
  });
})();
