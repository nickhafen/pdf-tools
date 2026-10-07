# Third-Party Notices

This project's own source code is licensed under the MIT License (see [LICENSE](LICENSE)). It uses the third-party components below, each under its own license. None of them is copied into this repository: the browser libraries are loaded at runtime from the jsDelivr CDN at the pinned versions listed, and the Python packages are installed from `requirements.txt`.

## Redaction engines (Redact tool, `/redact`)

The Redact tool lets the user choose between two engines. Only the selected engine is downloaded.

| Component | Version | License | Source |
|---|---|---|---|
| MuPDF.js (Artifex Software, Inc.) | 1.28.1 | GNU AGPL v3 or later | https://github.com/ArtifexSoftware/mupdf.js |
| PDFium (The PDFium Authors) | as built in @embedpdf/pdfium 2.15.1 | Apache License 2.0 (BSD-style for some files) | https://pdfium.googlesource.com/pdfium/ |
| @embedpdf/pdfium (EmbedPDF) | 2.15.1 | MIT | https://github.com/embedpdf/embed-pdf-viewer |
| pdf-lib (Andrew Dillon) | 1.17.1 | MIT | https://github.com/Hopding/pdf-lib |

### About the AGPL component

MuPDF.js is licensed under the GNU Affero General Public License v3. When the Redact tool runs with the **MuPDF** engine, the combined program the browser executes includes MuPDF, and anyone who distributes or publicly hosts it must do so under the terms of the AGPL. This includes providing the complete corresponding source code. This project's source is public, and MuPDF's source is available at the link above. The full license text is at https://www.gnu.org/licenses/agpl-3.0.html.

This project's own files remain under the MIT License. The **PDFium** engine path uses only permissively licensed components (Apache 2.0 and MIT). A deployment that removes the MuPDF option would include no AGPL code.

## Compare tool (`/`)

| Component | Version | License | Source |
|---|---|---|---|
| PDF.js (Mozilla) | 3.11.174 | Apache License 2.0 | https://github.com/mozilla/pdf.js |
| diff-match-patch (Google), vendored in `static/js/diff_match_patch.js` | n/a | Apache License 2.0 | https://github.com/google/diff-match-patch |
| html2canvas | 1.4.1 | MIT | https://github.com/niklasvh/html2canvas |
| jsPDF | 2.5.1 | MIT | https://github.com/parallax/jsPDF |

## Shared

| Component | License | Source |
|---|---|---|
| Lucide icons | ISC | https://github.com/lucide-icons/lucide |
| Inter, Outfit, JetBrains Mono fonts (Google Fonts) | SIL Open Font License 1.1 | https://fonts.google.com |

## Server and tooling (Python)

| Component | License | Notes |
|---|---|---|
| FastAPI, Uvicorn | MIT, BSD-3-Clause | Serve the static app and sample PDFs |
| PyMuPDF (Artifex Software, Inc.) | GNU AGPL v3 | Used only by `create_samples.py`, which the server runs to generate the two demo PDFs if they are missing. It never handles user documents and is not part of the code sent to the browser. |
