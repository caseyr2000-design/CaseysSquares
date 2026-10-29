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
    getPage: (name) => run("getPage", name),
    reportPayment: (method) => act("reportPayment", tok(), method),
    savePage: (name, data, rev) => run("savePage", adm(), name, data, rev),
    refresh: () => refresh(),
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
  const PAGE = document.body.dataset.page;
  const clone = (o) => JSON.parse(JSON.stringify(o));
  let pageData = clone(JSON.parse(($("pageDefault") || {}).textContent || "{}"));
  let pageRev = null, pageLoaded = false, saving = false;
  let slots = [];
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
    // price / squares left / pot: small, in the banner's bottom-right corner
    const stats = band.querySelector(".stats"), corner = !banner.hidden;
    if (corner && stats.parentElement !== banner) banner.append(stats);
    else if (!corner && stats.parentElement === banner) hero.append(stats);
    banner.classList.toggle("stats-corner", corner);
    if (corner) { const bw = banner.getBoundingClientRect(), iw = img.getBoundingClientRect(); banner.style.setProperty("--ir", Math.max(0, Math.round(bw.right - iw.right)) + "px"); }
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
    slots = [...document.querySelectorAll("figure.slot[data-slot]")];
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

  // ---------- page content: lists of rows the commissioner can reorder, add, edit and delete ----------
  const ROMAN = (n) => { let r = ""; for (const [v, t] of [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]]) while (n >= v) { r += t; n -= v; } return r; };
  const showMoney = (v) => {
    const t = String(v == null ? "" : v).trim();
    if (!t) return "";
    const n = Number(t.replace(/[$,\s]/g, ""));
    return /^\$?\s*[\d,]+(\.\d+)?$/.test(t) && isFinite(n) ? money(n) : t;
  };
  const rid = (prefix) => prefix + "-" + Math.random().toString(36).slice(2, 8).replace(/[^a-z0-9]/g, "x");
  const QS = [["q1", "Q1"], ["q2", "Q2"], ["q3", "Q3"], ["fin", "Final Score"]];
  const SPECS = {
    odds: [{ key: "items", kind: "gallery", prefix: "odds", noun: "picture", fields: [{ k: "caption", label: "Caption (optional)" }] }],
    pay: [{ key: "items", kind: "gallery", prefix: "pay", noun: "picture", fields: [{ k: "caption", label: "Caption (optional)" }] }],
    hot: [{ key: "items", kind: "gallery", prefix: "hot", noun: "picture", fields: [{ k: "caption", label: "Caption (optional)", ph: "Super Bowl LXI" }] }],
    yw: [{ key: "rows", kind: "yw", prefix: "yw", noun: "year", fields: [
      { k: "year", label: "Year", half: 1 }, { k: "sb", label: "Super Bowl", half: 1, ph: "LXI" },
      { k: "date", label: "Date", ph: "February 14, 2027" },
      { k: "q1", label: "Q1 winner", half: 1 }, { k: "q1a", label: "Q1 amount", half: 1, ph: "$300" },
      { k: "q2", label: "Q2 winner", half: 1 }, { k: "q2a", label: "Q2 amount", half: 1 },
      { k: "q3", label: "Q3 winner", half: 1 }, { k: "q3a", label: "Q3 amount", half: 1 },
      { k: "fin", label: "Final score winner", half: 1 }, { k: "fina", label: "Final amount", half: 1 }] }],
    hof: [
      { key: "wins", kind: "table", title: "Most Wins", noun: "row", cols: [{ k: "name", label: "Name" }, { k: "wins", label: "Wins", num: 1 }],
        fields: [{ k: "name", label: "Name" }, { k: "wins", label: "Wins", ph: "3" }] },
      { key: "dollars", kind: "table", title: "Top Dollars", noun: "row", cols: [{ k: "name", label: "Name" }, { k: "total", label: "Total won", num: 1, money: 1 }],
        fields: [{ k: "name", label: "Name" }, { k: "total", label: "Total won", ph: "$1,200" }] }],
  };
  const specs = SPECS[PAGE] || [];
  const listOf = (spec) => (Array.isArray(pageData[spec.key]) ? pageData[spec.key] : (pageData[spec.key] = []));
  const canEdit = () => !!(st && st.admin) && pageLoaded;

  function status(text, err) {
    let b = $("pageStatus");
    if (!b) { b = el("div", "page-status"); b.id = "pageStatus"; b.setAttribute("role", "status"); document.body.append(b); }
    b.textContent = text; b.classList.toggle("err", !!err); b.hidden = false;
    clearTimeout(status.t); status.t = setTimeout(() => { b.hidden = true; }, err ? 6000 : 1800);
  }
  async function commit(change, after) {
    if (saving) { status("Still saving the last change…"); return; }
    const before = clone(pageData);
    change(pageData); renderPage();
    saving = true; status("Saving…");
    try { const r = await B.savePage(PAGE, pageData, pageRev); pageRev = r && r.rev; status("Saved."); if (after) after(); }
    catch (e) { pageData = before; renderPage(); status(e.message || "Couldn't save. Try again.", true); }
    finally { saving = false; }
  }
  function rowActs(spec, i, len) {
    const box = el("div", "row-acts");
    const mk = (txt, label, fn, cls) => { const b = el("button", "tog" + (cls ? " " + cls : ""), txt); b.type = "button"; b.setAttribute("aria-label", label); b.title = label; b.onclick = fn; box.append(b); return b; };
    mk("↑", "Move up", () => commit((d) => { const a = d[spec.key]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; })).disabled = i === 0;
    mk("↓", "Move down", () => commit((d) => { const a = d[spec.key]; [a[i + 1], a[i]] = [a[i], a[i + 1]]; })).disabled = i === len - 1;
    mk("Edit", "Edit this " + spec.noun, () => openForm(spec, i));
    const del = mk("Delete", "Delete this " + spec.noun, () => {
      if (!del.classList.contains("armed")) { del.classList.add("armed"); del.textContent = "Tap again to delete"; setTimeout(() => { del.classList.remove("armed"); del.textContent = "Delete"; }, 4000); return; }
      const row = listOf(spec)[i], slot = row && row.id && spec.kind !== "table" ? row.id : null;
      commit((d) => { d[spec.key].splice(i, 1); }, () => { if (slot && st && st.cfg.images && st.cfg.images[slot]) B.removeImage(slot).catch(() => {}); });
    }, "danger");
    return box;
  }
  function addBtn(spec) {
    const b = el("button", "btn add-row", "+ Add " + spec.noun); b.type = "button";
    b.onclick = () => openForm(spec, -1);
    return b;
  }
  function blankRow(spec) {
    const r = {};
    for (const f of spec.fields) r[f.k] = "";
    if (spec.kind !== "table") r.id = rid(spec.prefix);
    if (spec.kind === "yw") {
      const years = listOf(spec).map((x) => parseInt(x.year, 10)).filter((n) => n > 1900);
      const y = years.length ? Math.max(...years) + 1 : new Date().getFullYear();
      r.year = String(y); r.sb = ROMAN(y - 1966);
    }
    return r;
  }
  // add / edit form
  function openForm(spec, i) {
    const editing = i >= 0, row = editing ? clone(listOf(spec)[i]) : blankRow(spec);
    const back = el("div", "modal"), card = el("div", "modal-card wide rowform");
    card.setAttribute("role", "dialog"); card.setAttribute("aria-modal", "true"); card.setAttribute("aria-label", (editing ? "Edit " : "Add ") + spec.noun);
    const x = el("button", "sheet-x", "×"); x.type = "button"; x.setAttribute("aria-label", "Close");
    const h = el("h2", null, (editing ? "Edit " : "Add ") + spec.noun + (spec.title ? " · " + spec.title : ""));
    const form = el("form"), inputs = {};
    let pair = null;
    for (const f of spec.fields) {
      const wrapF = el("div"), id = "rf_" + f.k, lab = el("label", null, f.label), inp = el("input");
      lab.htmlFor = id; inp.id = id; inp.type = "text"; inp.maxLength = 120; inp.value = row[f.k] == null ? "" : String(row[f.k]);
      if (f.ph) inp.placeholder = f.ph;
      inputs[f.k] = inp; wrapF.append(lab, inp);
      if (f.half) { if (!pair) { pair = el("div", "grid2"); form.append(pair); } pair.append(wrapF); if (pair.children.length === 2) pair = null; }
      else { pair = null; form.append(wrapF); }
    }
    const btns = el("div", "btns"), save = el("button", "btn", editing ? "Save" : "Add"), cancel = el("button", "btn ghost", "Cancel");
    save.type = "submit"; cancel.type = "button"; btns.append(cancel, save); form.append(btns);
    card.append(x, h, form); back.append(card); document.body.append(back);
    const close = () => { back.remove(); document.removeEventListener("keydown", onKey); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    x.onclick = cancel.onclick = close;
    back.addEventListener("click", (e) => { if (e.target === back) close(); });
    form.onsubmit = (e) => {
      e.preventDefault();
      for (const f of spec.fields) row[f.k] = inputs[f.k].value.trim();
      close();
      commit((d) => { const a = d[spec.key] = d[spec.key] || []; if (editing) a[i] = row; else a.push(row); });
    };
    inputs[spec.fields[0].k].focus();
  }

  function renderGallery(spec, host) {
    const rows = listOf(spec), admin = canEdit(), grid = el("div", "slot-grid");
    rows.forEach((r, i) => {
      const f = el("figure", "slot"); f.dataset.slot = r.id; f.dataset.label = r.caption || spec.noun;
      if (r.caption) f.append(el("figcaption", null, r.caption));
      if (admin) f.append(rowActs(spec, i, rows.length));
      grid.append(f);
    });
    host.append(rows.length ? grid : el("p", "empty-list", "Nothing here yet."));
    if (admin) host.append(addBtn(spec));
  }
  function winnerCell(name, amt, head) {
    const td = el("td"); td.dataset.h = head;
    if (name || amt) { const w = el("span", "who", name || ""); if (amt) w.append(el("span", "amt", showMoney(amt))); td.append(w); }
    return td;
  }
  function renderYW(spec, host) {
    const rows = listOf(spec), admin = canEdit();
    const wrap = el("div", "yw-wrap"), t = el("table", "yw"), hr = el("tr");
    for (const hd of ["Date", "Q1", "Q2", "Q3", "Final Score", "Photo"].concat(admin ? ["Order"] : [])) hr.append(el("th", null, hd));
    const thead = el("thead"); thead.append(hr);
    const tb = el("tbody");
    rows.forEach((r, i) => {
      const tr = el("tr"), when = el("td", "when"); when.dataset.h = "Date";
      when.append(el("b", null, r.year || ""));
      const sub = [r.sb ? "Super Bowl " + r.sb : "", r.date || ""].filter(Boolean).join(" · ");
      if (sub) when.append(el("small", null, sub));
      tr.append(when);
      for (const [k, hd] of QS) tr.append(winnerCell(r[k], r[k + "a"], hd));
      const pic = el("td", "pic"); pic.dataset.h = "Photo";
      const f = el("figure", "slot"); f.dataset.slot = r.id; f.dataset.label = (r.year || "") + " photo"; pic.append(f); tr.append(pic);
      if (admin) { const a = el("td", "acts"); a.append(rowActs(spec, i, rows.length)); tr.append(a); }
      tb.append(tr);
    });
    t.append(thead, tb); wrap.append(t); host.append(wrap);
    if (admin) host.append(addBtn(spec));
  }
  function renderTable(spec, host) {
    const rows = listOf(spec), admin = canEdit();
    const sec = el("section", "page-section lb-sec"); sec.append(el("h3", null, spec.title));
    const wrap = el("div", "lb-wrap"), t = el("table", "lb"), hr = el("tr");
    hr.append(el("th", null, "#"));
    for (const c of spec.cols) hr.append(el("th", c.num ? "num" : null, c.label));
    if (admin) hr.append(el("th", null, ""));
    const thead = el("thead"); thead.append(hr); const tb = el("tbody");
    rows.forEach((r, i) => {
      const tr = el("tr"); tr.append(el("td", "rk", String(i + 1)));
      for (const c of spec.cols) tr.append(el("td", c.num ? "num" : "nm", c.money ? showMoney(r[c.k]) : String(r[c.k] == null ? "" : r[c.k])));
      if (admin) { const a = el("td", "acts"); a.append(rowActs(spec, i, rows.length)); tr.append(a); }
      tb.append(tr);
    });
    t.append(thead, tb); wrap.append(t); sec.append(wrap);
    if (admin) sec.append(addBtn(spec));
    host.append(sec);
  }
  let lastWant = "";
  function renderPage() {
    const host = $("pageBody"); if (!host) return;
    host.replaceChildren();
    const outer = PAGE === "hof" ? el("div", "hof-grid") : host;
    for (const spec of specs) {
      if (spec.kind === "gallery") renderGallery(spec, outer);
      else if (spec.kind === "yw") renderYW(spec, outer);
      else renderTable(spec, outer);
    }
    if (outer !== host) host.append(outer);
    renderSlots();
    // ask the backend for the pictures these rows show
    const want = slots.map((f) => f.dataset.slot);
    window.SQUARES_WANT_IMAGES = want;
    const key = want.join(",");
    if (key !== lastWant) { const first = !lastWant; lastWant = key; if (!first && B.refresh) B.refresh(); }
  }
  async function loadPage() {
    try {
      const r = await B.getPage(PAGE);
      if (r && r.data && typeof r.data === "object") { pageData = r.data; pageRev = r.rev; } else pageRev = 0;
      pageLoaded = true; renderPage();
    } catch (e) { setTimeout(loadPage, 5000); }
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

  renderPage();
  let wasAdmin = null;
  B.start((s, problem) => {
    $("offline").hidden = !problem; if (problem) $("offlineTxt").textContent = problem;
    if (!s) return;
    st = s; renderHeader();
    if (wasAdmin !== !!s.admin) { wasAdmin = !!s.admin; renderPage(); } else renderSlots();
  });
  loadPage();
})();
