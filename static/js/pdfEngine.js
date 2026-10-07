/**
 * PDF Engine Service - Browser-side text extraction via PDF.js.
 * Documents never leave the browser: extraction happens entirely client-side.
 */

class PDFEngine {
  /**
   * Extract text and pages from a PDF File object.
   * @param {File} file - PDF file object
   * @returns {Promise<Object>} Extracted document object
   */
  async extractText(file) {
    if (!window.pdfjsLib) {
      throw new Error("PDF.js library is not loaded");
    }

    const arrayBuffer = await file.arrayBuffer();
    const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    let fullTextParts = [];
    let pagesData = [];
    let totalWords = 0;

    for (let i = 1; i <= pdfDoc.numPages; i++) {
      const page = await pdfDoc.getPage(i);
      const textContent = await page.getTextContent();
      const viewport = page.getViewport({ scale: 1 });

      const { text: pageText, wordCount } = this._buildStructuredPageText(textContent, viewport.width);
      totalWords += wordCount;

      pagesData.push({ page: i, text: pageText, word_count: wordCount });
      fullTextParts.push(pageText);
    }

    return {
      filename: file.name,
      page_count: pdfDoc.numPages,
      total_words: totalWords,
      // "\n\n---\n\n" marks a page boundary; the diff engine renders it as a
      // page-break divider instead of guessing structure from flattened text.
      full_text: fullTextParts.join('\n\n---\n\n'),
      pages: pagesData,
      ocr_used: false
    };
  }

  /**
   * Join a line's text items into one string, inserting a space between
   * adjacent items when their horizontal gap warrants it. Some PDFs position
   * words purely via coordinates with no space character in the content
   * stream, so a naive '' join runs words together.
   */
  _joinLineItems(items) {
    let text = "";
    let prevEnd = null;
    for (const it of items) {
      if (prevEnd !== null && it.x - prevEnd > Math.max(1, it.fontSize * 0.15) &&
          !text.endsWith(" ") && !it.str.startsWith(" ")) {
        text += " ";
      }
      text += it.str;
      prevEnd = it.x + it.width;
    }
    return text.replace(/[ \t]+/g, ' ').trim();
  }

