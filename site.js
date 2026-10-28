/* GitHub Pages backend: calls the Google Apps Script web app (Code.gs doPost) set in config.js. */
window.SquaresBackend = (function () {
  let emit, last = null;
  const imgData = {}, imgVer = {}, imgLoading = {};
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
  };
  const tok = () => store.get("sq_token"), adm = () => store.get("sq_admin");
  const API = String(window.SQUARES_API || "").trim();
  const apiReady = /^https:\/\/script\.google(usercontent)?\.com\/.+\/exec$/.test(API) || /^http:\/\/localhost:\d+\//.test(API);
  async function run(fn, ...args) {
    if (!apiReady) throw new Error("This board isn't connected to its Google Apps Script yet. Add the web app URL to config.js.");
    let res;
    // text/plain keeps this a "simple" request, which Google's servers accept from any website.
    try { res = await fetch(API, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ fn, args }), redirect: "follow" }); }
    catch (e) { throw new Error("Can't reach the board right now. Check your connection and try again."); }
    const data = await res.json().catch(() => null);
    if (!data) throw new Error("The board's Google Apps Script didn't answer. Check that it's deployed with access set to Anyone.");
    if (data.error) throw new Error(String(data.error).replace(/^(Exception|Error):\s*/, ""));
    return data.result;
  }

  function withImages(st) {
    const urls = {};
    // Only fetch the pictures this page shows (header, logos, plus any the page asks for).
    const want = new Set(["logoTop", "logoSide", "header"].concat(window.SQUARES_WANT_IMAGES || []));
    for (const [slot, ver] of Object.entries(st.cfg.images || {})) {
      if (!want.has(slot)) continue;
      if (imgVer[slot] === ver && imgData[slot]) urls[slot] = imgData[slot];
      else if (imgLoading[slot] !== ver) {
        imgLoading[slot] = ver;
        run("getImage", slot).then((uri) => {
          imgData[slot] = uri; imgVer[slot] = ver;
          if (last) emit(withImages(last));
        }).catch(() => { imgLoading[slot] = null; });
      }
    }
    return { ...st, cfg: { ...st.cfg, imageUrls: urls } };
  }
  async function refresh() {
    try {
      const st = await run("getState", tok(), adm());
      if (!st.admin && adm()) store.del("sq_admin");
      last = st; emit(withImages(st));
    } catch (e) { emit(null, apiReady ? "Can't reach the board. Retrying…" : "Setup needed: this board isn't connected to its Google Apps Script yet. Add the web app URL to config.js."); }
  }
  async function act(fn, ...args) { try { return await run(fn, ...args); } finally { refresh(); } }
  const toBase64 = (blob) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1]);
    r.onerror = () => rej(new Error("Couldn't read that image."));
    r.readAsDataURL(blob);
  });

  return {
    hasLogin: true,
    invites: true,
    inviteLink: (token) => location.origin + location.pathname + "?invite=" + token,
    start(e) {
      emit = e;
      // A personal invitation link carries ?invite=<code>; remember it on this device and tidy the address bar.
      try {
        const u = new URL(location.href), code = u.searchParams.get("invite");
        if (code && /^[a-f0-9]{32}$/.test(code)) {
          store.set("sq_token", code); u.searchParams.delete("invite");
          history.replaceState(null, "", u.pathname + u.search + u.hash);
        }
      } catch (err) {}
      refresh();
      if (!apiReady) return;
      setInterval(() => { if (!document.hidden) refresh(); }, 8000);
      document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
    },
    async claim(p) { try { return await run("claim", tok(), p); } finally { refresh(); } },
    release: (id) => act("release", tok(), id),
    restyle: (s) => act("restyle", tok(), s),
    saveCfg: (c) => act("saveSettings", adm(), c),
    setPaid: (cells, paid) => act("setPaid", adm(), cells, paid),
    adminRelease: (cells) => act("adminRelease", adm(), cells),
    draw: () => act("draw", adm()),
    reset: () => act("reset", adm()),
    saveScores: (scores) => act("saveScores", adm(), scores),
    async uploadImage(slot, blob) { return act("uploadImage", adm(), slot, await toBase64(blob), blob.type); },
    removeImage: (slot) => act("removeImage", adm(), slot),
    createInvite: (b) => act("createInvite", adm(), b),
    updateInvite: (id, b) => act("updateInvite", adm(), id, b),
    sendInvite: (id, subject, body) => act("sendInvite", adm(), id, subject, body),
    adminAssign: (id, cells) => act("adminAssign", adm(), id, cells),
    requestInvite: (p) => run("requestInvite", p),
    dismissRequest: (id) => act("dismissRequest", adm(), id),
    async login(password) { const r = await run("login", password); store.set("sq_admin", r.token); refresh(); },
    adminExtras() {
      const wrap = document.createElement("div");
      const a = document.createElement("button"); a.className = "btn ghost"; a.type = "button"; a.textContent = "Export payment ledger to Google Sheets";
      const out = document.createElement("p"); out.className = "note"; out.hidden = true;
      a.onclick = async () => {
        a.disabled = true; a.textContent = "Creating sheet…";
        try {
          const url = await run("exportLedger", adm());
          const link = document.createElement("a"); link.href = url; link.target = "_blank"; link.rel = "noopener"; link.textContent = "Open the ledger sheet";
          out.replaceChildren("Saved to your Google Drive. ", link); out.hidden = false;
        } catch (e) { out.textContent = e.message; out.hidden = false; }
        a.disabled = false; a.textContent = "Export payment ledger to Google Sheets";
      };
      const b = document.createElement("button"); b.className = "btn ghost"; b.type = "button"; b.textContent = "Log out";
      b.onclick = () => { const t = adm(); store.del("sq_admin"); run("logout", t).catch(() => {}); refresh(); };
      wrap.append(a, out, b);
      return [wrap];
    },
  };
})();

