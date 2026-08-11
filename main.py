import os
import io
from typing import List, Dict, Any, Optional
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import pymupdf
import diff_match_patch as dmp_module

app = FastAPI(
    title="PDF Redline & Comparison Suite",
    description="High-performance document text extraction and redline comparison app with modular OCR support.",
    version="1.0.0"
)

# Enable CORS for development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==============================================================================
# MODULAR TEXT EXTRACTION ARCHITECTURE (OCR-Ready)
# ==============================================================================

class BaseTextExtractor:
    """Abstract Base Class for Document Text Extraction"""
    def extract_text(self, pdf_bytes: bytes) -> Dict[str, Any]:
        raise NotImplementedError

class PyMuPDFTextExtractor(BaseTextExtractor):
    """Native PDF vector/text stream extractor using PyMuPDF (fitz)"""
    def extract_text(self, pdf_bytes: bytes) -> Dict[str, Any]:
        doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
        pages_data = []
        full_text_list = []
        total_words = 0

        for page_num in range(len(doc)):
            page = doc[page_num]
            page_text = page.get_text("text")
            # Sanitize zero-width spaces and special Unicode characters
            import re
            page_text = re.sub(r'[\u200b\u200c\u200d\ufeff]', '', page_text)
            page_text = page_text.replace('\u00a0', ' ')
            
            text_blocks = page.get_text("blocks")
            blocks = []
            for b in text_blocks:
                if len(b) >= 5 and b[4].strip():
                    clean_b_text = re.sub(r'[\u200b\u200c\u200d\ufeff]', '', b[4]).strip()
                    blocks.append({
                        "bbox": [b[0], b[1], b[2], b[3]],
                        "text": clean_b_text,
                        "type": b[6] if len(b) > 6 else 0
                    })
            
            word_count = len(page_text.split())
            total_words += word_count
            pages_data.append({
                "page": page_num + 1,
                "text": page_text,
                "word_count": word_count,
                "blocks": blocks
            })
            full_text_list.append(page_text)

        doc.close()
        full_text = "\n\n".join(full_text_list)
        return {
            "page_count": len(pages_data),
            "total_words": total_words,
            "full_text": full_text,
            "pages": pages_data,
            "ocr_used": False
        }

class OCRExtractorStub(BaseTextExtractor):
    """
    Modular Placeholder for future OCR Engine integration (e.g. Tesseract, EasyOCR, or Docling).
    When OCR mode is enabled, this extractor renders PDF pages to images and runs optical recognition.
    """
    def extract_text(self, pdf_bytes: bytes) -> Dict[str, Any]:
        # Hook point for Tesseract / EasyOCR integration
        return {
            "error": "OCR engine is currently disabled. Initialized modular interface for future extension.",
            "ocr_used": True
        }

# Global Extractor Registry
EXTRACTORS = {
    "native": PyMuPDFTextExtractor(),
    "ocr": OCRExtractorStub()
}

# ==============================================================================
# DIFF & REDLINE PROCESSING ENGINE
# ==============================================================================

class RedlineEngine:
    def __init__(self):
        self.dmp = dmp_module.diff_match_patch()
        # Adjust DMP timeout and threshold for fast semantic cleanup
        self.dmp.Diff_Timeout = 2.0

    def compute_redline(self, text_v1: str, text_v2: str) -> Dict[str, Any]:
        import re
        text_v1 = re.sub(r'[\u200b\u200c\u200d\ufeff]', '', text_v1 or '').replace('\u00a0', ' ')
        text_v2 = re.sub(r'[\u200b\u200c\u200d\ufeff]', '', text_v2 or '').replace('\u00a0', ' ')

        # 1. Compute raw character/word diffs
        raw_diffs = self.dmp.diff_main(text_v1, text_v2)
        # 2. Apply semantic cleanup to make diffs human-readable (combining word fragments)
        self.dmp.diff_cleanupSemantic(raw_diffs)
        
        # 3. Analyze statistics & construct structured delta tokens
        delta_tokens = []
        additions_words = 0
        deletions_words = 0
        unchanged_words = 0
        changes_count = 0
        
        for op, data in raw_diffs:
            word_cnt = len(data.split())
            if op == 0:  # EQUAL
                delta_tokens.append({"op": "EQUAL", "text": data})
                unchanged_words += word_cnt
            elif op == 1:  # INSERT (Addition)
                delta_tokens.append({"op": "INSERT", "text": data})
                additions_words += word_cnt
                changes_count += 1
            elif op == -1:  # DELETE (Deletion)
                delta_tokens.append({"op": "DELETE", "text": data})
                deletions_words += word_cnt
                changes_count += 1

        total_words_v1 = len(text_v1.split())
        total_words_v2 = len(text_v2.split())
        total_ops_words = unchanged_words + additions_words + deletions_words
        
        similarity_score = round((unchanged_words / max(total_ops_words, 1)) * 100, 1)

        # 4. Generate line-by-line / paragraph-by-paragraph redline representation
        lines_v1 = text_v1.splitlines()
        lines_v2 = text_v2.splitlines()

        return {
            "statistics": {
                "similarity_score": similarity_score,
                "changes_count": changes_count,
                "words_v1": total_words_v1,
                "words_v2": total_words_v2,
                "additions_words": additions_words,
                "deletions_words": deletions_words,
                "unchanged_words": unchanged_words,
            },
            "diffs": delta_tokens,
            "lines_v1_count": len(lines_v1),
            "lines_v2_count": len(lines_v2)
        }

