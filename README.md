# PDF Redline & Comparison Suite

A browser-based tool for comparing two versions of a PDF and viewing a redline-style diff. All text extraction and diffing happens client-side in the browser — the FastAPI backend only serves static files and sample/demo PDFs, so uploaded documents never leave your machine.

## Features

- Side-by-side or single-pane comparison of two PDF versions
- Client-side text extraction and redline diffing (insertions/deletions highlighted)
- Independent per-pane document pickers, with swap and reset controls
- Adjustable text size
- Export the redline comparison to PDF
- Bundled sample contract pair for a quick demo, no upload required

## Requirements

- Python 3.9+

## Setup

```bash
pip install -r requirements.txt
```

## Run

```bash
python main.py
```

The app starts at [http://127.0.0.1:8000](http://127.0.0.1:8000).

## How it works

- `main.py` — FastAPI app; serves the static frontend and sample PDF endpoints (`/api/samples/...`)
- `static/` — frontend (HTML/CSS/JS) that handles PDF parsing and diffing in-browser
- `create_samples.py` — generates the bundled `sample_contract_v1.pdf` / `sample_contract_v2.pdf` demo pair if they're missing
- `test-documents/` — optional local-only folder for your own demo document pairs (gitignored, never committed); files named like `label-v1.pdf` / `label-v2.pdf` are auto-detected and listed for local comparison

## License

MIT — see [LICENSE](LICENSE).
