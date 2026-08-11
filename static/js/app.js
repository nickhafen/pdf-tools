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
    activeView: "unified",
    currentDiffIndex: 0,
    filteredDiffNodes: [],
    // Each side-by-side pane is independently configurable: what to show
    // (v1 / v2 / redline) and how (formatted text / plain text / PDF canvas).
    panes: {
      left: { content: "v1", display: "formatted", page: 1 },
      right: { content: "v2", display: "formatted", page: 1 }
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
  const btnExportReport = document.getElementById("btnExportReport");
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
  const unifiedRedlineContent = document.getElementById("unifiedRedlineContent");
  const contentLeft = document.getElementById("content-left");
  const contentRight = document.getElementById("content-right");

  const btnPrevDiff = document.getElementById("btnPrevDiff");
  const btnNextDiff = document.getElementById("btnNextDiff");
  const diffCounter = document.getElementById("diffCounter");
  const diffFilterSelect = document.getElementById("diffFilterSelect");
  const diffSearchInput = document.getElementById("diffSearchInput");

  // Export Modal Elements
  const exportModal = document.getElementById("exportModal");
  const btnCloseExportModal = document.getElementById("btnCloseExportModal");
  const btnExportHTML = document.getElementById("btnExportHTML");
  const btnExportPrint = document.getElementById("btnExportPrint");
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

  btnLoadSample.addEventListener("click", () => {
    loadSamplePair(
      "/api/samples/contract_v1", "sample_contract_v1.pdf",
      "/api/samples/contract_v2", "sample_contract_v2.pdf"
    );
  });

  async function loadSamplePair(url1, name1, url2, name2) {
    try {
      showLoading("Fetching sample contract PDFs...");

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
  // SAMPLE DROPDOWN (local test-documents/ pairs)
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

  async function populateSampleDropdown() {
    sampleDropdownList.innerHTML = `<div class="split-dropdown-empty">Loading...</div>`;
    try {
      const res = await fetch("/api/samples/list");
      if (!res.ok) throw new Error("Could not list local demo documents.");
      const pairs = await res.json();

      if (!pairs || pairs.length === 0) {
        sampleDropdownList.innerHTML = `<div class="split-dropdown-empty">No demo pairs found in test-documents/</div>`;
        return;
      }

      sampleDropdownList.innerHTML = "";
      pairs.forEach(({ label }) => {
        const item = document.createElement("button");
        item.className = "split-dropdown-item";
        item.textContent = label;
        item.addEventListener("click", () => {
          sampleDropdownMenu.classList.add("hidden");
          loadSamplePair(
            `/api/samples/testdoc/${encodeURIComponent(label)}/v1`, `${label}-v1.pdf`,
            `/api/samples/testdoc/${encodeURIComponent(label)}/v2`, `${label}-v2.pdf`
          );
        });
        sampleDropdownList.appendChild(item);
      });
    } catch (err) {
      sampleDropdownList.innerHTML = `<div class="split-dropdown-empty">Error loading demo list.</div>`;
    }
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

      // Step 3: Render Results in UI
      renderResults();

    } catch (err) {
      console.error(err);
      alert("Error generating comparison: " + err.message);
    } finally {
      hideLoading();
    }
  }

  function renderResults() {
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
    btnExportReport.classList.remove("hidden");
    diffNavigator.classList.remove("hidden");

    // 2. Render Unified Redline Content
    unifiedRedlineContent.innerHTML = comp.redlineHtml || "<p>No differences found.</p>";

    // 3. Render Side-by-Side Panes (each independently configurable)
    state.pdfDocCache = {};
    renderPane("left");
    renderPane("right");

    // Synchronize Side-by-Side Scrolling
    setupSynchronizedScroll();

    // 4. Setup Diff Navigator State
    state.filteredDiffNodes = comp.diffNodes || [];
    state.currentDiffIndex = state.filteredDiffNodes.length > 0 ? 1 : 0;
    updateDiffNavigatorUI();

    // 5. Show Results View Panel
    resultsSection.classList.remove("hidden");
    uploadSection.classList.add("hidden");
  }

  // ==========================================================================
  // SYNCHRONIZED SCROLLING
  // ==========================================================================

  function setupSynchronizedScroll() {
    let isSyncingLeft = false;
    let isSyncingRight = false;

    contentLeft.onscroll = () => {
      if (!isSyncingLeft) {
        isSyncingRight = true;
        const percentage = contentLeft.scrollTop / (contentLeft.scrollHeight - contentLeft.clientHeight || 1);
        contentRight.scrollTop = percentage * (contentRight.scrollHeight - contentRight.clientHeight);
      }
      isSyncingLeft = false;
    };

    contentRight.onscroll = () => {
      if (!isSyncingRight) {
        isSyncingLeft = true;
        const percentage = contentRight.scrollTop / (contentRight.scrollHeight - contentRight.clientHeight || 1);
        contentLeft.scrollTop = percentage * (contentLeft.scrollHeight - contentLeft.clientHeight);
      }
      isSyncingRight = false;
    };
  }

  // ==========================================================================
  // VIEW MODE SWITCHER
  // ==========================================================================

  // Main 2 View Controls: Unified Redline vs Side-by-Side
  viewModeControl.addEventListener("click", (e) => {
    const btn = e.target.closest(".segment-btn");
    if (!btn) return;

    viewModeControl.querySelectorAll(".segment-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");

    const viewName = btn.dataset.view;
    state.activeView = viewName;

    document.querySelectorAll(".view-panel").forEach(p => p.classList.remove("active"));

    if (viewName === "unified") {
      document.getElementById("viewUnified").classList.add("active");
    } else if (viewName === "sidebyside") {
      document.getElementById("viewSideBySide").classList.add("active");
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
    const paneEl = document.querySelector(`.side-pane[data-pane="${side}"]`);
    const textEl = document.getElementById(`content-${side}`);
    const canvasWrapper = paneEl.querySelector(".pane-canvas-wrapper");
    const pageNav = paneEl.querySelector(".pane-page-nav");
    const pageBadge = document.getElementById(`panePageCount-${side}`);

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
    let pageLabel = "";

    if (config.content === "redline") {
      escapedHtml = state.comparison ? state.comparison.redlineRawHtml : "";
      pageLabel = "redline";
    } else {
      const docData = config.content === "v1" ? state.docV1Data : state.docV2Data;
      escapedHtml = window.diffEngine.escapeForView(docData ? docData.full_text : "");
      pageLabel = docData ? `${docData.page_count} page${docData.page_count === 1 ? "" : "s"}` : "-- pages";
    }

    textEl.innerHTML = config.display === "plain"
      ? window.diffEngine.formatPlainView(escapedHtml)
      : window.diffEngine.formatFormattedView(escapedHtml);

    pageBadge.textContent = pageLabel;
  }

  async function getOrLoadPdfDoc(version) {
    if (state.pdfDocCache[version]) return state.pdfDocCache[version];
    const file = version === "v1" ? state.fileV1 : state.fileV2;
    if (!file || !window.pdfjsLib) return null;
    const arrayBuffer = await file.arrayBuffer();
    const doc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    state.pdfDocCache[version] = doc;
    return doc;
  }

  async function renderPaneCanvas(side) {
    const config = state.panes[side];
    if (config.content === "redline") return; // PDF option is disabled for redline

    const pageBadge = document.getElementById(`panePageCount-${side}`);
    const pageNumEl = document.querySelector(`.pane-page-num[data-pane="${side}"]`);
    const canvas = document.getElementById(`canvas-${side}`);

    try {
      const pdfDoc = await getOrLoadPdfDoc(config.content);
      if (!pdfDoc || !canvas) return;

      if (config.page > pdfDoc.numPages) config.page = pdfDoc.numPages;
      if (config.page < 1) config.page = 1;

      pageBadge.textContent = `${pdfDoc.numPages} page${pdfDoc.numPages === 1 ? "" : "s"}`;
      pageNumEl.textContent = `${config.page} / ${pdfDoc.numPages}`;

      const page = await pdfDoc.getPage(config.page);
      const context = canvas.getContext("2d");
      const viewport = page.getViewport({ scale: 1.3 });

      canvas.width = viewport.width;
      canvas.height = viewport.height;

      await page.render({ canvasContext: context, viewport }).promise;

      const diffType = config.content === "v1" ? "DELETE" : "INSERT";
      if (state.comparison && state.comparison.diffs) {
        await highlightCanvasDiffs(page, viewport, context, diffType);
      }
    } catch (e) {
      console.warn(`PDF canvas rendering error (${side}):`, e);
    }
  }

  async function highlightCanvasDiffs(pdfPage, viewport, context, diffType) {
    const textContent = await pdfPage.getTextContent();

    // Build array of significant change tokens (min 3 chars to prevent false positives)
    const targetDiffs = state.comparison.diffs
      .filter(t => t.op === diffType)
      .map(t => t.text.toLowerCase().trim())
      .filter(t => t.length >= 3);

    if (targetDiffs.length === 0) return;

    context.save();
    context.fillStyle = diffType === "DELETE" ? "rgba(239, 68, 68, 0.3)" : "rgba(16, 185, 129, 0.3)";
    context.strokeStyle = diffType === "DELETE" ? "#EF4444" : "#10B981";
    context.lineWidth = 1.5;

    textContent.items.forEach(item => {
      const itemText = item.str.toLowerCase().trim();
      if (!itemText || itemText.length < 3) return;

      const isMatch = targetDiffs.some(dt => dt.split(/\s+/).includes(itemText));
      if (isMatch) {
        const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
        const fontHeight = Math.sqrt(tx[2] * tx[2] + tx[3] * tx[3]);
        const x = tx[4];
        const y = tx[5] - fontHeight;
        const w = (item.width || 30) * viewport.scale;
        const h = fontHeight * 1.1;

        context.fillRect(x, y, w, h);
        context.strokeRect(x, y, w, h);
      }
    });

    context.restore();
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

  function scrollToCurrentDiff() {
    if (state.filteredDiffNodes.length === 0) return;
    const targetNodeData = state.filteredDiffNodes[state.currentDiffIndex - 1];
    if (!targetNodeData) return;

    // Remove glow from previous diffs
    document.querySelectorAll(".active-diff-glow").forEach(el => el.classList.remove("active-diff-glow"));

    const ids = targetNodeData.ids || [targetNodeData.id];
    const targetEls = ids.map(id => document.getElementById(id)).filter(Boolean);
    if (targetEls.length === 0) return;

    targetEls.forEach(el => el.classList.add("active-diff-glow"));

    // Scroll container to the first element in the group
    const container = document.getElementById("unifiedRedlineContent");
    const firstEl = targetEls[0];
    if (container && container.contains(firstEl)) {
      const offsetTop = firstEl.offsetTop - container.offsetTop - 80;
      container.scrollTo({ top: Math.max(0, offsetTop), behavior: "smooth" });
    }
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

  // Search & Filter Listeners
  diffFilterSelect.addEventListener("change", filterDiffs);
  diffSearchInput.addEventListener("input", filterDiffs);

  function filterDiffs() {
    if (!state.comparison || !state.comparison.diffNodes) return;

    const filterVal = diffFilterSelect.value;
    const searchVal = diffSearchInput.value.toLowerCase().trim();

    state.filteredDiffNodes = state.comparison.diffNodes.filter(node => {
      // "replace" groups contain both a deletion and an insertion, so they
      // match either filter.
      const matchesType = (filterVal === "all") ||
        (filterVal === "insert" && (node.type === "insert" || node.type === "replace")) ||
        (filterVal === "delete" && (node.type === "delete" || node.type === "replace"));

      const matchesQuery = !searchVal || node.text.toLowerCase().includes(searchVal);

      return matchesType && matchesQuery;
    });

    state.currentDiffIndex = state.filteredDiffNodes.length > 0 ? 1 : 0;
    updateDiffNavigatorUI();
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

  btnExportPrint.addEventListener("click", () => {
    exportModal.classList.add("hidden");
    window.exportUtil.triggerPrint();
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

  // Helpers
  function showLoading(msg) {
    loadingStatusText.textContent = msg || "Processing...";
    loadingOverlay.classList.remove("hidden");
  }

  function hideLoading() {
    loadingOverlay.classList.add("hidden");
  }
});
