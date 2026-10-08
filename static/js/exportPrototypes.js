/**
 * PROTOTYPE export formats, evaluated alongside the current image-based PDF
 * export (ExportUtil.exportRedlinePDF):
 *
 *   exportFormattedPDF  The reflowed redline written as real, selectable
 *                       text and styled after the revised PDF: its page
 *                       size, margins, body font family and size, line
 *                       spacing, and page breaks.
 *   exportMarkupPDF     The revised PDF itself, left as is, with the changes
 *                       marked as real PDF annotations: a Highlight on each
 *                       insertion where it sits on the page and a Caret at
 *                       each deletion, both carrying the changed text so
 *                       they appear in a viewer's comment list. Margin
 *                       balloons quoting each deletion and change bars
 *                       beside changed lines are drawn into the page.
 *
 * Both re-open the revised PDF with PDF.js to read its layout. Neither
 * changes how documents are extracted or compared.
 */

const PDFLIB_URL = "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.esm.min.js";

const INS_RGB = [4, 120, 87];   // #047857
const DEL_RGB = [185, 28, 28];  // #B91C1C

// pdf-lib's and jsPDF's standard 14 fonts only encode WinAnsi. Map the
// common typographic characters outside it and replace anything else.
const WINANSI_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
const WINANSI_SUBS = { "\t": " ", "‐": "-", "‑": "-", "−": "-", "′": "'", "″": "\"", "←": "<-", "→": "->" };
function toWinAnsi(text) {
  return text.replace(/[^\x20-\x7e\xa0-\xff\n]/g, ch => {
    if (WINANSI_EXTRA.includes(ch)) return ch;
    if (WINANSI_SUBS[ch]) return WINANSI_SUBS[ch];
    if (/\s/.test(ch)) return " ";
    return "?";
  });
}

function downloadBlob(bytes, filename) {
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function baseName(name) {
  return String(name || "").replace(/\.pdf$/i, "");
}

/**
 * Open a PDF with PDF.js and collect each page's box and text items.
 * Item coordinates are PDF user space (origin bottom-left, y up).
 */
async function analyzePdf(file) {
  const pdfjsLib = await window.pdfjsReady;
  const bytes = new Uint8Array(await file.arrayBuffer());
  // PDF.js transfers the buffer it's given to its worker; hand it a copy.
  const doc = await pdfjsLib.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    pages.push({ view: page.view, rotate: page.rotate, items: tc.items, styles: tc.styles });
  }
  await doc.destroy();
  return { bytes, pages };
}

function itemGeometry(item) {
  const t = item.transform;
  return {
    x: t[4],
    y: t[5],
    size: Math.hypot(t[2], t[3]) || Math.abs(t[3]) || 1,
    horizontal: t[0] > 0 && Math.abs(t[1]) < 1e-3 && Math.abs(t[2]) < 1e-3
  };
}

function weightedMode(entries) {
  const counts = new Map();
  entries.forEach(([key, weight]) => counts.set(key, (counts.get(key) || 0) + weight));
  let best = null, bestW = -1;
  counts.forEach((w, k) => { if (w > bestW) { best = k; bestW = w; } });
  return best;
}

function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))];
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ============================================================================
// FORMATTED REDLINE (reflowed, vector text, styled after the revised PDF)
// ============================================================================

/**
 * Estimate the revised document's typography from its text items: body font
 * size and family, line spacing, paragraph spacing, heading size, margins.
 */
function measureLayout(analysis) {
  const first = analysis.pages[0];
  const [vx0, vy0, vx1, vy1] = first ? first.view : [0, 0, 612, 792];
  const width = vx1 - vx0, height = vy1 - vy0;

  const sized = [];
  analysis.pages.forEach((page, pi) => {
    page.items.forEach(item => {
      if (!item.str || !item.str.trim()) return;
      const g = itemGeometry(item);
      if (!g.horizontal) return;
      const family = (page.styles[item.fontName] || {}).fontFamily || "";
      sized.push({ ...g, pi, view: page.view, width: item.width || 0, chars: item.str.trim().length, family });
    });
  });

  if (sized.length === 0) {
    return { width, height, body: 11, heading: 13, family: "times", leading: 14, paraGap: 7, left: 72, right: 72, top: 72, bottom: 72 };
  }

  const roundHalf = v => Math.round(v * 2) / 2;
  const body = weightedMode(sized.map(s => [roundHalf(s.size), s.chars]));
  const bodyItems = sized.filter(s => Math.abs(s.size - body) <= 0.75);

  const familyName = String(weightedMode(bodyItems.map(s => [s.family.toLowerCase(), s.chars])) || "");
  const family = /mono|courier/.test(familyName) ? "courier"
    : /sans|arial|helvetica|calibri|verdana/.test(familyName) ? "helvetica"
    : "times";

  // Baseline-to-baseline distance between consecutive body lines.
  const gaps = [];
  for (let i = 1; i < bodyItems.length; i++) {
    const a = bodyItems[i - 1], b = bodyItems[i];
    if (a.pi !== b.pi) continue;
    const dy = a.y - b.y;
    if (dy > body * 0.9 && dy < body * 4) gaps.push(roundHalf(dy));
  }
  const leading = weightedMode(gaps.filter(g => g < body * 2.2).map(g => [g, 1])) || body * 1.2;
  const paraGaps = gaps.filter(g => g > leading * 1.25 && g < leading * 3.5);
  const paraGap = paraGaps.length ? clamp(weightedMode(paraGaps.map(g => [g, 1])) - leading, 2, leading * 2) : leading * 0.5;

  const bigger = sized.filter(s => s.size > body * 1.1 && s.size < body * 3);
  const heading = bigger.length ? weightedMode(bigger.map(s => [roundHalf(s.size), s.chars])) : body;

  const lefts = bodyItems.map(s => s.x - s.view[0]);
  const rights = bodyItems.map(s => s.view[2] - (s.x + s.width));
  const tops = [], bottoms = [];
  analysis.pages.forEach((page, pi) => {
    const onPage = sized.filter(s => s.pi === pi);
    if (onPage.length === 0) return;
    tops.push(page.view[3] - Math.max(...onPage.map(s => s.y + s.size)));
    bottoms.push(Math.min(...onPage.map(s => s.y)) - page.view[1]);
  });

  return {
    width, height, body, heading, family, leading, paraGap,
    left: clamp(percentile(lefts, 0.05), 36, width * 0.25),
    right: clamp(percentile(rights, 0.05), 36, width * 0.25),
    // The fullest page sets the margins; a short last page or a title page
    // would otherwise push them in.
    top: clamp(percentile(tops, 0), 36, height * 0.2),
    // Leave room for the footer this export adds.
    bottom: clamp(percentile(bottoms, 0), 48, height * 0.2)
  };
}

