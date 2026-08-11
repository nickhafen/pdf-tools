/**
 * PDF Engine Service - Browser-side text extraction via PDF.js.
 * Documents never leave the browser: extraction happens entirely client-side.
 */

class PDFEngine {
  /**
   * Extract text and pages from a PDF File object.
   * @param {File} file - PDF file object
   * @returns {Promise<Object>} Extracted document object
   */
  async extractText(file) {
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

      pagesData.push({
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
      ocr_used: false
    };
  }
}

window.pdfEngine = new PDFEngine();
