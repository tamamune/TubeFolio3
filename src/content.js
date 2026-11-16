(() => {
  const KEY = "tubefolio";
  const load = async () => (await chrome.storage.local.get(KEY))[KEY] || { folders: [], videos: {}, bookmarks: [] };
  const save = (d) => chrome.storage.local.set({ [KEY]: d });
  const idFrom = (href) => { try { return new URL(href, location.origin).searchParams.get("v"); } catch { return null; } };

  async function openPopover(anchor, videoId, meta) {
    document.querySelector(".tf-pop")?.remove();
    const data = await load();
    const pop = document.createElement("div");
    pop.className = "tf-pop";
    const r = anchor.getBoundingClientRect();
    pop.style.top = Math.min(r.bottom + 6, innerHeight - 260) + "px";
    pop.style.left = Math.min(r.left, innerWidth - 230) + "px";
    const cur = new Set(data.videos[videoId]?.folders || []);
    data.folders.forEach((f) => {
      const l = document.createElement("label");
      l.innerHTML = `<input type="checkbox"><span class="tf-dot" style="background:${f.color}"></span>`;
      l.append(f.name);
      const cb = l.querySelector("input");
      cb.checked = cur.has(f.id);
      cb.onchange = async () => {
        const d = await load();
        const v = d.videos[videoId] ||= { ...meta, folders: [], tags: [], savedAt: new Date().toISOString() };
        v.folders = cb.checked ? [...new Set([...v.folders, f.id])] : v.folders.filter((x) => x !== f.id);
        if (!v.folders.length) delete d.videos[videoId];
        await save(d);
        refresh();
      };
      pop.append(l);
    });
    document.body.append(pop);
    setTimeout(() => addEventListener("click", function h(e) {
      if (!pop.contains(e.target)) { pop.remove(); removeEventListener("click", h); }
    }), 0);
  }

  function makeBtn(cls, text, videoId, meta) {
    const b = document.createElement("button");
    b.className = cls; b.dataset.tfId = videoId; b.textContent = text;
    b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); openPopover(b, videoId, meta); };
    return b;
  }

  async function inject() {
    const data = await load();
    // 再生画面: アクションバー
    const id = location.pathname === "/watch" ? new URLSearchParams(location.search).get("v") : null;
    const bar = document.querySelector("#top-level-buttons-computed, ytd-menu-renderer #top-level-buttons-computed");
    if (id && bar && !bar.querySelector(".tf-btn")) {
      const title = document.querySelector("h1 yt-formatted-string")?.textContent || "";
      bar.append(makeBtn("tf-btn", "📁 保存", id, { title, channel: "" }));
    }
    // 一覧: サムネイル左上
    document.querySelectorAll("a#thumbnail[href*='/watch'], a.yt-lockup-view-model-wiz__content-image[href*='/watch'], a.yt-lockup-view-model__content-image[href*='/watch']").forEach((a) => {
      const vid = idFrom(a.getAttribute("href"));
      if (!vid || a.querySelector(".tf-thumb-btn")) return;
      a.classList.add("tf-host"); a.style.position = "relative";
      a.append(makeBtn("tf-thumb-btn", "📁", vid, { title: a.getAttribute("title") || "", channel: "" }));
    });
    // ヘッダー: 管理ページを開くボタン
    const end = document.querySelector("ytd-masthead #end");
    if (end && !document.querySelector(".tf-head-btn")) {
      const b = document.createElement("button");
      b.className = "tf-btn tf-head-btn";
      const ico = document.createElement("img");
      ico.src = chrome.runtime.getURL("icons/icon-32.png"); ico.width = 20; ico.height = 20;
      b.append(ico, "TubeFolio3");
      b.onclick = () => chrome.runtime.sendMessage("tf-open-manager");
      end.prepend(b);
    }
    mark(data);
  }

  function mark(data) {
    document.querySelectorAll("[data-tf-id]").forEach((b) => {
      const saved = !!data.videos[b.dataset.tfId];
      b.classList.toggle("saved", saved);
      if (b.classList.contains("tf-btn")) b.textContent = saved ? "📁 保存済み" : "📁 保存";
    });
  }
  const refresh = async () => mark(await load());

  let t;
  new MutationObserver(() => { clearTimeout(t); t = setTimeout(inject, 300); }).observe(document.body, { childList: true, subtree: true });
  addEventListener("yt-navigate-finish", inject);
  inject();
})();