// Split runs ({text, op, v2}) wherever `sepRe` (a capturing regex) matches,
// returning groups of runs. Separators never belong to a group. `v2` is the
// run's offset in the revised text (null for deleted text).
function splitRuns(runs, sepRe) {
  const groups = [[]];
  runs.forEach(run => {
    let off = 0;
    run.text.split(sepRe).forEach((piece, idx) => {
      if (idx % 2 === 1) groups.push([]);
      else if (piece) groups[groups.length - 1].push({ text: piece, op: run.op, v2: run.v2 == null ? null : run.v2 + off });
      off += piece.length;
    });
  });
  return groups.filter(g => g.length > 0);
}

// Remove a leading match of `re` from a run list, across run boundaries.
function stripPrefix(runs, re) {
  const joined = runs.map(r => r.text).join("");
  const m = joined.match(re);
  if (!m) return { runs, match: null };
  let n = m[0].length;
  const out = [];
  runs.forEach(r => {
    if (n >= r.text.length) { n -= r.text.length; return; }
    out.push({ ...r, text: r.text.slice(n), v2: r.v2 == null ? null : r.v2 + n });
    n = 0;
  });
  return { runs: out, match: m };
}

ExportUtil.prototype.exportFormattedPDF = async function (comparison, fileV2) {
  if (!window.jspdf) throw new Error("PDF export library failed to load (check your internet connection).");
  const { jsPDF } = window.jspdf;
  const analysis = await analyzePdf(fileV2);
  const L = measureLayout(analysis);
  const diffs = comparison.diffs || [];
  const src = locateRevisedText(analysis, diffs);

  // Each source line's extent, to read a block's alignment and indent.
  const srcLines = new Map();
  src.chars.forEach(c => {
    const key = `${c.page}:${Math.round(c.y * 2)}`;
    const l = srcLines.get(key);
    if (l) { l.x0 = Math.min(l.x0, c.x0); l.x1 = Math.max(l.x1, c.x1); }
    else srcLines.set(key, { x0: c.x0, x1: c.x1, page: c.page });
  });
  const pageView = pi => (analysis.pages[pi] || analysis.pages[0]).view;

  // Justified text: most full-width lines end exactly at the right margin.
  let flush = 0, ragged = 0;
  srcLines.forEach(l => {
    const right = pageView(l.page)[2] - L.right;
    if (l.x1 >= right - 1.5) flush++;
    else if (l.x1 > right - 60) ragged++;
  });
  const justified = flush >= 3 && flush > ragged * 2;

  // Size, alignment and indent of the source line where a block starts.
  const sourceStyle = blockRuns => {
    const run = blockRuns.find(r => r.v2 != null && /\S/.test(r.text));
    if (!run) return null;
    const c = src.charAt(run.v2 + run.text.search(/\S/));
    if (!c) return null;
    const line = srcLines.get(`${c.page}:${Math.round(c.y * 2)}`);
    const [vx0, , vx1] = pageView(c.page);
    const colLeft = vx0 + L.left, colRight = vx1 - L.right;
    const centered = line && line.x0 > colLeft + 20 &&
      Math.abs((line.x0 + line.x1) / 2 - (colLeft + colRight) / 2) < 6;
    return { size: Math.round(c.size * 2) / 2, centered, indent: line ? Math.max(0, line.x0 - colLeft) : 0 };
  };

  const orientation = L.width > L.height ? "landscape" : "portrait";
  const pdf = new jsPDF({ unit: "pt", format: [L.width, L.height], orientation, compress: true });
  const maxX = L.width - L.right;
  const limitY = L.height - L.bottom;
  let cursor = L.top;          // top of the next line
  let pageHasContent = false;

  const newPage = () => {
    pdf.addPage([L.width, L.height], orientation);
    cursor = L.top;
    pageHasContent = false;
  };

  const setOpColor = op => {
    const c = op === "INSERT" ? INS_RGB : op === "DELETE" ? DEL_RGB : [17, 24, 39];
    pdf.setTextColor(c[0], c[1], c[2]);
    pdf.setDrawColor(c[0], c[1], c[2]);
  };

  /**
   * Lay out one paragraph-like run list with greedy word wrap. Words can be
   * made of fragments with different ops ("Tenant" + inserted "s").
   */
  const renderRuns = (runs, { size, style = "normal", indent = 0, marker = null, spaceBefore = 0, align = "left" }) => {
    pdf.setFont(L.family, style);
    pdf.setFontSize(size);
    const lineHeight = L.leading * size / L.body;
    const spaceW = pdf.getTextWidth(" ");

    const words = [];
    let word = null;
    runs.forEach(run => {
      (toWinAnsi(run.text).match(/\s+|\S+/g) || []).forEach(tok => {
        if (/^\s/.test(tok)) {
          if (word) { word.spaceOp = run.op; word = null; }
          else if (words.length) words[words.length - 1].spaceOp = run.op;
        } else {
          if (!word) { word = { frags: [], width: 0, spaceOp: null }; words.push(word); }
          const w = pdf.getTextWidth(tok);
          word.frags.push({ text: tok, op: run.op, width: w });
          word.width += w;
        }
      });
    });
    if (words.length === 0) return;

    const startX = L.left + indent;
    const lines = [[]];
    let x = startX;
    words.forEach(w => {
      const line = lines[lines.length - 1];
      if (line.length > 0 && x + w.width > maxX) {
        lines.push([w]);
        x = startX + w.width + spaceW;
      } else {
        line.push(w);
        x += w.width + spaceW;
      }
    });

    if (pageHasContent) cursor += spaceBefore;
    lines.forEach((line, li) => {
      if (cursor + lineHeight > limitY && pageHasContent) newPage();
      const baseline = cursor + lineHeight - size * 0.25;
      if (li === 0 && marker) {
        setOpColor(marker.op);
        pdf.text(marker.text, startX - size * 1.2, baseline);
      }
      // Centre the line, or stretch its spaces to the right margin when the
      // source is justified (except a paragraph's last line).
      const lineW = line.reduce((sum, w) => sum + w.width, 0) + spaceW * (line.length - 1);
      let lx = align === "center" ? startX + (maxX - startX - lineW) / 2 : startX;
      const gapW = align === "justify" && li < lines.length - 1 && line.length > 1
        ? spaceW + (maxX - startX - lineW) / (line.length - 1) : spaceW;
      line.forEach((w, wi) => {
        w.frags.forEach(f => {
          setOpColor(f.op);
          pdf.text(f.text, lx, baseline);
          decorate(f.op, lx, f.width, baseline, size);
          lx += f.width;
        });
        if (wi < line.length - 1) {
          // Underline / strike an inserted or deleted space too, so a
          // multi-word change reads as one continuous mark.
          if (w.spaceOp && w.spaceOp !== "EQUAL") { setOpColor(w.spaceOp); decorate(w.spaceOp, lx, gapW, baseline, size); }
          lx += gapW;
        }
      });
      cursor += lineHeight;
      pageHasContent = true;
    });
  };

  const decorate = (op, x, w, baseline, size) => {
    if (op === "INSERT") {
      pdf.setLineWidth(Math.max(0.5, size * 0.06));
      pdf.line(x, baseline + size * 0.12, x + w, baseline + size * 0.12);
    } else if (op === "DELETE") {
      pdf.setLineWidth(Math.max(0.5, size * 0.06));
      pdf.line(x, baseline - size * 0.28, x + w, baseline - size * 0.28);
    }
  };

  let v2pos = 0;
  const runs = diffs.map(d => {
    const run = { text: d.text, op: d.op, v2: d.op === "DELETE" ? null : v2pos };
    if (d.op !== "DELETE") v2pos += d.text.length;
    return run;
  });
  const blocks = splitRuns(runs, /(\n[ \t]*\n\s*)/);

  blocks.forEach(block => {
    const plain = block.map(r => r.text).join("").trim();

    if (/^-{3,}$/.test(plain)) {
      // A page break from the revised PDF (or one that only exists in v1,
      // which is skipped). Keeps redline pages roughly in step with it.
      if (block.some(r => r.op !== "DELETE") && pageHasContent) newPage();
      return;
    }

    if (/^##\s?/.test(plain)) {
      const { runs: headingRuns } = stripPrefix(block, /^\s*##\s?/);
      const st = sourceStyle(headingRuns);
      // Keep a heading with at least two lines of what follows it.
      const headSize = st ? st.size : L.heading;
      if (pageHasContent && cursor + L.paraGap * 2.5 + (L.leading * headSize / L.body) + L.leading * 2 > limitY) newPage();
      renderRuns(headingRuns, {
        size: st ? st.size : L.heading, style: "bold", spaceBefore: L.paraGap * 1.5,
        align: st && st.centered ? "center" : "left"
      });
      return;
    }

    // List blocks hold one item per line ("  - item" / "3. item").
    const lines = splitRuns(block, /(\n)/);
    const isList = lines.every(l => /^ *(-|\d+\.) /.test(l.map(r => r.text).join("")));
    if (isList) {
      lines.forEach((lineRuns, idx) => {
        const { runs: itemRuns, match } = stripPrefix(lineRuns, /^( *)(-|\d+\.) /);
        const depth = Math.min(4, Math.floor(match[1].length / 2));
        const markerOp = (lineRuns.find(r => r.text.trim()) || {}).op || "EQUAL";
        const st = sourceStyle(lineRuns);
        renderRuns(itemRuns, {
          size: L.body,
          // Put the marker where the source put it, when that's known.
          indent: st && st.indent > 0 ? st.indent + L.body * 1.2 : L.body * 1.6 * (depth + 1),
          marker: { text: match[2] === "-" ? "•" : match[2], op: markerOp },
          spaceBefore: idx === 0 ? L.paraGap : L.paraGap * 0.3
        });
      });
      return;
    }

    const st = sourceStyle(block);
    lines.forEach((lineRuns, idx) =>
      renderRuns(lineRuns, {
        size: st ? st.size : L.body,
        spaceBefore: idx === 0 ? L.paraGap : 0,
        align: st && st.centered ? "center" : justified ? "justify" : "left"
      }));
  });

  // Footer: what was compared, a legend, page numbers.
  const total = pdf.getNumberOfPages();
  const v1 = toWinAnsi(baseName(comparison.docNameV1 || "Original"));
  const v2 = toWinAnsi(baseName(comparison.docNameV2 || "Revised"));
  for (let i = 1; i <= total; i++) {
    pdf.setPage(i);
    const fy = L.height - Math.min(24, L.bottom / 2);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7.5);
    pdf.setTextColor(107, 114, 128);
    pdf.text(`${v1} compared with ${v2}`.slice(0, 90), L.left, fy);
    pdf.text(`Page ${i} of ${total}`, L.width - L.right, fy, { align: "right" });
    if (i === 1) {
      const legendY = fy - 10;
      let lx = L.left;
      [["Inserted", "INSERT"], ["Deleted", "DELETE"]].forEach(([label, op]) => {
        setOpColor(op);
        pdf.text(label, lx, legendY);
        const w = pdf.getTextWidth(label);
        decorate(op, lx, w, legendY, 7.5);
        lx += w + 10;
      });
    }
  }

  pdf.save(`Redline_Formatted_${baseName(comparison.docNameV2)}_${Date.now()}.pdf`);
};

