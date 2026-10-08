/**
 * Redaction Engine - backend-independent core.
 *
 * Search, mark geometry, and post-redaction verification live here. The
 * actual PDF work (flattening, rendering, text extraction, applying
 * redactions, writing the file) is delegated to a backend:
 *
 *   - redactMupdf.js   MuPDF.js (AGPL-3.0)
 *   - redactPdfium.js  PDFium via EmbedPDF + pdf-lib (Apache-2.0 / MIT)
 *
 * A backend provides:
 *   name, label
 *   prepare(bytes)            -> { prepared, pendingRedactions, flattened }
 *   openDoc(bytes)            -> DocAdapter
 *   apply(bytes, marks, opts) -> Promise<{ bytes, removed }>
 *
 * and a DocAdapter provides:
 *   pageCount
 *   pageBounds(i)             -> [x0, y0, x1, y1], y pointing down
 *   renderPage(i, scale)      -> PNG Uint8Array, or { width, height, data } RGBA
 *   indexPage(i)              -> { text, boxes } (see below)
 *   inspect()                 -> Promise<{ metadata, hasXmp, attachments, annotations, formFields, revisions }>
 *   destroy()
 *
 * indexPage returns the page text as one string plus a parallel array
 * holding each character's { rect, line } (null for synthetic characters
 * such as line breaks), so regex matches map straight back to page areas.
 */

// Common patterns offered as one-click searches in the UI.
export const PRESET_PATTERNS = {
  ssn: { label: "SSNs", source: String.raw`\b\d{3}-\d{2}-\d{4}\b` },
  email: { label: "Emails", source: String.raw`[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}` },
  phone: { label: "Phone numbers", source: String.raw`(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b` },
  card: { label: "Card numbers", source: String.raw`\b(?:\d[ -]?){13,16}\b` },
};

export const DEFAULT_SANITIZE = {
  metadata: true,      // document info dictionary + XMP metadata
  attachments: true,   // embedded files
  scripts: true,       // JavaScript and automatic actions
  bookmarks: true,     // outline titles can repeat redacted names
};

const METADATA_FIELDS = ["Title", "Author", "Subject", "Keywords", "Creator", "Producer"];

/** Escape a literal search term, letting any run of whitespace match a line break. */
export function literalToRegexSource(term) {
  return term
    .trim()
    .split(/\s+/)
    .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
}

export function unionRect(a, b) {
  return a ? [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])] : b.slice();
}

/** Group marks into a Map of page index -> rects. */
export function rectsByPage(marks) {
  const byPage = new Map();
  for (const mark of marks) {
    if (!byPage.has(mark.page)) byPage.set(mark.page, []);
    byPage.get(mark.page).push(...mark.rects);
  }
  return byPage;
}

function rectContainsPoint(r, x, y) {
  return x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3];
}

function rectsOverlap(a, b) {
  return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
}

/**
 * The middle of a character box. Character boxes run from the font's full
 * ascent to its descent, well past the glyph itself, and engines remove a
 * glyph only when a box reaches into roughly this part of it.
 */
function coreRect(r) {
  const dx = (r[2] - r[0]) * 0.2;
  const dy = (r[3] - r[1]) * 0.2;
  return [r[0] + dx, r[1] + dy, r[2] - dx, r[3] - dy];
}

/**
 * Fit a hand-drawn box to the text it touches. Every character whose middle
 * the box reaches will be removed, so the box grows to cover those
 * characters in full; it then shrinks away from characters it only grazes,
 * so they are neither removed nor half covered. Returns { rect, chars }.
 */
function fitRect(index, drawn) {
  const touched = new Set();
  index.boxes.forEach((b, i) => {
    if (b && rectsOverlap(drawn, coreRect(b.rect))) touched.add(i);
  });

  let rect;
  for (let pass = 0; pass < 10; pass++) {
    rect = drawn.slice();
    let need = null; // must stay covered: the middles of the touched characters
    for (const i of touched) {
      rect = unionRect(rect, index.boxes[i].rect);
      need = unionRect(need, coreRect(index.boxes[i].rect));
    }
    let grew = false;
    index.boxes.forEach((b, i) => {
      if (!b || touched.has(i) || !rectsOverlap(rect, b.rect)) return;
      // Cut back whichever edge frees this character with the smallest trim.
      const cuts = [
        { k: 0, v: b.rect[2], ok: !need || b.rect[2] <= need[0] },
        { k: 1, v: b.rect[3], ok: !need || b.rect[3] <= need[1] },
        { k: 2, v: b.rect[0], ok: !need || b.rect[0] >= need[2] },
        { k: 3, v: b.rect[1], ok: !need || b.rect[1] >= need[3] },
      ].filter(c => c.ok && (c.k < 2 ? c.v < rect[c.k + 2] : c.v > rect[c.k - 2]));
      if (!cuts.length) {
        // Can't free it without uncovering touched text: take it in as well.
        touched.add(i);
        grew = true;
        return;
      }
      const best = cuts.reduce((a, c) => (Math.abs(c.v - rect[c.k]) < Math.abs(a.v - rect[a.k]) ? c : a));
      rect[best.k] = best.v;
    });
    if (!grew) break;
  }
  const chars = [...touched].sort((a, b) => a - b);
  return { rect, chars };
}

