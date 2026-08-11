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
# PUBLIC SAMPLE CONTRACTS (bundled demo, auto-generated if missing)
# ==============================================================================

def _ensure_public_samples():
    path_v1 = os.path.join(BASE_DIR, "sample_contract_v1.pdf")
    path_v2 = os.path.join(BASE_DIR, "sample_contract_v2.pdf")
    if not (os.path.exists(path_v1) and os.path.exists(path_v2)):
        try:
            from create_samples import create_sample_pdfs
            create_sample_pdfs()
        except Exception as e:
            print("Error auto-generating samples:", e)
    return path_v1, path_v2

@app.get("/api/samples/contract_v1")
async def get_sample_v1():
    path_v1, _ = _ensure_public_samples()
    if os.path.exists(path_v1):
        return FileResponse(path_v1, media_type="application/pdf", filename="sample_contract_v1.pdf")
    raise HTTPException(status_code=404, detail="Sample PDF 1 not found.")

@app.get("/api/samples/contract_v2")
async def get_sample_v2():
    _, path_v2 = _ensure_public_samples()
    if os.path.exists(path_v2):
        return FileResponse(path_v2, media_type="application/pdf", filename="sample_contract_v2.pdf")
    raise HTTPException(status_code=404, detail="Sample PDF 2 not found.")

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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