  /**
   * Group PDF.js text items into lines using their vertical position and
   * per-item font size, classify each line as a heading (larger than the
   * page's body text, or matching a short numbered/ALL-CAPS pattern at body
   * size), a list item, or ordinary body text, and reassemble into a text
   * stream with explicit Markdown-style structure markers ("## Heading",
   * "- item", blank lines between real paragraphs). This lets downstream
   * diffing/rendering preserve real document structure instead of guessing
   * from post-diff HTML.
   */
  _buildStructuredPageText(textContent, pageWidth) {
    const items = (textContent.items || []).filter(it => it && typeof it.str === "string");
    if (items.length === 0) return { text: "", wordCount: 0 };

    // Group items into lines by y-position. PDF.js marks the end of a line
    // in the source content stream via item.hasEOL.
    const lines = [];
    let currentLine = null;
    const Y_TOLERANCE = 2;

    items.forEach(item => {
      if (!item.transform) return;
      const x = item.transform[4];
      const y = item.transform[5];
      const fontSize = Math.hypot(item.transform[2], item.transform[3]) || Math.abs(item.transform[3]) || 1;
      const lineItem = { str: item.str, x, fontSize, width: item.width || 0 };

      if (currentLine && Math.abs(currentLine.y - y) <= Y_TOLERANCE) {
        currentLine.items.push(lineItem);
        currentLine.maxFontSize = Math.max(currentLine.maxFontSize, fontSize);
      } else {
        currentLine = { y, items: [lineItem], maxFontSize: fontSize };
        lines.push(currentLine);
      }

      if (item.hasEOL) {
        currentLine = null;
      }
    });

    let lineTexts = lines
      .map(l => {
        const text = this._joinLineItems(l.items);
        const first = l.items[0];
        const last = l.items[l.items.length - 1];
        return { text, fontSize: l.maxFontSize, y: l.y, x0: first.x, xEnd: last.x + last.width };
      })
      .filter(l => l.text.length > 0);

    if (lineTexts.length === 0) return { text: "", wordCount: 0 };

    // Some PDFs render a section number ("1.", "7A.") as its own text line,
    // separate from the heading title that follows on the next line. Merge
    // a bare numbering line into the line after it so the combined text can
    // be tested as one heading candidate.
    const BARE_NUMBERING_PATTERN = /^[0-9]{1,3}[A-Za-z]?\.?$/;
    const mergedLines = [];
    for (let idx = 0; idx < lineTexts.length; idx++) {
      const cur = lineTexts[idx];
      const next = lineTexts[idx + 1];
      if (next && BARE_NUMBERING_PATTERN.test(cur.text)) {
        const sep = cur.text.endsWith('.') ? ' ' : '. ';
        mergedLines.push({
          text: `${cur.text}${sep}${next.text}`,
          fontSize: Math.max(cur.fontSize, next.fontSize),
          y: cur.y,
          x0: cur.x0,
          xEnd: next.xEnd
        });
        idx++; // consume the next line too
      } else {
        mergedLines.push(cur);
      }
    }
    lineTexts = mergedLines;

    // Body font size = the most common (rounded) line font size on the page
    const sizeCounts = {};
    lineTexts.forEach(l => {
      const bucket = Math.round(l.fontSize);
      sizeCounts[bucket] = (sizeCounts[bucket] || 0) + 1;
    });
    const bodyFontSize = Number(
      Object.entries(sizeCounts).sort((a, b) => b[1] - a[1])[0][0]
    );

    const NUMBERED_HEADING_PATTERN = /^[0-9]+(?:\.[0-9]+)*[A-Za-z]?\.?\s+[A-Z].{0,80}$/;
    const ALLCAPS_HEADING_PATTERN = /^[A-Z][A-Z\s&"'\-]{4,60}$/;
    const MINOR_WORDS = new Set(["of", "and", "the", "for", "to", "in", "a", "an", "or", "&"]);

    // Catches short Title Case headings that aren't numbered and aren't
    // ALL CAPS (e.g. "Exhibit A — Statement of Work (SOW)"): most words
    // start with a capital letter, any lowercase words are minor connectors,
    // and it doesn't end like a sentence.
    function looksLikeTitleCaseHeading(text) {
      if (text.length >= 70 || /[.!?,]$/.test(text)) return false;
      const words = text.split(/\s+/);
      if (words.length < 2 || words.length > 9) return false;
      let capCount = 0;
      for (const w of words) {
        const bare = w.replace(/[^A-Za-z]/g, "");
        if (!bare) continue;
        if (/^[A-Z]/.test(bare)) {
          capCount++;
        } else if (!MINOR_WORDS.has(w.toLowerCase())) {
          return false;
        }
      }
      return capCount >= Math.ceil(words.length * 0.5);
    }

    // Bullet or numbered/lettered list markers ("•", "-", "1.", "12)", "a.").
    // Lowercase-letter markers only (not uppercase), to avoid mistaking a
    // capitalized abbreviation or heading for a list item.
    const LIST_MARKER_PATTERN = /^([•●○◦▪‣∙·–—-]|\d{1,3}[.)]|[a-z][.)])\s+(.+)$/;
    function listItemText(text) {
      const m = text.match(LIST_MARKER_PATTERN);
      if (!m) return null;
      const marker = m[1];
      if (/^\d/.test(marker)) return `${parseInt(marker, 10)}. ${m[2]}`;
      return `- ${m[2]}`;
    }

    // Page geometry, used to tell a wrapped continuation line (of a
    // paragraph or list item) apart from the start of a new one: the
    // previous line must have reached near the right margin, and indent
    // depth relative to pageLeft maps to list nesting at a ~36pt step.
    const pageLeft = Math.min(...lineTexts.map(l => l.x0));
    const rightEdge = (pageWidth || 612) - pageLeft;
    const fullX = rightEdge - Math.max(24, (rightEdge - pageLeft) * 0.12);
    const levelOf = (l) => Math.max(1, Math.min(5, Math.round((l.x0 - pageLeft) / 36)));

