(() => {
  /* ===== 休憩・就寝のお知らせ(YouTube の再生画面) =====
     ・休憩: 動画を続けて見た時間が、決めた時間(30〜120分)を超えたら、一時停止して休憩を勧める
       続けて見た時間は、どのタブで見ても合わせて数える(chrome.storage の tf-watch-run。このパソコンだけの値で、同期しない)。
       10分以上どの動画も再生しなかったら、休憩したとみなして 0 に戻す
     ・就寝: 決めた就寝時間(例 23:00〜06:00。日をまたいでもよい)に動画を再生していたら、一時停止して寝るよう勧める
     ・どちらも「あと15分」で先送りできる
     ・設定(chrome.storage。ドライブ同期の対象): tf-break = 休憩までの分(0 = 使わない)、tf-bed = on/off、tf-bed-from / tf-bed-to = "HH:MM" */
  const RUN = "tf-watch-run", GAP = 10 * 60 * 1000, SNOOZE = 15 * 60 * 1000, TICK = 15000;
  let breakMin = 0, bedOn = false, bedFrom = "23:00", bedTo = "06:00";
  let lastTick = 0, shown = "";

  const video = () => document.querySelector("#movie_player video");
  const playing = () => { const v = video(); return !!v && !v.paused && !v.ended && v.readyState > 2 && !document.querySelector("#movie_player.ad-showing"); };
  const mins = (hm) => { const m = /^(\d{1,2}):(\d{2})$/.exec(hm || ""); return m ? (+m[1] % 24) * 60 + (+m[2] % 60) : null; };
  // いまが就寝時間の中か(23:00〜06:00 のように日をまたぐ指定にも対応)
  function inBed(now = new Date()) {
    const a = mins(bedFrom), b = mins(bedTo); if (a == null || b == null || a === b) return false;
    const t = now.getHours() * 60 + now.getMinutes();
    return a < b ? t >= a && t < b : t >= a || t < b;
  }

  /* ---------- お知らせの画面(プレーヤーの上に重ねる。全画面でも見える) ---------- */
  function ask(kind, title, text, okLabel) {
    if (shown) return; shown = kind;
    const v = video(); try { v?.pause(); } catch {}
    const p = document.getElementById("movie_player") || document.body;
    const box = document.createElement("div"); box.className = "tf-wb"; box.setAttribute("role", "dialog");
    box.innerHTML = `<div class="tf-wb-in"><div class="tf-wb-ic">${kind === "bed" ? "🌙" : "☕"}</div><b></b><p></p><div class="tf-wb-b"><button type="button" class="ok"></button><button type="button" class="more">あと15分見る</button></div></div>`;
    box.querySelector("b").textContent = title; box.querySelector("p").textContent = text; box.querySelector(".ok").textContent = okLabel;
    const close = () => { box.remove(); shown = ""; };
    box.addEventListener("click", (e) => e.stopPropagation());
    box.querySelector(".ok").onclick = async () => { // 休憩する / 寝る: 一時停止のまま
      if (kind === "break") await chrome.storage.local.set({ [RUN]: { ms: 0, at: Date.now() } });
      else await chrome.storage.local.set({ "tf-bed-snooze": Date.now() + SNOOZE }); // 寝ると決めた直後に、また出さない
      close();
    };
    box.querySelector(".more").onclick = async () => { // 先送りして、続きを再生
      if (kind === "break") await chrome.storage.local.set({ [RUN]: { ms: Math.max(0, breakMin * 60000 - SNOOZE), at: Date.now() } });
      else await chrome.storage.local.set({ "tf-bed-snooze": Date.now() + SNOOZE });
      close(); try { video()?.play(); } catch {}
    };
    p.appendChild(box);
  }

  /* ---------- 見ている時間を数えて、時間になったら知らせる ---------- */
  async function tick() {
    const now = Date.now(), dt = lastTick ? Math.min(now - lastTick, TICK * 2) : 0; lastTick = now;
    if (!playing() || document.hidden && !document.pictureInPictureElement) return;
    if (breakMin > 0) {
      const r = (await chrome.storage.local.get(RUN))[RUN] || { ms: 0, at: 0 };
      const ms = (now - (r.at || 0) > GAP ? 0 : r.ms || 0) + dt; // しばらく見ていなかったら、休憩したとみなして数え直す
      await chrome.storage.local.set({ [RUN]: { ms, at: now } });
      if (ms >= breakMin * 60000) return ask("break", `続けて ${Math.round(ms / 60000)}分 見ています`, "少し休憩しませんか? 目を休めて、体を伸ばしましょう。", "休憩する");
    }
    if (bedOn && inBed()) {
      const until = +(await chrome.storage.local.get("tf-bed-snooze"))["tf-bed-snooze"] || 0;
      if (now >= until) return ask("bed", `就寝時間です(${bedFrom}〜${bedTo})`, "そろそろ動画を止めて、寝る準備をしませんか?", "やめて寝る");
    }
  }
  setInterval(tick, TICK);
  document.addEventListener("play", () => { lastTick = Date.now(); setTimeout(tick, 1000); }, true); // 再生を始めた直後にも確かめる(就寝時間中に再生したとき)

  const apply = (r) => {
    if ("tf-break" in r) breakMin = Math.max(0, +r["tf-break"] || 0);
    if ("tf-bed" in r) bedOn = r["tf-bed"] === "on";
    if ("tf-bed-from" in r) bedFrom = r["tf-bed-from"] || "23:00";
    if ("tf-bed-to" in r) bedTo = r["tf-bed-to"] || "06:00";
  };
  const KEYS = ["tf-break", "tf-bed", "tf-bed-from", "tf-bed-to"];
  chrome.storage.local.get(KEYS).then((r) => apply(Object.fromEntries(KEYS.map((k) => [k, r[k]]))));
  chrome.storage.onChanged.addListener((c) => { const r = {}; for (const k of KEYS) if (c[k]) r[k] = c[k].newValue; if (Object.keys(r).length) apply(r); });
})();
