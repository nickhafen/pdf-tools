/**
 * PDFium redaction backend: Google's PDFium (Apache-2.0) compiled to WASM
 * by EmbedPDF (MIT), whose build adds true-redaction functions, plus
 * pdf-lib (MIT) for the document-structure cleanup PDFium has no API for.
 * See redactEngine.js for the backend contract.
 *
 * PDFium works in PDF user space (origin bottom-left, y up). Everything this
 * module hands back is converted to top-left "device" points at 72 dpi so it
 * matches what the UI draws.
 */

import { rectsByPage, METADATA_FIELDS } from "./redactEngine.js";

export const PDFIUM_URL = "https://cdn.jsdelivr.net/npm/@embedpdf/pdfium@2.15.1/dist/index.browser.js";
export const PDFLIB_URL = "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.esm.min.js";

// fpdf_annot.h subtypes
const ANNOT_LINK = 2;
const ANNOT_POPUP = 16;
const ANNOT_REDACT = 28;
const FILLMODE_ALTERNATE = 1;
const FLAT_NORMALDISPLAY = 0;
const RENDER_ANNOTS = 0x01;
const ERR_PASSWORD = 4;

// Page <-> device conversions go through PDFium's integer device space, so
// work at 1000x and divide back down to keep sub-point precision.
const PRECISION = 1000;

