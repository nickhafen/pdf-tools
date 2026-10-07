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
- Mark by search (plain text or regex, with presets for SSNs, emails, phone and card numbers) or by drawing boxes; click a mark to drop it, Ctrl+Z to undo
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

## License

This project's code is MIT — see [LICENSE](LICENSE).

Third-party components keep their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). In particular, the Redact tool's **MuPDF** engine is MuPDF.js by Artifex Software, licensed under the GNU AGPL v3. Distributing or hosting the app with that engine is subject to the AGPL for the combined program, including keeping the complete source available. The **PDFium** engine path uses only Apache-2.0 and MIT components.
