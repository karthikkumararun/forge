import * as fs from 'fs/promises';
import * as path from 'path';
import { GitService } from '../git/gitService';
import * as os from 'os';
import { ShelfFileEntry, ShelfItem, ShelfMeta, ShelfMetaV1, ShelfOrigin, UnshelveOptions, UnshelveResult } from './types';
import { applyHunksToContent, extractFilePatch, parsePatch, parsePatchDetailed, PatchFile, synthesizePatch } from './patchParser';

const SHELVES_DIR = '.forge/shelves';
const TRASH_DIR = '.forge/shelves/.trash';
const GITIGNORE_LINE = '.forge/';
const GITIGNORE_COMMENT = '# Forge shelves';

export class ShelvingService {
  constructor(private gitService: GitService, private workspaceRoot: string) {}

  async shelveChanges(displayName: string, description: string, files?: string[]): Promise<void> {
    const diffArgs = ['HEAD'];
    if (files && files.length > 0) diffArgs.push('--', ...files);
    const diff = await this.gitService.getDiff(diffArgs);
    if (!diff || diff.trim().length === 0) {
      throw new Error('No changes to shelve');
    }

    await this.ensureShelvesDir();

    const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '').replace(/Z$/, '');
    const safeName = this.sanitizeName(displayName);
    const baseName = `${safeName}_${ts}`;
    const patchPath = path.join(this.getShelvesDir(), `${baseName}.patch`);
    const metaPath = path.join(this.getShelvesDir(), `${baseName}.meta.json`);

    await fs.writeFile(patchPath, diff, 'utf8');

    const fileEntries = parsePatch(diff);
    const branch = await this.gitService.getCurrentBranch();
    const head = await this.gitService.getHeadSha();