// ============================================================================
// MARKED-UP PDF (the revised PDF itself, with the changes drawn on it)
// ============================================================================

/**
 * Build a stream of positioned characters from the PDF's text items and cut
 * it into words the same way pdfEngine joins items: a gap wider than a
 * fraction of the font size, a new line, or whitespace ends a word.
 * Character x-positions are apportioned within each item by canvas-measured
 * glyph widths, scaled to the item's real width.
 */
function buildPositionIndex(analysis) {
  const ctx = document.createElement("canvas").getContext("2d");
  const chars = [];
  const words = [];
  let wordStart = -1;
  const endWord = () => {
    if (wordStart >= 0 && chars.length > wordStart) {
      words.push({ c0: wordStart, c1: chars.length, text: chars.slice(wordStart).map(c => c.ch).join("") });
    }
    wordStart = -1;
  };

  analysis.pages.forEach((page, pi) => {
    let prev = null;
    page.items.forEach(item => {
      if (!item.str) { if (item.hasEOL && prev) prev.eol = true; return; }
      const g = itemGeometry(item);
      const brk = !prev || prev.eol || Math.abs(prev.y - g.y) > 2 ||
        g.x - prev.endX > Math.max(1, g.size * 0.15);
      if (brk) endWord();

      const family = (page.styles[item.fontName] || {}).fontFamily || "sans-serif";
      ctx.font = `100px ${family}`;
      const str = item.str.replace(/ /g, " ").replace(/[​‌‍﻿]/g, "");
      const widths = [...str].map(ch => ctx.measureText(ch).width);
      const total = widths.reduce((a, b) => a + b, 0) || 1;
      const scale = (item.width || 0) / total;
      let x = g.x;
      [...str].forEach((ch, k) => {
        const w = widths[k] * scale;
        if (/\s/.test(ch)) { endWord(); x += w; return; }
        if (wordStart < 0) wordStart = chars.length;
        chars.push({ ch, page: pi, x0: x, x1: x + w, y: g.y, size: g.size, horizontal: g.horizontal });
        x += w;
      });
      prev = { y: g.y, endX: g.x + (item.width || 0), eol: item.hasEOL };
    });
    endWord();
  });
  endWord();
  return { chars, words };
}

