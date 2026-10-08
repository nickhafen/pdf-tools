# PDF Redline & Comparison Suite

Browser-based PDF tools: compare two versions of a PDF as a redline, and permanently redact sensitive content. All document processing happens client-side in the browser, so uploaded documents never leave your machine.

**Live site:** https://nickhafen.github.io/pdf-tools/ (deployed from `main` by GitHub Pages)

## Features

### Compare (`/`)

- Side-by-side or single-pane comparison of two PDF versions
- Client-side text extraction and redline diffing (insertions/deletions highlighted)
- Independent per-pane document pickers, with swap and reset controls
- Adjustable text size
- Export the redline comparison to PDF
- Bundled sample document pairs (contract, NDA, legal memo, lease) for a quick demo, no upload required; **Load Sample** opens the contract, and its dropdown lists the rest

### Redact (`/redact`)

- True redaction: marked text is deleted from the PDF's content streams, image pixels under a box are blanked, and covered vector art is removed (not just covered with a black box)
- Mark by search (plain text or regex, with presets for SSNs, emails, phone and card numbers), by selecting text on the page as in a PDF reader, or by drawing boxes (a box that cuts through text grows to cover every character it touches); click a mark to drop it, Ctrl+Z to undo
- Comments, stamps, and form fields are flattened first so their text can be found and redacted; redaction marks left unapplied by other tools are detected and applied
- Strips metadata, attachments, JavaScript, bookmarks, thumbnails, and earlier saved revisions
- After applying, the output is re-opened and checked for any leftover marked text before download
- Two interchangeable engines, chosen with the **Engine** toggle (or `?engine=mupdf|pdfium`): **MuPDF** (AGPL) or **PDFium** via EmbedPDF + pdf-lib (Apache-2.0/MIT). Switching keeps your marks, and **Cross-check** re-verifies the output with the other engine

## Run locally

The app is static, so the GitHub Pages site is the easiest way to use it. Running it locally adds one feature: the **Load Sample** dropdown also lists your own private demo pairs from `test-documents/`.

### Requirements

- Python 3.9+

### Setup

```bash
pip install -r requirements.txt
```

### Start

```bash
python main.py
```

The app starts at [http://127.0.0.1:8000](http://127.0.0.1:8000).

## Deployment

`.github/workflows/pages.yml` publishes on every push to `main`. It copies `static/` into the site, lifts `index.html` and `redact.html` to the root, and deploys with GitHub Pages. No build step is needed; all page links and asset paths are relative, so the same HTML works locally and under `/pdf-tools/`.

## How it works

- `main.py` — local FastAPI server: serves the static frontend and the local-only `test-documents/` demo list (`/api/samples/...`)
- `static/` — frontend (HTML/CSS/JS) that handles PDF parsing and diffing in-browser
- `static/js/redactEngine.js` — engine-independent redaction core (search, mark geometry, leak verification)
- `static/js/redactMupdf.js` / `static/js/redactPdfium.js` — the two engine backends, each loaded from jsDelivr at a pinned version; `static/js/redactApp.js` is the UI
- `static/samples/` — the bundled synthetic demo pairs and their `manifest.json`, committed so the static site has them; `create_samples.py` regenerates them (add a pair there to add it to the dropdown)
- `test-documents/` — optional local-only folder for your own demo document pairs (gitignored, never committed); files named like `label-v1.pdf` / `label-v2.pdf` are auto-detected and listed for local comparison

## Maintenance

The browser libraries are loaded from CDNs at pinned versions, each with a Subresource Integrity (SRI) hash, so the browser refuses a file whose contents don't match. A version bump therefore means updating the URL **and** its hash together, or that library stops loading.

| Library | Version | URL and hash live in |
|---|---|---|
| PDF.js + worker | 4.10.38 | `static/index.html` (module hash in the import map; worker fetched with SRI in the inline script) |
| html2canvas | 1.4.1 | `static/index.html` |
| jsPDF | 2.5.1 | `static/index.html` |
| Lucide icons | 1.47.0 | `static/index.html`, `static/redact.html` |
| MuPDF.js | 1.28.1 | JS modules: import map in `static/redact.html`; `.wasm`: `static/js/redactMupdf.js` |
| @embedpdf/pdfium | 2.15.1 | JS module: import map in `static/redact.html`; `.wasm`: `static/js/redactPdfium.js` |
| pdf-lib | 1.17.1 | URL: `static/js/redactPdfium.js`; hash: import map in `static/redact.html` |
| Google Fonts | n/a | `static/index.html`, `static/redact.html` (no SRI possible; the CSS varies by browser) |

To compute a hash for a new file:

```bash
curl -sL <url> | openssl dgst -sha384 -binary | openssl base64 -A
```

Prefix the output with `sha384-`.

### Checklist

Run through this monthly, and whenever a security advisory lands for one of the libraries above.

- [ ] **Security advisories.** Check each library's GitHub security advisories (or [GitHub Advisory Database](https://github.com/advisories) / [Snyk](https://security.snyk.io/)). PDF.js, MuPDF, and PDFium matter most, since they parse untrusted PDFs.
- [ ] **New releases.** Check each library for a newer version. Prefer a release that has been out at least two weeks over one published days ago.
- [ ] **When bumping a library:**
  - [ ] Update the version in every URL that references it (table above).
  - [ ] Recompute and replace the SRI hash for every file of that library, including `.wasm` files and the PDF.js worker.
  - [ ] For MuPDF and PDFium, load the Redact page with each engine and check the browser's network tab for CDN files that aren't in the import map (a release can rename or add internal modules).
  - [ ] For Lucide, confirm every icon still renders; a renamed icon silently renders nothing.
  - [ ] For PDF.js, skip 5.6.83 through 6.2.107 (CVE-2026-16633, arbitrary JavaScript execution); go to 6.2.108 or later. From 5.0 on, the JPEG 2000, JBIG2, and ICC color decoders are separate `.wasm` files that PDF.js fetches itself (the `wasmUrl` option), so they can't carry SRI; serve them from this repo or leave them out (text extraction still works, but some images won't draw in the PDF Canvas view). 6.x needs Chrome 125+ or Safari 18+.
  - [ ] Update the version in `THIRD_PARTY_NOTICES.md` and re-check the license.
  - [ ] Test: run a Compare on a sample pair, export the redline PDF, and redact a document with both engines (plus **Cross-check**). Watch the console for integrity errors.
- [ ] **GitHub Actions.** Check `.github/workflows/pages.yml` for new major versions of the `actions/*` steps.
- [ ] **Python packages** (local server only). `requirements.txt` uses minimum versions; run `pip install -U -r requirements.txt` and confirm `python main.py` still serves both tools.
- [ ] **Live site.** After the deploy finishes, open both tools on the live site and check the console for errors.

Import-map integrity (PDF.js and the JS modules of the redaction engines) is enforced in Chrome/Edge 127+, Firefox 138+, and Safari 18+. Older browsers still load those modules, just without the hash check; the PDF.js worker and the `.wasm` files are checked in every browser. PDF.js 4.x itself needs a recent browser (roughly Chrome 119+, Firefox 121+, Safari 17.4+); older ones would need its `legacy/` build.

## License

This project's code is MIT — see [LICENSE](LICENSE).

Third-party components keep their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). In particular, the Redact tool's **MuPDF** engine is MuPDF.js by Artifex Software, licensed under the GNU AGPL v3. Distributing or hosting the app with that engine is subject to the AGPL for the combined program, including keeping the complete source available. The **PDFium** engine path uses only Apache-2.0 and MIT components.
