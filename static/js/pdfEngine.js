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
    const pdfjsLib = await window.pdfjsReady.catch(() => null);
    if (!pdfjsLib) {
      throw new Error("PDF.js library is not loaded");
    }

    const arrayBuffer = await file.arrayBuffer();
    const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer, isEvalSupported: false }).promise;

    const rawPages = [];
    for (let i = 1; i <= pdfDoc.numPages; i++) {
      const page = await pdfDoc.getPage(i);
      rawPages.push({
        textContent: await page.getTextContent(),
        width: page.getViewport({ scale: 1 }).width
      });
    }

    // Hyphenated compounds written mid-line anywhere in the document, so a
    // hyphen at a line break can be told apart from word-break hyphenation.
    const hyphenatedWords = new Set();
    rawPages.forEach(({ textContent }) => {
      (textContent.items || []).forEach(it => {
        (String(it.str || "").match(/[A-Za-z]+-[A-Za-z]+/g) || [])
          .forEach(w => hyphenatedWords.add(w.toLowerCase()));
      });
    });

    const builtPages = rawPages.map(({ textContent, width }) =>
      this._buildStructuredPageText(textContent, width, hyphenatedWords));

    // A paragraph that runs off the bottom of a page unfinished continues
    // in the first paragraph of the next page: move that continuation back
    // so the paragraph stays whole and the page break falls after it.
    let openPage = null; // page whose last block is an unfinished paragraph
    builtPages.forEach(page => {
      if (openPage && page.firstIsParagraph) {
        const lastIdx = openPage.blocks.length - 1;
        const tail = openPage.blocks[lastIdx];
        if (this._continuesParagraph(tail, page.blocks[0])) {
          openPage.blocks[lastIdx] = this._joinWrapped(tail, page.blocks.shift(), hyphenatedWords);
          // A page holding only the middle of the paragraph leaves it open.
          if (page.blocks.length === 0) {
            if (!page.lastIsOpenParagraph) openPage = null;
            return;
          }
        }
      }
      openPage = page.lastIsOpenParagraph && page.blocks.length > 0 ? page : null;
    });

    let fullTextParts = [];
    let pagesData = [];
    let totalWords = 0;

    builtPages.forEach((built, idx) => {
      const pageText = built.blocks.join('\n\n');
      const wordCount = this._countWords(pageText);
      totalWords += wordCount;
      pagesData.push({ page: idx + 1, text: pageText, word_count: wordCount });
      fullTextParts.push(pageText);
    });

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
   * Whether a line ends a sentence: terminal punctuation (optionally followed
   * by a closing quote or bracket), but not an abbreviation that rarely ends
   * one, such as the "No." in "Harlow v. Dunmore Supply Co., No. 24-0117".
   */
  _endsSentence(text) {
    return /[.!?:]["')\]]?$/.test(text) &&
      !/(?:^|[\s(])(?:No|Nos|v|vs|Mr|Mrs|Ms|Dr|cf|Cf|e\.g|i\.e|pp|para|Art|Sec)\.$/.test(text);
  }

  /**
   * Whether `next` continues the paragraph ending in `text`, given that the
   * last line of `text` ran to the right margin: it must not cross a sentence
   * boundary into a capitalized line, so real paragraph breaks aren't lost.
   */
  _continuesParagraph(text, next) {
    return !this._endsSentence(text) || /^[a-z]/.test(next);
  }

  /**
   * Join a wrapped line onto the text before it. A line-end hyphen is kept
   * ("100-mile", "store-manager") unless it splits a lowercase word that
   * never appears hyphenated mid-line in the document, which is how
   * word-break hyphenation ("mainte-nance") looks.
   */
  _joinWrapped(text, next, hyphenatedWords) {
    if (!text.endsWith("-")) return `${text} ${next}`;
    const left = (text.match(/([A-Za-z]+)-$/) || [])[1];
    const right = (next.match(/^([A-Za-z]+)/) || [])[1];
    const wordBreak = left && right && /[a-z]$/.test(left) && /^[a-z]/.test(right) &&
      !hyphenatedWords.has(`${left}-${right}`.toLowerCase());
    return wordBreak ? text.slice(0, -1) + next : text + next;
  }

  _countWords(text) {
    return text
      .replace(/^\s*(#{1,6}\s+|-\s+|\d+\.\s+)/gm, '')
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;
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
   *
   * Returns the page's blocks plus whether the first block is a paragraph
   * and the last is an unfinished one, so extractText can rejoin a
   * paragraph split across a page break.
   */
  _buildStructuredPageText(textContent, pageWidth, hyphenatedWords) {
    const EMPTY = { blocks: [], firstIsParagraph: false, lastIsOpenParagraph: false };
    const items = (textContent.items || []).filter(it => it && typeof it.str === "string");
    if (items.length === 0) return EMPTY;

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

    if (lineTexts.length === 0) return EMPTY;

    // Page geometry, used to tell a wrapped continuation line (of a
    // paragraph or list item) apart from the start of a new one: the
    // previous line must have reached near the right margin.
    const pageLeft = Math.min(...lineTexts.map(l => l.x0));
    const rightEdge = (pageWidth || 612) - pageLeft;
    const fullX = rightEdge - Math.max(24, (rightEdge - pageLeft) * 0.12);

    // Some PDFs render a section number ("1.", "7A.") as its own text line,
    // separate from the heading title that follows on the next line. Merge
    // a bare numbering line into the line after it so the combined text can
    // be tested as one heading candidate — unless it is the wrapped end of an
    // unfinished line ("... slip op. at" / "12.").
    const BARE_NUMBERING_PATTERN = /^[0-9]{1,3}[A-Za-z]?\.?$/;
    const mergedLines = [];
    for (let idx = 0; idx < lineTexts.length; idx++) {
      const cur = lineTexts[idx];
      const next = lineTexts[idx + 1];
      const prev = mergedLines[mergedLines.length - 1];
      const wrappedTail = prev && prev.xEnd >= fullX && prev.y - cur.y > 0 &&
        prev.y - cur.y <= cur.fontSize * 1.8 && !this._endsSentence(prev.text);
      if (next && BARE_NUMBERING_PATTERN.test(cur.text) && !wrappedTail) {
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
    // A numbered line that reads as a sentence ("1. Monthly rent is $1,650,
    // due on the first day of each month.") is a list item or clause, not a
    // heading; short titles may still end in a period ("1. Definitions.").
    const looksLikeNumberedHeading = (text) =>
      NUMBERED_HEADING_PATTERN.test(text) &&
      !(/[.;,]$/.test(text) && text.split(/\s+/).length > 7);
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

    let outputBlocks = [];
    const paragraphBlocks = new Set(); // indexes of outputBlocks that are paragraphs
    let para = null; // { text, lastY, lastXEnd }
    let lastParaOpen = false; // last flushed paragraph ran to the right margin unfinished
    // Marker x-position of each open list nesting level (index = depth),
    // reset whenever a list block starts fresh. Indent steps vary by
    // producer (18pt, 24pt, 36pt...), so depth comes from comparing indents
    // rather than from a fixed step.
    let listIndents = [];
    let listDepth = 0;
    let lastListItem = null; // { x0, xEnd, fontSize }
    const INDENT_TOLERANCE = 4;

    const flushParagraph = () => {
      if (para) {
        paragraphBlocks.add(outputBlocks.length);
        outputBlocks.push(para.text);
        lastParaOpen = para.lastXEnd >= fullX && !this._endsSentence(para.text);
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
            (looksLikeNumberedHeading(line.text) ||
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
        const cont = lastBlockIsList() && listIndents.length > 0;
        let depth = 0;
        if (!cont) {
          listIndents = [];
        } else if (line.x0 > listIndents[listDepth] + INDENT_TOLERANCE) {
          // An item can nest at most one level deeper than the previous item.
          depth = Math.min(4, listDepth + 1);
        } else {
          // Same level, or back out to the deepest level at or left of it.
          while (depth < listDepth && listIndents[depth + 1] <= line.x0 + INDENT_TOLERANCE) depth++;
        }
        listIndents = listIndents.slice(0, depth);
        listIndents[depth] = line.x0;
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
        outputBlocks[outputBlocks.length - 1] = this._joinWrapped(last, line.text, hyphenatedWords);
        lastListItem.xEnd = line.xEnd;
        return;
      }
      lastListItem = null;

      // Paragraph text: rejoin wrapped lines. The previous line must have
      // reached the right margin and the next must continue its sentence;
      // otherwise start a new paragraph.
      if (para) {
        const gap = para.lastY - line.y;
        const sameParagraph = gap >= 0 && gap <= line.fontSize * 1.8 && para.lastXEnd >= fullX &&
          this._continuesParagraph(para.text, line.text);
        if (sameParagraph) {
          para.text = this._joinWrapped(para.text, line.text, hyphenatedWords);
          para.lastY = line.y;
          para.lastXEnd = line.xEnd;
          return;
        }
        flushParagraph();
      }
      para = { text: line.text, lastY: line.y, lastXEnd: line.xEnd };
    });
    flushParagraph();

    const lastIdx = outputBlocks.length - 1;
    return {
      blocks: outputBlocks,
      firstIsParagraph: paragraphBlocks.has(0),
      lastIsOpenParagraph: paragraphBlocks.has(lastIdx) && lastParaOpen
    };
  }
}

window.pdfEngine = new PDFEngine();