/**
 * Convert a [start, end) character range into one rectangle per text line.
 *
 * Character boxes span the font's full ascent and descent, which on tightly
 * set text reaches into the lines above and below, and redaction removes
 * any glyph a box touches. So each rectangle is trimmed back to stop at the
 * neighbouring lines' glyphs (never below a central band of the line, so
 * the matched glyphs themselves are always still covered).
 */
function rangeToRects(index, start, end) {
  const byLine = new Map();
  for (let i = start; i < end; i++) {
    const b = index.boxes[i];
    if (!b) continue;
    byLine.set(b.line, unionRect(byLine.get(b.line), b.rect));
  }
  return [...byLine.entries()].map(([line, r]) => {
    const height = r[3] - r[1];
    const mid = (r[1] + r[3]) / 2;
    let [top, bottom] = [r[1], r[3]];
    for (const b of index.boxes) {
      if (!b || b.line === line) continue;
      if (b.rect[0] >= r[2] || b.rect[2] <= r[0]) continue;      // no horizontal overlap
      const cy = (b.rect[1] + b.rect[3]) / 2;
      if (cy < r[1] && b.rect[3] > top) top = b.rect[3];          // line above reaches down into us
      else if (cy > r[3] && b.rect[1] < bottom) bottom = b.rect[1]; // line below reaches up into us
    }
    const minHalf = height * 0.2;
    top = Math.min(top, mid - minHalf);
    bottom = Math.max(bottom, mid + minHalf);
    return [r[0], top, r[2], bottom];
  });
}