/* Gridiron Squares — extra pages (Odds, Hot Squares, Yearly Winners, Hall of Fame).
   Shares the board's header and data (via window.SquaresBackend) and turns every
   <figure class="slot" data-slot="..."> into a picture the commissioner can upload. */
(function () {
  const B = window.SquaresBackend;
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const money = (n) => "$" + (Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
  const slots = [...document.querySelectorAll("figure.slot[data-slot]")];
  window.SQUARES_WANT_IMAGES = slots.map((f) => f.dataset.slot);
  let st = null;
  const busy = {};

  // ---------- header (same look as the board page) ----------
  function teamEl(name, url) {
    const w = el("span", "tm");
    if (url) { const i = el("img", "logo"); i.src = url; i.alt = name + " logo"; w.append(i); }
    w.append(el("span", null, name));
    return w;
  }
  function placeHero() {
    const hero = $("heroText"), banner = $("banner"), img = $("bannerImg"), band = $("band");
    const L = window.SQUARES_HEADER_LAYOUT || null, usingDefault = !(st && st.cfg.imageUrls && st.cfg.imageUrls.header);
    const between = !!(L && L.text === "between" && usingDefault);
    banner.classList.toggle("layout-between", between);
    band.style.background = between && L.strip ? L.strip : "";
    let wide = !banner.hidden && window.innerWidth >= 760;
    if (between) {
      banner.style.background = "linear-gradient(90deg," + (L.bgLeft || "#000") + " 50%," + (L.bgRight || "#000") + " 50%)";
      const bw = banner.getBoundingClientRect(), iw = img.getBoundingClientRect();
      const x = iw.left - bw.left + iw.width * (L.from || 0.35), w = iw.width * ((L.to || 0.6) - (L.from || 0.35));
      banner.style.setProperty("--hx", Math.round(x) + "px"); banner.style.setProperty("--hw", Math.round(w) + "px");
      wide = !banner.hidden && w >= 230;
    }
    if (wide && hero.parentElement !== banner) banner.append(hero);
    else if (!wide && hero.parentElement === banner) band.querySelector(".wrap").prepend(hero);
    band.classList.toggle("hero-in-banner", hero.parentElement === banner);
  }
  window.addEventListener("resize", placeHero);
  $("bannerImg").addEventListener("load", placeHero);
  function renderHeader() {
    const cf = st.cfg, img = cf.imageUrls || {}, now = Date.now();
    document.body.dataset.scheme = cf.scheme || "turf";
    $("title").textContent = cf.title;
    $("matchup").replaceChildren(teamEl(cf.teamTop, img.logoTop), el("span", "vs", "vs"), teamEl(cf.teamSide, img.logoSide));
    const held = Object.values(st.squares || {}).filter((s) => !(s.expiresAt && s.expiresAt <= now));
    $("sPrice").textContent = money(cf.price);
    $("sLeft").textContent = 100 - held.length;
    $("sPot").textContent = money(held.filter((s) => s.paid).length * cf.price);
    $("statusPill").textContent = cf.locked ? "Numbers drawn" : "Board open";
    $("statusPill").classList.toggle("locked", !!cf.locked);
    const headerUrl = img.header || window.SQUARES_HEADER_IMAGE || "";
    $("band").classList.toggle("has-banner", !!headerUrl);
    $("banner").hidden = !headerUrl;
    if (headerUrl && $("bannerImg").getAttribute("src") !== headerUrl) $("bannerImg").src = headerUrl;
    placeHero();
  }

  // ---------- picture slots ----------
  async function shrink(file, slot) {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("Use a PNG, JPG or WebP image.");
    if (file.size > 20 * 1024 * 1024) throw new Error("That image is over 20 MB. Pick a smaller one.");
    const url = URL.createObjectURL(file);
    try {
      const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("Couldn't read that image.")); i.src = url; });
      const max = /^yw-/.test(slot) ? 900 : 1600, k = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
      const cv = document.createElement("canvas"); cv.width = Math.round(im.naturalWidth * k); cv.height = Math.round(im.naturalHeight * k);
      const ctx = cv.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height); ctx.drawImage(im, 0, 0, cv.width, cv.height);
      return await new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't process that image."))), "image/jpeg", 0.86));
    } finally { URL.revokeObjectURL(url); }
  }
  function renderSlots() {
    const urls = (st && st.cfg.imageUrls) || {}, has = (st && st.cfg.images) || {}, admin = !!(st && st.admin);
    for (const f of slots) {
      const slot = f.dataset.slot, url = urls[slot], stored = !!has[slot];
      let frame = f.querySelector(".slot-frame");
      if (!frame) { frame = el("div", "slot-frame"); f.prepend(frame); }
      const key = [url ? url.length + url.slice(-24) : "", stored, admin, busy[slot] || ""].join("|");
      if (frame.dataset.key === key) continue;
      frame.dataset.key = key;
      frame.replaceChildren();
      f.classList.toggle("filled", !!url);
      if (url) {
        const b = el("button", "slot-img"); b.type = "button"; b.setAttribute("aria-label", "Enlarge " + (f.dataset.label || "picture"));
        const i = el("img"); i.src = url; i.alt = f.dataset.label || ""; b.append(i);
        b.onclick = () => openViewer(url, f.dataset.label || "");
        frame.append(b);
      } else {
        const ph = el("div", "slot-empty");
        ph.append(el("span", "slot-icon", "▣"), el("span", null, busy[slot] || (stored ? "Loading picture…" : admin ? "No picture yet" : "Picture coming soon")));
        frame.append(ph);
      }
      if (admin) {
        const acts = el("div", "slot-acts");
        const up = el("label", "tog file-btn", url || stored ? "Replace picture" : "Upload picture");
        const inp = el("input"); inp.type = "file"; inp.accept = "image/png,image/jpeg,image/webp"; inp.setAttribute("aria-label", "Upload picture for " + (f.dataset.label || slot));
        inp.onchange = async () => {
          const file = inp.files[0]; if (!file) return;
          busy[slot] = "Uploading…"; renderSlots();
          try { await B.uploadImage(slot, await shrink(file, slot)); busy[slot] = ""; }
          catch (e) { busy[slot] = e.message; setTimeout(() => { busy[slot] = ""; renderSlots(); }, 4000); }
          renderSlots();
        };
        up.append(inp); acts.append(up);
        if (url || stored) {
          const rm = el("button", "tog", "Remove"); rm.type = "button";
          rm.onclick = async () => {
            if (!rm.dataset.armed) { rm.dataset.armed = "1"; rm.textContent = "Tap again to remove"; return; }
            busy[slot] = "Removing…"; renderSlots();
            try { await B.removeImage(slot); } catch (e) {}
            busy[slot] = ""; renderSlots();
          };
          acts.append(rm);
        }
        frame.append(acts);
      }
    }
    $("adminHint").hidden = admin;
    $("adminOn").hidden = !admin;
  }

  // ---------- picture viewer ----------
  function openViewer(src, label) {
    const v = $("viewer"); $("viewerImg").src = src; $("viewerImg").alt = label; $("viewerCap").textContent = label;
    v.hidden = false; document.body.style.overflow = "hidden"; $("viewerClose").focus();
  }
  function closeViewer() { $("viewer").hidden = true; document.body.style.overflow = ""; }
  $("viewerClose").onclick = closeViewer;
  $("viewer").addEventListener("click", (e) => { if (e.target === $("viewer")) closeViewer(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("viewer").hidden) closeViewer(); });

  renderSlots();
  B.start((s, problem) => {
    $("offline").hidden = !problem; if (problem) $("offlineTxt").textContent = problem;
    if (!s) return;
    st = s; renderHeader(); renderSlots();
  });
})();
