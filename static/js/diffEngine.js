/**
 * Diff Engine Service - Computes word-level diffs, redline HTML, and side-by-side alignment
 */

class DiffEngine {

  /**
   * Compare two PDF files or text strings
   */
  async compareDocuments(fileV1, fileV2, textV1, textV2) {
    textV1 = this._cleanText(textV1);
    textV2 = this._cleanText(textV2);
    try {
      const formData = new FormData();
      if (textV1 && textV2) {
        formData.append("text_v1", textV1);
        formData.append("text_v2", textV2);
      } else {
        if (fileV1) formData.append("file_v1", fileV1);
        if (fileV2) formData.append("file_v2", fileV2);
      }

      const response = await fetch("/api/compare", {
        method: "POST",
        body: formData
      });

      if (response.ok) {
        const result = await response.json();
        return this._processDiffResult(result, textV1 || "", textV2 || "");
      } else {
        const errText = await response.text();
        console.warn(`Backend compare API returned HTTP ${response.status}: ${errText}`);
      }
    } catch (e) {
      console.warn("Backend compare API failed, running client-side diff:", e);
    }

    // Client-side fallback using bundled diff_match_patch JS
    return this._compareClientSide(textV1 || "", textV2 || "");
  }

  /**
   * Format raw API diff tokens into HTML and interactive navigation anchors
   */
  _processDiffResult(result, textV1, textV2) {
    let rawHtml = "";
    let changeIndex = 0;
    let diffNodes = [];

    (result.diffs || []).forEach((token) => {
      const escapedText = this._escapeHtml(token.text);
      if (token.op === "EQUAL") {
        rawHtml += escapedText;
      } else if (token.op === "INSERT") {
        changeIndex++;
        const changeId = `diff-change-${changeIndex}`;
        diffNodes.push({ id: changeId, type: "insert", text: token.text, index: changeIndex });
        rawHtml += `<ins class="diff-ins" id="${changeId}" data-change-idx="${changeIndex}">${escapedText}</ins>`;
      } else if (token.op === "DELETE") {
        changeIndex++;
        const changeId = `diff-change-${changeIndex}`;
        diffNodes.push({ id: changeId, type: "delete", text: token.text, index: changeIndex });
        rawHtml += `<del class="diff-del" id="${changeId}" data-change-idx="${changeIndex}">${escapedText}</del>`;
      }
    });

    result.redlineHtml = this._formatStructuredDocument(rawHtml);
    result.diffNodes = diffNodes;
    result.sideBySideData = this._generateSideBySideLines(textV1, textV2, result.diffs);
    return result;
  }

  /**
   * Format raw diff HTML into document section headings and paragraphs
   */
  _formatStructuredDocument(rawHtml) {
    if (!rawHtml) return "";
    
    // Split by double newlines or blank lines into logical document blocks
    const blocks = rawHtml.split(/\n\s*\n/);
    
    return blocks.map(block => {
      const trimmed = block.trim();
      if (!trimmed) return "";
      
      // Strip HTML tags to inspect plain text for heading patterns
      const plainText = trimmed.replace(/<[^>]+>/g, "").trim();
      const isHeader = /^(?:[0-9]+(?:\.[0-9]+)*\s+[A-Z\s&"'\-]{3,}|[A-Z\s&"'\-]{4,}|Version\s+[0-9\.]+.*)$/.test(plainText) ||
                       (plainText.length < 70 && /^[0-9]+\.\s+[A-Z]/.test(plainText));

      const formattedLines = block.split('\n').join('<br>');

      if (isHeader) {
        return `<h3 class="redline-heading">${formattedLines}</h3>`;
      } else {
        return `<p class="redline-paragraph">${formattedLines}</p>`;
      }
    }).join('');
  }

  /**
   * Generate side-by-side aligned lines with redline highlights (Deletions on Left, Additions on Right)
   */
  _generateSideBySideLines(textV1, textV2, diffs) {
    let leftRaw = "";
    let rightRaw = "";

    (diffs || []).forEach(token => {
      const textEsc = this._escapeHtml(token.text);
      if (token.op === "EQUAL") {
        leftRaw += textEsc;
        rightRaw += textEsc;
      } else if (token.op === "DELETE") {
        leftRaw += `<del class="diff-del">${textEsc}</del>`;
      } else if (token.op === "INSERT") {
        rightRaw += `<ins class="diff-ins">${textEsc}</ins>`;
      }
    });

    const leftLines = leftRaw.split('\n');
    const rightLines = rightRaw.split('\n');

    const maxLines = Math.max(leftLines.length, rightLines.length);
    let leftHtml = "";
    let rightHtml = "";

    for (let i = 0; i < maxLines; i++) {
      const lineNum = i + 1;
      const lContent = leftLines[i] !== undefined ? leftLines[i] : "";
      const rContent = rightLines[i] !== undefined ? rightLines[i] : "";

      leftHtml += `<div class="side-line" data-line="${lineNum}"><span class="line-num">${lineNum}</span><span class="line-content">${lContent || '&nbsp;'}</span></div>`;
      rightHtml += `<div class="side-line" data-line="${lineNum}"><span class="line-num">${lineNum}</span><span class="line-content">${rContent || '&nbsp;'}</span></div>`;
    }

    return { leftHtml, rightHtml };
  }

  /**
   * Client-side diff_match_patch fallback calculation
   */
  _compareClientSide(textV1, textV2) {
    const DMP = window.diff_match_patch || (typeof diff_match_patch !== "undefined" ? diff_match_patch : null);
    if (!DMP) {
      throw new Error("diff_match_patch library failed to load.");
    }

    const dmp = new DMP();
    const rawDiffs = dmp.diff_main(textV1, textV2);
    dmp.diff_cleanupSemantic(rawDiffs);

    const tokens = rawDiffs.map(([op, text]) => {
      const type = op === 0 ? "EQUAL" : op === 1 ? "INSERT" : "DELETE";
      return { op: type, text };
    });

    let additionsWords = 0;
    let deletionsWords = 0;
    let unchangedWords = 0;
    let changesCount = 0;

    tokens.forEach(t => {
      const cnt = t.text.trim().split(/\s+/).filter(Boolean).length;
      if (t.op === "EQUAL") unchangedWords += cnt;
      else if (t.op === "INSERT") { additionsWords += cnt; changesCount++; }
      else if (t.op === "DELETE") { deletionsWords += cnt; changesCount++; }
    });

    const totalOpsWords = unchangedWords + additionsWords + deletionsWords;
    const similarityScore = Math.round((unchangedWords / Math.max(totalOpsWords, 1)) * 1000) / 10;

    const resultPayload = {
      statistics: {
        similarity_score: similarityScore,
        changes_count: changesCount,
        words_v1: textV1.trim().split(/\s+/).filter(Boolean).length,
        words_v2: textV2.trim().split(/\s+/).filter(Boolean).length,
        additions_words: additionsWords,
        deletions_words: deletionsWords,
        unchanged_words: unchangedWords
      },
      diffs: tokens
    };

    return this._processDiffResult(resultPayload, textV1, textV2);
  }

  _cleanText(text) {
    if (!text) return "";
    return text.replace(/[\u200b\u200c\u200d\ufeff]/g, "").replace(/\u00a0/g, " ");
  }

  _escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
}

window.diffEngine = new DiffEngine();
