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
    currentVisualPage: 1
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
  const btnExportReport = document.getElementById("btnExportReport");
  const loadingOverlay = document.getElementById("loadingOverlay");
  const loadingStatusText = document.getElementById("loadingStatusText");

  const headerMetrics = document.getElementById("headerMetrics");
  const metricSimilarity = document.getElementById("metricSimilarity");
  const metricAdditions = document.getElementById("metricAdditions");
  const metricDeletions = document.getElementById("metricDeletions");
  const metricChanges = document.getElementById("metricChanges");

  const uploadSection = document.getElementById("uploadSection");
  const resultsSection = document.getElementById("resultsSection");
  const diffNavigator = document.getElementById("diffNavigator");

  const viewModeControl = document.getElementById("viewModeControl");
  const unifiedRedlineContent = document.getElementById("unifiedRedlineContent");
  const contentLeft = document.getElementById("contentLeft");
  const contentRight = document.getElementById("contentRight");
  const paneTitleV1 = document.getElementById("paneTitleV1");
  const paneTitleV2 = document.getElementById("paneTitleV2");

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

  btnLoadSample.addEventListener("click", async () => {
    try {
      showLoading("Fetching sample contract PDFs...");
      
      const res1 = await fetch("/api/samples/contract_v1");
      const res2 = await fetch("/api/samples/contract_v2");

      if (!res1.ok || !res2.ok) {
        throw new Error("Could not retrieve sample PDFs.");
      }

      const blob1 = await res1.blob();
      const blob2 = await res2.blob();

      state.fileV1 = new File([blob1], "sample_contract_v1.pdf", { type: "application/pdf" });
      state.fileV2 = new File([blob2], "sample_contract_v2.pdf", { type: "application/pdf" });

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
  });

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

    // 1. Update Header Metrics
    metricSimilarity.textContent = `${stats.similarity_score}%`;
    metricAdditions.textContent = `+${stats.additions_words}`;
    metricDeletions.textContent = `-${stats.deletions_words}`;
    metricChanges.textContent = stats.changes_count;

    headerMetrics.classList.remove("hidden");
    btnExportReport.classList.remove("hidden");
    diffNavigator.classList.remove("hidden");

    // 2. Render Unified Redline Content
    unifiedRedlineContent.innerHTML = comp.redlineHtml || "<p>No differences found.</p>";

    // 3. Render Side-by-Side Content
    paneTitleV1.textContent = state.fileV1 ? state.fileV1.name : "Original (v1)";
    paneTitleV2.textContent = state.fileV2 ? state.fileV2.name : "Revised (v2)";
    contentLeft.innerHTML = comp.sideBySideData ? comp.sideBySideData.leftHtml : "";
    contentRight.innerHTML = comp.sideBySideData ? comp.sideBySideData.rightHtml : "";

    // Synchronize Side-by-Side Scrolling
    setupSynchronizedScroll();

    // 4. Setup Diff Navigator State
    state.filteredDiffNodes = comp.diffNodes || [];
    state.currentDiffIndex = state.filteredDiffNodes.length > 0 ? 1 : 0;
    updateDiffNavigatorUI();

    // 5. Show Results View Panel
    resultsSection.classList.remove("hidden");
    uploadSection.classList.add("hidden");

    // Render Visual Canvases if active
    if (state.activeView === "visual") {
      renderVisualCanvases();
    }
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
  // VIEW MODE SWITCHER & SUB-TOGGLE
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

  // Sub-Toggle inside Side-by-Side: Formatted Text vs PDF Canvas View
  const sideBySideSubToggle = document.getElementById("sideBySideSubToggle");
  const sideTextGrid = document.getElementById("sideTextGrid");
  const sidePdfGrid = document.getElementById("sidePdfGrid");
  const canvasPageNav = document.getElementById("canvasPageNav");

  if (sideBySideSubToggle) {
    sideBySideSubToggle.addEventListener("click", (e) => {
      const btn = e.target.closest(".sub-segment-btn");
      if (!btn) return;

      sideBySideSubToggle.querySelectorAll(".sub-segment-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      const subView = btn.dataset.subview;

      if (subView === "text") {
        sideTextGrid.classList.remove("hidden");
        sidePdfGrid.classList.add("hidden");
        canvasPageNav.classList.add("hidden");
      } else if (subView === "pdf") {
        sideTextGrid.classList.add("hidden");
        sidePdfGrid.classList.remove("hidden");
        canvasPageNav.classList.remove("hidden");
        renderVisualCanvases();
      }
    });
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

    const targetEl = document.getElementById(targetNodeData.id);
    if (targetEl) {
      targetEl.classList.add("active-diff-glow");

      // Scroll container directly
      const container = document.getElementById("unifiedRedlineContent");
      if (container && container.contains(targetEl)) {
        const offsetTop = targetEl.offsetTop - container.offsetTop - 80;
        container.scrollTo({ top: Math.max(0, offsetTop), behavior: "smooth" });
      }
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
      const matchesType = (filterVal === "all") ||
        (filterVal === "insert" && node.type === "insert") ||
        (filterVal === "delete" && node.type === "delete");

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
  // VISUAL CANVAS RENDERER (HANDLES UNEQUAL PAGE COUNTS e.g. 3 vs 5 PAGES)
  // ==========================================================================

  async function renderVisualCanvases() {
    if (!window.pdfjsLib || !state.fileV1 || !state.fileV2) return;

    try {
      const arr1 = await state.fileV1.arrayBuffer();
      const arr2 = await state.fileV2.arrayBuffer();

      const pdf1 = await pdfjsLib.getDocument({ data: arr1 }).promise;
      const pdf2 = await pdfjsLib.getDocument({ data: arr2 }).promise;

      const totalPages1 = pdf1.numPages;
      const totalPages2 = pdf2.numPages;
      const maxPages = Math.max(totalPages1, totalPages2);

      // Clamp current page
      if (state.currentVisualPage > maxPages) state.currentVisualPage = maxPages;
      if (state.currentVisualPage < 1) state.currentVisualPage = 1;

      document.getElementById("visualPageNum").textContent = `Page ${state.currentVisualPage} of ${maxPages}`;

      // Canvas 1: Original (v1)
      if (state.currentVisualPage <= totalPages1) {
        document.getElementById("labelCanvasV1").textContent = `Original Page ${state.currentVisualPage} of ${totalPages1}`;
        const page1 = await pdf1.getPage(state.currentVisualPage);
        await renderPageToCanvas(page1, "canvasV1", "DELETE");
      } else {
        document.getElementById("labelCanvasV1").textContent = `Original (End of Document - ${totalPages1} pages total)`;
        renderEmptyCanvasMessage("canvasV1", `End of Original PDF (${totalPages1} pages)`);
      }

      // Canvas 2: Revised (v2)
      if (state.currentVisualPage <= totalPages2) {
        document.getElementById("labelCanvasV2").textContent = `Revised Page ${state.currentVisualPage} of ${totalPages2}`;
        const page2 = await pdf2.getPage(state.currentVisualPage);
        await renderPageToCanvas(page2, "canvasV2", "INSERT");
      } else {
        document.getElementById("labelCanvasV2").textContent = `Revised (End of Document - ${totalPages2} pages total)`;
        renderEmptyCanvasMessage("canvasV2", `End of Revised PDF (${totalPages2} pages)`);
      }

    } catch (e) {
      console.warn("Visual canvas rendering error:", e);
    }
  }

  function renderEmptyCanvasMessage(canvasId, msg) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const context = canvas.getContext("2d");
    canvas.width = 450;
    canvas.height = 300;
    context.fillStyle = "#182032";
    context.fillRect(0, 0, 450, 300);
    context.fillStyle = "#64748B";
    context.font = "14px Inter, sans-serif";
    context.textAlign = "center";
    context.fillText(msg, 225, 150);
  }

  async function renderPageToCanvas(pdfPage, canvasId, diffType) {
    const canvas = document.getElementById(canvasId);
    const context = canvas.getContext("2d");
    const viewport = pdfPage.getViewport({ scale: 1.2 });

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await pdfPage.render({ canvasContext: context, viewport: viewport }).promise;

    if (diffType && state.comparison && state.comparison.diffs) {
      await highlightCanvasDiffs(pdfPage, viewport, context, diffType);
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

  document.getElementById("btnPagePrev").addEventListener("click", () => {
    if (state.currentVisualPage > 1) {
      state.currentVisualPage--;
      renderVisualCanvases();
    }
  });

  document.getElementById("btnPageNext").addEventListener("click", () => {
    state.currentVisualPage++;
    renderVisualCanvases();
  });

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

  // Helpers
  function showLoading(msg) {
    loadingStatusText.textContent = msg || "Processing...";
    loadingOverlay.classList.remove("hidden");
  }

  function hideLoading() {
    loadingOverlay.classList.add("hidden");
  }
});
