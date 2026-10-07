/**
 * Google diff_match_patch JavaScript Library (Bundled Local)
 * https://github.com/google/diff-match-patch
 *
 * Copyright 2018 The diff-match-patch Authors.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

(function(root) {
  function diff_match_patch() {
    this.Diff_Timeout = 1.0;
    this.Diff_EditCost = 4;
    this.Match_Threshold = 0.5;
    this.Match_Distance = 1000;
    this.Patch_DeleteThreshold = 0.5;
    this.Patch_Margin = 4;
    this.Match_MaxBits = 32;
  }

  diff_match_patch.DIFF_DELETE = -1;
  diff_match_patch.DIFF_INSERT = 1;
  diff_match_patch.DIFF_EQUAL = 0;

  diff_match_patch.prototype.diff_main = function(text1, text2, opt_checklines) {
    if (text1 === null || text2 === null) {
      throw new Error('Null input. (diff_main)');
    }
    if (text1 === text2) {
      if (text1) return [[diff_match_patch.DIFF_EQUAL, text1]];
      return [];
    }

    var commonlength = this.diff_commonPrefix(text1, text2);
    var commonprefix = text1.substring(0, commonlength);
    text1 = text1.substring(commonlength);
    text2 = text2.substring(commonlength);

    commonlength = this.diff_commonSuffix(text1, text2);
    var commonsuffix = text1.substring(text1.length - commonlength);
    text1 = text1.substring(0, text1.length - commonlength);
    text2 = text2.substring(0, text2.length - commonlength);

    var diffs = this.diff_compute_(text1, text2, opt_checklines);

    if (commonprefix) diffs.unshift([diff_match_patch.DIFF_EQUAL, commonprefix]);
    if (commonsuffix) diffs.push([diff_match_patch.DIFF_EQUAL, commonsuffix]);
    this.diff_cleanupMerge(diffs);
    return diffs;
  };

  diff_match_patch.prototype.diff_compute_ = function(text1, text2, opt_checklines) {
    if (!text1) return [[diff_match_patch.DIFF_INSERT, text2]];
    if (!text2) return [[diff_match_patch.DIFF_DELETE, text1]];

    var longtext = text1.length > text2.length ? text1 : text2;
    var shorttext = text1.length > text2.length ? text2 : text1;
    var i = longtext.indexOf(shorttext);
    if (i !== -1) {
      var diffs = [
        [diff_match_patch.DIFF_INSERT, longtext.substring(0, i)],
        [diff_match_patch.DIFF_EQUAL, shorttext],
        [diff_match_patch.DIFF_INSERT, longtext.substring(i + shorttext.length)]
      ];
      if (text1.length > text2.length) {
        diffs[0][0] = diffs[2][0] = diff_match_patch.DIFF_DELETE;
      }
      return diffs;
    }

    if (shorttext.length === 1) {
      return [
        [diff_match_patch.DIFF_DELETE, text1],
        [diff_match_patch.DIFF_INSERT, text2]
      ];
    }

    return this.diff_bisect_(text1, text2);
  };

  diff_match_patch.prototype.diff_commonPrefix = function(text1, text2) {
    if (!text1 || !text2 || text1.charAt(0) !== text2.charAt(0)) return 0;
    var pointermin = 0;
    var pointermax = Math.min(text1.length, text2.length);
    var pointermid = pointermax;
    var pointerstart = 0;
    while (pointermin < pointermid) {
      if (text1.substring(pointerstart, pointermid) == text2.substring(pointerstart, pointermid)) {
        pointermin = pointermid;
        pointerstart = pointermin;
      } else {
        pointermax = pointermid;
      }
      pointermid = Math.floor((pointermax - pointermin) / 2) + pointermin;
    }
    return pointermid;
  };

  diff_match_patch.prototype.diff_commonSuffix = function(text1, text2) {
    if (!text1 || !text2 || text1.charAt(text1.length - 1) !== text2.charAt(text2.length - 1)) return 0;
    var pointermin = 0;
    var pointermax = Math.min(text1.length, text2.length);
    var pointermid = pointermax;
    var pointerend = 0;
    while (pointermin < pointermid) {
      if (text1.substring(text1.length - pointermid, text1.length - pointerend) ==
          text2.substring(text2.length - pointermid, text2.length - pointerend)) {
        pointermin = pointermid;
        pointerend = pointermin;
      } else {
        pointermax = pointermid;
      }
      pointermid = Math.floor((pointermax - pointermin) / 2) + pointermin;
    }
    return pointermid;
  };

  diff_match_patch.prototype.diff_bisect_ = function(text1, text2) {
    var max_d = Math.ceil((text1.length + text2.length) / 2);
    var v_offset = max_d;
    var v_length = 2 * max_d;
    var v1 = new Array(v_length);
    var v2 = new Array(v_length);
    for (var x = 0; x < v_length; x++) {
      v1[x] = -1;
      v2[x] = -1;
    }
    v1[v_offset + 1] = 0;
    v2[v_offset + 1] = 0;
    var delta = text1.length - text2.length;
    var front = (delta % 2 !== 0);
    var k1start = 0, k1end = 0, k2start = 0, k2end = 0;

    for (var d = 0; d < max_d; d++) {
      for (var k1 = -d + k1start; k1 <= d - k1end; k1 += 2) {
        var k1_offset = v_offset + k1;
        var x1;
        if (k1 === -d || (k1 !== d && v1[k1_offset - 1] < v1[k1_offset + 1])) {
          x1 = v1[k1_offset + 1];
        } else {
          x1 = v1[k1_offset - 1] + 1;
        }
        var y1 = x1 - k1;
        while (x1 < text1.length && y1 < text2.length && text1.charAt(x1) === text2.charAt(y1)) {
          x1++; y1++;
        }
        v1[k1_offset] = x1;
        if (x1 > text1.length) { k1end += 2; }
        else if (y1 > text2.length) { k1start += 2; }
        else if (front) {
          var k2_offset = v_offset + delta - k1;
          if (k2_offset >= 0 && k2_offset < v_length && v2[k2_offset] !== -1) {
            var x2 = text1.length - v2[k2_offset];
            if (x1 >= x2) return this.diff_bisectSplit_(text1, text2, x1, y1);
          }
        }
      }

      for (var k2 = -d + k2start; k2 <= d - k2end; k2 += 2) {
        var k2_offset = v_offset + k2;
        var x2;
        if (k2 === -d || (k2 !== d && v2[k2_offset - 1] < v2[k2_offset + 1])) {
          x2 = v2[k2_offset + 1];
        } else {
          x2 = v2[k2_offset - 1] + 1;
        }
        var y2 = x2 - k2;
        while (x2 < text1.length && y2 < text2.length &&
               text1.charAt(text1.length - x2 - 1) === text2.charAt(text2.length - y2 - 1)) {
          x2++; y2++;
        }
        v2[k2_offset] = x2;
        if (x2 > text1.length) { k2end += 2; }
        else if (y2 > text2.length) { k2start += 2; }
        else if (!front) {
          var k1_offset = v_offset + delta - k2;
          if (k1_offset >= 0 && k1_offset < v_length && v1[k1_offset] !== -1) {
            var x1 = v1[k1_offset];
            var y1 = v_offset + x1 - k1_offset;
            x2 = text1.length - x2;
            if (x1 >= x2) return this.diff_bisectSplit_(text1, text2, x1, y1);
          }
        }
      }
    }
    return [[diff_match_patch.DIFF_DELETE, text1], [diff_match_patch.DIFF_INSERT, text2]];
  };

  diff_match_patch.prototype.diff_bisectSplit_ = function(text1, text2, x, y) {
    var text1a = text1.substring(0, x);
    var text2a = text2.substring(0, y);
    var text1b = text1.substring(x);
    var text2b = text2.substring(y);
    var diffs = this.diff_main(text1a, text2a, false);
    var diffsb = this.diff_main(text1b, text2b, false);
    return diffs.concat(diffsb);
  };

  diff_match_patch.prototype.diff_cleanupMerge = function(diffs) {
    diffs.push([diff_match_patch.DIFF_EQUAL, '']);
    var pointer = 0;
    var count_delete = 0, count_insert = 0;
    var text_delete = '', text_insert = '';
    var commonlength;
    while (pointer < diffs.length) {
      switch (diffs[pointer][0]) {
        case diff_match_patch.DIFF_INSERT:
          count_insert++;
          text_insert += diffs[pointer][1];
          pointer++;
          break;
        case diff_match_patch.DIFF_DELETE:
          count_delete++;
          text_delete += diffs[pointer][1];
          pointer++;
          break;
        case diff_match_patch.DIFF_EQUAL:
          if (count_delete + count_insert !== 0) {
            if (count_delete !== 0 && count_insert !== 0) {
              commonlength = this.diff_commonPrefix(text_insert, text_delete);
              if (commonlength !== 0) {
                if ((pointer - count_delete - count_insert) > 0 &&
                    diffs[pointer - count_delete - count_insert - 1][0] === diff_match_patch.DIFF_EQUAL) {
                  diffs[pointer - count_delete - count_insert - 1][1] += text_insert.substring(0, commonlength);
                } else {
                  diffs.splice(0, 0, [diff_match_patch.DIFF_EQUAL, text_insert.substring(0, commonlength)]);
                  pointer++;
                }
                text_insert = text_insert.substring(commonlength);
                text_delete = text_delete.substring(commonlength);
              }
              commonlength = this.diff_commonSuffix(text_insert, text_delete);
              if (commonlength !== 0) {
                diffs[pointer][1] = text_insert.substring(text_insert.length - commonlength) + diffs[pointer][1];
                text_insert = text_insert.substring(0, text_insert.length - commonlength);
                text_delete = text_delete.substring(0, text_delete.length - commonlength);
              }
            }
            if (count_delete === 0) {
              diffs.splice(pointer - count_insert, count_insert, [diff_match_patch.DIFF_INSERT, text_insert]);
            } else if (count_insert === 0) {
              diffs.splice(pointer - count_delete, count_delete, [diff_match_patch.DIFF_DELETE, text_delete]);
            } else {
              diffs.splice(pointer - count_delete - count_insert, count_delete + count_insert,
                  [diff_match_patch.DIFF_DELETE, text_delete],
                  [diff_match_patch.DIFF_INSERT, text_insert]);
            }
            pointer = pointer - count_delete - count_insert + (count_delete ? 1 : 0) + (count_insert ? 1 : 0) + 1;
          } else if (pointer !== 0 && diffs[pointer - 1][0] === diff_match_patch.DIFF_EQUAL) {
            diffs[pointer - 1][1] += diffs[pointer][1];
            diffs.splice(pointer, 1);
          } else {
            pointer++;
          }
          count_insert = 0; count_delete = 0;
          text_delete = ''; text_insert = '';
          break;
      }
    }
    if (diffs[diffs.length - 1][1] === '') {
      diffs.pop();
    }
  };

  diff_match_patch.prototype.diff_cleanupSemantic = function(diffs) {
    var changes = false;
    var equalities = [];
    var equalitiesLength = 0;
    var lastequality = null;
    var pointer = 0;
    var length_insertions1 = 0, length_deletions1 = 0;
    var length_insertions2 = 0, length_deletions2 = 0;

    while (pointer < diffs.length) {
      if (diffs[pointer][0] === diff_match_patch.DIFF_EQUAL) {
        equalities[equalitiesLength++] = pointer;
        length_insertions1 = length_insertions2;
        length_deletions1 = length_deletions2;
        length_insertions2 = 0;
        length_deletions2 = 0;
        lastequality = diffs[pointer][1];
      } else {
        if (diffs[pointer][0] === diff_match_patch.DIFF_INSERT) {
          length_insertions2 += diffs[pointer][1].length;
        } else {
          length_deletions2 += diffs[pointer][1].length;
        }
        if (lastequality && (lastequality.length <= Math.max(length_insertions1, length_deletions1)) &&
            (lastequality.length <= Math.max(length_insertions2, length_deletions2))) {
          diffs.splice(equalities[equalitiesLength - 1], 0,
              [diff_match_patch.DIFF_DELETE, lastequality]);
          diffs[equalities[equalitiesLength - 1] + 1][0] = diff_match_patch.DIFF_INSERT;
          equalitiesLength--;
          equalitiesLength--;
          pointer = equalitiesLength > 0 ? equalities[equalitiesLength - 1] : -1;
          length_insertions1 = 0; length_deletions1 = 0;
          length_insertions2 = 0; length_deletions2 = 0;
          lastequality = null;
          changes = true;
        }
      }
      pointer++;
    }
    if (changes) {
      this.diff_cleanupMerge(diffs);
    }
  };

  root.diff_match_patch = diff_match_patch;
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