/**
 * Align the compared (extracted) text's words to the PDF's positioned words
 * with a word-level diff. Most words match exactly; the few that don't
 * (rejoined hyphenation, structure markers like "##") are bridged by
 * their matched neighbours.
 */
function alignWords(extractedWords, indexWords) {
  const dict = new Map();
  const encode = list => list.map(w => {
    let code = dict.get(w.text);
    if (code === undefined) {
      code = 0x100 + dict.size;
      if (code >= 0xd800) code += 0x800; // skip the surrogate range
      dict.set(w.text, code);
    }
    return String.fromCharCode(code);
  }).join("");

  const dmp = new diff_match_patch();
  dmp.Diff_Timeout = 5;
  const diffs = dmp.diff_main(encode(extractedWords), encode(indexWords), false);
  const map = new Array(extractedWords.length).fill(-1);
  let ei = 0, ii = 0;
  diffs.forEach(([op, text]) => {
    const n = text.length;
    if (op === 0) { for (let k = 0; k < n; k++) map[ei + k] = ii + k; ei += n; ii += n; }
    else if (op === -1) ei += n;
    else ii += n;
  });
  return map;
}

/**
 * Position lookup for the revised text exactly as it was compared (the
 * EQUAL + INSERT diff tokens): its words, their matches among the PDF's
 * positioned words, and helpers to go from a text offset to a glyph.
 */
