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

    const lineTexts = lines
      .map(l => ({ text: l.parts.join('').replace(/[ \t]+/g, ' ').trim(), fontSize: l.maxFontSize }))
      .filter(l => l.text.length > 0);

    if (lineTexts.length === 0) return { text: "", wordCount: 0 };

    // Body font size = the most common (rounded) line font size on the page
    const sizeCounts = {};
    lineTexts.forEach(l => {
      const bucket = Math.round(l.fontSize);
      sizeCounts[bucket] = (sizeCounts[bucket] || 0) + 1;
    });
    const bodyFontSize = Number(
      Object.entries(sizeCounts).sort((a, b) => b[1] - a[1])[0][0]
    );

    const HEADING_TEXT_PATTERN = /^(?:[0-9]+(?:\.[0-9]+)*\.?\s+[A-Z].{0,80}|[A-Z][A-Z\s&"'\-]{4,60})$/;

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
          (line.fontSize >= bodyFontSize && HEADING_TEXT_PATTERN.test(line.text)));

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
