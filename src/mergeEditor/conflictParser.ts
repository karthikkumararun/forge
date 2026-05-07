export interface ConflictChunk {
  id: string;
  startLine: number;
  endLine: number;
  ours: string[];
  theirs: string[];
  baseLines?: string[];
}

export interface ParsedConflicts {
  chunks: ConflictChunk[];
  totalLines: number;
  linesBeforeFirst: string[];
}

const OURS_RE = /^<{7}(\s|$)/;
const BASE_RE = /^\|{7}(\s|$)/;
const SEP_RE = /^={7}\s*$/;
const THEIRS_RE = /^>{7}(\s|$)/;

export function hasConflictMarkers(content: string): boolean {
  return /^<{7}(\s|$)/m.test(content);
}

export function parseConflicts(fileContent: string): ParsedConflicts {
  const lines = fileContent.split('\n');
  const chunks: ConflictChunk[] = [];
  const linesBeforeFirst: string[] = [];
  let inConflict = false;
  let phase: 'ours' | 'base' | 'theirs' = 'ours';
  let cur: ConflictChunk | null = null;
  let chunkIdx = 0;
  let beforeFirstDone = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inConflict && OURS_RE.test(line)) {
      inConflict = true;
      beforeFirstDone = true;
      phase = 'ours';
      cur = { id: `chunk-${chunkIdx++}`, startLine: i, endLine: -1, ours: [], theirs: [] };
      continue;
    }
    if (inConflict && cur) {
      if (BASE_RE.test(line)) {
        phase = 'base';
        cur.baseLines = [];
        continue;
      }
      if (SEP_RE.test(line)) {
        phase = 'theirs';
        continue;
      }
      if (THEIRS_RE.test(line)) {
        cur.endLine = i;
        chunks.push(cur);
        cur = null;
        inConflict = false;
        continue;
      }
      if (phase === 'ours') cur.ours.push(line);
      else if (phase === 'base') cur.baseLines!.push(line);
      else cur.theirs.push(line);
      continue;
    }
    if (!beforeFirstDone) linesBeforeFirst.push(line);
  }

  return { chunks, totalLines: lines.length, linesBeforeFirst };
}