export function createPdfiumBackend(P, PDFLib) {
  const M = P.pdfium;
  const malloc = n => M.wasmExports.malloc(n);
  const free = p => M.wasmExports.free(p);
  P.PDFiumExt_Init();

  // Shared scratch memory for out-parameters (doubles, ints, FS_RECTF).
  const scratch = malloc(64);

  function load(bytes) {
    const ptr = malloc(bytes.length);
    M.HEAPU8.set(bytes, ptr);
    const doc = P.FPDF_LoadMemDocument(ptr, bytes.length, "");
    if (!doc) {
      const err = P.FPDF_GetLastError();
      free(ptr);
      if (err === ERR_PASSWORD) throw new Error("This PDF is password-protected. Remove the password before redacting.");
      throw new Error(`PDFium could not open this file (error ${err}).`);
    }
    return { doc, close() { P.FPDF_CloseDocument(doc); free(ptr); } };
  }

  function save(doc) {
    const writer = P.PDFiumExt_OpenFileWriter();
    try {
      P.PDFiumExt_SaveAsCopy(doc, writer);
      const size = P.PDFiumExt_GetFileWriterSize(writer);
      const data = malloc(size);
      P.PDFiumExt_GetFileWriterData(writer, data, size);
      const out = M.HEAPU8.slice(data, data + size);
      free(data);
      return out;
    } finally {
      P.PDFiumExt_CloseFileWriter(writer);
    }
  }

  function pageSize(page) {
    return { w: P.FPDF_GetPageWidthF(page), h: P.FPDF_GetPageHeightF(page) };
  }

  function toDevice(page, size, x, y) {
    P.FPDF_PageToDevice(page, 0, 0, Math.round(size.w * PRECISION), Math.round(size.h * PRECISION), 0, x, y, scratch, scratch + 4);
    return [M.getValue(scratch, "i32") / PRECISION, M.getValue(scratch + 4, "i32") / PRECISION];
  }

  function toPage(page, size, x, y) {
    P.FPDF_DeviceToPage(page, 0, 0, Math.round(size.w * PRECISION), Math.round(size.h * PRECISION), 0,
      Math.round(x * PRECISION), Math.round(y * PRECISION), scratch, scratch + 8);
    return [M.getValue(scratch, "double"), M.getValue(scratch + 8, "double")];
  }

  /** Read an FS_RECTF { left, top, right, bottom } at scratch+32 as a device rect. */
  function readRectF(page, size) {
    const base = scratch + 32;
    const [l, t, r, b] = [0, 1, 2, 3].map(k => M.getValue(base + 4 * k, "float"));
    const [x0, y0] = toDevice(page, size, l, t);
    const [x1, y1] = toDevice(page, size, r, b);
    return [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];
  }

  function writeRectF(page, size, rect) {
    const [ax, ay] = toPage(page, size, rect[0], rect[1]);
    const [bx, by] = toPage(page, size, rect[2], rect[3]);
    const base = scratch + 32;
    [Math.min(ax, bx), Math.max(ay, by), Math.max(ax, bx), Math.min(ay, by)]
      .forEach((v, k) => M.setValue(base + 4 * k, v, "float"));
    return base;
  }

  function readMeta(doc, key) {
    const n = P.FPDF_GetMetaText(doc, key, 0, 0);
    if (n <= 2) return "";
    const buf = malloc(n);
    P.FPDF_GetMetaText(doc, key, buf, n);
    const s = M.UTF16ToString(buf);
    free(buf);
    return s;
  }

  function prepare(bytes) {
    const h = load(bytes);
    try {
      const pendingRedactions = [];
      let flattened = 0;
      for (let p = 0; p < P.FPDF_GetPageCount(h.doc); p++) {
        let page = P.FPDF_LoadPage(h.doc, p);
        const size = pageSize(page);
        for (let i = P.FPDFPage_GetAnnotCount(page) - 1; i >= 0; i--) {
          const annot = P.FPDFPage_GetAnnot(page, i);
          const subtype = P.FPDFAnnot_GetSubtype(annot);
          if (subtype === ANNOT_REDACT) {
            P.FPDFAnnot_GetRect(annot, scratch + 32);
            pendingRedactions.push({ page: p, rect: readRectF(page, size) });
          } else if (subtype !== ANNOT_LINK && subtype !== ANNOT_POPUP) {
            flattened++;
          }
          P.FPDFPage_CloseAnnot(annot);
          if (subtype === ANNOT_REDACT) P.FPDFPage_RemoveAnnot(page, i);
        }
        P.FPDFPage_Flatten(page, FLAT_NORMALDISPLAY);
        P.FPDF_ClosePage(page);

        // Flatten skips hidden annotations and ones with no appearance (e.g.
        // a sticky note's popup text), so drop whatever is left except links.
        page = P.FPDF_LoadPage(h.doc, p);
        for (let i = P.FPDFPage_GetAnnotCount(page) - 1; i >= 0; i--) {
          const annot = P.FPDFPage_GetAnnot(page, i);
          const subtype = P.FPDFAnnot_GetSubtype(annot);
          P.FPDFPage_CloseAnnot(annot);
          if (subtype !== ANNOT_LINK) P.FPDFPage_RemoveAnnot(page, i);
        }
        P.FPDF_ClosePage(page);
      }
      P.EPDF_RemoveEncryption(h.doc);
      return { prepared: save(h.doc), pendingRedactions, flattened };
    } finally {
      h.close();
    }
  }

  function openDoc(bytes) {
    const h = load(bytes);
    const pages = [];
    const page = i => pages[i] || (pages[i] = P.FPDF_LoadPage(h.doc, i));
    const pageCount = P.FPDF_GetPageCount(h.doc);

    return {
      pageCount,

      pageBounds(i) {
        const { w, h: ht } = pageSize(page(i));
        return [0, 0, w, ht];
      },

      renderPage(i, scale) {
        const pg = page(i);
        const { w, h: ht } = pageSize(pg);
        const width = Math.max(1, Math.round(w * scale));
        const height = Math.max(1, Math.round(ht * scale));
        const bitmap = P.FPDFBitmap_Create(width, height, 0);
        try {
          P.FPDFBitmap_FillRect(bitmap, 0, 0, width, height, 0xFFFFFFFF);
          P.FPDF_RenderPageBitmap(bitmap, pg, 0, 0, width, height, 0, RENDER_ANNOTS);
          const stride = P.FPDFBitmap_GetStride(bitmap);
          const src = M.HEAPU8.subarray(P.FPDFBitmap_GetBuffer(bitmap), P.FPDFBitmap_GetBuffer(bitmap) + stride * height);
          const data = new Uint8ClampedArray(width * height * 4);
          for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
              const s = y * stride + x * 4;
              const d = (y * width + x) * 4;
              data[d] = src[s + 2];     // BGRx -> RGBA
              data[d + 1] = src[s + 1];
              data[d + 2] = src[s];
              data[d + 3] = 255;
            }
          }
          return { width, height, data };
        } finally {
          P.FPDFBitmap_Destroy(bitmap);
        }
      },

      indexPage(i) {
        const pg = page(i);
        const size = pageSize(pg);
        const tp = P.FPDFText_LoadPage(pg);
        let text = "";
        const boxes = [];
        let line = 0;
        try {
          const n = P.FPDFText_CountChars(tp);
          for (let c = 0; c < n; c++) {
            const code = P.FPDFText_GetUnicode(tp, c);
            if (code === 13) continue;
            if (code === 10) {
              text += "\n";
              boxes.push(null);
              line++;
              continue;
            }
            const ch = String.fromCodePoint(code);
            text += ch;
            for (let k = 1; k < ch.length; k++) boxes.push(null); // surrogate pairs
            if (P.FPDFText_IsGenerated(tp, c) === 1 || !P.FPDFText_GetLooseCharBox(tp, c, scratch + 32)) {
              boxes.push(null);
            } else {
              boxes.push({ rect: readRectF(pg, size), line });
            }
          }
        } finally {
          P.FPDFText_ClosePage(tp);
        }
        return { text, boxes };
      },

      async inspect() {
        const metadata = {};
        for (const key of METADATA_FIELDS) metadata[key] = readMeta(h.doc, key);
        let annotations = 0;
        for (let p = 0; p < pageCount; p++) {
          const pg = page(p);
          for (let i = 0; i < P.FPDFPage_GetAnnotCount(pg); i++) {
            const annot = P.FPDFPage_GetAnnot(pg, i);
            if (P.FPDFAnnot_GetSubtype(annot) !== ANNOT_LINK) annotations++;
            P.FPDFPage_CloseAnnot(annot);
          }
        }
        // PDFium has no API for the catalog's XMP stream; read it with pdf-lib.
        const pdf = await PDFLib.PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
        const form = pdf.catalog.lookupMaybe(PDFLib.PDFName.of("AcroForm"), PDFLib.PDFDict);
        const fields = form && form.lookupMaybe(PDFLib.PDFName.of("Fields"), PDFLib.PDFArray);
        return {
          metadata,
          hasXmp: pdf.catalog.has(PDFLib.PDFName.of("Metadata")),
          attachments: P.FPDFDoc_GetAttachmentCount(h.doc),
          annotations,
          formFields: fields ? fields.size() : 0,
          revisions: countOccurrences(bytes, "startxref"),
        };
      },

      destroy() {
        pages.forEach(p => p && P.FPDF_ClosePage(p));
        h.close();
      },
    };
  }

  async function apply(bytes, marks, sanitize) {
    const removed = { attachments: 0, scripts: false, metadata: false, bookmarks: false };
    const h = load(bytes);
    let out;
    try {
      for (const [p, rects] of rectsByPage(marks)) {
        const page = P.FPDF_LoadPage(h.doc, p);
        const size = pageSize(page);
        for (const rect of rects) {
          const annot = P.FPDFPage_CreateAnnot(page, ANNOT_REDACT);
          P.FPDFAnnot_SetRect(annot, writeRectF(page, size, rect));
          P.FPDFPage_CloseAnnot(annot);
        }
        P.EPDFPage_ApplyRedactions(page);

        // PDFium removes the content but leaves the area blank, so paint the
        // familiar black boxes as ordinary page content.
        for (const rect of rects) {
          const base = writeRectF(page, size, rect);
          const [left, top, right, bottom] = [0, 1, 2, 3].map(k => M.getValue(base + 4 * k, "float"));
          const box = P.FPDFPageObj_CreateNewRect(left, bottom, right - left, top - bottom);
          P.FPDFPageObj_SetFillColor(box, 0, 0, 0, 255);
          P.FPDFPath_SetDrawMode(box, FILLMODE_ALTERNATE, false);
          P.FPDFPage_InsertObject(page, box);
        }
        P.FPDFPage_GenerateContent(page);
        P.FPDF_ClosePage(page);
      }

      if (sanitize.attachments) {
        while (P.FPDFDoc_GetAttachmentCount(h.doc) > 0 && P.FPDFDoc_DeleteAttachment(h.doc, 0)) {
          removed.attachments++;
        }
      }
      if (sanitize.bookmarks) {
        P.EPDFBookmark_Clear(h.doc);
        removed.bookmarks = true;
      }
      out = save(h.doc);
    } finally {
      h.close();
    }
    return { bytes: await cleanStructure(out, sanitize, removed), removed };
  }

  /**
   * Remove what PDFium can't (XMP, document JavaScript, thumbnails, the
   * info dictionary, the form dictionary), then drop every object no longer
   * reachable from the document root, in case anything orphaned still holds
   * original content.
   */
  async function cleanStructure(bytes, sanitize, removed) {
    const { PDFDocument, PDFName, PDFDict } = PDFLib;
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    const catalog = pdf.catalog;
    const del = (dict, key) => dict && dict.delete(PDFName.of(key));

    for (const page of pdf.getPages()) {
      del(page.node, "Thumb");
      del(page.node, "PieceInfo");
      del(page.node, "Metadata");
    }
    // Fields were flattened into the pages on open; the form dictionary
    // left behind still holds their original values.
    del(catalog, "AcroForm");

    const names = catalog.lookupMaybe(PDFName.of("Names"), PDFDict);
    if (sanitize.metadata) {
      pdf.context.trailerInfo.Info = undefined;
      del(catalog, "Info"); // non-standard, but some producers put one here
      del(catalog, "Metadata");
      del(catalog, "PieceInfo");
      removed.metadata = true;
    }
    if (sanitize.attachments) del(names, "EmbeddedFiles");
    if (sanitize.scripts) {
      del(names, "JavaScript");
      del(catalog, "OpenAction");
      del(catalog, "AA");
      removed.scripts = true;
    }
    if (sanitize.bookmarks) del(catalog, "Outlines");

    collectGarbage(pdf.context);
    return pdf.save({ useObjectStreams: false, updateFieldAppearances: false, addDefaultPage: false });
  }

  function collectGarbage(context) {
    const { PDFRef, PDFDict, PDFArray, PDFStream } = PDFLib;
    const reachable = new Set();
    const t = context.trailerInfo;
    const stack = [t.Root, t.Info, t.Encrypt].filter(Boolean);
    while (stack.length) {
      const obj = stack.pop();
      if (obj instanceof PDFRef) {
        const key = obj.toString();
        if (reachable.has(key)) continue;
        reachable.add(key);
        const target = context.lookup(obj);
        if (target) stack.push(target);
      } else if (obj instanceof PDFDict) {
        for (const [, value] of obj.entries()) stack.push(value);
      } else if (obj instanceof PDFArray) {
        stack.push(...obj.asArray());
      } else if (obj instanceof PDFStream) {
        stack.push(obj.dict);
      }
    }
    for (const [ref] of context.enumerateIndirectObjects()) {
      if (!reachable.has(ref.toString())) context.delete(ref);
    }
  }

  return {
    name: "pdfium",
    label: "PDFium / EmbedPDF (MIT)",
    prepare,
    openDoc,
    apply,
  };
}

function countOccurrences(bytes, word) {
  const needle = Array.from(word, c => c.charCodeAt(0));
  let count = 0;
  outer: for (let i = 0; i <= bytes.length - needle.length; i++) {
    for (let k = 0; k < needle.length; k++) {
      if (bytes[i + k] !== needle[k]) continue outer;
    }
    count++;
  }
  return count;
}

/** Load PDFium (EmbedPDF build) and pdf-lib from the CDN and wrap them as a backend. */
export async function loadPdfiumBackend() {
  const [{ init, DEFAULT_PDFIUM_WASM_URL }, PDFLib] = await Promise.all([import(PDFIUM_URL), import(PDFLIB_URL)]);
  const res = await fetch(DEFAULT_PDFIUM_WASM_URL);
  if (!res.ok) throw new Error(`Could not download PDFium (${res.status}).`);
  const P = await init({ wasmBinary: await res.arrayBuffer() });
  return createPdfiumBackend(P, PDFLib);
}
