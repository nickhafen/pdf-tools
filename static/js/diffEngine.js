/**
 * Diff Engine Service - Computes word-level diffs, redline HTML, and side-by-side alignment.
 * Runs entirely client-side via the bundled diff-match-patch library.
 */

class DiffEngine {

  /**
   * Compare two PDF files' extracted text.
   */
  async compareDocuments(fileV1, fileV2, textV1, textV2) {
    textV1 = this._cleanText(textV1);
    textV2 = this._cleanText(textV2);
    return this._compareClientSide(textV1 || "", textV2 || "");
  }

  /**
   * Run diff-match-patch, then format raw diff tokens into HTML and interactive
   * navigation anchors. Adjacent DELETE+INSERT pairs (a "replace") are grouped
   * into a single navigable change, since they represent one edit, not two.
   */
  _processDiffResult(result, textV1, textV2) {
    let rawHtml = "";
    let diffNodes = [];
    let groupIndex = 0;

    const diffs = result.diffs || [];
    let i = 0;

    const emit = (token, groupId, suffix) => {
      const id = `diff-change-${groupId}${suffix}`;
      const esc = this._escapeHtml(token.text);
      if (token.op === "INSERT") {
        rawHtml += `<ins class="diff-ins" id="${id}" data-group="${groupId}">${esc}</ins>`;
      } else {
        rawHtml += `<del class="diff-del" id="${id}" data-group="${groupId}">${esc}</del>`;
      }
      return id;
    };

    while (i < diffs.length) {
      const token = diffs[i];

      if (token.op === "EQUAL") {
        rawHtml += this._escapeHtml(token.text);
        i++;
        continue;
      }

      groupIndex++;
      const ids = [];
      const textParts = [];

      ids.push(emit(token, groupIndex, "-a"));
      textParts.push(token.text);
      let type = token.op === "INSERT" ? "insert" : "delete";

      const next = diffs[i + 1];
      if (next && next.op !== "EQUAL" && next.op !== token.op) {
        ids.push(emit(next, groupIndex, "-b"));
        textParts.push(next.text);
        type = "replace";
        i += 2;
      } else {
        i += 1;
      }

      diffNodes.push({ ids, type, text: textParts.join(" "), index: groupIndex });
    }

    result.redlineHtml = this._formatStructuredDocument(rawHtml);
    result.diffNodes = diffNodes;
    // The navigable/reportable change count is the number of grouped edits,
    // not the number of raw diff-match-patch tokens (which fragments a single
    // word replacement into a delete + insert pair).
    result.statistics = result.statistics || {};
    result.statistics.changes_count = diffNodes.length;
    result.sideBySideData = this._generateSideBySideLines(textV1, textV2, result.diffs);
    return result;
  }

  /**
   * Format raw diff HTML into document blocks, using the explicit structure
   * markers written by pdfEngine ("## Heading" lines, "---" page breaks)
   * rather than guessing headings from arbitrary flattened text.
   */
  _formatStructuredDocument(rawHtml) {
    if (!rawHtml) return "";

    const blocks = rawHtml.split(/\n\s*\n/);

    return blocks.map(block => {
      const trimmed = block.trim();
      if (!trimmed) return "";

      const plainText = trimmed.replace(/<[^>]+>/g, "").trim();

      if (/^-{3,}$/.test(plainText)) {
        return `<hr class="redline-pagebreak">`;
      }

      if (/^##\s?/.test(plainText)) {
        // Strip the leading "## " marker while preserving any diff tags
        // that wrap it (e.g. a brand-new heading added in v2).
        const headingHtml = trimmed.replace(/^(\s*(?:<[^>]+>)*\s*)##\s?/, "$1");
        return `<h3 class="redline-heading">${headingHtml}</h3>`;
      }

      const formattedLines = block.split('\n').join('<br>');
      return `<p class="redline-paragraph">${formattedLines}</p>`;
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

    const cleanupMarkers = (line) => {
      const plain = line.replace(/<[^>]+>/g, "").trim();
      if (/^-{3,}$/.test(plain)) return "— Page Break —";
      return line.replace(/^(\s*(?:<[^>]+>)*\s*)##\s?/, "$1");
    };

    const leftLines = leftRaw.split('\n').map(cleanupMarkers);
    const rightLines = rightRaw.split('\n').map(cleanupMarkers);

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
   * Client-side diff-match-patch calculation, diffed at word granularity.
   *
   * diff-match-patch's diff_main operates on raw characters, which fragments
   * a single word replacement (e.g. "January" -> "February") into
   * mid-word insert/delete tokens and skews word counts. We work around this
   * with the same technique DMP itself uses for line-mode diffing: tokenize
   * both texts into words/whitespace runs, map each unique token to one
   * synthetic character, diff those character strings, then map the result
   * back to whole tokens. Every diff chunk is then a whole word (or run of
   * whitespace), never a fragment of one.
   */
  _compareClientSide(textV1, textV2) {
    const DMP = window.diff_match_patch || (typeof diff_match_patch !== "undefined" ? diff_match_patch : null);
    if (!DMP) {
      throw new Error("diff_match_patch library failed to load.");
    }

    const dmp = new DMP();
    const { chars1, chars2, tokenArray } = this._tokensToChars(textV1, textV2);
    const rawDiffs = dmp.diff_main(chars1, chars2, false);
    dmp.diff_cleanupSemantic(rawDiffs);

    const tokens = rawDiffs.map(([op, chars]) => {
      const type = op === 0 ? "EQUAL" : op === 1 ? "INSERT" : "DELETE";
      let text = "";
      for (let i = 0; i < chars.length; i++) {
        text += tokenArray[chars.charCodeAt(i)];
      }
      return { op: type, text };
    });

    let additionsWords = 0;
    let deletionsWords = 0;
    let unchangedWords = 0;

    tokens.forEach(t => {
      const cnt = t.text.trim().split(/\s+/).filter(Boolean).length;
      if (t.op === "EQUAL") unchangedWords += cnt;
      else if (t.op === "INSERT") additionsWords += cnt;
      else if (t.op === "DELETE") deletionsWords += cnt;
    });

    const totalOpsWords = unchangedWords + additionsWords + deletionsWords;
    const similarityScore = Math.round((unchangedWords / Math.max(totalOpsWords, 1)) * 1000) / 10;

    const resultPayload = {
      statistics: {
        similarity_score: similarityScore,
        changes_count: 0, // computed from grouped diff nodes in _processDiffResult
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

  /**
   * Tokenize two texts into words and whitespace runs, and encode each text
   * as a string of synthetic characters (one per unique token) so
   * diff-match-patch's character-level diff_main effectively becomes a
   * word-level diff. Mirrors DMP's own diff_linesToChars_ pattern.
   */
  _tokensToChars(text1, text2) {
    const tokenArray = [];
    const tokenHash = {};

    const tokenize = (text) => {
      const tokens = text.match(/\S+|\s+/g) || [];
      let chars = "";
      tokens.forEach(tok => {
        let code = tokenHash[tok];
        if (code === undefined) {
          tokenArray.push(tok);
          code = tokenArray.length - 1;
          tokenHash[tok] = code;
        }
        chars += String.fromCharCode(code);
      });
      return chars;
    };

    const chars1 = tokenize(text1);
    const chars2 = tokenize(text2);
    return { chars1, chars2, tokenArray };
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
