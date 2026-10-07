/**
 * Redact App Controller - file loading, marking (search + drawn boxes),
 * apply/verify, and download. All PDF work happens in redactEngine.js.
 */

import { createRedactEngine, PRESET_PATTERNS, DEFAULT_SANITIZE, literalToRegexSource } from "./redactEngine.js";
import { loadMupdfBackend } from "./redactMupdf.js";
import { loadPdfiumBackend } from "./redactPdfium.js";

// Both engines are loaded from the CDN at pinned versions, so an update
// there can never silently change how documents are redacted.
const ENGINES = {
  mupdf: { label: "MuPDF", license: "AGPL-3.0", load: loadMupdfBackend },
  pdfium: { label: "PDFium", license: "Apache-2.0 / MIT", load: loadPdfiumBackend },
};
const ENGINE_PREF_KEY = "redact.engine";
const MAX_RENDER_WIDTH = 900;

const $ = id => document.getElementById(id);

const state = {
  engineName: initialEngineName(),
  engine: null,
  session: null,
  fileBytes: null,      // original upload, kept so the document can be reopened in the other engine
  fileName: "",
  fileSize: 0,
  marks: [],            // [{ id, page, rects, groupId, label }]
  groups: new Map(),    // groupId -> { id, label, source, caseSensitive, total }
  history: [],          // undo stack: { type: "add", ids } | { type: "remove", marks }
  pageViews: [],        // [{ frame, overlay, bounds }]
  result: null,         // { bytes, session, run: { marks, searches, sanitize } }
  nextId: 1,
};

let renderObserver = null;

// ==========================================================================
// ENGINE LOADING & SWITCHING
// ==========================================================================

function initialEngineName() {
  const fromUrl = new URLSearchParams(location.search).get("engine");
  if (ENGINES[fromUrl]) return fromUrl;
  try {
    const saved = localStorage.getItem(ENGINE_PREF_KEY);
    if (ENGINES[saved]) return saved;
  } catch { /* storage unavailable */ }
  return "mupdf";
}

const enginePromises = {};

function getEngine(name) {
  if (!enginePromises[name]) {
    enginePromises[name] = ENGINES[name].load()
      .then(createRedactEngine)
      .catch(err => {
        delete enginePromises[name]; // allow a retry
        throw err;
      });
  }
  return enginePromises[name];
}

async function activateEngine(name) {
  state.engineName = name;
  try { localStorage.setItem(ENGINE_PREF_KEY, name); } catch { /* storage unavailable */ }
  document.querySelectorAll("#engineToggle .segment-btn").forEach(b => b.classList.toggle("active", b.dataset.engine === name));

  const status = $("engineStatus");
  status.classList.remove("error");
  status.textContent = `Loading ${ENGINES[name].label}…`;
  try {
    const engine = await getEngine(name);
    if (state.engineName !== name) return engine; // switched again meanwhile
    state.engine = engine;
    status.textContent = `${ENGINES[name].label} engine ready (${ENGINES[name].license}). Your file stays on this device.`;
    return engine;
  } catch (err) {
    console.error(err);
    status.textContent = `Could not load ${ENGINES[name].label}. Check your connection and reload.`;
    status.classList.add("error");
    throw err;
  }
}

$("engineToggle").addEventListener("click", async e => {
  const btn = e.target.closest(".segment-btn");
  if (!btn || btn.dataset.engine === state.engineName) return;
  const name = btn.dataset.engine;
  if (!state.session) {
    activateEngine(name).catch(() => {});
    return;
  }
  // Reopen the current document in the other engine, keeping every mark.
  // Both engines use top-left page coordinates in points, so marks carry over.
  const previous = state.engineName;
  try {
    showLoading(`Switching to ${ENGINES[name].label}…`);
    const engine = await activateEngine(name);
    await nextFrame();
    const session = engine.open(state.fileBytes);
    clearResult();
    state.session.destroy();
    state.session = session;
    showDocument();
    $("resultSection").classList.add("hidden");
    $("workspace").classList.remove("hidden");
  } catch (err) {
    alert(`Could not reopen the document with ${ENGINES[name].label}: ${err.message}`);
    activateEngine(previous).catch(() => {});
  } finally {
    hideLoading();
  }
});

activateEngine(state.engineName).catch(() => {});

// ==========================================================================
// FILE INPUT
// ==========================================================================

