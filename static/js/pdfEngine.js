/**
 * PDF Engine Service - Handles Document Extraction with Modular OCR Strategy
 */

class PDFEngine {
  constructor() {
    this.useBackend = true; // Default to fast PyMuPDF FastAPI backend
  }

  /**
   * Extract text and pages from a PDF File object.
   * @param {File} file - PDF file object
   * @returns {Promise<Object>} Extracted document object
   */
  async extractText(file) {
    if (this.useBackend) {
      try {
        return await this._extractViaBackend(file);
      } catch (err) {
        console.warn("Backend extraction failed, falling back to client PDF.js:", err);
        return await this._extractViaPDFJS(file);
      }
    } else {
      return await this._extractViaPDFJS(file);
    }
  }

  /**
   * Server-side PyMuPDF Extraction API
   */
  async _extractViaBackend(file) {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("use_ocr", "false"); // Extensible OCR toggle

    const response = await fetch("/api/extract", {
      method: "POST",
      body: formData
    });

    if (!response.ok) {
      throw new Error(`Server returned HTTP ${response.status}`);
    }

    return await response.json();
  }

  /**
   * Client-side PDF.js Extraction Fallback
   */
  async _extractViaPDFJS(file) {
    if (!window.pdfjsLib) {
      throw new Error("PDF.js library is not loaded");
    }

    const arrayBuffer = await file.arrayBuffer();
    const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    
    let fullTextParts = [];
    let pagesData = [];
    let totalWords = 0;

    for (let i = 1; i <= pdfDoc.numPages; i++) {
      const page = await pdfDoc.getPage(i);
      const textContent = await page.getTextContent();
      
      const pageText = textContent.items
        .map(item => item.str)
        .join(' ')
        .replace(/\s+/g, ' ');

      const wordCount = pageText.trim().split(/\s+/).filter(Boolean).length;
      totalWords += wordCount;

      pagesData.append ? pagesData.append : pagesData.push({
        page: i,
        text: pageText,
        word_count: wordCount
      });
      fullTextParts.push(pageText);
    }

    return {
      filename: file.name,
      page_count: pdfDoc.numPages,
      total_words: totalWords,
      full_text: fullTextParts.join('\n\n'),
      pages: pagesData,
      ocr_used: false,
      extracted_by: "PDF.js (Browser Client)"
    };
  }
}

window.pdfEngine = new PDFEngine();
