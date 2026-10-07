/**
 * MuPDF.js redaction backend (WASM, AGPL-3.0). See redactEngine.js for the
 * backend contract.
 *
 * MuPDF's applyRedactions() deletes glyphs from the content stream, blanks
 * covered image pixels, and removes covered vector art. The document is
 * then rewritten from scratch (non-incremental save + garbage collection)
 * so the original content does not survive as an earlier revision or
 * orphaned object.
 */

import { rectsByPage, METADATA_FIELDS } from "./redactEngine.js";

export const MUPDF_URL = "https://cdn.jsdelivr.net/npm/mupdf@1.28.1/dist/mupdf.js";

function quadBBox(q) {
  return [
    Math.min(q[0], q[2], q[4], q[6]),
    Math.min(q[1], q[3], q[5], q[7]),
    Math.max(q[0], q[2], q[4], q[6]),
    Math.max(q[1], q[3], q[5], q[7]),
  ];
}

export function createMupdfBackend(mupdf) {
  const { PDFDocument, PDFPage, Matrix, ColorSpace } = mupdf;

  function openPdf(bytes) {
    const doc = new PDFDocument(bytes);
    if (doc.needsPassword()) {
      doc.destroy();
      throw new Error("This PDF is password-protected. Remove the password before redacting.");
    }
    return doc;
  }

  function prepare(bytes) {
    const doc = openPdf(bytes);
    try {
      const pendingRedactions = [];
      let flattened = 0;
      for (let p = 0; p < doc.countPages(); p++) {
        const page = doc.loadPage(p);
        for (const annot of page.getAnnotations()) {
          if (annot.getType() === "Redact") {
            pendingRedactions.push({ page: p, rect: annot.getBounds() });
            page.deleteAnnotation(annot);
          } else if (annot.getType() !== "Link") {
            flattened++;
          }
        }
        flattened += page.getWidgets().length;
      }
      doc.bake(true, true);
      const prepared = doc.saveToBuffer("").asUint8Array().slice();
      return { prepared, pendingRedactions, flattened };
    } finally {
      doc.destroy();
    }
  }

  function openDoc(bytes) {
    const doc = openPdf(bytes);
    const pages = [];
    const page = i => pages[i] || (pages[i] = doc.loadPage(i));

    return {
      pageCount: doc.countPages(),

      pageBounds: i => page(i).getBounds(),

      renderPage(i, scale) {
        const pix = page(i).toPixmap(Matrix.scale(scale, scale), ColorSpace.DeviceRGB, false, true);
        const png = pix.asPNG();
        pix.destroy();
        return png;
      },

      indexPage(i) {
        const stext = page(i).toStructuredText("preserve-whitespace");
        let text = "";
        const boxes = [];
        let line = -1;
        stext.walk({
          beginLine() { line++; },
          onChar(c, origin, font, size, quad) {
            text += c;
            for (let k = 1; k < c.length; k++) boxes.push(null); // surrogate pairs
            boxes.push({ rect: quadBBox(quad), line });
          },
          endLine() { text += "\n"; boxes.push(null); },
        });
        stext.destroy();
        return { text, boxes };
      },

      async inspect() {
        const metadata = {};
        for (const key of METADATA_FIELDS) metadata[key] = doc.getMetaData(`info:${key}`) || "";
        let annotations = 0;
        for (let p = 0; p < doc.countPages(); p++) {
          annotations += page(p).getAnnotations().filter(a => a.getType() !== "Link").length + page(p).getWidgets().length;
        }
        const root = doc.getTrailer().get("Root");
        const form = root.get("AcroForm");
        const fields = form.isDictionary() ? form.get("Fields") : form;
        return {
          metadata,
          hasXmp: !root.get("Metadata").isNull(),
          attachments: Object.keys(doc.getEmbeddedFiles()).length,
          annotations,
          formFields: fields.isArray() ? fields.length : 0,
          revisions: doc.countVersions(),
        };
      },

      destroy() {
        pages.forEach(p => p && p.destroy());
        doc.destroy();
      },
    };
  }

  async function apply(bytes, marks, sanitize) {
    const doc = openPdf(bytes);
    const removed = { attachments: 0, scripts: false, metadata: false, bookmarks: false };
    try {
      for (let p = 0; p < doc.countPages(); p++) {
        const pageObj = doc.loadPage(p).getObject();
        // Page thumbnails are tiny unredacted images of the page.
        pageObj.delete("Thumb");
        pageObj.delete("PieceInfo");
        pageObj.delete("Metadata");
      }

      for (const [p, rects] of rectsByPage(marks)) {
        const page = doc.loadPage(p);
        for (const rect of rects) {
          const annot = page.createAnnotation("Redact");
          annot.setRect(rect);
        }
        page.applyRedactions(
          true,
          PDFPage.REDACT_IMAGE_PIXELS,
          PDFPage.REDACT_LINE_ART_REMOVE_IF_COVERED,
          PDFPage.REDACT_TEXT_REMOVE
        );
      }

      const trailer = doc.getTrailer();
      const root = trailer.get("Root");

      // Fields were flattened into the pages on open; the form dictionary
      // left behind can still hold their original values.
      root.delete("AcroForm");

      if (sanitize.metadata) {
        trailer.delete("Info");
        root.delete("Info"); // non-standard, but some producers put one here
        root.delete("Metadata");
        root.delete("PieceInfo");
        removed.metadata = true;
      }

      if (sanitize.attachments) {
        for (const name of Object.keys(doc.getEmbeddedFiles())) {
          doc.deleteEmbeddedFile(name);
          removed.attachments++;
        }
      }

      if (sanitize.scripts) {
        const names = root.get("Names");
        if (names.isDictionary()) names.delete("JavaScript");
        root.delete("OpenAction");
        root.delete("AA");
        removed.scripts = true;
      }

      if (sanitize.bookmarks) {
        root.delete("Outlines");
        removed.bookmarks = true;
      }

      // Full rewrite (never incremental) with garbage collection, so the
      // pre-redaction content streams are not carried along.
      const out = doc.saveToBuffer("garbage=deduplicate,compress,clean").asUint8Array().slice();
      return { bytes: out, removed };
    } finally {
      doc.destroy();
    }
  }

  return {
    name: "mupdf",
    label: "MuPDF (AGPL)",
    prepare,
    openDoc,
    apply,
  };
}

/** Load MuPDF.js from the CDN and wrap it as a backend. */
export async function loadMupdfBackend() {
  return createMupdfBackend(await import(MUPDF_URL));
}