const dropzone = $("dropzone");
const fileInput = $("fileInput");

dropzone.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", e => {
  if (e.target.files && e.target.files[0]) loadFile(e.target.files[0]);
});
dropzone.addEventListener("dragover", e => { e.preventDefault(); dropzone.classList.add("drag-over"); });
dropzone.addEventListener("dragleave", e => { e.preventDefault(); dropzone.classList.remove("drag-over"); });
dropzone.addEventListener("drop", e => {
  e.preventDefault();
  dropzone.classList.remove("drag-over");
  if (e.dataTransfer.files && e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
});
window.addEventListener("dragover", e => e.preventDefault());
window.addEventListener("drop", e => e.preventDefault());

$("btnLoadSample").addEventListener("click", async () => {
  try {
    const res = await fetch("static/samples/sample_contract_v1.pdf");
    if (!res.ok) throw new Error("Could not retrieve the sample PDF.");
    const blob = await res.blob();
    await loadFile(new File([blob], "sample_contract_v1.pdf", { type: "application/pdf" }));
  } catch (err) {
    alert("Error loading sample: " + err.message);
  }
});

async function loadFile(file) {
  if (!file.type.includes("pdf") && !file.name.toLowerCase().endsWith(".pdf")) {
    alert("Please select a PDF file.");
    return;
  }
  try {
    showLoading(`Loading ${ENGINES[state.engineName].label}…`);
    const engine = await activateEngine(state.engineName);
    showLoading("Opening and flattening the PDF…");
    await nextFrame();

    resetSession();
    const bytes = new Uint8Array(await file.arrayBuffer());
    state.session = engine.open(bytes);
    state.fileBytes = bytes;
    state.fileName = file.name;
    state.fileSize = file.size;
    showDocument();

    const pending = state.session.pendingRedactions;
    if (pending.length) {
      const group = addGroup({ label: "Marked in original file", source: null });
      const ids = pending.map(r => addMark({ page: r.page, rects: [r.rect], groupId: group.id }));
      group.total = ids.length;
      $("pendingNoticeText").textContent =
        `This file had ${pending.length} redaction mark(s) that were never applied, so the text under them was still there. They've been added to your list and will be applied.`;
      $("pendingNotice").classList.remove("hidden");
    }

    $("uploadSection").classList.add("hidden");
    $("resultSection").classList.add("hidden");
    $("workspace").classList.remove("hidden");
    $("btnReset").classList.remove("hidden");
    $("btnApply").disabled = false;
    refreshMarks();
  } catch (err) {
    console.error(err);
    alert("Could not open this PDF: " + err.message);
  } finally {
    hideLoading();
    fileInput.value = "";
  }
}

/** (Re)build the page views and file details for the current session. */
function showDocument() {
  const s = state.session;
  $("docName").textContent = state.fileName;
  $("docInfo").textContent =
    `${s.pageCount} page${s.pageCount === 1 ? "" : "s"} · ${formatBytes(state.fileSize)} · ${ENGINES[state.engineName].label}`;
  $("scanNotice").classList.toggle("hidden", !s.hasNoText());
  buildPageViews($("pages"), s, true);
  refreshMarks();
}

function resetSession() {
  clearResult();
  if (state.session) state.session.destroy();
  state.session = null;
  state.fileBytes = null;
  state.marks = [];
  state.groups.clear();
  state.history = [];
  state.pageViews = [];
  $("pages").innerHTML = "";
  $("searchInput").value = "";
  setFeedback("");
  $("pendingNotice").classList.add("hidden");
  $("scanNotice").classList.add("hidden");
}

$("btnReset").addEventListener("click", () => {
  resetSession();
  $("workspace").classList.add("hidden");
  $("resultSection").classList.add("hidden");
  $("uploadSection").classList.remove("hidden");
  $("btnReset").classList.add("hidden");
  window.scrollTo({ top: 0 });
});

// ==========================================================================
// PAGE RENDERING (lazy, as pages scroll into view)
// ==========================================================================

function buildPageViews(container, session, editable) {
  container.innerHTML = "";
  if (renderObserver && editable) renderObserver.disconnect();

  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      renderPageImage(session, Number(entry.target.dataset.page), entry.target);
    }
  }, { rootMargin: "800px 0px" });

  const views = [];
  for (let p = 0; p < session.pageCount; p++) {
    const bounds = session.pageBounds(p);
    const frame = document.createElement("div");
    frame.className = "page-frame";
    frame.dataset.page = p;
    frame.style.aspectRatio = `${bounds[2] - bounds[0]} / ${bounds[3] - bounds[1]}`;

    const label = document.createElement("span");
    label.className = "page-number";
    label.textContent = `Page ${p + 1}`;
    frame.appendChild(label);

    const overlay = document.createElement("div");
    overlay.className = "page-overlay";
    frame.appendChild(overlay);
    if (editable) attachDrawing(overlay, p, bounds);

    container.appendChild(frame);
    observer.observe(frame);
    views.push({ frame, overlay, bounds });
  }

  if (editable) {
    renderObserver = observer;
    state.pageViews = views;
  }
  return observer;
}