    let outputBlocks = [];
    let para = null; // { text, lastY, lastXEnd }
    // List nesting base re-anchors whenever a list block starts fresh.
    let listBase = null;
    let listDepth = 0;
    let lastListItem = null; // { x0, xEnd, fontSize }

    const flushParagraph = () => {
      if (para) {
        outputBlocks.push(para.text);
        para = null;
      }
    };
    const lastBlockIsList = () => {
      const last = outputBlocks[outputBlocks.length - 1];
      return typeof last === "string" && /^ *(-|\d+\.) /.test(last.split("\n").pop() || "");
    };

    lineTexts.forEach(line => {
      const isHeading =
        line.text.length < 90 &&
        (line.fontSize > bodyFontSize * 1.12 ||
          (line.fontSize >= bodyFontSize &&
            (NUMBERED_HEADING_PATTERN.test(line.text) ||
              ALLCAPS_HEADING_PATTERN.test(line.text) ||
              looksLikeTitleCaseHeading(line.text))));

      if (isHeading) {
        flushParagraph();
        lastListItem = null;
        outputBlocks.push(`## ${line.text}`);
        return;
      }

      // Orphan bullet glyph (a marker whose text ended up on its own line).
      if (/^[•●○◦▪‣∙·]+$/.test(line.text.trim())) return;

      const listText = listItemText(line.text);
      if (listText) {
        flushParagraph();
        const cont = lastBlockIsList();
        if (!cont || listBase === null) listBase = levelOf(line);
        // An item can nest at most one level deeper than the previous item.
        const depth = cont
          ? Math.max(0, Math.min(4, levelOf(line) - listBase, listDepth + 1))
          : 0;
        listDepth = depth;
        const item = `${"  ".repeat(depth)}${listText}`;
        if (cont) outputBlocks[outputBlocks.length - 1] += `\n${item}`;
        else outputBlocks.push(item);
        lastListItem = { x0: line.x0, xEnd: line.xEnd, fontSize: line.fontSize };
        return;
      }

      // Wrapped continuation of the previous list item: it reached the right
      // margin, and this line starts at or past the item's indent in the
      // same font size.
      if (lastListItem && lastListItem.xEnd >= fullX && line.x0 >= lastListItem.x0 - 2 &&
          Math.abs(line.fontSize - lastListItem.fontSize) <= lastListItem.fontSize * 0.25) {
        const last = outputBlocks[outputBlocks.length - 1];
        outputBlocks[outputBlocks.length - 1] = last.endsWith("-")
          ? last.slice(0, -1) + line.text
          : `${last} ${line.text}`;
        lastListItem.xEnd = line.xEnd;
        return;
      }
      lastListItem = null;

      // Paragraph text: rejoin wrapped lines. The previous line must have
      // reached the right margin, and the join must not cross a sentence
      // boundary into a capitalized line — otherwise start a new paragraph
      // so real paragraph breaks in the source aren't lost.
      if (para) {
        const gap = para.lastY - line.y;
        const sameParagraph = gap >= 0 && gap <= line.fontSize * 1.8 && para.lastXEnd >= fullX &&
          (!/[.!?:]["')\]]?$/.test(para.text) || /^[a-z]/.test(line.text));
        if (sameParagraph) {
          para.text = para.text.endsWith("-")
            ? para.text.slice(0, -1) + line.text
            : `${para.text} ${line.text}`;
          para.lastY = line.y;
          para.lastXEnd = line.xEnd;
          return;
        }
        flushParagraph();
      }
      para = { text: line.text, lastY: line.y, lastXEnd: line.xEnd };
    });
    flushParagraph();

    const text = outputBlocks.join('\n\n');
    const wordCount = text
      .replace(/^\s*(#{1,6}\s+|-\s+|\d+\.\s+)/gm, '')
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;

    return { text, wordCount };
  }
}

window.pdfEngine = new PDFEngine();