function locateRevisedText(analysis, diffs) {
  const { chars, words: indexWords } = buildPositionIndex(analysis);
  const v2Text = diffs.filter(d => d.op !== "DELETE").map(d => d.text).join("");
  const extractedWords = [...v2Text.matchAll(/\S+/g)].map(m => ({ text: m[0], start: m.index, end: m.index + m[0].length }));
  const map = alignWords(extractedWords, indexWords);

  const wordAt = offset => {
    let lo = 0, hi = extractedWords.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const w = extractedWords[mid];
      if (offset < w.start) hi = mid - 1;
      else if (offset >= w.end) lo = mid + 1;
      else return mid;
    }
    return -1;
  };
  const firstWordFrom = offset => {
    let lo = 0, hi = extractedWords.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (extractedWords[mid].end <= offset) lo = mid + 1; else hi = mid; }
    return lo;
  };
  const charOf = (ew, offset) => chars[indexWords[map[ew]].c0 + (offset - extractedWords[ew].start)];
  // The glyph at a revised-text offset, if its word was matched.
  const charAt = offset => {
    const ew = wordAt(offset);
    return ew >= 0 && map[ew] >= 0 ? charOf(ew, offset) : null;
  };
  return { chars, indexWords, extractedWords, map, v2Text, wordAt, firstWordFrom, charOf, charAt };
}

// Merge character boxes into one rectangle per run of text on a line.
function charsToRects(chars) {
  const sorted = chars.filter(c => c.horizontal)
    .sort((a, b) => a.page - b.page || b.y - a.y || a.x0 - b.x0);
  const rects = [];
  sorted.forEach(c => {
    const r = rects[rects.length - 1];
    if (r && r.page === c.page && Math.abs(r.y - c.y) < c.size * 0.5 && c.x0 - r.x1 < c.size * 0.8) {
      r.x1 = Math.max(r.x1, c.x1);
      r.size = Math.max(r.size, c.size);
    } else {
      rects.push({ page: c.page, x0: c.x0, x1: c.x1, y: c.y, size: c.size });
    }
  });
  return rects;
}

function wrapText(text, font, size, width) {
  const lines = [];
  let line = "";
  text.split(/\s+/).filter(Boolean).forEach(word => {
    // Hard-break a word that can't fit on a line by itself.
    while (font.widthOfTextAtSize(word, size) > width && word.length > 1) {
      let cut = word.length - 1;
      while (cut > 1 && font.widthOfTextAtSize(word.slice(0, cut), size) > width) cut--;
      if (line) { lines.push(line); line = ""; }
      lines.push(word.slice(0, cut));
      word = word.slice(cut);
    }
    const candidate = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(candidate, size) > width) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  });
  if (line) lines.push(line);
  return lines;
}