function renderPageImage(session, p, frame) {
  const bounds = session.pageBounds(p);
  const width = bounds[2] - bounds[0];
  const scale = Math.min(3, (MAX_RENDER_WIDTH * (window.devicePixelRatio || 1)) / width);
  try {
    // Backends return either PNG bytes or raw RGBA pixels.
    const rendered = session.renderPage(p, scale);
    let el;
    if (rendered instanceof Uint8Array) {
      el = document.createElement("img");
      el.src = URL.createObjectURL(new Blob([rendered], { type: "image/png" }));
      el.onload = () => URL.revokeObjectURL(el.src);
    } else {
      el = document.createElement("canvas");
      el.width = rendered.width;
      el.height = rendered.height;
      el.getContext("2d").putImageData(new ImageData(rendered.data, rendered.width, rendered.height), 0, 0);
    }
    el.className = "page-image";
    el.setAttribute("role", "img");
    el.setAttribute("aria-label", `Page ${p + 1}`);
    frame.insertBefore(el, frame.querySelector(".page-overlay"));
  } catch (err) {
    console.warn(`Could not render page ${p + 1}:`, err);
  }
}

// ==========================================================================
// DRAWING BOXES
// ==========================================================================

function attachDrawing(overlay, page, bounds) {
  let start = null;
  let box = null;

  const toPage = e => {
    const r = overlay.getBoundingClientRect();
    const fx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const fy = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    return { fx, fy, px: e.clientX - r.left, py: e.clientY - r.top };
  };

  overlay.addEventListener("pointerdown", e => {
    if (e.button !== 0 || e.target.closest(".mark-rect")) return;
    overlay.setPointerCapture(e.pointerId);
    start = toPage(e);
    box = document.createElement("div");
    box.className = "draw-rect";
    overlay.appendChild(box);
    e.preventDefault();
  });

  overlay.addEventListener("pointermove", e => {
    if (!start) return;
    const cur = toPage(e);
    Object.assign(box.style, {
      left: `${Math.min(start.fx, cur.fx) * 100}%`,
      top: `${Math.min(start.fy, cur.fy) * 100}%`,
      width: `${Math.abs(cur.fx - start.fx) * 100}%`,
      height: `${Math.abs(cur.fy - start.fy) * 100}%`,
    });
  });

  const finish = e => {
    if (!start) return;
    const cur = toPage(e);
    const big = Math.abs(cur.px - start.px) > 4 && Math.abs(cur.py - start.py) > 4;
    box.remove();
    if (big && e.type === "pointerup") {
      const w = bounds[2] - bounds[0];
      const h = bounds[3] - bounds[1];
      const rect = [
        bounds[0] + Math.min(start.fx, cur.fx) * w,
        bounds[1] + Math.min(start.fy, cur.fy) * h,
        bounds[0] + Math.max(start.fx, cur.fx) * w,
        bounds[1] + Math.max(start.fy, cur.fy) * h,
      ];
      const text = state.session.textInRect(page, rect);
      const id = addMark({ page, rects: [rect], groupId: null, label: text ? `“${truncate(text, 40)}”` : "Drawn area" });
      state.history.push({ type: "add", ids: [id] });
      refreshMarks();
    }
    start = null;
    box = null;
  };
  overlay.addEventListener("pointerup", finish);
  overlay.addEventListener("pointercancel", finish);
}

// ==========================================================================
// SEARCH
// ==========================================================================

for (const [key, preset] of Object.entries(PRESET_PATTERNS)) {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "preset-chip";
  chip.textContent = preset.label;
  chip.dataset.preset = key;
  chip.addEventListener("click", () => runSearch({ label: preset.label, source: preset.source, caseSensitive: false }));
  $("presetRow").appendChild(chip);
}