    const meta: ShelfMeta = {
      schemaVersion: 2,
      name: baseName,
      displayName,
      description,
      createdAt: new Date().toISOString(),
      branch,
      baseCommit: head,
      files: fileEntries,
      origin: 'manual',
    };

    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8');
    if (files && files.length > 0) {
      for (const f of fileEntries) {
        const target = f.status === 'R' ? f.oldPath ?? f.path : f.path;
        await this.gitService.checkoutFile(target);
      }
    } else {
      await this.gitService.checkoutAll();
    }
    await this.ensureGitignore();
  }

  async listChangedFiles(): Promise<string[]> {
    const out = await this.gitService.getDiff(['HEAD', '--name-only']);
    return out.split('\n').map((s) => s.trim()).filter(Boolean);
  }

  async listShelves(): Promise<ShelfItem[]> {
    const dir = this.getShelvesDir();
    try {
      await fs.access(dir);
    } catch {
      return [];
    }
    const entries = await fs.readdir(dir);
    const metas = entries.filter((f) => f.endsWith('.meta.json'));
    const items: ShelfItem[] = [];
    for (const m of metas) {
      const metaPath = path.join(dir, m);
      const patchPath = path.join(dir, m.replace(/\.meta\.json$/, '.patch'));
      try {
        const raw = JSON.parse(await fs.readFile(metaPath, 'utf8'));
        const meta = await this.migrateMeta(raw, patchPath, metaPath);
        items.push({ meta, patchPath, metaPath });
      } catch {
        // skip corrupt
      }
    }
    items.sort((a, b) => b.meta.createdAt.localeCompare(a.meta.createdAt));
    return items;
  }

  async unshelveChanges(shelfName: string, opts: UnshelveOptions = {}): Promise<UnshelveResult> {
    const item = await this.findShelf(shelfName);
    if (!item) throw new Error(`Shelf not found: ${shelfName}`);
    const keep = opts.keep !== false;
    const onConflict = opts.onConflict ?? 'merge';

    const allFiles = item.meta.files.map((f) => f.path);
    const targetFiles = opts.files && opts.files.length > 0 ? opts.files : allFiles;
    const selected = item.meta.files.filter((f) => targetFiles.includes(f.path) || (f.oldPath && targetFiles.includes(f.oldPath)));
    if (selected.length === 0) throw new Error('No files selected to unshelve');

    const bundle = await fs.readFile(item.patchPath, 'utf8');
    const subPatch = selected.map((e) => extractFilePatch(bundle, e)).join('');

    const tmpPatch = path.join(os.tmpdir(), `forge-unshelve-${Date.now()}-${Math.random().toString(36).slice(2)}.patch`);
    await fs.writeFile(tmpPatch, subPatch, 'utf8');

    let applyErr: any;
    try {
      await this.gitService.applyPatch(tmpPatch);
    } catch (e) {
      applyErr = e;
    }
    if (applyErr && onConflict === 'merge') {
      try {
        await this.gitService.applyPatch3Way(tmpPatch);
        applyErr = undefined;
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        if (/Applied patch/.test(msg)) applyErr = undefined;
        else applyErr = e;
      }
    }
    await fs.unlink(tmpPatch).catch(() => {});
    if (applyErr) throw new Error(`git apply failed: ${applyErr?.message ?? String(applyErr)}`);

    const conflicted = await this.scanForConflictMarkers(selected);
    const applied = selected.filter((e) => !conflicted.includes(e.path)).map((e) => e.path);
    let shelfRemaining = true;

    if (!keep && conflicted.length === 0) {
      const remaining = item.meta.files.filter((f) => !selected.includes(f));
      if (remaining.length === 0) {
        await this.softDeleteFiles(item);
        shelfRemaining = false;
      } else {
        const newBundle = remaining.map((e) => extractFilePatch(bundle, e)).join('');
        await fs.writeFile(item.patchPath, newBundle, 'utf8');
        const newEntries = parsePatch(newBundle);
        const updated: ShelfMeta = {
          ...item.meta,
          files: newEntries,
          updatedAt: new Date().toISOString(),
        };
        await fs.writeFile(item.metaPath, JSON.stringify(updated, null, 2), 'utf8');
      }
    }

    return { applied, conflicted, skipped: [], shelfRemaining };
  }

  private async scanForConflictMarkers(entries: ShelfFileEntry[]): Promise<string[]> {
    const out: string[] = [];
    for (const e of entries) {
      if (e.status === 'D') continue;
      const abs = path.join(this.workspaceRoot, e.path);
      try {
        const content = await fs.readFile(abs, 'utf8');
        if (/^<{7}( |$)/m.test(content) && /^={7}\s*$/m.test(content) && /^>{7}( |$)/m.test(content)) {
          out.push(e.path);
        }
      } catch {}
    }
    return out;
  }

  async renameShelf(shelfName: string, newDisplayName: string): Promise<void> {
    const item = await this.findShelf(shelfName);
    if (!item) throw new Error(`Shelf not found: ${shelfName}`);
    const trimmed = newDisplayName.trim();
    if (!trimmed) throw new Error('Name cannot be empty');
    const updated: ShelfMeta = { ...item.meta, displayName: trimmed, updatedAt: new Date().toISOString() };
    await fs.writeFile(item.metaPath, JSON.stringify(updated, null, 2), 'utf8');
  }

  async setShelfDescription(shelfName: string, description: string): Promise<void> {
    const item = await this.findShelf(shelfName);
    if (!item) throw new Error(`Shelf not found: ${shelfName}`);
    const updated: ShelfMeta = { ...item.meta, description, updatedAt: new Date().toISOString() };
    await fs.writeFile(item.metaPath, JSON.stringify(updated, null, 2), 'utf8');
  }

  async getWorkingTreeHunks(): Promise<PatchFile[]> {
    const diff = await this.gitService.getDiff(['HEAD']);
    if (!diff || diff.trim().length === 0) return [];
    return parsePatchDetailed(diff);
  }

  async getShelfHunks(shelfName: string): Promise<PatchFile[]> {
    const item = await this.findShelf(shelfName);
    if (!item) throw new Error(`Shelf not found: ${shelfName}`);
    const bundle = await fs.readFile(item.patchPath, 'utf8');
    return parsePatchDetailed(bundle);
  }

  async shelveHunks(displayName: string, description: string, selectedHunkIds: string[]): Promise<void> {
    const all = await this.getWorkingTreeHunks();
    const ids = new Set(selectedHunkIds);
    const synth = synthesizePatch(all, ids);
    if (!synth || synth.trim().length === 0) {
      throw new Error('No hunks selected');
    }
    await this.ensureShelvesDir();

    const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '').replace(/Z$/, '');
    const safeName = this.sanitizeName(displayName);
    const baseName = `${safeName}_${ts}`;
    const patchPath = path.join(this.getShelvesDir(), `${baseName}.patch`);
    const metaPath = path.join(this.getShelvesDir(), `${baseName}.meta.json`);

    await fs.writeFile(patchPath, synth, 'utf8');
    const fileEntries = parsePatch(synth);
    const branch = await this.gitService.getCurrentBranch();
    const head = await this.gitService.getHeadSha();

    const meta: ShelfMeta = {
      schemaVersion: 2,
      name: baseName,
      displayName,
      description,
      createdAt: new Date().toISOString(),
      branch,
      baseCommit: head,
      files: fileEntries,
      origin: 'manual',
    };
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8');

    const tmpRevert = path.join(os.tmpdir(), `forge-shelve-revert-${Date.now()}-${Math.random().toString(36).slice(2)}.patch`);
    await fs.writeFile(tmpRevert, synth, 'utf8');
    try {
      await this.gitService.applyPatch(tmpRevert, ['--reverse']);
    } finally {
      await fs.unlink(tmpRevert).catch(() => {});
    }
    await this.ensureGitignore();
  }

  async unshelveHunks(shelfName: string, selectedHunkIds: string[], opts: UnshelveOptions = {}): Promise<UnshelveResult> {
    const item = await this.findShelf(shelfName);
    if (!item) throw new Error(`Shelf not found: ${shelfName}`);
    const keep = opts.keep !== false;
    const onConflict = opts.onConflict ?? 'merge';

    const detailed = await this.getShelfHunks(shelfName);
    const ids = new Set(selectedHunkIds);
    const synth = synthesizePatch(detailed, ids);
    if (!synth || synth.trim().length === 0) throw new Error('No hunks selected');

    const tmpPatch = path.join(os.tmpdir(), `forge-unshelve-hunks-${Date.now()}-${Math.random().toString(36).slice(2)}.patch`);
    await fs.writeFile(tmpPatch, synth, 'utf8');

    let applyErr: any;
    try {
      await this.gitService.applyPatch(tmpPatch);
    } catch (e) { applyErr = e; }
    if (applyErr && onConflict === 'merge') {
      try {
        await this.gitService.applyPatch3Way(tmpPatch);
        applyErr = undefined;
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        if (/Applied patch/.test(msg)) applyErr = undefined;
        else applyErr = e;
      }
    }
    await fs.unlink(tmpPatch).catch(() => {});
    if (applyErr) throw new Error(`git apply failed: ${applyErr?.message ?? String(applyErr)}`);

    const touchedEntries = parsePatch(synth).map((e) => ({ path: e.path, status: e.status, oldPath: e.oldPath, patchOffset: 0, patchLength: 0 }));
    const conflicted = await this.scanForConflictMarkers(touchedEntries);
    const applied = touchedEntries.filter((e) => !conflicted.includes(e.path)).map((e) => e.path);
    let shelfRemaining = true;

    if (!keep && conflicted.length === 0) {
      const remainingFiles = detailed.filter((f) => !f.hunks.every((h) => ids.has(h.id)) || f.hunks.length === 0);
      const partiallyTouched = detailed.filter((f) => f.hunks.some((h) => ids.has(h.id)) && !f.hunks.every((h) => ids.has(h.id)));
      const remainingIds = new Set<string>();
      for (const f of detailed) {
        for (const h of f.hunks) if (!ids.has(h.id)) remainingIds.add(h.id);
      }
      const newBundle = synthesizePatch(detailed, remainingIds);
      if (!newBundle || newBundle.trim().length === 0) {
        await this.softDeleteFiles(item);
        shelfRemaining = false;
      } else {
        await fs.writeFile(item.patchPath, newBundle, 'utf8');
        const newEntries = parsePatch(newBundle);
        const updated: ShelfMeta = {
          ...item.meta,
          files: newEntries,
          updatedAt: new Date().toISOString(),
        };
        await fs.writeFile(item.metaPath, JSON.stringify(updated, null, 2), 'utf8');
      }
      void remainingFiles; void partiallyTouched;
    }

    return { applied, conflicted, skipped: [], shelfRemaining };
  }

  async autoShelf(origin: ShelfOrigin, contextLabel?: string): Promise<string | undefined> {
    const diff = await this.gitService.getDiff(['HEAD']);
    if (!diff || diff.trim().length === 0) return undefined;
    await this.ensureShelvesDir();

    const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '').replace(/Z$/, '');
    const baseName = `auto-${ts}`;
    const patchPath = path.join(this.getShelvesDir(), `${baseName}.patch`);
    const metaPath = path.join(this.getShelvesDir(), `${baseName}.meta.json`);

    await fs.writeFile(patchPath, diff, 'utf8');
    const fileEntries = parsePatch(diff);
    const branch = await this.gitService.getCurrentBranch();
    const head = await this.gitService.getHeadSha();
    const description = contextLabel ? `Auto-shelved before ${contextLabel}` : `Auto-shelved (${origin})`;

    const meta: ShelfMeta = {
      schemaVersion: 2,
      name: baseName,
      displayName: baseName,
      description,
      createdAt: new Date().toISOString(),
      branch,
      baseCommit: head,
      files: fileEntries,
      origin,
    };
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8');
    await this.gitService.checkoutAll();
    await this.ensureGitignore();
    return baseName;
  }

  async deleteShelve(shelfName: string, opts: { hard?: boolean } = {}): Promise<void> {
    const item = await this.findShelf(shelfName);
    if (!item) throw new Error(`Shelf not found: ${shelfName}`);
    if (opts.hard) {
      await fs.unlink(item.patchPath).catch(() => {});
      await fs.unlink(item.metaPath).catch(() => {});
      return;
    }
    await this.softDeleteFiles(item);
  }

  private async softDeleteFiles(item: ShelfItem): Promise<void> {
    await this.ensureTrashDir();
    const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '').replace(/Z$/, '');
    const trashBase = `${item.meta.name}__deleted_${ts}`;
    const trashPatch = path.join(this.getTrashDir(), `${trashBase}.patch`);
    const trashMeta = path.join(this.getTrashDir(), `${trashBase}.meta.json`);
    try { await fs.rename(item.patchPath, trashPatch); } catch {}
    try {
      const raw = JSON.parse(await fs.readFile(item.metaPath, 'utf8'));
      raw.deletedAt = new Date().toISOString();
      await fs.writeFile(trashMeta, JSON.stringify(raw, null, 2), 'utf8');
      await fs.unlink(item.metaPath).catch(() => {});
    } catch {
      try { await fs.rename(item.metaPath, trashMeta); } catch {}
    }
  }

  async listTrashed(): Promise<ShelfItem[]> {
    const dir = this.getTrashDir();
    try { await fs.access(dir); } catch { return []; }
    const entries = await fs.readdir(dir);
    const metas = entries.filter((f) => f.endsWith('.meta.json'));
    const items: ShelfItem[] = [];
    for (const m of metas) {
      const metaPath = path.join(dir, m);
      const patchPath = path.join(dir, m.replace(/\.meta\.json$/, '.patch'));
      try {
        const raw = JSON.parse(await fs.readFile(metaPath, 'utf8'));
        const meta = await this.migrateMeta(raw, patchPath, metaPath);
        items.push({ meta, patchPath, metaPath, trashed: true, deletedAt: raw.deletedAt });
      } catch {}
    }
    items.sort((a, b) => (b.deletedAt ?? '').localeCompare(a.deletedAt ?? ''));
    return items;
  }

  async restoreFromTrash(trashedName: string): Promise<void> {
    const trashed = await this.listTrashed();
    const item = trashed.find((i) => path.basename(i.metaPath, '.meta.json') === trashedName || i.meta.name === trashedName);
    if (!item) throw new Error(`Trashed shelf not found: ${trashedName}`);
    await this.ensureShelvesDir();
    const baseName = item.meta.name;
    const targetPatch = path.join(this.getShelvesDir(), `${baseName}.patch`);
    const targetMeta = path.join(this.getShelvesDir(), `${baseName}.meta.json`);
    let finalBase = baseName;
    let i = 1;
    while (await this.exists(path.join(this.getShelvesDir(), `${finalBase}.meta.json`))) {
      finalBase = `${baseName}_restored${i++}`;
    }
    const finalPatch = path.join(this.getShelvesDir(), `${finalBase}.patch`);
    const finalMeta = path.join(this.getShelvesDir(), `${finalBase}.meta.json`);
    await fs.rename(item.patchPath, finalPatch).catch(() => {});
    try {
      const raw = JSON.parse(await fs.readFile(item.metaPath, 'utf8'));
      delete raw.deletedAt;
      raw.name = finalBase;
      await fs.writeFile(finalMeta, JSON.stringify(raw, null, 2), 'utf8');
      await fs.unlink(item.metaPath).catch(() => {});
    } catch {
      await fs.rename(item.metaPath, finalMeta).catch(() => {});
    }
    void targetPatch; void targetMeta;
  }

  async purgeTrash(olderThanDays: number = 0): Promise<number> {
    const trashed = await this.listTrashed();
    const cutoff = olderThanDays > 0 ? Date.now() - olderThanDays * 86400000 : Infinity;
    let purged = 0;
    for (const t of trashed) {
      const dt = t.deletedAt ? Date.parse(t.deletedAt) : 0;
      if (olderThanDays > 0 && dt > cutoff) continue;
      if (olderThanDays === 0 || dt < cutoff) {
        await fs.unlink(t.patchPath).catch(() => {});
        await fs.unlink(t.metaPath).catch(() => {});
        purged++;
      }
    }
    return purged;
  }

  async purgeOneTrashed(trashedName: string): Promise<void> {
    const trashed = await this.listTrashed();
    const item = trashed.find((i) => path.basename(i.metaPath, '.meta.json') === trashedName || i.meta.name === trashedName);
    if (!item) throw new Error(`Trashed shelf not found: ${trashedName}`);
    await fs.unlink(item.patchPath).catch(() => {});
    await fs.unlink(item.metaPath).catch(() => {});
  }

  private async exists(p: string): Promise<boolean> {
    try { await fs.access(p); return true; } catch { return false; }
  }

  private getTrashDir(): string {
    return path.join(this.workspaceRoot, TRASH_DIR);
  }

  private async ensureTrashDir(): Promise<void> {
    await fs.mkdir(this.getTrashDir(), { recursive: true });
  }

  async peekShelf(shelfName: string): Promise<string> {
    const item = await this.findShelf(shelfName);
    if (!item) throw new Error(`Shelf not found: ${shelfName}`);
    return fs.readFile(item.patchPath, 'utf8');
  }

  async getFilePatch(shelfName: string, filePath: string): Promise<string> {
    const { item, entry } = await this.resolveFileEntry(shelfName, filePath);
    const patch = await fs.readFile(item.patchPath, 'utf8');
    return extractFilePatch(patch, entry);
  }

  async getFileBaseContent(shelfName: string, filePath: string): Promise<string> {
    const { item, entry } = await this.resolveFileEntry(shelfName, filePath);
    if (entry.status === 'A') return '';
    const source = entry.status === 'R' ? entry.oldPath ?? entry.path : entry.path;
    return this.gitService.showFileAtCommit(item.meta.baseCommit, source);
  }

  async getFileShelvedContent(shelfName: string, filePath: string): Promise<string> {
    const { item, entry } = await this.resolveFileEntry(shelfName, filePath);
    if (entry.status === 'D') return '';
    const base = await this.getFileBaseContent(shelfName, filePath);
    const patch = await fs.readFile(item.patchPath, 'utf8');
    const sub = extractFilePatch(patch, entry);
    return applyHunksToContent(base, sub);
  }

  private async resolveFileEntry(shelfName: string, filePath: string): Promise<{ item: ShelfItem; entry: ShelfFileEntry }> {
    const item = await this.findShelf(shelfName);
    if (!item) throw new Error(`Shelf not found: ${shelfName}`);
    const entry = item.meta.files.find((f) => f.path === filePath || f.oldPath === filePath);
    if (!entry) throw new Error(`File not in shelf: ${filePath}`);
    return { item, entry };
  }

  private async migrateMeta(raw: any, patchPath: string, metaPath: string): Promise<ShelfMeta> {
    if (raw && raw.schemaVersion === 2 && Array.isArray(raw.files) && raw.files.length > 0 && typeof raw.files[0] === 'object') {
      return raw as ShelfMeta;
    }
    const v1 = raw as ShelfMetaV1;
    let entries: ShelfFileEntry[] = [];
    try {
      const patch = await fs.readFile(patchPath, 'utf8');
      entries = parsePatch(patch);
    } catch {
      entries = (v1.files ?? []).map((p) => ({ path: p, status: 'M' as const, patchOffset: 0, patchLength: 0 }));
    }
    const upgraded: ShelfMeta = {
      schemaVersion: 2,
      name: v1.name,
      displayName: v1.displayName,
      description: v1.description,
      createdAt: v1.createdAt,
      branch: v1.branch,
      baseCommit: v1.baseCommit,
      files: entries,
      origin: 'manual',
    };
    if (entries.length > 0 && entries[0].patchLength > 0) {
      try { await fs.writeFile(metaPath, JSON.stringify(upgraded, null, 2), 'utf8'); } catch {}
    }
    return upgraded;
  }

  private async findShelf(name: string): Promise<ShelfItem | undefined> {
    const items = await this.listShelves();
    return items.find((i) => i.meta.name === name);
  }

  private getShelvesDir(): string {
    return path.join(this.workspaceRoot, SHELVES_DIR);
  }

  private async ensureShelvesDir(): Promise<void> {
    await fs.mkdir(this.getShelvesDir(), { recursive: true });
  }

  private async ensureGitignore(): Promise<void> {
    const gi = path.join(this.workspaceRoot, '.gitignore');
    let content = '';
    try {
      content = await fs.readFile(gi, 'utf8');
    } catch {
      content = '';
    }
    const lines = content.split('\n').map((l) => l.trim());
    if (lines.includes(GITIGNORE_LINE) || lines.includes('.forge') || lines.includes('.forge/*')) return;
    const sep = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
    const append = `${sep}${GITIGNORE_COMMENT}\n${GITIGNORE_LINE}\n`;
    await fs.writeFile(gi, content + append, 'utf8');
  }

  private sanitizeName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'shelf';
  }
}
