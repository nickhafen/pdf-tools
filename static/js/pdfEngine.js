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

      const { text: pageText, wordCount } = this._buildStructuredPageText(textContent);
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
   * Group PDF.js text items into lines using their vertical position and
   * per-item font size, classify each line as a heading (larger than the
   * page's body text, or matching a short numbered/ALL-CAPS pattern at body
   * size) or ordinary body text, and reassemble into a text stream with
   * explicit Markdown-style structure markers ("## Heading", blank lines
   * between paragraphs). This lets downstream diffing/rendering preserve
   * real document structure instead of guessing from post-diff HTML.
   */
  _buildStructuredPageText(textContent) {
    const items = (textContent.items || []).filter(it => it && typeof it.str === "string");
    if (items.length === 0) return { text: "", wordCount: 0 };

    // Group items into lines by y-position. PDF.js marks the end of a line
    // in the source content stream via item.hasEOL.
    const lines = [];
    let currentLine = null;
    const Y_TOLERANCE = 2;

    items.forEach(item => {
      if (!item.transform) return;
      const y = item.transform[5];
      const fontSize = Math.hypot(item.transform[2], item.transform[3]) || Math.abs(item.transform[3]) || 1;

      if (currentLine && Math.abs(currentLine.y - y) <= Y_TOLERANCE) {
        currentLine.parts.push(item.str);
        currentLine.maxFontSize = Math.max(currentLine.maxFontSize, fontSize);
      } else {
        currentLine = { y, parts: [item.str], maxFontSize: fontSize };
        lines.push(currentLine);
      }

      if (item.hasEOL) {
        currentLine = null;
      }
    });

    let lineTexts = lines
      .map(l => ({ text: l.parts.join('').replace(/[ \t]+/g, ' ').trim(), fontSize: l.maxFontSize }))
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
          fontSize: Math.max(cur.fontSize, next.fontSize)
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

    let outputBlocks = [];
    let paragraphBuffer = [];

    const flushParagraph = () => {
      if (paragraphBuffer.length > 0) {
        outputBlocks.push(paragraphBuffer.join(' '));
        paragraphBuffer = [];
      }
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
        outputBlocks.push(`## ${line.text}`);
      } else {
        paragraphBuffer.push(line.text);
      }
    });
    flushParagraph();

    const text = outputBlocks.join('\n\n');
    const wordCount = text.replace(/^##\s?/gm, '').trim().split(/\s+/).filter(Boolean).length;

    return { text, wordCount };
  }
}

window.pdfEngine = new PDFEngine();