$("searchForm").addEventListener("submit", e => {
  e.preventDefault();
  const term = $("searchInput").value;
  if (!term.trim()) return;
  const isRegex = $("optRegex").checked;
  let source;
  if (isRegex) {
    try {
      new RegExp(term);
    } catch (err) {
      setFeedback(`Invalid regex: ${err.message}`, true);
      return;
    }
    source = term;
  } else {
    source = literalToRegexSource(term);
  }
  if (runSearch({ label: isRegex ? `/${term}/` : term.trim(), source, caseSensitive: $("optCase").checked })) {
    $("searchInput").value = "";
  }
});

function runSearch({ label, source, caseSensitive }) {
  if (!state.session) return false;
  const hits = state.session.find(source, { caseSensitive });
  const existing = new Set(state.marks.map(markKey));
  const fresh = hits.filter(h => !existing.has(markKey(h)));

  if (!hits.length) {
    setFeedback(`No matches for ${label}.`);
    return false;
  }
  if (!fresh.length) {
    setFeedback(`All ${hits.length} match(es) for ${label} are already marked.`);
    return true;
  }

  const group = addGroup({ label, source, caseSensitive });
  const ids = fresh.map(h => addMark({ page: h.page, rects: h.rects, groupId: group.id, label: h.text }));
  group.total = ids.length;
  state.history.push({ type: "add", ids });
  setFeedback(`Marked ${fresh.length} match(es) for ${label}${fresh.length < hits.length ? ` (${hits.length - fresh.length} already marked)` : ""}. Review them on the pages before applying.`);
  refreshMarks();
  flashMark(ids[0]);
  return true;
}

function setFeedback(msg, isError = false) {
  const el = $("searchFeedback");
  el.textContent = msg;
  el.classList.toggle("error", isError);
}

// ==========================================================================
// MARK MODEL
// ==========================================================================

function addGroup({ label, source, caseSensitive = false }) {
  const group = { id: `g${state.nextId++}`, label, source, caseSensitive, total: 0 };
  state.groups.set(group.id, group);
  return group;
}

function addMark({ page, rects, groupId, label = "" }) {
  const id = `m${state.nextId++}`;
  state.marks.push({ id, page, rects, groupId, label });
  return id;
}

function markKey(m) {
  return `${m.page}:${m.rects.map(r => r.map(v => v.toFixed(1)).join(",")).join("|")}`;
}

function removeMarks(ids) {
  const set = new Set(ids);
  const removed = state.marks.filter(m => set.has(m.id));
  if (!removed.length) return;
  state.marks = state.marks.filter(m => !set.has(m.id));
  state.history.push({ type: "remove", marks: removed });
  refreshMarks();
}

function undo() {
  const step = state.history.pop();
  if (!step) return;
  if (step.type === "add") {
    const set = new Set(step.ids);
    state.marks = state.marks.filter(m => !set.has(m.id));
  } else {
    state.marks.push(...step.marks);
  }
  refreshMarks();
}

document.addEventListener("keydown", e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.target.closest("input")) {
    if ($("workspace").classList.contains("hidden")) return;
    e.preventDefault();
    undo();
  }
});

