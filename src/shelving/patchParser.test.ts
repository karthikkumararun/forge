import { describe, it, expect } from 'vitest';
import { applyHunksToContent, extractFilePatch, parsePatch, parsePatchDetailed, synthesizePatch } from './patchParser';

const PATCH_M = `diff --git a/foo.ts b/foo.ts
index 1111111..2222222 100644
--- a/foo.ts
+++ b/foo.ts
@@ -1,3 +1,3 @@
 line one
-line two
+line TWO
 line three
`;

const PATCH_A = `diff --git a/new.ts b/new.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/new.ts
@@ -0,0 +1,2 @@
+hello
+world
`;

const PATCH_D = `diff --git a/old.ts b/old.ts
deleted file mode 100644
index 4444444..0000000
--- a/old.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-bye
-world
`;

const PATCH_R = `diff --git a/from.ts b/to.ts
similarity index 90%
rename from from.ts
rename to to.ts
index 5555555..6666666 100644
--- a/from.ts
+++ b/to.ts
@@ -1,2 +1,2 @@
 keep
-old
+new
`;

describe('parsePatch', () => {
  it('parses a single modified file', () => {
    const r = parsePatch(PATCH_M);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ path: 'foo.ts', status: 'M' });
    expect(r[0].patchOffset).toBe(0);
    expect(r[0].patchLength).toBe(PATCH_M.length);
  });

  it('detects added files', () => {
    const r = parsePatch(PATCH_A);
    expect(r[0]).toMatchObject({ path: 'new.ts', status: 'A' });
  });

  it('detects deleted files', () => {
    const r = parsePatch(PATCH_D);
    expect(r[0]).toMatchObject({ path: 'old.ts', status: 'D' });
  });

  it('detects renames with oldPath', () => {
    const r = parsePatch(PATCH_R);
    expect(r[0]).toMatchObject({ path: 'to.ts', status: 'R', oldPath: 'from.ts' });
  });

  it('parses a bundle with multiple files and produces correct slices', () => {
    const bundle = PATCH_M + PATCH_A + PATCH_D;
    const entries = parsePatch(bundle);
    expect(entries.map((e) => e.status)).toEqual(['M', 'A', 'D']);

    const sliceM = extractFilePatch(bundle, entries[0]);
    const sliceA = extractFilePatch(bundle, entries[1]);
    const sliceD = extractFilePatch(bundle, entries[2]);

    expect(sliceM).toBe(PATCH_M);
    expect(sliceA).toBe(PATCH_A);
    expect(sliceD).toBe(PATCH_D);
  });

  it('returns empty for empty input', () => {
    expect(parsePatch('')).toEqual([]);
  });
});

describe('applyHunksToContent', () => {
  it('applies a simple modification', () => {
    const base = 'line one\nline two\nline three\n';
    const out = applyHunksToContent(base, PATCH_M);
    expect(out).toBe('line one\nline TWO\nline three\n');
  });

  it('applies an addition to empty base', () => {
    const out = applyHunksToContent('', PATCH_A);
    expect(out).toBe('hello\nworld\n');
  });

  it('round-trips a multi-hunk file', () => {
    const base = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].join('\n') + '\n';
    const patch = `diff --git a/x b/x
--- a/x
+++ b/x
@@ -1,3 +1,3 @@
 a
-b
+B
 c
@@ -6,3 +6,3 @@
 f
-g
+G
 h
`;
    const out = applyHunksToContent(base, patch);
    expect(out).toBe('a\nB\nc\nd\ne\nf\nG\nh\n');
  });

  it('preserves missing trailing newline', () => {
    const base = 'a\nb';
    const patch = `diff --git a/x b/x
--- a/x
+++ b/x
@@ -1,2 +1,2 @@
 a
-b
+B
`;
    const out = applyHunksToContent(base, patch);
    expect(out).toBe('a\nB');
  });

  it('handles empty hunks (no-op)', () => {
    const base = 'foo\n';
    expect(applyHunksToContent(base, 'diff --git a/x b/x\n')).toBe(base);
  });
});

describe('parsePatchDetailed', () => {
  it('extracts file header and hunks for a single file', () => {
    const r = parsePatchDetailed(PATCH_M);
    expect(r).toHaveLength(1);
    expect(r[0].path).toBe('foo.ts');
    expect(r[0].fileHeader).toContain('diff --git a/foo.ts b/foo.ts');
    expect(r[0].fileHeader).toContain('+++ b/foo.ts');
    expect(r[0].hunks).toHaveLength(1);
    expect(r[0].hunks[0].id).toBe('foo.ts#0');
    expect(r[0].hunks[0].oldStart).toBe(1);
  });

  it('parses multi-hunk file with stable ids', () => {
    const patch = `diff --git a/x b/x
--- a/x
+++ b/x
@@ -1,3 +1,3 @@
 a
-b
+B
 c
@@ -6,3 +6,3 @@
 f
-g
+G
 h
`;
    const r = parsePatchDetailed(patch);
    expect(r[0].hunks.map((h) => h.id)).toEqual(['x#0', 'x#1']);
    expect(r[0].hunks[1].oldStart).toBe(6);
  });
});

describe('synthesizePatch', () => {
  it('emits only selected hunks but keeps file header', () => {
    const patch = `diff --git a/x b/x
--- a/x
+++ b/x
@@ -1,3 +1,3 @@
 a
-b
+B
 c
@@ -6,3 +6,3 @@
 f
-g
+G
 h
`;
    const files = parsePatchDetailed(patch);
    const selected = new Set(['x#1']);
    const out = synthesizePatch(files, selected);
    expect(out).toContain('diff --git a/x b/x');
    expect(out).toContain('@@ -6,3 +6,3 @@');
    expect(out).not.toContain('@@ -1,3 +1,3 @@');
  });

  it('skips files with no selected hunks', () => {
    const bundle = PATCH_M + PATCH_A;
    const files = parsePatchDetailed(bundle);
    const newId = files[1].hunks[0].id;
    const out = synthesizePatch(files, new Set([newId]));
    expect(out).not.toContain('foo.ts');
    expect(out).toContain('new.ts');
  });

  it('round-trip: select all hunks reproduces input', () => {
    const files = parsePatchDetailed(PATCH_M);
    const all = new Set(files.flatMap((f) => f.hunks.map((h) => h.id)));
    const out = synthesizePatch(files, all);
    expect(out).toBe(PATCH_M);
  });
});