redline_engine = RedlineEngine()

# ==============================================================================
# API ENDPOINTS
# ==============================================================================

@app.post("/api/extract")
async def extract_pdf_text(
    file: UploadFile = File(...),
    use_ocr: bool = Form(False)
):
    """Extract structured text from an uploaded PDF file."""
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")
    
    contents = await file.read()
    extractor_key = "ocr" if use_ocr else "native"
    extractor = EXTRACTORS.get(extractor_key, EXTRACTORS["native"])
    
    result = extractor.extract_text(contents)
    result["filename"] = file.filename
    return JSONResponse(result)

@app.post("/api/compare")
async def compare_pdfs(
    file_v1: Optional[UploadFile] = File(None),
    file_v2: Optional[UploadFile] = File(None),
    text_v1: Optional[str] = Form(None),
    text_v2: Optional[str] = Form(None),
    use_ocr: bool = Form(False)
):
    """
    Compare two PDFs or raw text strings and return detailed redline diffs and metrics.
    """
    doc1_text = ""
    doc2_text = ""
    file1_name = "Original Document"
    file2_name = "Revised Document"

    extractor_key = "ocr" if use_ocr else "native"
    extractor = EXTRACTORS.get(extractor_key, EXTRACTORS["native"])

    if file_v1:
        file1_name = file_v1.filename
        bytes1 = await file_v1.read()
        res1 = extractor.extract_text(bytes1)
        doc1_text = res1.get("full_text", "")
    elif text_v1:
        doc1_text = text_v1

    if file_v2:
        file2_name = file_v2.filename
        bytes2 = await file_v2.read()
        res2 = extractor.extract_text(bytes2)
        doc2_text = res2.get("full_text", "")
    elif text_v2:
        doc2_text = text_v2

    if not doc1_text and not doc2_text:
        raise HTTPException(status_code=400, detail="Please provide two PDF files or text strings to compare.")

    comparison_result = redline_engine.compute_redline(doc1_text, doc2_text)
    comparison_result["document_v1"] = {"filename": file1_name, "text_length": len(doc1_text)}
    comparison_result["document_v2"] = {"filename": file2_name, "text_length": len(doc2_text)}
    
    return JSONResponse(comparison_result)

@app.get("/api/samples/contract_v1")
async def get_sample_v1():
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    path = os.path.join(BASE_DIR, "sample_contract_v1.pdf")
    if not os.path.exists(path):
        try:
            from create_samples import create_sample_pdfs
            create_sample_pdfs()
        except Exception as e:
            print("Error auto-generating samples:", e)

    if os.path.exists(path):
        return FileResponse(path, media_type="application/pdf", filename="sample_contract_v1.pdf")
    raise HTTPException(status_code=404, detail="Sample PDF 1 not found.")

@app.get("/api/samples/contract_v2")
async def get_sample_v2():
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    path = os.path.join(BASE_DIR, "sample_contract_v2.pdf")
    if not os.path.exists(path):
        try:
            from create_samples import create_sample_pdfs
            create_sample_pdfs()
        except Exception as e:
            print("Error auto-generating samples:", e)

    if os.path.exists(path):
        return FileResponse(path, media_type="application/pdf", filename="sample_contract_v2.pdf")
    raise HTTPException(status_code=404, detail="Sample PDF 2 not found.")

# ==============================================================================
# STATIC FILES & SERVING
# ==============================================================================

# Ensure static directory exists
os.makedirs("static", exist_ok=True)
os.makedirs("static/css", exist_ok=True)
os.makedirs("static/js", exist_ok=True)

app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
async def root():
    return FileResponse("static/index.html")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
