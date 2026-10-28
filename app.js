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

window.SQUARES_THEMES=[{"key": "turf", "label": "Gridiron", "sw": ["#18231b", "#f5c451", "#1f5a37"]}, {"key": "black", "label": "Black", "sw": ["#000000", "#ffffff", "#5c5c5c"]}, {"key": "blue", "label": "Blue", "sw": ["#0b2a6b", "#ffffff", "#1a56db"]}, {"key": "white", "label": "White", "sw": ["#ffffff", "#111111", "#dcdcdc"]}, {"key": "blackblue", "label": "Black & Blue", "sw": ["#000000", "#4d8dff", "#ffffff"]}, {"key": "bluewhite", "label": "Blue & White", "sw": ["#0b2a6b", "#ffffff", "#1a56db"]}, {"key": "crimson", "label": "Crimson", "sw": ["#6b0f1a", "#ffffff", "#b3141f"]}, {"key": "purple", "label": "Purple & Gold", "sw": ["#2e1065", "#ffd166", "#6d28d9"]}];
/* Gridiron Squares — board UI. Talks to window.SquaresBackend (the claude.ai
   artifact store in the prototype, the Node server in the deployable site). */
(function () {
  const B = window.SquaresBackend;
  const QUARTERS = [["q1", "Q1", "Q1"], ["q2", "Halftime", "HT"], ["q3", "Q3", "Q3"], ["final", "Final score", "F"]];
  const SCORE_LABELS = { q1: "End of Q1", q2: "Halftime", q3: "End of Q3", final: "Final (incl. OT)" };
  const FONTS = [["clean", "Clean"], ["readable", "Readable"], ["stadium", "Stadium"], ["handwritten", "Handwritten"], ["cursive", "Cursive"], ["varsity", "Varsity"], ["marker", "Marker"], ["slab", "Slab"], ["mono", "Mono"]];
  const THEMES = window.SQUARES_THEMES || [];
  const isPhone = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const COLORS = ["ink", "red", "orange", "gold", "green", "teal", "blue", "purple", "pink"];
  const IMG_SLOTS = [["logoTop", "Logo, team across top"], ["logoSide", "Logo, team down side"], ["header", "Header photo"]];

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  };
  const money = (n) => "$" + (Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
  const cellId = (r, c) => "r" + r + "c" + c;
  const rc = (id) => id.slice(1).split("c").map(Number);
  const pos = (id) => { const [r, c] = rc(id); return "Row " + (r + 1) + " · Col " + (c + 1); };
  const short = (id) => { const [r, c] = rc(id); return "R" + (r + 1) + "C" + (c + 1); };

  const savedStyle = (() => { try { return JSON.parse(store.get("sq_style") || "{}"); } catch (e) { return {}; } })();
  const S = {
    st: null, selected: new Set(), busy: false, drawArm: false, armedRelease: null,
    period: store.get("sq_period") || "all",
    zoom: store.get("sq_zoom") || "fit",
    big: false, cfgDirty: false, scoresDirty: false, previewScheme: null,
    style: { font: FONTS.some((f) => f[0] === savedStyle.font) ? savedStyle.font : "clean", color: COLORS.includes(savedStyle.color) ? savedStyle.color : "ink" },
  };

  // ---------- derived ----------
  function live() { // squares still held (expired unpaid holds drop off)
    const out = {}, now = Date.now();
    if (!S.st) return out;
    for (const [id, sq] of Object.entries(S.st.squares)) if (!(sq.expiresAt && sq.expiresAt <= now)) out[id] = sq;
    return out;
  }
  function winners() {
    const cf = S.st.cfg, out = {};
    if (!cf.nums) return out;
    for (const [q] of QUARTERS) {
      const s = cf.scores && cf.scores[q], n = cf.nums[q];
      if (!s || !n || s.top == null || s.side == null) continue;
      const c = n.col.indexOf(Number(s.top) % 10), r = n.row.indexOf(Number(s.side) % 10);
      if (c >= 0 && r >= 0) out[q] = cellId(r, c);
    }
    return out;
  }
  const minsLeft = (sq) => Math.max(1, Math.ceil((sq.expiresAt - Date.now()) / 60000));

  // ---------- header ----------
  function teamEl(name, url, cls) {
    const w = el("span", cls || "tm");
    if (url) { const i = el("img", "logo"); i.src = url; i.alt = name + " logo"; w.append(i); }
    w.append(el("span", null, name));
    return w;
  }
  function renderHeader() {
    const cf = S.st.cfg, img = cf.imageUrls || {}, sq = live(), all = Object.values(sq);
    document.title = cf.title;
    document.body.dataset.scheme = S.previewScheme || cf.scheme || "turf";
    $("title").textContent = cf.title;
    $("matchup").replaceChildren(teamEl(cf.teamTop, img.logoTop), el("span", "vs", "vs"), teamEl(cf.teamSide, img.logoSide));
    const band = $("band"), headerUrl = img.header || window.SQUARES_HEADER_IMAGE || "";
    band.classList.remove("photo");
    band.classList.toggle("has-banner", !!headerUrl);
    $("banner").hidden = !headerUrl;
    if (headerUrl && $("bannerImg").getAttribute("src") !== headerUrl) $("bannerImg").src = headerUrl;
    placeHero();
    $("sPrice").textContent = money(cf.price);
    $("sLeft").textContent = 100 - all.length;
    $("sPot").textContent = money(all.filter((s) => s.paid).length * cf.price);
    $("statusPill").textContent = cf.locked ? "Numbers drawn" : "Board open";
    $("statusPill").classList.toggle("locked", !!cf.locked);
    $("bigTitle").replaceChildren(cf.title + " · ", teamEl(cf.teamTop, null, "tm"), " vs ", teamEl(cf.teamSide, null, "tm"));
  }

  // ---------- period tabs ----------
  function renderTabs() {
    for (const host of [$("periodTabs"), $("bigTabs")]) {
      host.replaceChildren();
      for (const [k, lab] of [["all", "All"]].concat(QUARTERS.map((q) => [q[0], q[2] === "F" ? "Final" : q[2]]))) {
        const b = el("button", null, lab); b.type = "button"; b.dataset.p = k;
        b.setAttribute("aria-pressed", String(S.period === k));
        b.title = k === "all" ? "Show all four number sets" : "Show numbers for " + (QUARTERS.find((q) => q[0] === k) || [])[1];
        host.append(b);
      }
    }
  }
  function onTab(e) {
    const b = e.target.closest("button[data-p]"); if (!b) return;
    S.period = b.dataset.p; store.set("sq_period", S.period); renderTabs(); renderBoard();
  }
  $("periodTabs").addEventListener("click", onTab);
  $("bigTabs").addEventListener("click", onTab);

  // ---------- board ----------
  function headerCell(nums, axis, i) {
    if (!nums) { const h = el("div", "hd dim", "?"); return h; }
    if (S.period === "all") {
      const h = el("div", "hd quad");
      for (const [q] of QUARTERS) h.append(el("span", null, nums[q][axis][i]));
      h.setAttribute("aria-label", QUARTERS.map((q) => q[2] + " " + nums[q[0]][axis][i]).join(", "));
      return h;
    }
    return el("div", "hd", nums[S.period][axis][i]);
  }
  function renderBoard() {
    if (!S.st) return;
    const cf = S.st.cfg, img = cf.imageUrls || {}, sqs = live(), win = winners(), winBy = {}, me = S.st;
    for (const q in win) (winBy[win[q]] = winBy[win[q]] || []).push(QUARTERS.find((x) => x[0] === q)[2]);
    const focused = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.id : null;

    const field = $("field");
    const top = el("div", "team-top");
    if (img.logoTop) { const i = el("img", "logo"); i.src = img.logoTop; i.alt = ""; top.append(i); }
    top.append(el("span", null, cf.teamTop + " →"));
    top.append(el("span", "both-down", "· " + cf.teamSide + " ↓"));
    const side = el("div", "team-side");
    if (img.logoSide) { const i = el("img", "logo"); i.src = img.logoSide; i.alt = ""; side.append(i); }
    side.append(el("span", "vt", cf.teamSide + " →"));

    const b = el("div", "board"); b.setAttribute("role", "grid"); b.setAttribute("aria-label", "Squares board");
    const corner = el("div", "hd corner hdrow");
    if (cf.nums && S.period === "all" && !isCompact()) { corner.classList.add("quad"); for (const q of QUARTERS) corner.append(el("span", null, q[2])); }
    else if (cf.nums && S.period === "all") corner.textContent = "#";
    else corner.textContent = cf.nums ? QUARTERS.find((q) => q[0] === S.period)[2] : "#";
    b.append(corner);
    for (let c = 0; c < 10; c++) { const h = headerCell(cf.nums, "col", c); h.classList.add("hdrow"); b.append(h); }
    for (let r = 0; r < 10; r++) {
      b.append(headerCell(cf.nums, "row", r));
      for (let c = 0; c < 10; c++) {
        const id = cellId(r, c), sq = sqs[id], btn = el("button", "cell");
        btn.type = "button"; btn.dataset.id = id;
        if (sq) {
          btn.classList.add("taken", sq.paid ? "paid" : "unpaid"); if (sq.mine) btn.classList.add("mine");
          const n = el("span", "nm ff-" + (sq.font || "clean")), np = nameParts(sq.name);
          n.append(el("span", "n-full", sq.name), el("span", "n-short", np.short), el("span", "n-init", np.init));
          if (sq.color && sq.color !== "ink") n.style.setProperty("--pc", "var(--pc-" + sq.color + ")");
          const label = sq.paid ? "PAID" : (sq.mine && sq.expiresAt ? minsLeft(sq) + "m left" : "UNPAID");
          btn.append(n, el("span", "pd", label));
          btn.setAttribute("aria-label", pos(id) + ", " + sq.name + ", " + (sq.paid ? "paid" : "unpaid"));
          btn.title = sq.name + (sq.paid ? " · paid" : " · unpaid");
        } else if (S.selected.has(id)) {
          btn.classList.add("selected"); btn.setAttribute("aria-label", pos(id) + ", selected");
        } else {
          btn.classList.add("open"); btn.append(el("span", "plus", "+"));
          btn.setAttribute("aria-label", pos(id) + ", open");
          if (cf.locked) btn.disabled = true;
        }
        if (winBy[id]) { btn.classList.add("win"); btn.append(el("span", "q", winBy[id].join(" "))); }
        b.append(btn);
      }
    }
    field.replaceChildren(top, side, b);
    applyZoom();
    if (focused) { const f = field.querySelector('[data-id="' + focused + '"]'); if (f) f.focus({ preventScroll: true }); }
    $("boardNote").textContent = cf.nums
      ? "Each period has its own random numbers. Use the tabs to see one set at a time. The square matching the last digit of each team's score wins that period; the last payout uses the final score, overtime included."
      : "Four sets of random numbers (Q1, halftime, Q3, final score) are drawn when the commissioner locks the board.";
    $("boardNote").textContent += " Tap a taken square to see whose it is.";
  }

  // ---------- zoom / big board ----------
  // Phones drop the sideways team label and narrow the number column so the squares can be as big as possible.
  const isCompact = () => window.innerWidth < 600 && !S.big;
  function fitCell(w, h) {
    const compact = isCompact(), rowHead = compact ? 0.6 : 0.8;
    const side = compact ? 0 : Math.max(30, Math.min(70, w * 0.04)) + 6;
    let c = (w - side - 26) / (10 + rowHead);
    if (h) c = Math.min(c, (h - 70) / (10 + rowHead + 0.7));
    return Math.floor(c);
  }
  function applyZoom() {
    let cell;
    const field = $("field");
    field.classList.toggle("compact", isCompact());
    field.classList.toggle("short", S.big && window.innerHeight < 560);
    if (S.big) {
      const body = $("bigBody"), short = window.innerHeight < 560, rowHead = 0.8;
      const side = Math.max(30, Math.min(70, body.clientWidth * 0.04)) + 6;
      const byW = (body.clientWidth - side - 26) / (10 + rowHead);
      const byH = (body.clientHeight - (short ? 8 : 60) - 26) / (10 + rowHead);
      // Short screens (phones sideways) can't fit the whole board, so keep squares tappable and let it scroll.
      cell = Math.floor(short ? Math.max(20, Math.min(46, byW)) : Math.max(20, Math.min(160, byW, byH)));
    }
    else if (S.zoom === "fit") cell = Math.max(24, Math.min(76, fitCell($("scroller").clientWidth)));
    else cell = Number(S.zoom);
    field.style.setProperty("--cell", cell + "px");
    const brd = field.querySelector(".board");
    if (brd) {
      brd.classList.toggle("small", cell < 40);
      brd.classList.toggle("lvl-i", cell < 44);
      brd.classList.toggle("lvl-s", cell >= 44 && cell < 100);
    }
    $("zoomFit").setAttribute("aria-pressed", String(S.zoom === "fit"));
    S.curCell = cell;
  }
  function setZoom(delta) {
    const cur = S.curCell || 48;
    S.zoom = String(Math.max(24, Math.min(140, Math.round(cur * (delta > 0 ? 1.25 : 1 / 1.25)))));
    store.set("sq_zoom", S.zoom); applyZoom();
  }
  $("zoomIn").onclick = () => setZoom(1);
  $("zoomOut").onclick = () => setZoom(-1);
  $("zoomFit").onclick = () => { S.zoom = "fit"; store.set("sq_zoom", "fit"); applyZoom(); };
  function openBig() {
    S.big = true; $("bigView").hidden = false; $("bigBody").append($("field")); document.body.style.overflow = "hidden";
    const v = $("bigView"); if (v.requestFullscreen) v.requestFullscreen().catch(() => {});
    requestAnimationFrame(applyZoom); $("bigClose").focus();
  }
  function closeBig() {
    S.big = false; $("bigView").hidden = true; $("scroller").append($("field")); document.body.style.overflow = "";
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    applyZoom(); $("bigBtn").focus();
  }
  $("bigBtn").onclick = openBig;
  $("bigClose").onclick = closeBig;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && S.big) closeBig(); });
  document.addEventListener("fullscreenchange", () => requestAnimationFrame(applyZoom));
  let rz; window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(applyZoom, 80); });

  $("field").addEventListener("click", (e) => {
    const c = e.target.closest(".cell"); if (!c || c.disabled || !S.st) return;
    const id = c.dataset.id, sq = live()[id];
    if (sq) { openSheet(id); return; }
    closeSheet();
    if (S.st.cfg.locked) return;
    if (inviteMode() && !S.st.me && !S.st.admin) { showMsg("claimMsg", "You need your invitation link to pick squares.", "err"); return; }
    if (!S.selected.has(id) && inviteMode() && S.st.me && !S.st.admin) {
      const max = maxOf(S.st.cfg), held = Object.values(live()).filter((s) => s.mine).length;
      if (max && held + S.selected.size >= max) {
        showMsg("claimMsg", held >= max ? "You already have the maximum of " + max + " squares." : "The limit is " + max + " squares per player. You can pick " + (max - held) + ".", "err");
        $("claimMsg").scrollIntoView({ behavior: "smooth", block: "nearest" });
        return;
      }
    }
    S.selected.has(id) ? S.selected.delete(id) : S.selected.add(id);
    hide("claimMsg"); renderBoard(); renderClaim();
  });

  // ---------- names that fit small squares ----------
  function nameParts(name) {
    const w = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!w.length) return { short: "", init: "" };
    if (w.length === 1) return { short: w[0], init: w[0].slice(0, 3) };
    return { short: w[0] + " " + w[w.length - 1][0] + ".", init: (w[0][0] + w[w.length - 1][0]).toUpperCase() };
  }

  // ---------- square details sheet (tap a taken square) ----------
  let sheetId = null;
  function openSheet(id) { sheetId = id; renderSheet(); }
  function closeSheet() { sheetId = null; $("cellSheet").hidden = true; renderBar(); }
  function renderSheet() {
    const sh = $("cellSheet");
    if (!sheetId || !S.st) { sh.hidden = true; return; }
    const sq = live()[sheetId];
    if (!sq) { closeSheet(); return; }
    const cf = S.st.cfg, [r, c] = rc(sheetId);
    const nm = $("sheetName"); nm.className = "sheet-name ff-" + (sq.font || "clean"); nm.textContent = sq.name;
    nm.style.setProperty("--pc", sq.color && sq.color !== "ink" ? "var(--pc-" + sq.color + ")" : "var(--ink)");
    let where = pos(sheetId);
    if (cf.nums) {
      if (S.period === "all") where += " · " + cf.teamTop + "/" + cf.teamSide + ": " + QUARTERS.map((q) => q[2] + " " + cf.nums[q[0]].col[c] + "-" + cf.nums[q[0]].row[r]).join(", ");
      else { const p = S.period, lab = QUARTERS.find((q) => q[0] === p)[2]; where += " · " + lab + ": " + cf.teamTop + " " + cf.nums[p].col[c] + ", " + cf.teamSide + " " + cf.nums[p].row[r]; }
    }
    $("sheetWhere").textContent = where;
    const st = $("sheetStatus");
    st.textContent = sq.paid ? "Paid" : sq.expiresAt ? "Unpaid · releases in " + minsLeft(sq) + " min" : "Unpaid";
    st.className = "sheet-status " + (sq.paid ? "ok" : "warn");
    const acts = $("sheetActs"); acts.replaceChildren();
    if (S.st.admin) {
      const p = el("button", "btn", sq.paid ? "Mark unpaid" : "Mark paid"); p.type = "button";
      p.onclick = () => adminDo(() => B.setPaid([sheetId], !sq.paid), sq.paid ? "Marked unpaid." : "Marked paid.").then(renderSheet);
      acts.append(p);
      if (!sq.paid) {
        const rl = el("button", "btn ghost", "Release square"); rl.type = "button";
        rl.onclick = () => { if (rl.dataset.armed) { adminDo(() => B.adminRelease([sheetId]), "Square released."); closeSheet(); } else { rl.dataset.armed = "1"; rl.textContent = "Tap again to release"; rl.classList.add("warn"); } };
        acts.append(rl);
      }
    } else if (sq.mine && !sq.paid && !cf.locked) {
      const g = el("button", "btn ghost", "Give this square back"); g.type = "button";
      g.onclick = async () => { try { await B.release(sheetId); closeSheet(); } catch (e) { showMsg("claimMsg", e.message, "err"); } };
      acts.append(g);
    }
    sh.hidden = false; renderBar();
  }
  $("sheetClose").onclick = closeSheet;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && sheetId) closeSheet(); });

  // ---------- sticky claim bar (phones and everywhere once squares are selected) ----------
  function renderBar() {
    const bar = $("claimBar");
    const n = S.selected.size, cf = S.st && S.st.cfg;
    const show = !!(cf && n && !cf.locked && !sheetId);
    bar.hidden = !show; document.body.classList.toggle("has-bar", show || !!sheetId);
    if (!show) return;
    $("barCount").textContent = n + " square" + (n > 1 ? "s" : "");
    $("barTotal").textContent = money(n * cf.price);
    const go = $("barGo"), main = $("claimBtn");
    const adminOnly = S.st.admin && inviteMode() && !S.st.me;
    go.textContent = adminOnly ? "Assign…" : S.busy ? "Claiming…" : main.disabled ? main.textContent : "Claim";
    go.disabled = !adminOnly && (main.disabled || S.busy);
  }
  $("barGo").onclick = () => {
    if (S.st.admin && inviteMode() && !S.st.me) { $("assignBox").scrollIntoView({ behavior: "smooth", block: "center" }); return; }
    $("claimBtn").click();
  };
  $("barClear").onclick = () => { S.selected.clear(); hide("claimMsg"); renderBoard(); renderClaim(); };

  // ---------- style picker ----------
  function buildPicker() {
    const fp = $("fontPick");
    for (const [k, lab] of FONTS) { const b = el("button", "ff-" + k, lab); b.type = "button"; b.dataset.f = k; fp.append(b); }
    const cp = $("colorPick");
    for (const k of COLORS) { const b = el("button"); b.type = "button"; b.dataset.c = k; b.style.setProperty("--pc", "var(--pc-" + k + ")"); b.setAttribute("aria-label", k === "ink" ? "Default" : k[0].toUpperCase() + k.slice(1)); cp.append(b); }
    fp.onclick = (e) => { const b = e.target.closest("button"); if (!b) return; S.style.font = b.dataset.f; saveStyle(); };
    cp.onclick = (e) => { const b = e.target.closest("button"); if (!b) return; S.style.color = b.dataset.c; saveStyle(); };
  }
  function buildThemes() {
    const tp = $("themePick");
    for (const t of THEMES) {
      const b = el("button"); b.type = "button"; b.dataset.k = t.key;
      const sw = el("span", "sw"); for (const c of t.sw) { const i = el("i"); i.style.background = c; sw.append(i); }
      b.append(sw, el("span", null, t.label)); tp.append(b);
    }
    tp.onclick = (e) => {
      const b = e.target.closest("button"); if (!b) return;
      S.previewScheme = b.dataset.k; S.cfgDirty = true;
      document.body.dataset.scheme = b.dataset.k; renderAdmin();
      showMsg("adminMsg", "Previewing " + b.textContent + ". Save settings to apply it for everyone.");
    };
  }
  const inviteMode = () => !!(S.st && S.st.inviteOnly);
  let styleTimer = null;
  function saveStyle() {
    store.set("sq_style", JSON.stringify(S.style)); renderPicker();
    const me = S.st && S.st.me;
    if (!inviteMode() || !me || me.revoked) return;
    S.styleDirty = true; clearTimeout(styleTimer);
    styleTimer = setTimeout(async () => {
      try { await B.restyle(S.style); showMsg("claimMsg", "Font and color saved.", "ok"); }
      catch (e) { showMsg("claimMsg", e.message, "err"); }
      S.styleDirty = false;
    }, 500);
  }
  function renderPicker() {
    for (const b of $("fontPick").children) b.setAttribute("aria-pressed", String(b.dataset.f === S.style.font));
    for (const b of $("colorPick").children) b.setAttribute("aria-pressed", String(b.dataset.c === S.style.color));
    const pv = $("stylePv"); pv.className = "pv ff-" + S.style.font;
    pv.style.setProperty("--pc", "var(--pc-" + S.style.color + ")");
    pv.textContent = inviteMode() ? ((S.st.me && S.st.me.name) || "You") : ($("myName").value.trim() || "You");
    const mine = Object.values(live()).filter((s) => s.mine);
    $("applyStyle").hidden = inviteMode() || !mine.length || mine.every((s) => (s.font || "clean") === S.style.font && (s.color || "ink") === S.style.color);
  }
  $("applyStyle").onclick = async () => {
    try { await B.restyle(S.style); showMsg("claimMsg", "Style updated on your squares.", "ok"); }
    catch (e) { showMsg("claimMsg", e.message, "err"); }
  };

  // ---------- claim ----------
  $("myName").value = store.get("sq_name") || "";
  $("myName").addEventListener("input", () => { store.set("sq_name", $("myName").value.trim()); renderClaim(); renderPicker(); });

  function renderClaim() {
    if (!S.st) return;
    queueMicrotask(renderBar);
    const cf = S.st.cfg, n = S.selected.size, btn = $("claimBtn"), inv = inviteMode(), me = S.st.me;
    const name = inv ? (me && me.name) || "" : $("myName").value.trim();
    $("selCount").textContent = n + " selected"; $("selTotal").textContent = money(n * cf.price);
    $("holdNote").textContent = "Unpaid squares go back on the board " + cf.holdMinutes + " minutes after they're picked, unless the commissioner has marked them paid.";
    $("inviteGate").hidden = !inv || !!me;
    $("whoBox").hidden = !inv || !me; if (me) $("whoName").textContent = me.name + (me.revoked ? " (invitation turned off)" : "");
    $("nameBox").hidden = inv;
    $("styleBox").hidden = inv && !me;
    $("styleNote").hidden = !inv;
    if (cf.locked) { btn.disabled = true; btn.textContent = "Board is locked"; return; }
    if (inv && !me) { btn.disabled = true; btn.textContent = "Invitation required"; return; }
    if (inv && me.revoked) { btn.disabled = true; btn.textContent = "Your invitation is turned off"; return; }
    if (!S.st.canClaim) { btn.disabled = true; btn.textContent = S.st.claimNote || "Claiming is unavailable"; return; }
    if (!n) { btn.disabled = true; btn.textContent = "Select squares on the board"; return; }
    if (!name) { btn.disabled = true; btn.textContent = "Add your name to claim"; return; }
    btn.disabled = S.busy;
    btn.textContent = S.busy ? "Claiming…" : "Claim " + n + " square" + (n > 1 ? "s" : "") + " · " + money(n * cf.price);
  }
  $("claimBtn").addEventListener("click", async () => {
    const name = inviteMode() ? "" : $("myName").value.trim();
    if ((!inviteMode() && !name) || S.busy || !S.selected.size) return;
    S.busy = true; renderClaim();
    try {
      const r = await B.claim(inviteMode() ? { cells: [...S.selected] } : { name, cells: [...S.selected], font: S.style.font, color: S.style.color });
      S.selected.clear();
      const hold = S.st.cfg.holdMinutes;
      if (r.won.length && !r.lost.length) showMsg("claimMsg", "You claimed " + r.won.length + " square" + (r.won.length > 1 ? "s" : "") + ". Pay within " + hold + " minutes to keep them.", "ok");
      else if (r.won.length) showMsg("claimMsg", "Claimed " + r.won.length + ". " + r.lost.length + " were taken by someone else first. Pay within " + hold + " minutes to keep yours.", "err");
      else showMsg("claimMsg", "Those squares were taken by someone else first. Pick open ones and try again.", "err");
    } catch (e) { showMsg("claimMsg", e.message, "err"); }
    S.busy = false; renderAll();
    if (window.innerWidth < 960 && !$("myPanel").hidden) $("myPanel").scrollIntoView({ behavior: "smooth", block: "start" });
    else if (window.innerWidth < 960 && !$("claimMsg").hidden) $("claimMsg").scrollIntoView({ behavior: "smooth", block: "center" });
  });

  // ---------- your squares / pay ----------
  function payLinks(amount, note) {
    const cf = S.st.cfg, v = (cf.venmo || "").replace(/^@/, ""), p = cf.paypal || "";
    const q = "txn=pay&amount=" + amount.toFixed(2) + "&note=" + encodeURIComponent(note);
    return {
      venmo: v ? "https://venmo.com/" + encodeURIComponent(v) + "?" + q : null,
      venmoApp: v ? "venmo://paycharge?" + q + "&recipients=" + encodeURIComponent(v) : null,
      paypal: p ? "https://paypal.me/" + encodeURIComponent(p) + "/" + amount.toFixed(2) + "USD" : null,
      v, p,
    };
  }
  function renderMine() {
    const mineIds = Object.entries(live()).filter(([, s]) => s.mine).map(([id]) => id).sort();
    $("myPanel").hidden = !mineIds.length; if (!mineIds.length) return;
    const sqs = live(), cf = S.st.cfg, chips = $("myChips"); chips.replaceChildren();
    for (const id of mineIds) {
      const sq = sqs[id], ch = el("span", "chip" + (sq.paid ? " paid" : ""), pos(id));
      if (sq.paid) ch.append(" · paid");
      else if (sq.expiresAt) ch.append(el("span", "t", minsLeft(sq) + " min left"));
      if (!sq.paid && !cf.locked) {
        const x = el("button", null, "×"); x.type = "button"; x.title = "Give this square back"; x.setAttribute("aria-label", "Give back " + pos(id));
        x.onclick = async () => { try { await B.release(id); } catch (e) { showMsg("claimMsg", e.message, "err"); } };
        ch.append(x);
      }
      chips.append(ch);
    }
    const unpaid = mineIds.filter((id) => !sqs[id].paid), owed = unpaid.length * cf.price;
    $("owed").textContent = money(owed);
    const note = cf.title + " squares: " + unpaid.map(short).join(", ");
    const L = payLinks(owed, note);
    const vb = $("venmoBtn"), pb = $("paypalBtn");
    vb.hidden = !L.venmo || !unpaid.length; pb.hidden = !L.paypal || !unpaid.length;
    if (L.venmo) { vb.href = isPhone ? L.venmoApp : L.venmo; vb.textContent = "Pay " + money(owed) + " · Venmo"; $("venmoWebLink").href = L.venmo; }
    $("venmoWeb").hidden = !(isPhone && L.venmo && unpaid.length);
    if (L.paypal) { pb.href = L.paypal; pb.textContent = "Pay " + money(owed) + " · PayPal"; }
    $("payBtns").classList.toggle("one", !(L.venmo && L.paypal));
    $("venmoRow").hidden = !L.v; $("venmoTxt").textContent = L.v ? "@" + L.v : "";
    $("paypalRow").hidden = !L.p; $("paypalTxt").textContent = L.p ? "paypal.me/" + L.p : "";
    $("payNote").textContent = !unpaid.length ? "All paid. Good luck!"
      : !L.v && !L.p ? "The commissioner hasn't added a Venmo or PayPal account yet. Check back soon."
      : "Venmo fills in your square numbers for you. With PayPal, add \"" + unpaid.map(short).join(", ") + "\" in the note. The commissioner marks squares paid once the money arrives.";
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-copy]"); if (!b) return;
    const node = $(b.dataset.copy), t = node.textContent;
    const sel = () => { const r = document.createRange(); r.selectNodeContents(node); const s = getSelection(); s.removeAllRanges(); s.addRange(r); };
    if (!navigator.clipboard) return sel();
    navigator.clipboard.writeText(t).then(() => { b.textContent = "Copied"; setTimeout(() => (b.textContent = "Copy"), 1500); }, sel);
  });

  // ---------- payouts ----------
  function renderPayouts() {
    const cf = S.st.cfg, sqs = live(), paid = Object.values(sqs).filter((s) => s.paid).length;
    const pot = paid * cf.price, full = 100 * cf.price, win = winners(), t = $("payTable"); t.replaceChildren();
    for (const [q, lab] of QUARTERS) {
      const pct = Number(cf.payouts[q]) || 0, tr = el("tr"), a = el("td", null, lab + " · " + pct + "%"), b = el("td", null, money((pct / 100) * (pot || full)));
      const s = cf.scores && cf.scores[q];
      if (s) a.append(el("span", "winner", (win[q] ? "Winner: " + (sqs[win[q]] ? sqs[win[q]].name : "open square") : "") + "  (" + s.top + "–" + s.side + ")"));
      tr.append(a, b); t.append(tr);
    }
    const tr = el("tr"), a = el("td"), sm = el("small", null, pot ? "Based on paid squares" : "Shown for a full board");
    sm.style.color = "var(--muted)"; a.append(sm); tr.append(a, el("td", null, money(pot || full))); t.append(tr);
  }

  // ---------- commissioner ----------
  function renderAdmin() {
    const st = S.st;
    $("adminPanel").hidden = !st.admin;
    $("footer").hidden = !B.hasLogin || st.admin;
    if (st.admin) $("loginPanel").hidden = true;
    if (!st.admin) return;
    const cf = st.cfg, active = document.activeElement;
    const setv = (id, v) => { if (active !== $(id)) $(id).value = v; };
    if (!S.cfgDirty) {
      setv("cTitle", cf.title); setv("cTop", cf.teamTop); setv("cSide", cf.teamSide); setv("cPrice", cf.price); setv("cHold", cf.holdMinutes);
      setv("cVenmo", cf.venmo ? "@" + cf.venmo : ""); setv("cPaypal", cf.paypal || "");
      setv("pQ1", cf.payouts.q1); setv("pQ2", cf.payouts.q2); setv("pQ3", cf.payouts.q3); setv("pF", cf.payouts.final);
      setv("cMax", cf.maxPerPlayer == null ? DEFAULT_MAX : cf.maxPerPlayer); setv("cContact", cf.contactEmail || "");
      setv("cRules", rulesOf(cf).join("\n"));
    }

    const cur = S.previewScheme || cf.scheme || "turf";
    for (const b of $("themePick").children) b.setAttribute("aria-pressed", String(b.dataset.k === cur));

    // images
    const imgs = $("imgs"); imgs.replaceChildren();
    const urls = cf.imageUrls || {};
    for (const [slot, lab] of IMG_SLOTS) {
      const row = el("div", "imgrow"), th = el("div", "th" + (slot === "header" ? " wide" : ""));
      if (urls[slot]) th.style.backgroundImage = 'url("' + urls[slot].replace(/"/g, "%22") + '")';
      const nm = el("div", "nm2", slot === "logoTop" ? cf.teamTop + " logo" : slot === "logoSide" ? cf.teamSide + " logo" : lab);
      const acts = el("div", "acts");
      if (st.canUpload) {
        const up = el("label", "tog file-btn", urls[slot] ? "Replace" : "Upload"); up.style.margin = "0"; up.style.textTransform = "none"; up.style.letterSpacing = "0";
        const inp = el("input"); inp.type = "file"; inp.accept = "image/png,image/jpeg,image/webp"; inp.setAttribute("aria-label", "Upload " + nm.textContent);
        inp.onchange = () => inp.files[0] && uploadImage(slot, inp.files[0]);
        up.append(inp); acts.append(up);
        if (urls[slot]) { const rm = el("button", "tog", "Remove"); rm.type = "button"; rm.onclick = () => adminDo(() => B.removeImage(slot), "Image removed."); acts.append(rm); }
      } else nm.append(el("small", null, " (only page editors can upload)"));
      row.append(th, nm, acts); imgs.append(row);
    }

    renderInvites();

    // ledger
    const sqs = live(), groups = {};
    for (const [id, s] of Object.entries(sqs)) (groups[s.owner] = groups[s.owner] || { name: s.name, ids: [] }).ids.push(id);
    const L = $("ledger"); L.replaceChildren();
    const keys = Object.keys(groups).sort((a, b) => groups[a].name.localeCompare(groups[b].name));
    if (!keys.length) L.append(el("div", "note", "No squares claimed yet. Share this page's link with your group."));
    for (const k of keys) {
      const g = groups[k], paidN = g.ids.filter((i) => sqs[i].paid).length, all = paidN === g.ids.length;
      const unpaidIds = g.ids.filter((i) => !sqs[i].paid);
      const soonest = unpaidIds.map((i) => sqs[i]).filter((s) => s.expiresAt).sort((a, b) => a.expiresAt - b.expiresAt)[0];
      const row = el("div", "ledger-row"), w = el("span", "who", g.name + " · " + g.ids.length + " sq · " + money(g.ids.length * cf.price));
      w.append(el("small", null, all ? "All paid" : paidN + " of " + g.ids.length + " paid" + (soonest ? " · releases in " + minsLeft(soonest) + " min" : "")));
      const acts = el("div", "acts");
      const t = el("button", "tog" + (all ? " on" : ""), all ? "Paid" : "Mark paid"); t.type = "button";
      t.onclick = () => adminDo(() => B.setPaid(g.ids, !all));
      acts.append(t);
      if (unpaidIds.length) {
        const armed = S.armedRelease === k, rel = el("button", "tog", armed ? "Confirm release" : "Release"); rel.type = "button";
        if (armed) rel.style.color = "var(--danger)";
        rel.onclick = () => {
          if (!armed) { S.armedRelease = k; renderAdmin(); setTimeout(() => { if (S.armedRelease === k) { S.armedRelease = null; renderAdmin(); } }, 4000); return; }
          S.armedRelease = null; adminDo(() => B.adminRelease(unpaidIds), "Released " + unpaidIds.length + " unpaid square" + (unpaidIds.length > 1 ? "s" : "") + ".");
        };
        acts.append(rel);
      }
      row.append(w, acts); L.append(row);
    }

    $("drawBtn").textContent = cf.locked
      ? (S.drawArm ? "Tap again to clear numbers and reopen" : "Reopen board")
      : (S.drawArm ? "Tap again to lock and draw" : "Lock board and draw numbers");
    $("drawBtn").classList.toggle("warn", S.drawArm);

    const sc = $("scores");
    if (!sc.dataset.built) {
      const h1 = el("span", "h"), h2 = el("span", "h"); h1.id = "scH1"; h2.id = "scH2";
      sc.append(el("span"), h1, h2);
      for (const [q] of QUARTERS) {
        const a = el("input"), b = el("input");
        for (const [i, who] of [[a, "top"], [b, "side"]]) { i.type = "number"; i.min = 0; i.inputMode = "numeric"; i.id = (who === "top" ? "st_" : "ss_") + q; }
        a.setAttribute("aria-label", SCORE_LABELS[q] + ", team across top"); b.setAttribute("aria-label", SCORE_LABELS[q] + ", team down side");
        sc.append(el("span", null, SCORE_LABELS[q]), a, b);
      }
      sc.dataset.built = "1";
      sc.addEventListener("input", () => (S.scoresDirty = true));
    }
    $("scH1").textContent = cf.teamTop; $("scH2").textContent = cf.teamSide;
    if (!S.scoresDirty) for (const [q] of QUARTERS) { const s = (cf.scores || {})[q] || {}; setv("st_" + q, s.top ?? ""); setv("ss_" + q, s.side ?? ""); }
  }

  async function adminDo(fn, okText) {
    try { await fn(); if (okText) showMsg("adminMsg", okText, "ok"); return true; }
    catch (e) { showMsg("adminMsg", e.message, "err"); return false; }
  }

  ["cTitle", "cTop", "cSide", "cPrice", "cHold", "cVenmo", "cPaypal", "pQ1", "pQ2", "pQ3", "pF", "cMax", "cContact", "cRules"].forEach((id) => $(id).addEventListener("input", () => (S.cfgDirty = true)));
  $("saveCfg").onclick = async () => {
    const payouts = { q1: Number($("pQ1").value) || 0, q2: Number($("pQ2").value) || 0, q3: Number($("pQ3").value) || 0, final: Number($("pF").value) || 0 };
    const sum = payouts.q1 + payouts.q2 + payouts.q3 + payouts.final;
    if (sum !== 100) return showMsg("adminMsg", "Payout split adds up to " + sum + "%. Make it 100% and save again.", "err");
    const venmo = $("cVenmo").value.trim().replace(/^@/, "");
    if (venmo && !/^[A-Za-z0-9_-]{5,30}$/.test(venmo)) return showMsg("adminMsg", "That doesn't look like a Venmo username. Use the part after the @.", "err");
    const paypal = $("cPaypal").value.trim().replace(/^https?:\/\/(www\.)?paypal\.me\//i, "").replace(/\/.*$/, "");
    if (paypal && !/^[A-Za-z0-9]{1,40}$/.test(paypal)) return showMsg("adminMsg", "Use just your PayPal.me name, the part after paypal.me/ (letters and numbers).", "err");
    const ok = await adminDo(() => B.saveCfg({
      title: $("cTitle").value.trim(), teamTop: $("cTop").value.trim(), teamSide: $("cSide").value.trim(),
      price: Number($("cPrice").value), holdMinutes: Number($("cHold").value), venmo, paypal, payouts,
      scheme: S.previewScheme || S.st.cfg.scheme || "turf",
      maxPerPlayer: Number($("cMax").value || 0), contactEmail: $("cContact").value.trim(),
      rules: $("cRules").value.split("\n").map((r) => r.replace(/^\s*[-*•⁃]+\s*/, "").trim()).filter(Boolean),
    }), "Settings saved.");
    if (ok) { S.cfgDirty = false; S.previewScheme = null; renderAll(); }
  };

  $("drawBtn").onclick = () => {
    if (!S.drawArm) { S.drawArm = true; renderAdmin(); setTimeout(() => { S.drawArm = false; renderAdmin(); }, 5000); return; }
    S.drawArm = false;
    const reset = S.st.cfg.locked;
    adminDo(() => reset ? B.reset() : B.draw(), reset ? "Board reopened. Numbers cleared." : "Board locked. Four sets of numbers drawn.");
  };
  $("saveScores").onclick = async () => {
    const scores = {};
    for (const [q] of QUARTERS) {
      const t = $("st_" + q).value, s = $("ss_" + q).value;
      if (t !== "" && s !== "") scores[q] = { top: Number(t), side: Number(s) };
    }
    if (!S.st.cfg.nums) return showMsg("adminMsg", "Draw the numbers first, then enter scores.", "err");
    if (await adminDo(() => B.saveScores(scores), "Scores saved. Winners are highlighted on the board.")) { S.scoresDirty = false; renderAll(); }
  };

  async function shrinkImage(file, slot) {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("Use a PNG, JPG or WebP image.");
    if (file.size > 15 * 1024 * 1024) throw new Error("That image is over 15 MB. Pick a smaller one.");
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("Couldn't read that image.")); i.src = url; });
      const max = slot === "header" ? 1800 : 320, k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const cv = document.createElement("canvas"); cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k);
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
      const type = slot === "header" ? "image/jpeg" : "image/png";
      return await new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't process that image."))), type, 0.85));
    } finally { URL.revokeObjectURL(url); }
  }
  async function uploadImage(slot, file) {
    showMsg("adminMsg", "Uploading…");
    await adminDo(async () => B.uploadImage(slot, await shrinkImage(file, slot)), "Image saved.");
  }

  // login (deployable site only)
  $("showLogin").onclick = () => { $("loginPanel").hidden = false; $("adminPw").focus(); };
  if (location.hash === "#login") setTimeout(() => { if ($("adminPanel").hidden) { $("loginPanel").hidden = false; $("loginPanel").scrollIntoView({ block: "center" }); $("adminPw").focus(); } }, 1200);
  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try { await B.login($("adminPw").value); $("adminPw").value = ""; hide("loginMsg"); }
    catch (err) { showMsg("loginMsg", err.message, "err"); }
  });
  $("adminExtra").replaceChildren(...(B.adminExtras ? B.adminExtras() : []));

  // ---------- invitations (commissioner) ----------
  const S2 = { edit: null, editVals: {} };
  function inviteLink(inv) { return B.inviteLink ? B.inviteLink(inv.token, S.st) : ""; }
  function inviteText(inv) {
    const cf = S.st.cfg, link = inviteLink(inv), pays = [cf.venmo && "Venmo", cf.paypal && "PayPal"].filter(Boolean).join(" or ");
    const subject = "You're invited: " + cf.title + " (" + cf.teamTop + " vs " + cf.teamSide + ")";
    const body = "Hi " + inv.name + ",\n\n" +
      "You're invited to pick squares in " + cf.title + ": " + cf.teamTop + " vs " + cf.teamSide + ". Squares are " + money(cf.price) + " each.\n\n" +
      "Your personal link:\n" + link + "\n\n" +
      "This link is just for you. It's how the board knows your picks are yours, so please don't share it. Your name shows on the board as \"" + inv.name + "\". You can choose your own font and color.\n\n" +
      "Squares are held for " + cf.holdMinutes + " minutes after you pick them" + (pays ? "; pay by " + pays + " from the board" : "") + " to keep them.\n\n" +
      "Good luck!";
    return { subject, body };
  }
  function gmailCompose(inv) {
    const t = inviteText(inv);
    return "https://mail.google.com/mail/?view=cm&fs=1&to=" + encodeURIComponent(inv.email) + "&su=" + encodeURIComponent(t.subject) + "&body=" + encodeURIComponent(t.body);
  }
  async function copyText(text, okMsg) {
    try { await navigator.clipboard.writeText(text); showMsg("invMsg", okMsg, "ok"); }
    catch (e) { showMsg("invMsg", "Copy this link: " + text); }
  }
  async function invDo(fn, okText) {
    try { await fn(); if (okText) showMsg("invMsg", okText, "ok"); return true; }
    catch (e) { showMsg("invMsg", e.message, "err"); return false; }
  }
  const fmtDate = (t) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  function renderInvites() {
    const sec = $("invSection");
    sec.hidden = !(B.invites && S.st.admin); if (sec.hidden) return;
    renderRequests();
    const list = (S.st.invites || []).slice().sort((a, b) => a.name.localeCompare(b.name));
    const L = $("invList"); L.replaceChildren();
    if (!list.length) L.append(el("div", "note", "No invitations yet. Add a name and email above."));
    for (const inv of list) {
      const row = el("div", "inv-row" + (inv.revoked ? " off" : ""));
      if (S2.edit === inv.id) {
        const v = S2.editVals, f = el("div", "inv-edit");
        const n = el("input"); n.type = "text"; n.maxLength = 24; n.value = v.name; n.setAttribute("aria-label", "Name"); n.oninput = () => (v.name = n.value);
        const m = el("input"); m.type = "email"; m.maxLength = 120; m.value = v.email; m.setAttribute("aria-label", "Email address"); m.oninput = () => (v.email = m.value);
        f.append(n, m);
        const acts = el("div", "acts");
        const save = el("button", "tog on", "Save"); save.type = "button";
        save.onclick = async () => { if (await invDo(() => B.updateInvite(inv.id, { name: v.name.trim(), email: v.email.trim() }), "Saved. The board shows the new name.")) { S2.edit = null; renderInvites(); } };
        const cancel = el("button", "tog", "Cancel"); cancel.type = "button"; cancel.onclick = () => { S2.edit = null; renderInvites(); };
        acts.append(save, cancel); row.append(f, acts); L.append(row);
        continue;
      }
      const top = el("div", "top");
      const nm = el("span", "nm3 ff-" + (inv.font || "clean"), inv.name);
      if (inv.color && inv.color !== "ink") nm.style.color = "var(--pc-" + inv.color + ")";
      const meta = el("span", "meta" + (inv.revoked ? " off" : inv.sentAt ? " sent" : ""), inv.revoked ? "Turned off" : inv.sentAt ? "Sent " + fmtDate(inv.sentAt) : "Not sent");
      top.append(nm, meta);
      const em = el("div", "em", inv.email + " · " + (inv.squares || 0) + " square" + (inv.squares === 1 ? "" : "s") + (inv.squares ? ", " + (inv.paid || 0) + " paid" : ""));
      const acts = el("div", "acts");
      if (!inv.revoked) {
        if (B.sendInvite) {
          const s = el("button", "tog", inv.sentAt ? "Resend email" : "Send email"); s.type = "button";
          s.onclick = () => { const t = inviteText(inv); s.disabled = true; s.textContent = "Sending…"; invDo(() => B.sendInvite(inv.id, t.subject, t.body), "Invitation emailed to " + inv.email + "."); };
          acts.append(s);
        } else {
          const a = el("a", "tog", inv.sentAt ? "Email again in Gmail" : "Email in Gmail"); a.href = gmailCompose(inv); a.target = "_blank"; a.rel = "noopener";
          a.onclick = () => { B.markSent && B.markSent(inv.id).catch(() => {}); showMsg("invMsg", "Gmail opened with the invitation ready. Press Send there."); };
          acts.append(a);
        }
        const c = el("button", "tog", "Copy link"); c.type = "button"; c.onclick = () => copyText(inviteLink(inv), "Link for " + inv.name + " copied.");
        acts.append(c);
      }
      const e = el("button", "tog", "Edit"); e.type = "button"; e.onclick = () => { S2.edit = inv.id; S2.editVals = { name: inv.name, email: inv.email }; renderInvites(); };
      const o = el("button", "tog", inv.revoked ? "Turn on" : "Turn off"); o.type = "button";
      o.title = inv.revoked ? "Let this link pick squares again" : "Stop this link from picking squares or changing style";
      o.onclick = () => invDo(() => B.updateInvite(inv.id, { revoked: !inv.revoked }), inv.revoked ? inv.name + "'s link works again." : inv.name + "'s link is turned off.");
      acts.append(e, o);
      row.append(top, em, acts); L.append(row);
    }
    const unsent = list.filter((i) => !i.revoked && !i.sentAt);
    $("invSendAll").hidden = !B.sendInvite || unsent.length < 2;
    $("invSendAll").textContent = "Email all " + unsent.length + " unsent invitations";
    // assign squares on someone's behalf
    const active = list.filter((i) => !i.revoked);
    $("assignBox").hidden = !active.length || S.st.cfg.locked;
    const sel = $("assignSel"), keep = sel.value;
    sel.replaceChildren(...active.map((i) => { const op = el("option", null, i.name); op.value = i.id; return op; }));
    if (keep && active.some((i) => String(i.id) === keep)) sel.value = keep;
  }
  $("invForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("invName").value.trim(), email = $("invEmail").value.trim();
    if (!name) return showMsg("invMsg", "Add the person's name.", "err");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showMsg("invMsg", "That email address doesn't look right.", "err");
    if (await invDo(() => B.createInvite({ name, email }), "Invitation for " + name + " added. Send it from the list below.")) {
      $("invName").value = ""; $("invEmail").value = ""; $("invName").focus();
    }
  });
  $("invSendAll").onclick = async () => {
    const list = (S.st.invites || []).filter((i) => !i.revoked && !i.sentAt);
    const btn = $("invSendAll"); btn.disabled = true;
    let ok = 0;
    for (const inv of list) {
      btn.textContent = "Sending " + (ok + 1) + " of " + list.length + "…";
      const t = inviteText(inv);
      try { await B.sendInvite(inv.id, t.subject, t.body); ok++; } catch (e) { showMsg("invMsg", "Stopped after " + ok + ": " + e.message, "err"); btn.disabled = false; return; }
    }
    btn.disabled = false; showMsg("invMsg", "Emailed " + ok + " invitation" + (ok === 1 ? "" : "s") + ".", "ok");
  };
  $("assignBtn").onclick = async () => {
    const id = $("assignSel").value, cells = [...S.selected];
    if (!cells.length) return showMsg("invMsg", "Select open squares on the board first, then assign them.", "err");
    const who = (S.st.invites || []).find((i) => String(i.id) === id);
    if (await invDo(() => B.adminAssign(id, cells), "Assigned " + cells.length + " square" + (cells.length > 1 ? "s" : "") + " to " + (who ? who.name : "player") + ".")) { S.selected.clear(); renderAll(); }
  };

  // ---------- header banner ----------
  // Layout comes from config.js: SQUARES_HEADER_LAYOUT = { text: "left", clear: 0.19, bg: "#234c48" } puts the
  // title in the open space left of the picture's centre (clear = share of the picture's width that is empty on
  // each side); without it the title sits over the middle of the picture.
  function placeHero() {
    const hero = $("heroText"), banner = $("banner"), img = $("bannerImg");
    const L = window.SQUARES_HEADER_LAYOUT || null, usingDefault = !(S.st && S.st.cfg.imageUrls && S.st.cfg.imageUrls.header);
    const left = !!(L && L.text === "left" && usingDefault);
    banner.classList.toggle("layout-left", left);
    banner.style.background = left && L.bg ? L.bg : "";
    let wide = !banner.hidden && window.innerWidth >= 760;
    const between = !!(L && L.text === "between" && usingDefault);
    banner.classList.toggle("layout-between", between);
    $("band").style.background = (between || left) && L.strip ? L.strip : "";
    if (between) {
      // fill any space beside the picture with the colours at its left and right edges
      banner.style.background = "linear-gradient(90deg," + (L.bgLeft || "#000") + " 50%," + (L.bgRight || "#000") + " 50%)";
      const bw = banner.getBoundingClientRect(), iw = img.getBoundingClientRect();
      const x = iw.left - bw.left + iw.width * (L.from || 0.35), w = iw.width * ((L.to || 0.6) - (L.from || 0.35));
      banner.style.setProperty("--hx", Math.round(x) + "px"); banner.style.setProperty("--hw", Math.round(w) + "px");
      wide = !banner.hidden && w >= 230;
    }
    if (left && !banner.hidden) {
      const W = banner.clientWidth, H = img.clientHeight || 1, aspect = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 2;
      const drawnW = Math.min(W, H * aspect), free = (W - drawnW) / 2 + drawnW * (L.clear || 0);
      banner.style.setProperty("--free", Math.floor(free) + "px");
      wide = free >= 280;
    }
    if (wide && hero.parentElement !== banner) banner.append(hero);
    else if (!wide && hero.parentElement === banner) $("band").querySelector(".wrap").prepend(hero);
    // In the left-title layout, the price/squares/pot figures fill the matching space on the right.
    const stats = $("band").querySelector(".stats"), wrap = $("band").querySelector(".wrap");
    const statsIn = left && wide;
    if (statsIn && stats.parentElement !== banner) banner.append(stats);
    else if (!statsIn && stats.parentElement === banner) wrap.append(stats);
    $("band").classList.toggle("stats-in-banner", statsIn);
    $("band").classList.toggle("hero-in-banner", hero.parentElement === banner);
  }
  window.addEventListener("resize", placeHero);
  $("bannerImg").addEventListener("load", placeHero);

  // ---------- rules ----------
  const DEFAULT_MAX = 8;
  const DEFAULT_RULES = [
    "Maximum of 8 squares per player",
    "Squares are not owned until paid",
    "Payments accepted via Venmo or PayPal",
    "Numbers are randomized on Super Bowl Sunday",
    "Winnings paid within 24 hours of the end of the game",
    "If all squares are not sold by noon on Super Bowl Sunday, payouts will be adjusted and posted",
  ];
  const rulesOf = (cf) => (Array.isArray(cf.rules) ? cf.rules : DEFAULT_RULES);
  const maxOf = (cf) => (cf.maxPerPlayer == null ? DEFAULT_MAX : Number(cf.maxPerPlayer) || 0);
  function renderRules() {
    const rules = rulesOf(S.st.cfg), ul = $("rulesList");
    $("rulesPanel").hidden = !rules.length;
    ul.replaceChildren(...rules.map((r) => el("li", null, r)));
    // remaining-squares hint for invited players
    let note = $("limitNote");
    if (!note) { note = el("p", "limit-note"); note.id = "limitNote"; $("holdNote").before(note); }
    const max = maxOf(S.st.cfg), me = S.st.me;
    if (inviteMode() && me && !me.revoked && max && !S.st.cfg.locked) {
      const held = Object.values(live()).filter((s) => s.mine).length, left = Math.max(0, max - held);
      note.textContent = left ? "You can hold up to " + max + " squares. " + left + " left to pick." : "You have the maximum of " + max + " squares.";
      note.hidden = false;
    } else note.hidden = true;
  }

  // ---------- request an invitation ----------
  function renderReqButton() {
    const show = !!(B.requestInvite && inviteMode() && !S.st.me && !S.st.admin);
    $("reqBtn").hidden = !show;
  }
  function openReq() {
    $("reqModal").hidden = false; $("reqForm").hidden = false; $("reqDone").hidden = true; hide("rqMsgBox");
    document.body.style.overflow = "hidden";
    setTimeout(() => $("rqName").focus(), 30);
  }
  function closeReq() { $("reqModal").hidden = true; document.body.style.overflow = ""; $("reqBtn").focus(); }
  $("reqBtn").onclick = openReq;
  $("reqClose").onclick = closeReq;
  $("reqDoneClose").onclick = closeReq;
  $("reqModal").addEventListener("click", (e) => { if (e.target === $("reqModal")) closeReq(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("reqModal").hidden) closeReq(); });
  $("reqForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("rqName").value.trim(), email = $("rqEmail").value.trim(), message = $("rqMsg").value.trim();
    if (!name) return showMsg("rqMsgBox", "Add your name.", "err");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showMsg("rqMsgBox", "That email address doesn't look right.", "err");
    const btn = $("rqSend"); btn.disabled = true; btn.textContent = "Sending…";
    try {
      await B.requestInvite({ name, email, message, website: $("rqWebsite").value });
      $("reqForm").hidden = true; $("reqDone").hidden = false; $("rqMsg").value = "";
      $("reqDoneClose").focus();
    } catch (err) { showMsg("rqMsgBox", err.message, "err"); }
    btn.disabled = false; btn.textContent = "Send request";
  });

  // commissioner: list of requests
  function renderRequests() {
    const box = $("reqSection"), reqs = S.st.requests;
    box.hidden = !Array.isArray(reqs); if (box.hidden) return;
    $("reqCount").textContent = reqs.length || "";
    const L = $("reqList"); L.replaceChildren();
    if (!reqs.length) L.append(el("div", "note", "No requests right now. When someone taps Request an Invitation, they'll show up here."));
    for (const r of reqs) {
      const row = el("div", "req-row"), top = el("div", "rq-top");
      top.append(el("span", "rq-name", r.name), el("span", "rq-when", fmtDate(r.at)));
      row.append(top, el("div", "rq-email", r.email));
      if (r.message) row.append(el("div", "rq-msg", r.message));
      const acts = el("div", "acts");
      const inv = el("button", "tog on", "Invite"); inv.type = "button";
      inv.title = "Add an invitation for " + r.name + " (send it from the list below)";
      inv.onclick = () => invDo(async () => { await B.createInvite({ name: r.name.slice(0, 24), email: r.email }); await B.dismissRequest(r.id); },
        "Invitation for " + r.name + " added. Send it from the Invitations list below.");
      const dis = el("button", "tog", "Dismiss"); dis.type = "button";
      dis.onclick = () => invDo(() => B.dismissRequest(r.id), "Request dismissed.");
      acts.append(inv, dis); row.append(acts); L.append(row);
    }
    const n = $("reqNote");
    n.hidden = S.st.contactSet !== false;
    n.textContent = "Requests also go to your email once you set \"Send invitation requests to\" in the settings above.";
  }

  // ---------- messages ----------
  function showMsg(id, text, kind) { const m = $(id); m.textContent = text; m.className = "msg" + (kind ? " " + kind : ""); m.hidden = false; }
  function hide(id) { $(id).hidden = true; }

  // ---------- main ----------
  function renderAll() {
    if (!S.st) return;
    if (sheetId) renderSheet();
    for (const id of [...S.selected]) if (live()[id]) S.selected.delete(id);
    renderHeader(); renderTabs(); renderBoard(); renderClaim(); renderPicker(); renderMine(); renderPayouts(); renderAdmin(); renderRules(); renderReqButton();
  }
  buildPicker(); buildThemes(); renderPicker(); renderTabs();
  B.start((st, problem) => {
    if (problem) { $("offline").hidden = false; $("offlineTxt").textContent = problem; }
    else $("offline").hidden = true;
    if (st) {
      S.st = st;
      if (st.inviteOnly && st.me && !S.styleDirty) S.style = { font: st.me.font || "clean", color: st.me.color || "ink" };
      renderAll();
    }
  });
  setInterval(() => { if (!document.hidden && S.st) renderAll(); }, 20000); // countdowns + expiring holds
})();