// Changed text as a reader should see it: no structure markers.
function displayChange(text, max = 420) {
  const cleaned = text
    .replace(/(^|\n)\s*-{3,}\s*(?=\n|$)/g, "$1")
    .replace(/(^|\n)\s*##\s?/g, "$1")
    .replace(/\n\s*\n/g, " ¶ ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned === "¶") return "(paragraph break)";
  return cleaned.length > max ? cleaned.slice(0, max) + "…" : cleaned;
}

ExportUtil.prototype.exportMarkupPDF = async function (comparison, fileV2) {
  const analysis = await analyzePdf(fileV2);
  const { PDFDocument, PDFHexString, PDFString, rgb, StandardFonts } = await import(PDFLIB_URL);
  const diffs = comparison.diffs || [];
  const { chars, indexWords, extractedWords, map, v2Text, wordAt, firstWordFrom, charOf } =
    locateRevisedText(analysis, diffs);

  // Walk the diff in revised-text offsets. Each change holds its inserted
  // glyphs and/or the anchor point of its deletion; a deletion next to an
  // insertion is one replacement.
  const changes = [];
  const unplaced = []; // text of changes with no position on the page
  let pos = 0;
  // Structure markers pdfEngine adds ("## ", "---", "- ", "3. ") have no
  // glyphs of their own on the page (or a different one, like a bullet).
  const MARKER_WORD = /^(#{1,6}|-{3,}|-|\d{1,3}\.)$/;

  const insertionChars = (start, end) => {
    const insertedChars = new Set();
    const first = firstWordFrom(start);
    for (let ew = first; ew < extractedWords.length && extractedWords[ew].start < end; ew++) {
      const w = extractedWords[ew];
      if (map[ew] >= 0) {
        for (let o = Math.max(start, w.start); o < Math.min(end, w.end); o++) insertedChars.add(charOf(ew, o));
        continue;
      }
      if (MARKER_WORD.test(w.text)) continue;
      // Unmatched word: take every positioned word between its matched
      // neighbours, unless that gap is suspiciously large.
      let p = ew - 1; while (p >= 0 && map[p] < 0) p--;
      let n = ew + 1; while (n < extractedWords.length && map[n] < 0) n++;
      const lo = p >= 0 ? map[p] + 1 : 0;
      const hi = n < extractedWords.length ? map[n] - 1 : indexWords.length - 1;
      if (hi - lo > 40) {
        unplaced.push(w.text);
      } else {
        for (let iw = lo; iw <= hi; iw++) for (let c = indexWords[iw].c0; c < indexWords[iw].c1; c++) insertedChars.add(chars[c]);
      }
    }
    return [...insertedChars].filter(Boolean);
  };

  const anchorAt = offset => {
    // Deletion right after a word character: mark that character's right edge.
    if (offset > 0 && /\S/.test(v2Text[offset - 1])) {
      const ew = wordAt(offset - 1);
      if (ew >= 0 && map[ew] >= 0) { const c = charOf(ew, offset - 1); return { page: c.page, x: c.x1, y: c.y, size: c.size }; }
    }
    // Otherwise the left edge of the next matched word, else the right edge
    // of the previous one.
    for (let ew = firstWordFrom(offset); ew < extractedWords.length; ew++) {
      if (map[ew] >= 0) { const c = chars[indexWords[map[ew]].c0]; return { page: c.page, x: c.x0, y: c.y, size: c.size }; }
    }
    for (let ew = firstWordFrom(offset) - 1; ew >= 0; ew--) {
      if (map[ew] >= 0) { const c = chars[indexWords[map[ew]].c1 - 1]; return { page: c.page, x: c.x1, y: c.y, size: c.size }; }
    }
    return null;
  };

  diffs.forEach((d, i) => {
    if (d.op === "EQUAL") { pos += d.text.length; return; }
    let change = changes[changes.length - 1];
    if (!change || change.lastIdx !== i - 1) { change = { del: null, ins: null }; changes.push(change); }
    change.lastIdx = i;

    if (d.op === "DELETE") {
      const text = displayChange(d.text, 5000);
      const anchor = text ? anchorAt(pos) : null;
      if (anchor) change.del = { ...anchor, text };
      else if (text) unplaced.push(text);
      return;
    }
    const text = displayChange(d.text, 5000);
    const insChars = text ? insertionChars(pos, pos + d.text.length) : [];
    if (insChars.length) change.ins = { text, rects: charsToRects(insChars) };
    pos += d.text.length;
  });

  const placedChanges = changes.filter(c => c.del || c.ins);
  const deletions = placedChanges.filter(c => c.del).map(c => c.del);

  // ---- Draw on the revised PDF -------------------------------------------
  const doc = await PDFDocument.load(analysis.bytes, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pages = doc.getPages();
  const MARGIN = 190;
  const insColor = rgb(...INS_RGB.map(v => v / 255));
  const delColor = rgb(...DEL_RGB.map(v => v / 255));
  const ink = rgb(0.25, 0.27, 0.31);

  deletions.forEach((d, i) => { d.num = i + 1; });

  // Real PDF annotations, so the changes show up in a viewer's comment
  // list (author, type, text) and can be filtered, replied to, or hidden.
  // Each carries its own appearance stream so every viewer draws it the
  // same way instead of improvising one.
  const context = doc.context;
  const now = PDFString.fromDate(new Date());
  const author = PDFHexString.fromText("Redline");
  const HL = [0.62, 0.9, 0.74];
  const n2 = v => (Math.round(v * 100) / 100).toString();
  const color = (c, op) => `${c.map(n2).join(" ")} ${op}`;
  const insRgb = INS_RGB.map(v => v / 255), delRgb = DEL_RGB.map(v => v / 255);

  const addAnnotation = (page, fields, bbox, appearance, resources) => {
    const ap = context.flateStream(appearance, {
      Type: "XObject", Subtype: "Form", BBox: bbox, ...(resources ? { Resources: resources } : {})
    });
    const annot = context.obj({
      Type: "Annot", Rect: bbox, F: 4, T: author, M: now, CreationDate: now, P: page.ref,
      AP: { N: context.register(ap) }, ...fields
    });
    const ref = context.register(annot);
    page.node.addAnnot(ref);
    return ref;
  };

  // One change, one comment: the first annotation made for a change is its
  // primary; the rest (its caret in a replacement, its highlight on a later
  // page) are grouped under it, as Acrobat does for "Replace Text".
  const groupFields = change => change.primaryRef ? { IRT: change.primaryRef, RT: "Group" } : {};
  const remember = (change, ref) => { if (!change.primaryRef) change.primaryRef = ref; };

  const quote = t => t === "(paragraph break)" ? "a paragraph break" : `“${t}”`;
  const describe = change => change.del && change.ins
    ? { subj: "Replaced", text: `Replaced ${quote(change.del.text)} with ${quote(change.ins.text)}` }
    : change.ins ? { subj: "Inserted", text: `Inserted ${quote(change.ins.text)}` }
    : { subj: "Deleted", text: `Deleted ${quote(change.del.text)}` };

  // Insertions (and the new half of a replacement): one Highlight
  // annotation per page the change touches, tinted and underlined.
  const addHighlight = (page, change, rects, id) => {
    const quads = [], fills = [];
    const underline = [`${color(insRgb, "RG")} 0.8 w`];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    rects.forEach(r => {
      const bottom = r.y - r.size * 0.22, top = r.y + r.size * 0.9;
      const left = r.x0 - 0.5, right = r.x1 + 0.5;
      // QuadPoints order viewers expect: upper-left, upper-right, lower-left, lower-right.
      quads.push(left, top, right, top, left, bottom, right, bottom);
      fills.push(`${n2(left)} ${n2(bottom)} ${n2(right - left)} ${n2(top - bottom)} re`);
      underline.push(`${n2(r.x0)} ${n2(r.y - r.size * 0.16)} m ${n2(r.x1)} ${n2(r.y - r.size * 0.16)} l S`);
      x0 = Math.min(x0, left); y0 = Math.min(y0, bottom); x1 = Math.max(x1, right); y1 = Math.max(y1, top);
    });
    const { subj, text } = describe(change);
    remember(change, addAnnotation(page, {
      Subtype: "Highlight", QuadPoints: quads, C: HL, CA: 1,
      Subj: PDFHexString.fromText(subj), Contents: PDFHexString.fromText(text),
      NM: PDFHexString.fromText(`redline-${id}`), ...groupFields(change)
    }, [x0, y0, x1, y1],
    `/GS0 gs ${color(HL, "rg")}\n${fills.join("\n")}\nf\n${underline.join("\n")}`,
    { ExtGState: { GS0: { Type: "ExtGState", BM: "Multiply" } } }));
  };

  // Deletions (and the removed half of a replacement): a Caret annotation
  // where the text was taken out.
  const addCaret = (page, change, id) => {
    const d = change.del;
    const by = d.y - d.size * 0.22, top = d.y + d.size * 0.85;
    const { subj, text } = describe(change);
    remember(change, addAnnotation(page, {
      Subtype: "Caret", C: delRgb, RD: [0, 0, 0, 0], Sy: "None",
      Subj: PDFHexString.fromText(subj), Contents: PDFHexString.fromText(text),
      NM: PDFHexString.fromText(`redline-${id}-del`), ...groupFields(change)
    }, [d.x - 3.5, by - 3.5, d.x + 3.5, top + 0.5],
    `${color(delRgb, "RG")} 1 w 1 J\n` +
    `${n2(d.x)} ${n2(by)} m ${n2(d.x)} ${n2(top)} l S\n` +
    `${n2(d.x - 2.5)} ${n2(by - 2.5)} m ${n2(d.x)} ${n2(by)} l ${n2(d.x + 2.5)} ${n2(by - 2.5)} l S`));
  };
  const stats = comparison.statistics || {};

  pages.forEach((page, pi) => {
    const view = analysis.pages[pi] ? analysis.pages[pi].view : [0, 0, page.getWidth(), page.getHeight()];
    const [vx0, vy0, vx1, vy1] = view;
    const pageH = vy1 - vy0;

    // Widen the page with a markup column on the right, like Word's
    // balloon margin. (Rotated pages would put it on another edge; this
    // prototype doesn't handle them.)
    const mb = page.getMediaBox();
    page.setMediaBox(mb.x, mb.y, Math.max(mb.width, vx1 - mb.x) + MARGIN, mb.height);
    page.setCropBox(vx0, vy0, (vx1 - vx0) + MARGIN, pageH);
    const colX = vx1;
    page.drawRectangle({ x: colX, y: vy0, width: MARGIN, height: pageH, color: rgb(0.965, 0.968, 0.976) });
    page.drawLine({ start: { x: colX, y: vy0 }, end: { x: colX, y: vy1 }, thickness: 0.5, color: rgb(0.82, 0.84, 0.87) });

    let headerY = vy1 - 22;
    page.drawText("CHANGES", { x: colX + 10, y: headerY, size: 7, font: bold, color: ink });
    if (pi === 0) {
      const meta = [
        `Revised: ${toWinAnsi(comparison.docNameV2 || "")}`,
        `Compared with: ${toWinAnsi(comparison.docNameV1 || "")}`,
        `+${stats.additions_words || 0} / -${stats.deletions_words || 0} words`
      ];
      meta.forEach(line => {
        wrapText(line, font, 6.5, MARGIN - 20).forEach(l => {
          headerY -= 9;
          page.drawText(l, { x: colX + 10, y: headerY, size: 6.5, font, color: ink });
        });
      });
      if (unplaced.length > 0) {
        headerY -= 9;
        page.drawText(`${unplaced.length} change(s) could not be placed on the page`, { x: colX + 10, y: headerY, size: 6.5, font, color: delColor });
      }
      headerY -= 6;
    }

    const textLeft = Math.min(...chars.filter(c => c.page === pi).map(c => c.x0), vx1);
    const barX = Math.max(vx0 + 6, textLeft - 10);

    // Insertions get a Highlight annotation and a change bar in the
    // gutter; deletions get a Caret annotation (balloons follow below).
    placedChanges.forEach((change, ci) => {
      if (change.ins) {
        const rects = change.ins.rects.filter(r => r.page === pi);
        if (rects.length) addHighlight(page, change, rects, `${ci + 1}-p${pi + 1}`);
        rects.forEach(r => page.drawLine({
          start: { x: barX, y: r.y - r.size * 0.25 }, end: { x: barX, y: r.y + r.size * 0.9 }, thickness: 1.6, color: insColor
        }));
      }
      if (change.del && change.del.page === pi) addCaret(page, change, ci + 1);
    });

    // Deletions: marker at the spot, balloon in the margin, leader between.
    const pageDels = deletions.filter(d => d.page === pi).sort((a, b) => b.y - a.y || a.x - b.x);
    const balloonW = MARGIN - 20;
    const BAL_SIZE = 7;
    const placed = pageDels.map(d => {
      const lines = wrapText(toWinAnsi(displayChange(d.text)), font, BAL_SIZE, balloonW - 12);
      return { d, lines, h: 14 + lines.length * (BAL_SIZE + 2) + 3 };
    });

    // Stack balloons top-down near their anchors without overlapping; if
    // they run off the bottom, push the stack back up.
    let nextTop = headerY - 4;
    placed.forEach(p => {
      p.top = Math.min(p.d.y + p.d.size, nextTop);
      nextTop = p.top - p.h - 4;
    });
    let overflow = (vy0 + 8) - (placed.length ? placed[placed.length - 1].top - placed[placed.length - 1].h : vy0 + 8);
    for (let i = placed.length - 1; i >= 0 && overflow > 0; i--) {
      const limit = i === 0 ? headerY - 4 : placed[i - 1].top - placed[i - 1].h - 4;
      const room = Math.max(0, limit - placed[i].top);
      const shift = Math.min(room, overflow);
      for (let j = i; j < placed.length; j++) placed[j].top += shift;
      overflow -= shift;
    }

    placed.forEach(({ d, lines, h, top }) => {
      const bx = colX + 10;
      // The caret itself is the Caret annotation; this number ties it to
      // its balloon.
      const by = d.y - d.size * 0.22;
      page.drawText(String(d.num), { x: d.x + 1.5, y: d.y + d.size * 0.6, size: 5.5, font: bold, color: delColor });
      page.drawLine({ start: { x: barX - 3, y: d.y - d.size * 0.25 }, end: { x: barX - 3, y: d.y + d.size * 0.9 }, thickness: 1.6, color: delColor });

      // Dotted leader from the marker to the balloon.
      const leadY = top - 7;
      page.drawLine({ start: { x: d.x, y: by }, end: { x: colX - 4, y: by }, thickness: 0.5, color: delColor, dashArray: [1.5, 1.5], opacity: 0.8 });
      page.drawLine({ start: { x: colX - 4, y: by }, end: { x: bx, y: leadY }, thickness: 0.5, color: delColor, dashArray: [1.5, 1.5], opacity: 0.8 });

      page.drawRectangle({ x: bx, y: top - h, width: balloonW, height: h, color: rgb(1, 0.96, 0.96), borderColor: delColor, borderWidth: 0.6 });
      page.drawText(`${d.num}  Deleted:`, { x: bx + 6, y: top - 10, size: BAL_SIZE, font: bold, color: delColor });
      lines.forEach((l, li) => {
        const ty = top - 10 - (li + 1) * (BAL_SIZE + 2);
        page.drawText(l, { x: bx + 6, y: ty, size: BAL_SIZE, font, color: rgb(0.2, 0.2, 0.2) });
        const w = font.widthOfTextAtSize(l, BAL_SIZE);
        page.drawLine({ start: { x: bx + 6, y: ty + BAL_SIZE * 0.3 }, end: { x: bx + 6 + w, y: ty + BAL_SIZE * 0.3 }, thickness: 0.4, color: delColor });
      });
    });
  });

  const bytes = await doc.save();
  downloadBlob(bytes, `Redline_Markup_${baseName(comparison.docNameV2)}_${Date.now()}.pdf`);
  return { changes: placedChanges.length, deletions: deletions.length, unplaced };
};
