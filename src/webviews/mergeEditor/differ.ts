import DiffMatchPatch from 'diff-match-patch';

export interface DiffToken {
  type: 'equal' | 'insert' | 'delete';
  text: string;
  line: number;
}

const dmp = new DiffMatchPatch();

export function computeLineDiff(before: string, after: string): DiffToken[] {
  const a = dmp.diff_linesToChars_(before, after);
  const diffs = dmp.diff_main(a.chars1, a.chars2, false);
  dmp.diff_charsToLines_(diffs, a.lineArray);
  let line = 0;
  return diffs.map(([op, text]) => {
    const tok: DiffToken = {
      type: op === 0 ? 'equal' : op === 1 ? 'insert' : 'delete',
      text,
      line,
    };
    line += (text.match(/\n/g) ?? []).length;
    return tok;
  });
}

export function computeTokenDiff(before: string, after: string): DiffToken[] {
  const diffs = dmp.diff_main(before, after);
  dmp.diff_cleanupSemantic(diffs);
  return diffs.map(([op, text]) => ({
    type: op === 0 ? 'equal' : op === 1 ? 'insert' : 'delete',
    text,
    line: 0,
  }));
}

export function isWhitespaceOnlyChange(before: string, after: string): boolean {
  return before.replace(/\s+/g, '') === after.replace(/\s+/g, '');
}

export interface MovedBlock {
  text: string;
  fromLine: number;
  toLine: number;
}

// Detect blocks that disappear in `before` and reappear in `after` — i.e. moves
// rather than true deletes/inserts. Compares only multi-line blocks (>= minLines)
// to avoid noise from single-line coincidences.
export function detectMoves(before: string, after: string, minLines = 3): MovedBlock[] {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  const moves: MovedBlock[] = [];
  const used = new Set<number>();

  for (let i = 0; i <= beforeLines.length - minLines; i++) {
    for (let len = minLines; i + len <= beforeLines.length; len++) {
      const block = beforeLines.slice(i, i + len).join('\n');
      if (block.trim().length === 0) break;
      // appears at a different position in after?
      const idx = findBlock(afterLines, block.split('\n'));
      if (idx >= 0 && !used.has(idx)) {
        moves.push({ text: block, fromLine: i, toLine: idx });
        used.add(idx);
        i += len - 1;
        break;
      }
    }
  }
  return moves;
}

function findBlock(lines: string[], block: string[]): number {
  outer: for (let i = 0; i <= lines.length - block.length; i++) {
    for (let j = 0; j < block.length; j++) {
      if (lines[i + j] !== block[j]) continue outer;
    }
    return i;
  }
  return -1;
}