function refreshMarks() {
  // Overlays
  state.pageViews.forEach(v => v.overlay.querySelectorAll(".mark-rect").forEach(el => el.remove()));
  for (const mark of state.marks) {
    const view = state.pageViews[mark.page];
    if (!view) continue;
    const [bx0, by0, bx1, by1] = view.bounds;
    const w = bx1 - bx0;
    const h = by1 - by0;
    for (const r of mark.rects) {
      const el = document.createElement("div");
      el.className = "mark-rect";
      el.dataset.markId = mark.id;
      el.title = "Click to remove this mark";
      Object.assign(el.style, {
        left: `${((r[0] - bx0) / w) * 100}%`,
        top: `${((r[1] - by0) / h) * 100}%`,
        width: `${((r[2] - r[0]) / w) * 100}%`,
        height: `${((r[3] - r[1]) / h) * 100}%`,
      });
      el.addEventListener("click", () => removeMarks([mark.id]));
      view.overlay.appendChild(el);
    }
  }

  // Sidebar list: one row per search group, one row per drawn box
  const list = $("markList");
  list.innerHTML = "";
  const rows = [];
  const seenGroups = new Set();
  for (const mark of state.marks) {
    if (mark.groupId) {
      if (seenGroups.has(mark.groupId)) continue;
      seenGroups.add(mark.groupId);
      const group = state.groups.get(mark.groupId);
      const members = state.marks.filter(m => m.groupId === group.id);
      const pages = [...new Set(members.map(m => m.page + 1))];
      rows.push({
        label: group.label,
        meta: `${members.length} hit${members.length === 1 ? "" : "s"} · p.${compactPages(pages)}`,
        ids: members.map(m => m.id),
      });
    } else {
      rows.push({ label: mark.label, meta: `p.${mark.page + 1}`, ids: [mark.id] });
    }
  }

  if (!rows.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "Nothing marked yet.";
    list.appendChild(li);
  }

  for (const row of rows) {
    const li = document.createElement("li");
    li.className = "mark-item";
    const label = document.createElement("span");
    label.className = "mark-label";
    label.textContent = row.label;
    label.title = "Show on page";
    label.addEventListener("click", () => flashMark(row.ids[0]));
    const meta = document.createElement("span");
    meta.className = "mark-meta";
    meta.textContent = row.meta;
    const del = document.createElement("button");
    del.className = "btn-icon";
    del.title = "Remove";
    del.innerHTML = '<i data-lucide="x"></i>';
    del.addEventListener("click", () => removeMarks(row.ids));
    li.append(label, meta, del);
    list.appendChild(li);
  }

  $("markCount").textContent = state.marks.reduce((n, m) => n + m.rects.length, 0);
  if (window.lucide) lucide.createIcons();
}