export function createRedactEngine(backend) {

  // -------------------------------------------------------------------------
  // Session: one opened document being prepared for redaction
  // -------------------------------------------------------------------------

  class RedactSession {
    /**
     * By default the document is first flattened by the backend: comments,
     * stamps and filled-in form fields are burned into the page, so search
     * finds their text and redaction boxes remove it, and any redaction
     * marks left unapplied by another tool are pulled out as
     * pendingRedactions. `prepared: true` opens the bytes as-is (used to
     * inspect output).
     */
    constructor(bytes, { prepared = false } = {}) {
      bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      if (prepared) {
        this.bytes = bytes;
        this.pendingRedactions = [];
        this.flattened = 0;
      } else {
        const result = backend.prepare(bytes);
        this.bytes = result.prepared;
        this.pendingRedactions = result.pendingRedactions;
        this.flattened = result.flattened;
      }
      this.doc = backend.openDoc(this.bytes);
      this.pageCount = this.doc.pageCount;
      this._indexes = [];
      this._lines = [];
    }

    _index(i) {
      if (!this._indexes[i]) this._indexes[i] = this.doc.indexPage(i);
      return this._indexes[i];
    }

    /** The page's text lines: [{ rect, chars }], chars being indexes in reading order. */
    _lineList(p) {
      if (!this._lines[p]) {
        const index = this._index(p);
        const lines = new Map();
        index.boxes.forEach((b, i) => {
          if (!b) return;
          if (!lines.has(b.line)) lines.set(b.line, { rect: null, chars: [] });
          const line = lines.get(b.line);
          line.rect = unionRect(line.rect, b.rect);
          line.chars.push(i);
        });
        this._lines[p] = [...lines.values()];
      }
      return this._lines[p];
    }

    pageBounds(i) {
      return this.doc.pageBounds(i);
    }

    /** Render a page at the given scale (1 = 72 dpi). */
    renderPage(i, scale) {
      return this.doc.renderPage(i, scale);
    }

    /** True when no page has any extractable text (likely a scan). */
    hasNoText() {
      for (let i = 0; i < this.pageCount; i++) {
        if (this._index(i).text.trim()) return false;
      }
      return true;
    }

    /**
     * Find every match of a regex source across the document.
     * Returns [{ page, text, rects }].
     */
    find(source, { caseSensitive = false } = {}) {
      const results = [];
      for (let p = 0; p < this.pageCount; p++) {
        const index = this._index(p);
        const re = new RegExp(source, caseSensitive ? "g" : "gi");
        let m;
        while ((m = re.exec(index.text)) !== null) {
          if (m[0].length === 0) { re.lastIndex++; continue; }
          const rects = rangeToRects(index, m.index, m.index + m[0].length);
          if (rects.length) results.push({ page: p, text: m[0], rects });
        }
      }
      return results;
    }

    /**
     * Text cursor position (an offset into the page text) for a point, as
     * when selecting text. With `onText`, returns -1 unless the point is on
     * a character; otherwise it snaps to the nearest line.
     */
    caretAt(p, x, y, { onText = false } = {}) {
      const index = this._index(p);
      let best = null;
      let bestScore = Infinity;
      for (const line of this._lineList(p)) {
        const [x0, y0, x1, y1] = line.rect;
        const dx = x < x0 ? x0 - x : x > x1 ? x - x1 : 0;
        const dy = y < y0 ? y0 - y : y > y1 ? y - y1 : 0;
        if (onText && !line.chars.some(i => {
          const r = index.boxes[i].rect;
          return rectContainsPoint([r[0] - 1, r[1], r[2] + 1, r[3]], x, y);
        })) continue;
        const score = dy * 4 + dx + Math.abs(y - (y0 + y1) / 2) * 0.01;
        if (score < bestScore) {
          best = line;
          bestScore = score;
        }
      }
      if (!best) return -1;
      for (const i of best.chars) {
        const r = index.boxes[i].rect;
        if (x < (r[0] + r[2]) / 2) return i;
      }
      return best.chars[best.chars.length - 1] + 1;
    }

    /** The text between two caret positions, and one mark rectangle per line. */
    selection(p, a, b) {
      const index = this._index(p);
      let start = Math.min(a, b);
      let end = Math.max(a, b);
      while (start < end && /\s/.test(index.text[start])) start++;
      while (end > start && /\s/.test(index.text[end - 1])) end--;
      if (start === end) return { text: "", rects: [] };
      return { text: index.text.slice(start, end), rects: rangeToRects(index, start, end) };
    }

    /** Fit a hand-drawn box to the text it touches (see fitRect). Returns { rect, text }. */
    fitBox(p, rect) {
      const index = this._index(p);
      const { rect: fitted, chars } = fitRect(index, rect);
      // Fall back to the box as drawn if trimming squeezed it to nothing.
      const usable = fitted[2] - fitted[0] > 0.5 && fitted[3] - fitted[1] > 0.5;
      // Separate runs that aren't contiguous in the text, e.g. parts of two lines.
      const text = chars.map((i, k) => (k && i !== chars[k - 1] + 1 ? " " : "") + index.text[i]).join("");
      return { rect: usable ? fitted : rect, text: text.trim() };
    }

    /** Text currently under a rectangle (centres inside it). */
    textInRect(p, rect) {
      const index = this._index(p);
      let out = "";
      index.boxes.forEach((b, i) => {
        if (!b) return;
        const cx = (b.rect[0] + b.rect[2]) / 2;
        const cy = (b.rect[1] + b.rect[3]) / 2;
        if (rectContainsPoint(rect, cx, cy)) out += index.text[i];
      });
      return out.trim();
    }

    /**
     * Produce the redacted PDF. `marks` is [{ page, rects }], with rects in
     * page coordinates. The prepared bytes are reopened so this can be run
     * repeatedly without compounding changes.
     */
    apply(marks, sanitize = DEFAULT_SANITIZE) {
      return backend.apply(this.bytes, marks, sanitize);
    }

    destroy() {
      this.doc.destroy();
    }
  }

  /**
   * Reopen a redacted PDF and check that nothing leaked: no search term
   * still matches, no text sits inside any redaction box, and no metadata,
   * attachments, annotations, or earlier revisions remain.
   */
  async function verify(bytes, marks, searches, sanitize = DEFAULT_SANITIZE) {
    const check = new RedactSession(bytes, { prepared: true });
    const problems = [];
    try {
      for (const s of searches) {
        const hits = check.find(s.source, { caseSensitive: s.caseSensitive });
        if (hits.length) {
          problems.push(`"${s.label}" still found ${hits.length} time(s), e.g. on page ${hits[0].page + 1}: "${hits[0].text}"`);
        }
      }

      for (const mark of marks) {
        for (const rect of mark.rects) {
          const leftover = check.textInRect(mark.page, rect);
          if (leftover) problems.push(`Text remains under a redaction box on page ${mark.page + 1}: "${leftover}"`);
        }
      }

      const info = await check.doc.inspect();
      if (sanitize.metadata) {
        for (const key of METADATA_FIELDS) {
          if (info.metadata[key]) problems.push(`Metadata field ${key} still set: "${info.metadata[key]}"`);
        }
        if (info.hasXmp) problems.push("XMP metadata stream still present");
      }
      if (sanitize.attachments && info.attachments) problems.push("Embedded file attachments still present");
      if (info.annotations) problems.push(`${info.annotations} annotation(s)/form field(s) still present`);
      if (info.formFields) problems.push(`Form (AcroForm) still lists ${info.formFields} field(s), which can hold their original values`);
      if (info.revisions > 1) problems.push("File still contains earlier incremental revisions");

      return { ok: problems.length === 0, problems, pageCount: check.pageCount };
    } finally {
      check.destroy();
    }
  }

  return {
    name: backend.name,
    label: backend.label,
    open: (bytes, options) => new RedactSession(bytes, options),
    verify,
  };
}

export { METADATA_FIELDS };
