import os
import re
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

app = FastAPI(
    title="PDF Redline & Comparison Suite",
    description="Browser-based PDF text extraction and redline comparison. All document parsing and diffing happens client-side; the server only serves static files and demo PDFs.",
    version="2.0.0"
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TEST_DOCS_DIR = os.path.join(BASE_DIR, "test-documents")

# Matches e.g. "doc1-v1.pdf", "sample_contract_v2.pdf" -> (label="doc1", version="1")
SAMPLE_FILENAME_RE = re.compile(r"^(?P<label>.+?)[-_ ]*v(?P<version>[12])\.pdf$", re.IGNORECASE)

# ==============================================================================
# PUBLIC SAMPLE CONTRACTS (bundled demo in static/samples/, committed so the
# static GitHub Pages build has them; regenerated here only if missing)
# ==============================================================================

SAMPLES_DIR = os.path.join(BASE_DIR, "static", "samples")

def _ensure_public_samples():
    paths = [os.path.join(SAMPLES_DIR, f"sample_contract_v{v}.pdf") for v in (1, 2)]
    if not all(os.path.exists(p) for p in paths):
        try:
            from create_samples import create_sample_pdfs
            create_sample_pdfs()
        except Exception as e:
            print("Error auto-generating samples:", e)

_ensure_public_samples()

# ==============================================================================
# PRIVATE TEST-DOCUMENT DEMOS (local only — this folder is gitignored and never
# committed; it only exists on a developer's own machine)
# ==============================================================================

def _scan_test_documents():
    """Group files in test-documents/ by label, keeping only pairs with both v1 and v2."""
    pairs = {}
    if not os.path.isdir(TEST_DOCS_DIR):
        return pairs
    for fname in os.listdir(TEST_DOCS_DIR):
        match = SAMPLE_FILENAME_RE.match(fname)
        if not match:
            continue
        label = match.group("label")
        version = match.group("version")
        pairs.setdefault(label, {})[f"v{version}"] = fname
    return {label: files for label, files in pairs.items() if "v1" in files and "v2" in files}

@app.get("/api/samples/list")
async def list_test_document_samples():
    """List locally-available demo document pairs from the (gitignored) test-documents folder."""
    pairs = _scan_test_documents()
    return [{"label": label} for label in sorted(pairs.keys())]

@app.get("/api/samples/testdoc/{label}/{version}")
async def get_test_document_sample(label: str, version: str):
    if version not in ("v1", "v2"):
        raise HTTPException(status_code=400, detail="Version must be v1 or v2.")
    pairs = _scan_test_documents()
    if label not in pairs or version not in pairs[label]:
        raise HTTPException(status_code=404, detail="Sample document not found.")
    filename = pairs[label][version]
    path = os.path.join(TEST_DOCS_DIR, filename)
    return FileResponse(path, media_type="application/pdf", filename=filename)

# ==============================================================================
# STATIC FILES & SERVING
# ==============================================================================

app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
async def root():
    return FileResponse("static/index.html")

# Pages link to each other as "./" and "redact.html" (relative, so the same
# HTML also works on GitHub Pages under /pdf-tools/).
@app.get("/redact")
@app.get("/redact.html")
async def redact():
    return FileResponse("static/redact.html")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
