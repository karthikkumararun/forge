import { ShelfFileEntry, ShelfFileStatus } from './types';

export interface PatchHunk {
  id: string;
  header: string;
  body: string;
  raw: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
}

export interface PatchFile {
  path: string;
  status: ShelfFileStatus;
  oldPath?: string;
  fileHeader: string;
  hunks: PatchHunk[];
}

const FILE_HEADER = /^diff --git a\/(.+?) b\/(.+?)$/;

export function parsePatch(patch: string): ShelfFileEntry[] {
  const entries: ShelfFileEntry[] = [];
  if (!patch) return entries;

  const lines = patch.split('\n');
  const lineOffsets: number[] = new Array(lines.length);
  let acc = 0;
  for (let i = 0; i < lines.length; i++) {
    lineOffsets[i] = acc;
    acc += lines[i].length + 1;
  }

  let i = 0;
  while (i < lines.length) {
    const m = FILE_HEADER.exec(lines[i]);
    if (!m) {
      i++;
      continue;
    }
    const startLine = i;
    const startOffset = lineOffsets[startLine];
    let aPath = m[1];
    let bPath = m[2];
    let oldPath: string | undefined;
    let status: ShelfFileEntry['status'] = 'M';

    let j = i + 1;
    while (j < lines.length && !FILE_HEADER.test(lines[j])) j++;
    const block = lines.slice(i, j);

    for (const ln of block) {
      if (ln.startsWith('new file mode')) status = 'A';
      else if (ln.startsWith('deleted file mode')) status = 'D';
      else if (ln.startsWith('rename from ')) {
        oldPath = ln.slice('rename from '.length).trim();
        status = 'R';
      } else if (ln.startsWith('rename to ')) {
        bPath = ln.slice('rename to '.length).trim();
      } else if (ln.startsWith('--- /dev/null')) {
        status = 'A';
      } else if (ln.startsWith('+++ /dev/null')) {
        status = 'D';
      }
    }

    const path = status === 'D' ? aPath : bPath;
    const endOffset = j < lines.length ? lineOffsets[j] : patch.length;

    entries.push({
      path,
      status,
      oldPath: status === 'R' ? oldPath ?? aPath : undefined,
      patchOffset: startOffset,
      patchLength: endOffset - startOffset,
    });

    i = j;
  }
  return entries;
}

export function extractFilePatch(patch: string, entry: ShelfFileEntry): string {
  return patch.slice(entry.patchOffset, entry.patchOffset + entry.patchLength);
}

interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  body: string[];
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function parseHunks(subPatch: string): Hunk[] {
  const lines = subPatch.split('\n');
  const hunks: Hunk[] = [];
  let i = 0;
  while (i < lines.length) {
    const m = HUNK_HEADER.exec(lines[i]);
    if (!m) {
      i++;
      continue;
    }
    const hunk: Hunk = {
      oldStart: parseInt(m[1], 10),
      oldLines: m[2] !== undefined ? parseInt(m[2], 10) : 1,
      newStart: parseInt(m[3], 10),
      newLines: m[4] !== undefined ? parseInt(m[4], 10) : 1,
      body: [],
    };
    i++;
    while (i < lines.length && !HUNK_HEADER.test(lines[i]) && !FILE_HEADER.test(lines[i])) {
      hunk.body.push(lines[i]);
      i++;
    }
    hunks.push(hunk);
  }
  return hunks;
}

export function parsePatchDetailed(patch: string): PatchFile[] {
  const entries = parsePatch(patch);
  const out: PatchFile[] = [];
  for (const e of entries) {
    const slice = patch.slice(e.patchOffset, e.patchOffset + e.patchLength);
    const sliceLines = slice.split('\n');
    let firstHunkLine = sliceLines.findIndex((l) => HUNK_HEADER.test(l));
    let fileHeader: string;
    let hunkRegion: string[];
    if (firstHunkLine === -1) {
      fileHeader = slice;
      hunkRegion = [];
    } else {
      fileHeader = sliceLines.slice(0, firstHunkLine).join('\n') + (firstHunkLine > 0 ? '\n' : '');
      hunkRegion = sliceLines.slice(firstHunkLine);
    }
    const hunks: PatchHunk[] = [];
    let i = 0;
    let idx = 0;
    while (i < hunkRegion.length) {
      const m = HUNK_HEADER.exec(hunkRegion[i]);
      if (!m) { i++; continue; }
      const header = hunkRegion[i];
      const startI = i;
      i++;
      while (i < hunkRegion.length && !HUNK_HEADER.test(hunkRegion[i])) i++;
      const bodyLines = hunkRegion.slice(startI + 1, i);
      while (bodyLines.length > 0 && bodyLines[bodyLines.length - 1] === '') bodyLines.pop();
      const body = bodyLines.join('\n') + '\n';
      const raw = header + '\n' + body;
      hunks.push({
        id: `${e.path}#${idx++}`,
        header,
        body,
        raw,
        oldStart: parseInt(m[1], 10),
        oldLines: m[2] !== undefined ? parseInt(m[2], 10) : 1,
        newStart: parseInt(m[3], 10),
        newLines: m[4] !== undefined ? parseInt(m[4], 10) : 1,
      });
    }
    out.push({ path: e.path, status: e.status, oldPath: e.oldPath, fileHeader, hunks });
  }
  return out;
}

export function synthesizePatch(files: PatchFile[], selectedIds: Set<string>): string {
  const parts: string[] = [];
  for (const f of files) {
    const selected = f.hunks.filter((h) => selectedIds.has(h.id));
    if (selected.length === 0 && f.hunks.length > 0) continue;
    parts.push(f.fileHeader);
    for (const h of selected) parts.push(h.raw);
  }
  return parts.join('');
}

export function applyHunksToContent(base: string, subPatch: string): string {
  const hunks = parseHunks(subPatch);
  if (hunks.length === 0) return base;

  const baseLines = base.split('\n');
  const baseHadTrailingNewline = base.endsWith('\n');
  if (baseHadTrailingNewline) baseLines.pop();

  const out: string[] = [];
  let cursor = 0;

  for (const hunk of hunks) {
    const hunkStart = Math.max(0, hunk.oldStart - 1);
    while (cursor < hunkStart && cursor < baseLines.length) {
      out.push(baseLines[cursor]);
      cursor++;
    }
    let trailingNoNewline = false;
    for (let k = 0; k < hunk.body.length; k++) {
      const ln = hunk.body[k];
      if (ln.startsWith('\\')) {
        trailingNoNewline = true;
        continue;
      }
      const tag = ln[0];
      const text = ln.slice(1);
      if (tag === ' ') {
        out.push(text);
        cursor++;
      } else if (tag === '-') {
        cursor++;
      } else if (tag === '+') {
        out.push(text);
      }
    }
    void trailingNoNewline;
  }
  while (cursor < baseLines.length) {
    out.push(baseLines[cursor]);
    cursor++;
  }
  return out.join('\n') + (baseHadTrailingNewline ? '\n' : '');
}