function flashMark(id) {
  const el = document.querySelector(`.mark-rect[data-mark-id="${id}"]`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.remove("flash");
  void el.offsetWidth;
  el.classList.add("flash");
}

// ==========================================================================
// APPLY, VERIFY, DOWNLOAD
// ==========================================================================

$("btnApply").addEventListener("click", applyRedactions);

async function applyRedactions() {
  if (!state.session) return;
  const sanitize = { ...DEFAULT_SANITIZE };
  document.querySelectorAll("[data-sanitize]").forEach(cb => { sanitize[cb.dataset.sanitize] = cb.checked; });

  const marks = state.marks.map(m => ({ page: m.page, rects: m.rects }));
  // Re-run a search during verification only if every hit is still marked;
  // otherwise hits the user deliberately kept would read as leaks.
  const searches = [...state.groups.values()].filter(g =>
    g.source && g.total > 0 && state.marks.filter(m => m.groupId === g.id).length === g.total
  );

  try {
    showLoading(`Applying redactions with ${ENGINES[state.engineName].label}…`);
    await nextFrame();
    const started = performance.now();
    const { bytes, removed } = await state.session.apply(marks, sanitize);
    const elapsed = performance.now() - started;

    showLoading("Re-opening the result to check for leftovers…");
    await nextFrame();
    const report = await state.engine.verify(bytes, marks, searches, sanitize);

    clearResult();
    const session = state.engine.open(bytes, { prepared: true });
    state.result = { bytes, session, run: { marks, searches, sanitize } };
    showResult(report, removed, marks, searches, elapsed);
    buildPageViews($("resultPages"), session, false);
  } catch (err) {
    console.error(err);
    alert("Redaction failed: " + err.message);
  } finally {
    hideLoading();
  }
}

function showResult(report, removed, marks, searches, elapsed) {
  const areas = marks.reduce((n, m) => n + m.rects.length, 0);
  const banner = $("resultBanner");
  banner.classList.toggle("fail", !report.ok);
  $("resultIcon").innerHTML = `<i data-lucide="${report.ok ? "shield-check" : "shield-alert"}" width="36" height="36"></i>`;
  $("resultTitle").textContent = report.ok ? "Redaction applied and verified" : "Check failed: review before using this file";

  const extras = [];
  if (removed.metadata) extras.push("metadata");
  if (removed.attachments) extras.push(`${removed.attachments} attachment(s)`);
  if (removed.scripts) extras.push("scripts");
  if (removed.bookmarks) extras.push("bookmarks");
  $("resultSummary").textContent =
    `${areas} area(s) redacted${extras.length ? `; removed ${extras.join(", ")}` : ""}. ` +
    (report.ok
      ? `The file was re-opened and none of the marked content${searches.length ? ` or the ${searches.length} search term(s)` : ""} can be found in it. This confirms removal, not that nothing was missed, so review the pages below.`
      : "The re-opened file still contains content that was marked for removal:");

  const problems = $("resultProblems");
  problems.innerHTML = "";
  for (const p of report.problems) {
    const li = document.createElement("li");
    li.textContent = p;
    problems.appendChild(li);
  }

  const engine = ENGINES[state.engineName];
  const other = ENGINES[otherEngineName()];
  $("resultEngine").textContent =
    `Engine: ${engine.label} (${engine.license}) · ${Math.round(elapsed)} ms · ${formatBytes(state.result.bytes.length)}`;
  $("crossCheckResult").textContent = "";
  $("crossCheckResult").className = "cross-check-result";
  $("btnCrossCheck").querySelector("span").textContent = `Cross-check with ${other.label}`;
  $("btnCrossCheck").disabled = false;

  $("btnDownload").querySelector("span").textContent = report.ok ? "Download redacted PDF" : "Download anyway";
  $("btnDownload").classList.toggle("btn-danger", !report.ok);
  $("btnDownload").classList.toggle("btn-primary", report.ok);

  $("workspace").classList.add("hidden");
  $("resultSection").classList.remove("hidden");
  window.scrollTo({ top: 0 });
  if (window.lucide) lucide.createIcons();
}

function otherEngineName() {
  return state.engineName === "mupdf" ? "pdfium" : "mupdf";
}

// Re-open the output with the other engine and run its own leak check. Two
// independent PDF parsers agreeing is stronger evidence than one.
$("btnCrossCheck").addEventListener("click", async () => {
  if (!state.result) return;
  const name = otherEngineName();
  const out = $("crossCheckResult");
  $("btnCrossCheck").disabled = true;
  out.className = "cross-check-result";
  out.textContent = `Loading ${ENGINES[name].label}…`;
  try {
    const engine = await getEngine(name);
    out.textContent = `Checking with ${ENGINES[name].label}…`;
    await nextFrame();
    const { marks, searches, sanitize } = state.result.run;
    const report = await engine.verify(state.result.bytes, marks, searches, sanitize);
    out.classList.add(report.ok ? "ok" : "fail");
    out.textContent = report.ok
      ? `${ENGINES[name].label} cross-check passed: it finds none of the marked content either.`
      : `${ENGINES[name].label} cross-check found problems: ${report.problems.join("; ")}`;
  } catch (err) {
    console.error(err);
    out.classList.add("fail");
    out.textContent = `Cross-check could not run: ${err.message}`;
    $("btnCrossCheck").disabled = false;
  }
});

function clearResult() {
  if (state.result) {
    state.result.session.destroy();
    state.result = null;
  }
  $("resultPages").innerHTML = "";
}

$("btnBackToEdit").addEventListener("click", () => {
  clearResult();
  $("resultSection").classList.add("hidden");
  $("workspace").classList.remove("hidden");
});

$("btnDownload").addEventListener("click", () => {
  if (!state.result) return;
  const blob = new Blob([state.result.bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = state.fileName.replace(/\.pdf$/i, "") + "-redacted.pdf";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
});

// ==========================================================================
// HELP MODAL & HELPERS
// ==========================================================================

$("btnShowHelp").addEventListener("click", () => $("helpModal").classList.remove("hidden"));
$("btnCloseHelpModal").addEventListener("click", () => $("helpModal").classList.add("hidden"));
$("helpModal").addEventListener("click", e => { if (e.target === $("helpModal")) $("helpModal").classList.add("hidden"); });
document.addEventListener("keydown", e => { if (e.key === "Escape") $("helpModal").classList.add("hidden"); });

function showLoading(msg) {
  $("loadingStatusText").textContent = msg;
  $("loadingOverlay").classList.remove("hidden");
}

function hideLoading() {
  $("loadingOverlay").classList.add("hidden");
}

// Let the browser paint the loading overlay before a long synchronous WASM
// call. A timeout rather than requestAnimationFrame, which never fires while
// the tab is in the background.
function nextFrame() {
  return new Promise(resolve => setTimeout(resolve, 50));
}

function formatBytes(bytes) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function truncate(s, n) {
  s = s.replace(/\s+/g, " ");
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function compactPages(pages) {
  return pages.length > 4 ? `${pages.slice(0, 3).join(", ")}…` : pages.join(", ");
}

if (window.lucide) lucide.createIcons();
