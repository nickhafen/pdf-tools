/**
 * App Controller - State Management, Event Handlers, & UI Synchronization
 */

document.addEventListener("DOMContentLoaded", () => {
  // Global Application State
  const state = {
    fileV1: null,
    fileV2: null,
    docV1Data: null,
    docV2Data: null,
    comparison: null,
    currentDiffIndex: 0,
    filteredDiffNodes: [],
    fontScale: 0.9,
    syncScroll: false, // side-by-side text panes scroll independently unless toggled on
    // Each pane is independently configurable: what to show (v1 / v2 /
    // redline) and how (formatted text / plain text / PDF canvas). Results
    // open in Compare Side-by-Side; in Single View only the right pane is
    // shown, full width.
    panes: {
      left: { content: "v1", display: "formatted", page: 1 },
      right: { content: "redline", display: "formatted", page: 1 }
    },
    pdfDocCache: {} // { v1: pdfjsDocument, v2: pdfjsDocument } to avoid re-parsing on every pane change
  };

  // DOM Elements
  const dropzoneV1 = document.getElementById("dropzoneV1");
  const dropzoneV2 = document.getElementById("dropzoneV2");
  const inputV1 = document.getElementById("inputV1");
  const inputV2 = document.getElementById("inputV2");
  const fileMetaV1 = document.getElementById("fileMetaV1");
  const fileMetaV2 = document.getElementById("fileMetaV2");
  const fileNameV1 = document.getElementById("fileNameV1");
  const fileNameV2 = document.getElementById("fileNameV2");
  const fileSizeV1 = document.getElementById("fileSizeV1");
  const fileSizeV2 = document.getElementById("fileSizeV2");
  const removeV1 = document.getElementById("removeV1");
  const removeV2 = document.getElementById("removeV2");
  
  const btnRunCompare = document.getElementById("btnRunCompare");
  const btnLoadSample = document.getElementById("btnLoadSample");
  const btnSampleDropdownToggle = document.getElementById("btnSampleDropdownToggle");
  const sampleDropdownMenu = document.getElementById("sampleDropdownMenu");
  const sampleDropdownList = document.getElementById("sampleDropdownList");
  const sampleDropdownFooter = document.getElementById("sampleDropdownFooter");
  const btnExportReport = document.getElementById("btnExportReport");
  const btnSwapDocs = document.getElementById("btnSwapDocs");
  const btnNewComparison = document.getElementById("btnNewComparison");
  const loadingOverlay = document.getElementById("loadingOverlay");
  const loadingStatusText = document.getElementById("loadingStatusText");

  const appToolbar = document.getElementById("appToolbar");
  const btnShowStats = document.getElementById("btnShowStats");
  const metricSimilarity = document.getElementById("metricSimilarity");
  const metricAdditions = document.getElementById("metricAdditions");
  const metricDeletions = document.getElementById("metricDeletions");
  const metricChanges = document.getElementById("metricChanges");
  const metricWordsV1 = document.getElementById("metricWordsV1");
  const metricWordsV2 = document.getElementById("metricWordsV2");

  const uploadSection = document.getElementById("uploadSection");
  const resultsSection = document.getElementById("resultsSection");
  const diffNavigator = document.getElementById("diffNavigator");

  const viewModeControl = document.getElementById("viewModeControl");
  const btnSyncScroll = document.getElementById("btnSyncScroll");
  const paneGrid = document.getElementById("paneGrid");
  const contentLeft = document.getElementById("content-left");
  const contentRight = document.getElementById("content-right");

  const btnPrevDiff = document.getElementById("btnPrevDiff");
  const btnNextDiff = document.getElementById("btnNextDiff");
  const diffCounter = document.getElementById("diffCounter");
  const diffSearchInput = document.getElementById("diffSearchInput");

  const btnFontDecrease = document.getElementById("btnFontDecrease");
  const btnFontIncrease = document.getElementById("btnFontIncrease");
  const fontSizeLabel = document.getElementById("fontSizeLabel");

  // Export Modal Elements
  const exportModal = document.getElementById("exportModal");
  const btnCloseExportModal = document.getElementById("btnCloseExportModal");
  const btnExportHTML = document.getElementById("btnExportHTML");
  const btnExportPDF = document.getElementById("btnExportPDF");
  const btnCopyText = document.getElementById("btnCopyText");

  // Stats & Help Modal Elements
  const statsModal = document.getElementById("statsModal");
  const btnCloseStatsModal = document.getElementById("btnCloseStatsModal");
  const helpModal = document.getElementById("helpModal");
  const btnShowHelp = document.getElementById("btnShowHelp");
  const btnCloseHelpModal = document.getElementById("btnCloseHelpModal");

  const btnJumpTop = document.getElementById("btnJumpTop");

  // Initialize Lucide Icons
  if (window.lucide) {
    lucide.createIcons();
  }

  // ==========================================================================
  // DROPZONE EVENT HANDLERS
  // ==========================================================================

  function setupDropzone(card, input, meta, nameEl, sizeEl, stateKey) {
    // Make entire dropzone card clickable (except file meta or remove button)
    card.addEventListener("click", (e) => {
      if (e.target.closest(".remove-file") || e.target.closest(".file-meta")) return;
      input.click();
    });

    input.addEventListener("change", (e) => {
      if (e.target.files && e.target.files.length > 0) {
        handleFileSelect(e.target.files[0], card, meta, nameEl, sizeEl, stateKey);
      }
    });

    card.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.stopPropagation();
      card.classList.add("drag-over");
    });

    card.addEventListener("dragleave", (e) => {
      e.preventDefault();
      e.stopPropagation();
      card.classList.remove("drag-over");
    });

    card.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      card.classList.remove("drag-over");
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleFileSelect(e.dataTransfer.files[0], card, meta, nameEl, sizeEl, stateKey);
      }
    });
  }

  // Prevent default drag/drop behavior on document body
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => e.preventDefault());

  // Initialize dropzones for Original (v1) and Revised (v2)
  setupDropzone(dropzoneV1, inputV1, fileMetaV1, fileNameV1, fileSizeV1, "fileV1");
  setupDropzone(dropzoneV2, inputV2, fileMetaV2, fileNameV2, fileSizeV2, "fileV2");

  function handleFileSelect(file, card, meta, nameEl, sizeEl, stateKey) {
    if (!file.type.includes("pdf") && !file.name.toLowerCase().endsWith(".pdf")) {
      alert("Please select a valid PDF file.");
      return;
    }

    state[stateKey] = file;
    nameEl.textContent = file.name;
    sizeEl.textContent = formatBytes(file.size);

    card.querySelector(".dropzone-content").classList.add("hidden");
    meta.classList.remove("hidden");

    checkCanCompare();
  }

  removeV1.addEventListener("click", () => clearFile("V1", dropzoneV1, fileMetaV1, inputV1));
  removeV2.addEventListener("click", () => clearFile("V2", dropzoneV2, fileMetaV2, inputV2));

  function clearFile(vKey, card, meta, input) {
    state[`file${vKey}`] = null;
    input.value = "";
    meta.classList.add("hidden");
    card.querySelector(".dropzone-content").classList.remove("hidden");
    checkCanCompare();
  }

  function checkCanCompare() {
    if (state.fileV1 && state.fileV2) {
      btnRunCompare.disabled = false;
    } else {
      btnRunCompare.disabled = true;
    }
  }

  function formatBytes(bytes) {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }

  // ==========================================================================
  // SAMPLE DEMO LOADER
  // ==========================================================================

  // Bundled synthetic demo pairs, generated by create_samples.py. The first
  // entry is what the main "Load Sample" button loads.
  const SAMPLES_DIR = "static/samples/";
  let sampleManifest = null;

  async function getSampleManifest() {
    if (!sampleManifest) {
      const res = await fetch(SAMPLES_DIR + "manifest.json");
      if (!res.ok) throw new Error("Could not retrieve the sample list.");
      sampleManifest = await res.json();
    }
    return sampleManifest;
  }

  function loadBundledSample(sample) {
    loadSamplePair(
      SAMPLES_DIR + sample.v1, sample.v1,
      SAMPLES_DIR + sample.v2, sample.v2
    );
  }

  btnLoadSample.addEventListener("click", async () => {
    // Clicking the main button is not an "outside click" relative to
    // #sampleSplitButton (it's inside that container), so the dropdown
    // wouldn't otherwise auto-close if it happened to be open.
    sampleDropdownMenu.classList.add("hidden");
    try {
      const samples = await getSampleManifest();
      loadBundledSample(samples[0]);
    } catch (err) {
      alert("Error loading demo samples: " + err.message);
    }
  });

  async function loadSamplePair(url1, name1, url2, name2) {
    try {
      showLoading("Fetching sample PDFs...");

      const res1 = await fetch(url1);
      const res2 = await fetch(url2);

      if (!res1.ok || !res2.ok) {
        throw new Error("Could not retrieve sample PDFs.");
      }

      const blob1 = await res1.blob();
      const blob2 = await res2.blob();

      state.fileV1 = new File([blob1], name1, { type: "application/pdf" });
      state.fileV2 = new File([blob2], name2, { type: "application/pdf" });

      fileNameV1.textContent = state.fileV1.name;
      fileSizeV1.textContent = formatBytes(state.fileV1.size);
      dropzoneV1.querySelector(".dropzone-content").classList.add("hidden");
      fileMetaV1.classList.remove("hidden");

      fileNameV2.textContent = state.fileV2.name;
      fileSizeV2.textContent = formatBytes(state.fileV2.size);
      dropzoneV2.querySelector(".dropzone-content").classList.add("hidden");
      fileMetaV2.classList.remove("hidden");

      checkCanCompare();
      await executeComparison();
    } catch (err) {
      alert("Error loading demo samples: " + err.message);
    } finally {
      hideLoading();
    }
  }

  // ==========================================================================
  // SAMPLE DROPDOWN (bundled samples + local test-documents/ pairs)
  // ==========================================================================

  if (btnSampleDropdownToggle) {
    btnSampleDropdownToggle.addEventListener("click", async (e) => {
      e.stopPropagation();
      const isHidden = sampleDropdownMenu.classList.contains("hidden");
      if (isHidden) {
        sampleDropdownMenu.classList.remove("hidden");
        await populateSampleDropdown();
      } else {
        sampleDropdownMenu.classList.add("hidden");
      }
    });

    document.addEventListener("click", (e) => {
      if (!sampleDropdownMenu.classList.contains("hidden") &&
          !e.target.closest("#sampleSplitButton")) {
        sampleDropdownMenu.classList.add("hidden");
      }
    });
  }

  // Returns the local test-documents/ pairs, or null when there is no local
  // server (the static GitHub Pages build).
  async function fetchLocalPairs() {
    try {
      const res = await fetch("api/samples/list");
      if (!res.ok) return null;
      return await res.json();
    } catch (err) {
      return null;
    }
  }

  function addDropdownHeader(text) {
    const header = document.createElement("div");
    header.className = "split-dropdown-header";
    header.textContent = text;
    sampleDropdownList.appendChild(header);
  }

  function addDropdownItem(title, description, onPick) {
    const item = document.createElement("button");
    item.className = "split-dropdown-item";
    item.textContent = title;
    if (description) {
      const desc = document.createElement("span");
      desc.className = "split-dropdown-item-desc";
      desc.textContent = description;
      item.appendChild(desc);
    }
    item.addEventListener("click", () => {
      sampleDropdownMenu.classList.add("hidden");
      onPick();
    });
    sampleDropdownList.appendChild(item);
  }

  function addDropdownNote(text) {
    const note = document.createElement("div");
    note.className = "split-dropdown-empty";
    note.textContent = text;
    sampleDropdownList.appendChild(note);
  }

  async function populateSampleDropdown() {
    sampleDropdownList.innerHTML = `<div class="split-dropdown-empty">Loading...</div>`;
    const [samples, localPairs] = await Promise.all([
      getSampleManifest().catch(() => null),
      fetchLocalPairs()
    ]);

    sampleDropdownList.innerHTML = "";
    addDropdownHeader("Sample Documents");
    if (samples && samples.length > 0) {
      samples.forEach(sample => {
        addDropdownItem(sample.title, sample.description, () => loadBundledSample(sample));
      });
    } else {
      addDropdownNote("Error loading the sample list.");
    }

    // Local-only pairs, and the hint on how to add them, appear only when
    // running from the local server.
    sampleDropdownFooter.classList.toggle("hidden", localPairs === null);
    if (localPairs === null) return;

    addDropdownHeader("Local Documents");
    if (localPairs.length === 0) {
      addDropdownNote("No pairs found in test-documents/");
      return;
    }
    localPairs.forEach(({ label }) => {
      addDropdownItem(label, null, () => loadSamplePair(
        `api/samples/testdoc/${encodeURIComponent(label)}/v1`, `${label}-v1.pdf`,
        `api/samples/testdoc/${encodeURIComponent(label)}/v2`, `${label}-v2.pdf`
      ));
    });
  }

  // ==========================================================================
  // RUN COMPARISON
  // ==========================================================================

  btnRunCompare.addEventListener("click", executeComparison);

  async function executeComparison() {
    if (!state.fileV1 || !state.fileV2) return;

    try {
      showLoading("Extracting PDF text streams...");
      
      // Step 1: Extract Document Text
      loadingStatusText.textContent = "Extracting text from Original PDF (v1)...";
      state.docV1Data = await window.pdfEngine.extractText(state.fileV1);

      loadingStatusText.textContent = "Extracting text from Revised PDF (v2)...";
      state.docV2Data = await window.pdfEngine.extractText(state.fileV2);

      // Step 2: Run Diff & Redline Processing Engine
      loadingStatusText.textContent = "Running word alignment & semantic diff cleanup...";
      state.comparison = await window.diffEngine.compareDocuments(
        state.fileV1,
        state.fileV2,
        state.docV1Data.full_text,
        state.docV2Data.full_text
      );
      state.comparison.docNameV1 = state.fileV1.name;
      state.comparison.docNameV2 = state.fileV2.name;

      // Step 3: Render Results in UI (fresh comparison -> reset pane defaults)
      renderResults(true);

    } catch (err) {
      console.error(err);
      alert("Error generating comparison: " + err.message);
    } finally {
      hideLoading();
    }
  }

  // ==========================================================================
  // SWAP DOCUMENTS
  // ==========================================================================

  btnSwapDocs.addEventListener("click", swapDocuments);

  async function swapDocuments() {
    if (!state.fileV1 || !state.fileV2) return;

    try {
      showLoading("Swapping v1 and v2...");

      [state.fileV1, state.fileV2] = [state.fileV2, state.fileV1];
      [state.docV1Data, state.docV2Data] = [state.docV2Data, state.docV1Data];
      state.pdfDocCache = {};

      // Refresh the upload-screen file cards too, in case the user goes back
      fileNameV1.textContent = state.fileV1.name;
      fileSizeV1.textContent = formatBytes(state.fileV1.size);
      fileNameV2.textContent = state.fileV2.name;
      fileSizeV2.textContent = formatBytes(state.fileV2.size);

      state.comparison = await window.diffEngine.compareDocuments(
        state.fileV1,
        state.fileV2,
        state.docV1Data.full_text,
        state.docV2Data.full_text
      );
      state.comparison.docNameV1 = state.fileV1.name;
      state.comparison.docNameV2 = state.fileV2.name;

      // Preserve the user's current view/pane configuration
      renderResults(false);
    } catch (err) {
      console.error(err);
      alert("Error swapping documents: " + err.message);
    } finally {
      hideLoading();
    }
  }

  // ==========================================================================
  // NEW COMPARISON / RESET
  // ==========================================================================

  btnNewComparison.addEventListener("click", resetToUploadScreen);

  function resetToUploadScreen() {
    state.fileV1 = null;
    state.fileV2 = null;
    state.docV1Data = null;
    state.docV2Data = null;
    state.comparison = null;
    state.pdfDocCache = {};
    state.filteredDiffNodes = [];
    state.currentDiffIndex = 0;

    clearFile("V1", dropzoneV1, fileMetaV1, inputV1);
    clearFile("V2", dropzoneV2, fileMetaV2, inputV2);

    resultsSection.classList.add("hidden");
    uploadSection.classList.remove("hidden");
    appToolbar.classList.add("hidden");
    btnShowStats.classList.add("hidden");
    btnSwapDocs.classList.add("hidden");
    btnNewComparison.classList.add("hidden");
    btnExportReport.classList.add("hidden");
    diffNavigator.classList.add("hidden");
    diffSearchInput.value = "";

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // `resetPanes` is true for a brand-new comparison (single view, redline
  // full width) and false when re-rendering after a swap, where the user's
  // current view/pane configuration should be preserved.
  function renderResults(resetPanes) {
    const comp = state.comparison;
    const stats = comp.statistics || {};

    // 1. Update Stats (shown on demand via the Stats modal)
    metricSimilarity.textContent = `${stats.similarity_score}%`;
    metricAdditions.textContent = `+${stats.additions_words}`;
    metricDeletions.textContent = `-${stats.deletions_words}`;
    metricChanges.textContent = stats.changes_count;
    metricWordsV1.textContent = stats.words_v1 ?? 0;
    metricWordsV2.textContent = stats.words_v2 ?? 0;

    appToolbar.classList.remove("hidden");
    btnShowStats.classList.remove("hidden");
    btnSwapDocs.classList.remove("hidden");
    btnNewComparison.classList.remove("hidden");
    btnExportReport.classList.remove("hidden");
    diffNavigator.classList.remove("hidden");

    if (resetPanes) {
      state.panes.left = { content: "v1", display: "formatted", page: 1 };
      state.panes.right = { content: "redline", display: "formatted", page: 1 };

      document.querySelector('.pane-content-select[data-pane="left"]').value = "v1";
      document.querySelector('.pane-display-select[data-pane="left"]').value = "formatted";
      document.querySelector('.pane-content-select[data-pane="right"]').value = "redline";
      document.querySelector('.pane-display-select[data-pane="right"]').value = "formatted";
      updatePaneOptionAvailability("left");
      updatePaneOptionAvailability("right");

      paneGrid.classList.remove("single-mode");
      viewModeControl.querySelectorAll(".segment-btn").forEach(b => b.classList.remove("active"));
      viewModeControl.querySelector('[data-view="double"]').classList.add("active");
      updateSyncToggleVisibility();
    }

    // Render Panes (each independently configurable)
    state.pdfDocCache = {};
    renderPane("left");
    renderPane("right");

    // Synchronize Pane Scrolling
    setupSynchronizedScroll();

    // Setup Diff Navigator State
    state.filteredDiffNodes = comp.diffNodes || [];
    state.currentDiffIndex = state.filteredDiffNodes.length > 0 ? 1 : 0;
    updateDiffNavigatorUI();
    updateDiffNavGating();

    // Show Results
    resultsSection.classList.remove("hidden");
    uploadSection.classList.add("hidden");
  }

  // ==========================================================================
  // SYNCHRONIZED SCROLLING (Sync Scroll toggle, side-by-side text panes)
  // ==========================================================================
  //
  // Panes are lined up by section heading rather than by percentage of
  // length: headings both panes share become anchor points, and between two
  // anchors each pane sits the same fraction of the way along. A long section
  // added in one version therefore doesn't pull the other pane out of step for
  // the rest of the document. With no shared headings this falls back to
  // plain percentage sync (the only anchors are the top and bottom).

  let syncHeadingPairs = null; // [[leftHeadingEl, rightHeadingEl], ...]; null = rebuild on next use
  let syncSuppressedUntil = 0; // performance.now() timestamp
  const ignoreNextScroll = new Set(); // panes whose next scroll event is our own write

  function setupSynchronizedScroll() {
    syncHeadingPairs = null;
    ignoreNextScroll.clear();
    contentLeft.onscroll = () => syncScrollFrom(contentLeft, contentRight);
    contentRight.onscroll = () => syncScrollFrom(contentRight, contentLeft);
  }

  function isScrollSyncActive() {
    return state.syncScroll
      && !paneGrid.classList.contains("single-mode")
      && state.panes.left.display !== "pdf"
      && state.panes.right.display !== "pdf";
  }

  function syncScrollFrom(src, tgt) {
    if (ignoreNextScroll.delete(src)) return; // echo of our own write: don't bounce it back
    if (!isScrollSyncActive() || performance.now() < syncSuppressedUntil) return;

    const target = mapScrollPosition(src, tgt);
    const before = tgt.scrollTop;
    if (Math.abs(before - target) < 1) return;
    ignoreNextScroll.add(tgt);
    tgt.scrollTop = target;
    // If the write was clamped/rounded to no change, no scroll event will come to clear the flag.
    if (tgt.scrollTop === before) ignoreNextScroll.delete(tgt);
  }

  function mapScrollPosition(src, tgt) {
    const srcMax = src.scrollHeight - src.clientHeight;
    const tgtMax = tgt.scrollHeight - tgt.clientHeight;
    if (srcMax <= 0 || tgtMax <= 0) return 0;

    if (!syncHeadingPairs) syncHeadingPairs = matchHeadings();
    const srcIdx = src === contentLeft ? 0 : 1;

    // Anchors are [srcPos, tgtPos], kept strictly increasing on both sides
    // (and within scroll range) so the mapping never runs backwards and
    // maps the same way in either direction.
    const anchors = [[0, 0]];
    for (const pair of syncHeadingPairs) {
      const s = offsetWithin(pair[srcIdx], src);
      const t = offsetWithin(pair[1 - srcIdx], tgt);
      const [lastS, lastT] = anchors[anchors.length - 1];
      if (s > lastS && t > lastT && s < srcMax && t < tgtMax) anchors.push([s, t]);
    }
    anchors.push([srcMax, tgtMax]);

    const pos = src.scrollTop;
    let i = 0;
    while (i < anchors.length - 2 && pos >= anchors[i + 1][0]) i++;
    const [s0, t0] = anchors[i];
    const [s1, t1] = anchors[i + 1];
    const frac = s1 > s0 ? (pos - s0) / (s1 - s0) : 0;
    return Math.min(tgtMax, Math.max(0, t0 + frac * (t1 - t0)));
  }

  // Position of el's top within container's scrollable content.
  function offsetWithin(el, container) {
    return el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
  }

  // Pair up the headings both panes share, in document order (longest common
  // subsequence), so a heading added, deleted or reworded in one version is
  // skipped rather than knocking every later pair out of line.
  function matchHeadings() {
    const left = headingKeys("left");
    const right = headingKeys("right");
    const n = left.length, m = right.length;
    const same = (i, j) => left[i].key !== "" && left[i].key === right[j].key;

    const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i][j] = same(i, j) ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
      }
    }

    const pairs = [];
    for (let i = 0, j = 0; i < n && j < m;) {
      if (same(i, j)) { pairs.push([left[i].el, right[j].el]); i++; j++; }
      else if (lcs[i + 1][j] >= lcs[i][j + 1]) i++;
      else j++;
    }
    return pairs;
  }

  // A pane's headings as comparable text keys. A Redline heading carries
  // both versions' wording, so it is read in whichever version the other
  // pane shows: against v1, insertions are dropped; otherwise deletions are.
  function headingKeys(side) {
    const other = side === "left" ? "right" : "left";
    const content = state.panes[side].content;
    const version = content !== "redline" ? content
      : state.panes[other].content === "v1" ? "v1" : "v2";
    const container = side === "left" ? contentLeft : contentRight;

    return [...container.querySelectorAll(".redline-heading, .plain-heading")].map(el => {
      const clone = el.cloneNode(true);
      clone.querySelectorAll(version === "v1" ? "ins" : "del").forEach(n => n.remove());
      return { el, key: clone.textContent.replace(/[^a-z0-9]+/gi, " ").trim().toLowerCase() };
    });
  }

  // ==========================================================================
  // VIEW MODE SWITCHER (Single View <-> Compare Side-by-Side)
  // ==========================================================================

  viewModeControl.addEventListener("click", (e) => {
    const btn = e.target.closest(".segment-btn");
    if (!btn) return;

    viewModeControl.querySelectorAll(".segment-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");

    paneGrid.classList.toggle("single-mode", btn.dataset.view === "single");
    updateSyncToggleVisibility();
    updateDiffNavGating();
  });

  // Sync Scroll only applies with two panes on screen.
  function updateSyncToggleVisibility() {
    btnSyncScroll.classList.toggle("hidden", paneGrid.classList.contains("single-mode"));
  }

  btnSyncScroll.addEventListener("click", () => {
    state.syncScroll = !state.syncScroll;
    btnSyncScroll.setAttribute("aria-pressed", String(state.syncScroll));
    // Line the right pane up with the left one right away.
    if (isScrollSyncActive()) {
      ignoreNextScroll.clear();
      syncScrollFrom(contentLeft, contentRight);
    }
  });

  // ==========================================================================
  // SIDE-BY-SIDE PANE CONTROLS (content: v1/v2/redline, display: formatted/plain/pdf)
  // ==========================================================================

  document.querySelectorAll(".pane-content-select").forEach(select => {
    select.addEventListener("change", (e) => {
      const side = e.target.dataset.pane;
      state.panes[side].content = e.target.value;
      updatePaneOptionAvailability(side);
      renderPane(side);
      updateDiffNavGating();
    });
  });

  document.querySelectorAll(".pane-display-select").forEach(select => {
    select.addEventListener("change", (e) => {
      const side = e.target.dataset.pane;
      state.panes[side].display = e.target.value;
      renderPane(side);
    });
  });

  document.querySelectorAll(".pane-page-prev").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const side = e.target.closest("[data-pane]").dataset.pane;
      if (state.panes[side].page > 1) {
        state.panes[side].page--;
        renderPane(side);
      }
    });
  });

  document.querySelectorAll(".pane-page-next").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const side = e.target.closest("[data-pane]").dataset.pane;
      state.panes[side].page++;
      renderPane(side);
    });
  });

  // A PDF Canvas view only makes sense for an actual PDF (v1/v2), not a
  // redline markup, so disable that option while "Redline" is selected.
  function updatePaneOptionAvailability(side) {
    const displaySelect = document.querySelector(`.pane-display-select[data-pane="${side}"]`);
    const pdfOption = displaySelect.querySelector('option[value="pdf"]');
    const isRedline = state.panes[side].content === "redline";

    pdfOption.disabled = isRedline;
    if (isRedline && state.panes[side].display === "pdf") {
      state.panes[side].display = "formatted";
      displaySelect.value = "formatted";
    }
  }

  function renderPane(side) {
    const config = state.panes[side];
    syncHeadingPairs = null; // pane content changed: re-pair headings for Sync Scroll
    const paneEl = document.querySelector(`.side-pane[data-pane="${side}"]`);
    const textEl = document.getElementById(`content-${side}`);
    const canvasWrapper = paneEl.querySelector(".pane-canvas-wrapper");
    const pageNav = paneEl.querySelector(".pane-page-nav");

    if (config.display === "pdf") {
      textEl.classList.add("hidden");
      canvasWrapper.classList.remove("hidden");
      pageNav.classList.remove("hidden");
      renderPaneCanvas(side);
      return;
    }

    canvasWrapper.classList.add("hidden");
    pageNav.classList.add("hidden");
    textEl.classList.remove("hidden");

    let escapedHtml;

    if (config.content === "redline") {
      escapedHtml = state.comparison ? state.comparison.redlineRawHtml : "";
    } else {
      const docData = config.content === "v1" ? state.docV1Data : state.docV2Data;
      escapedHtml = window.diffEngine.escapeForView(docData ? docData.full_text : "");
    }

    textEl.innerHTML = config.display === "plain"
      ? window.diffEngine.formatPlainView(escapedHtml)
      : window.diffEngine.formatFormattedView(escapedHtml);
  }

  async function getOrLoadPdfDoc(version) {
    if (state.pdfDocCache[version]) return state.pdfDocCache[version];
    const file = version === "v1" ? state.fileV1 : state.fileV2;
    if (!file) return null;
    const pdfjsLib = await window.pdfjsReady.catch(() => null);
    if (!pdfjsLib) return null;
    const arrayBuffer = await file.arrayBuffer();
    const doc = await pdfjsLib.getDocument({ data: arrayBuffer, isEvalSupported: false }).promise;
    state.pdfDocCache[version] = doc;
    return doc;
  }

  async function renderPaneCanvas(side) {
    const config = state.panes[side];
    if (config.content === "redline") return; // PDF option is disabled for redline

    const pageNumEl = document.querySelector(`.pane-page-num[data-pane="${side}"]`);
    const canvas = document.getElementById(`canvas-${side}`);

    try {
      const pdfDoc = await getOrLoadPdfDoc(config.content);
      if (!pdfDoc || !canvas) return;

      if (config.page > pdfDoc.numPages) config.page = pdfDoc.numPages;
      if (config.page < 1) config.page = 1;

      pageNumEl.textContent = `${config.page} / ${pdfDoc.numPages}`;

      const page = await pdfDoc.getPage(config.page);
      const context = canvas.getContext("2d");
      const viewport = page.getViewport({ scale: 1.3 });

      canvas.width = viewport.width;
      canvas.height = viewport.height;

      // Renders the original PDF page as-is — no diff overlay. Use the
      // Redline content (Formatted/Plain Text) to see tracked changes.
      await page.render({ canvasContext: context, viewport }).promise;
    } catch (e) {
      console.warn(`PDF canvas rendering error (${side}):`, e);
    }
  }

  // ==========================================================================
  // DIFF NAVIGATOR & JUMP LOGIC
  // ==========================================================================

  btnNextDiff.addEventListener("click", () => jumpDiff(1));
  btnPrevDiff.addEventListener("click", () => jumpDiff(-1));

  function jumpDiff(direction) {
    if (state.filteredDiffNodes.length === 0) return;

    state.currentDiffIndex += direction;
    if (state.currentDiffIndex > state.filteredDiffNodes.length) {
      state.currentDiffIndex = 1; // Wrap around
    } else if (state.currentDiffIndex < 1) {
      state.currentDiffIndex = state.filteredDiffNodes.length;
    }

    updateDiffNavigatorUI();
    scrollToCurrentDiff();
  }

  function updateDiffNavigatorUI() {
    const total = state.filteredDiffNodes.length;
    if (total === 0) {
      diffCounter.textContent = "0 changes";
    } else {
      diffCounter.textContent = `Change ${state.currentDiffIndex} of ${total}`;
    }
  }

  // The change navigator only makes sense when the Redline is actually
  // visible somewhere (Single View's one pane, or either pane in Compare
  // Side-by-Side) — otherwise there's nothing on screen to jump to.
  function isRedlineVisible() {
    const isDouble = !paneGrid.classList.contains("single-mode");
    if (isDouble && state.panes.left.content === "redline") return true;
    return state.panes.right.content === "redline";
  }

  function updateDiffNavGating() {
    const active = isRedlineVisible() && state.filteredDiffNodes.length > 0;
    diffNavigator.classList.toggle("inactive", !active);
    btnPrevDiff.disabled = !active;
    btnNextDiff.disabled = !active;
  }

  function scrollToCurrentDiff() {
    if (!isRedlineVisible() || state.filteredDiffNodes.length === 0) return;
    const targetNodeData = state.filteredDiffNodes[state.currentDiffIndex - 1];
    if (!targetNodeData) return;

    // Remove glow from previous diffs
    document.querySelectorAll(".active-diff-glow").forEach(el => el.classList.remove("active-diff-glow"));

    // The same diff-id can appear in more than one pane at once (e.g. both
    // panes showing Redline), so glow/scroll every match, not just one.
    const scrolled = new Set();
    targetNodeData.ids.forEach(diffId => {
      document.querySelectorAll(`[data-diff-id="${diffId}"]`).forEach(el => {
        el.classList.add("active-diff-glow");
        const container = el.closest(".side-scroll-body");
        if (container) {
          const offsetTop = el.offsetTop - container.offsetTop - 80;
          container.scrollTo({ top: Math.max(0, offsetTop), behavior: "smooth" });
          scrolled.add(container);
        }
      });
    });
    // Both panes are already heading to the change; Sync Scroll would only
    // interrupt their smooth scrolls by dragging each toward the other.
    if (scrolled.size > 1) syncSuppressedUntil = performance.now() + 1500;
  }

  // Keyboard Shortcuts (Shift+J / Shift+K)
  document.addEventListener("keydown", (e) => {
    if (resultsSection.classList.contains("hidden")) return;
    if (e.shiftKey && e.key.toLowerCase() === "j") {
      e.preventDefault();
      jumpDiff(1);
    } else if (e.shiftKey && e.key.toLowerCase() === "k") {
      e.preventDefault();
      jumpDiff(-1);
    }
  });

  // Search Listener
  diffSearchInput.addEventListener("input", filterDiffs);

  function filterDiffs() {
    if (!state.comparison || !state.comparison.diffNodes) return;

    const searchVal = diffSearchInput.value.toLowerCase().trim();

    state.filteredDiffNodes = state.comparison.diffNodes.filter(node =>
      !searchVal || node.text.toLowerCase().includes(searchVal)
    );

    state.currentDiffIndex = state.filteredDiffNodes.length > 0 ? 1 : 0;
    updateDiffNavigatorUI();
    updateDiffNavGating();
    if (state.filteredDiffNodes.length > 0) {
      scrollToCurrentDiff();
    }
  }

  // ==========================================================================
  // EXPORT MODAL & ACTIONS
  // ==========================================================================

  btnExportReport.addEventListener("click", () => exportModal.classList.remove("hidden"));
  btnCloseExportModal.addEventListener("click", () => exportModal.classList.add("hidden"));

  btnExportHTML.addEventListener("click", () => {
    if (state.comparison) window.exportUtil.exportStandaloneHTML(state.comparison);
    exportModal.classList.add("hidden");
  });

  btnExportPDF.addEventListener("click", async () => {
    exportModal.classList.add("hidden");
    if (!state.comparison) return;
    try {
      showLoading("Building PDF...");
      await window.exportUtil.exportRedlinePDF(state.comparison);
    } catch (err) {
      console.error(err);
      alert("Error generating PDF: " + err.message);
    } finally {
      hideLoading();
    }
  });

  btnCopyText.addEventListener("click", async () => {
    if (state.comparison) {
      await window.exportUtil.copyPlaintextRedline(state.comparison);
      alert("Plaintext redline copied to clipboard!");
    }
    exportModal.classList.add("hidden");
  });

  // ==========================================================================
  // STATS MODAL
  // ==========================================================================

  btnShowStats.addEventListener("click", () => statsModal.classList.remove("hidden"));
  btnCloseStatsModal.addEventListener("click", () => statsModal.classList.add("hidden"));
  statsModal.addEventListener("click", (e) => {
    if (e.target === statsModal) statsModal.classList.add("hidden");
  });

  // ==========================================================================
  // PRIVACY & HELP MODAL
  // ==========================================================================

  btnShowHelp.addEventListener("click", () => helpModal.classList.remove("hidden"));
  btnCloseHelpModal.addEventListener("click", () => helpModal.classList.add("hidden"));
  helpModal.addEventListener("click", (e) => {
    if (e.target === helpModal) helpModal.classList.add("hidden");
  });

  // Esc closes whichever modal is currently open
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    document.querySelectorAll(".modal-backdrop:not(.hidden)").forEach(modal => {
      modal.classList.add("hidden");
    });
  });

  // ==========================================================================
  // JUMP TO TOP
  // ==========================================================================

  window.addEventListener("scroll", () => {
    if (window.scrollY > 320) {
      btnJumpTop.classList.remove("hidden");
    } else {
      btnJumpTop.classList.add("hidden");
    }
  });

  btnJumpTop.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  // ==========================================================================
  // TEXT SIZE CONTROL (Formatted/Plain Text panes only — PDF Canvas is unaffected)
  // ==========================================================================

  const FONT_SCALE_MIN = 0.7;
  const FONT_SCALE_MAX = 1.6;
  const FONT_SCALE_STEP = 0.1;

  function applyFontScale() {
    document.documentElement.style.setProperty("--content-font-scale", state.fontScale.toFixed(2));
    fontSizeLabel.textContent = `${Math.round(state.fontScale * 100)}%`;
  }

  btnFontDecrease.addEventListener("click", () => {
    state.fontScale = Math.max(FONT_SCALE_MIN, +(state.fontScale - FONT_SCALE_STEP).toFixed(2));
    applyFontScale();
  });

  btnFontIncrease.addEventListener("click", () => {
    state.fontScale = Math.min(FONT_SCALE_MAX, +(state.fontScale + FONT_SCALE_STEP).toFixed(2));
    applyFontScale();
  });

  applyFontScale();

  // Helpers
  function showLoading(msg) {
    loadingStatusText.textContent = msg || "Processing...";
    loadingOverlay.classList.remove("hidden");
  }

  function hideLoading() {
    loadingOverlay.classList.add("hidden");
  }
});
