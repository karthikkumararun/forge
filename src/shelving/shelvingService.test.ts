import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import simpleGit from 'simple-git';
import { GitService } from '../git/gitService';
import { ShelvingService } from './shelvingService';

async function setupRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-shelf-test-'));
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig('user.email', 'test@forge');
  await git.addConfig('user.name', 'Forge Test');
  await git.addConfig('commit.gpgsign', 'false');
  await fs.writeFile(path.join(dir, 'a.txt'), 'alpha\nbeta\ngamma\n');
  await fs.writeFile(path.join(dir, 'b.txt'), 'one\ntwo\nthree\n');
  await git.add('.');
  await git.commit('init');
  return dir;
}

async function cleanup(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

describe('ShelvingService', () => {
  let dir: string;
  let svc: ShelvingService;

  beforeEach(async () => {
    dir = await setupRepo();
    svc = new ShelvingService(new GitService(dir), dir);
  });
  afterEach(async () => { await cleanup(dir); });

  it('shelve → working tree clean', async () => {
    await fs.writeFile(path.join(dir, 'a.txt'), 'alpha\nBETA\ngamma\n');
    await svc.shelveChanges('feat-x', 'change beta');
    const aAfter = await fs.readFile(path.join(dir, 'a.txt'), 'utf8');
    expect(aAfter).toBe('alpha\nbeta\ngamma\n');
    const list = await svc.listShelves();
    expect(list).toHaveLength(1);
    expect(list[0].meta.displayName).toBe('feat-x');
    expect(list[0].meta.schemaVersion).toBe(2);
    expect(list[0].meta.files).toHaveLength(1);
    expect(list[0].meta.files[0].path).toBe('a.txt');
  });

  it('full unshelve restores the change and keeps shelf by default', async () => {
    await fs.writeFile(path.join(dir, 'a.txt'), 'alpha\nBETA\ngamma\n');
    await svc.shelveChanges('feat-x', '');
    const list = await svc.listShelves();
    const r = await svc.unshelveChanges(list[0].meta.name);
    expect(r.applied).toContain('a.txt');
    expect(r.shelfRemaining).toBe(true);
    const a = await fs.readFile(path.join(dir, 'a.txt'), 'utf8');
    expect(a).toBe('alpha\nBETA\ngamma\n');
    expect(await svc.listShelves()).toHaveLength(1);
  });

  it('unshelve with keep:false trashes the shelf when fully applied', async () => {
    await fs.writeFile(path.join(dir, 'a.txt'), 'alpha\nBETA\ngamma\n');
    await svc.shelveChanges('feat-x', '');
    const list = await svc.listShelves();
    const r = await svc.unshelveChanges(list[0].meta.name, { keep: false });
    expect(r.shelfRemaining).toBe(false);
    expect(await svc.listShelves()).toHaveLength(0);
    expect(await svc.listTrashed()).toHaveLength(1);
  });

  it('partial unshelve with keep:false rewrites the shelf bundle', async () => {
    await fs.writeFile(path.join(dir, 'a.txt'), 'alpha\nBETA\ngamma\n');
    await fs.writeFile(path.join(dir, 'b.txt'), 'ONE\ntwo\nthree\n');
    await svc.shelveChanges('multi', '');
    const list = await svc.listShelves();
    const name = list[0].meta.name;
    expect(list[0].meta.files.map((f) => f.path).sort()).toEqual(['a.txt', 'b.txt']);

    const r = await svc.unshelveChanges(name, { files: ['a.txt'], keep: false });
    expect(r.applied).toEqual(['a.txt']);
    expect(r.shelfRemaining).toBe(true);

    const a = await fs.readFile(path.join(dir, 'a.txt'), 'utf8');
    expect(a).toBe('alpha\nBETA\ngamma\n');
    const b = await fs.readFile(path.join(dir, 'b.txt'), 'utf8');
    expect(b).toBe('one\ntwo\nthree\n');

    const after = await svc.listShelves();
    expect(after).toHaveLength(1);
    expect(after[0].meta.files.map((f) => f.path)).toEqual(['b.txt']);
  });

  it('soft delete + restore round-trip', async () => {
    await fs.writeFile(path.join(dir, 'a.txt'), 'alpha\nBETA\ngamma\n');
    await svc.shelveChanges('feat-x', '');
    const name = (await svc.listShelves())[0].meta.name;

    await svc.deleteShelve(name);
    expect(await svc.listShelves()).toHaveLength(0);
    const trashed = await svc.listTrashed();
    expect(trashed).toHaveLength(1);

    const trashedKey = path.basename(trashed[0].metaPath, '.meta.json');
    await svc.restoreFromTrash(trashedKey);
    expect(await svc.listTrashed()).toHaveLength(0);
    expect(await svc.listShelves()).toHaveLength(1);
  });

  it('hard delete bypasses trash', async () => {
    await fs.writeFile(path.join(dir, 'a.txt'), 'alpha\nBETA\ngamma\n');
    await svc.shelveChanges('feat-x', '');
    const name = (await svc.listShelves())[0].meta.name;
    await svc.deleteShelve(name, { hard: true });
    expect(await svc.listShelves()).toHaveLength(0);
    expect(await svc.listTrashed()).toHaveLength(0);
  });

  it('renameShelf updates displayName and updatedAt', async () => {
    await fs.writeFile(path.join(dir, 'a.txt'), 'alpha\nBETA\ngamma\n');
    await svc.shelveChanges('orig', '');
    const name = (await svc.listShelves())[0].meta.name;
    await svc.renameShelf(name, 'renamed');
    const after = (await svc.listShelves())[0];
    expect(after.meta.displayName).toBe('renamed');
    expect(after.meta.updatedAt).toBeTruthy();
  });

  it('setShelfDescription updates description', async () => {
    await fs.writeFile(path.join(dir, 'a.txt'), 'alpha\nBETA\ngamma\n');
    await svc.shelveChanges('orig', 'old');
    const name = (await svc.listShelves())[0].meta.name;
    await svc.setShelfDescription(name, 'new');
    expect((await svc.listShelves())[0].meta.description).toBe('new');
  });

  it('autoShelf creates a shelf with auto- prefix and origin', async () => {
    await fs.writeFile(path.join(dir, 'a.txt'), 'alpha\nBETA\ngamma\n');
    const name = await svc.autoShelf('auto-checkout', 'checkout main');
    expect(name).toBeTruthy();
    expect(name!.startsWith('auto-')).toBe(true);
    const list = await svc.listShelves();
    expect(list[0].meta.origin).toBe('auto-checkout');
    expect(list[0].meta.description).toContain('checkout main');
  });

  it('autoShelf returns undefined on a clean tree', async () => {
    const r = await svc.autoShelf('auto-pull');
    expect(r).toBeUndefined();
  });

  it('per-file APIs reproduce shelved content', async () => {
    await fs.writeFile(path.join(dir, 'a.txt'), 'alpha\nBETA\ngamma\n');
    await svc.shelveChanges('feat', '');
    const name = (await svc.listShelves())[0].meta.name;

    const base = await svc.getFileBaseContent(name, 'a.txt');
    const shelved = await svc.getFileShelvedContent(name, 'a.txt');
    expect(base).toBe('alpha\nbeta\ngamma\n');
    expect(shelved).toBe('alpha\nBETA\ngamma\n');
  });

  it('migrates a v1 meta on read', async () => {
    await fs.writeFile(path.join(dir, 'a.txt'), 'alpha\nBETA\ngamma\n');
    await svc.shelveChanges('legacy', '');
    const list = await svc.listShelves();
    const metaPath = list[0].metaPath;

    const v1 = {
      name: list[0].meta.name,
      displayName: 'legacy',
      description: '',
      createdAt: list[0].meta.createdAt,
      branch: list[0].meta.branch,
      baseCommit: list[0].meta.baseCommit,
      files: ['a.txt'],
    };
    await fs.writeFile(metaPath, JSON.stringify(v1, null, 2), 'utf8');

    const reread = await svc.listShelves();
    expect(reread[0].meta.schemaVersion).toBe(2);
    expect(reread[0].meta.files).toHaveLength(1);
    expect(reread[0].meta.files[0]).toMatchObject({ path: 'a.txt', status: 'M' });
    expect(reread[0].meta.files[0].patchLength).toBeGreaterThan(0);
  });

  it('rejects shelve on a clean tree', async () => {
    await expect(svc.shelveChanges('empty', '')).rejects.toThrow(/No changes to shelve/);
  });

  describe('hunk-level operations', () => {
    it('shelveHunks shelves only the selected hunk and reverts only that region', async () => {
      const lines = Array.from({ length: 12 }, (_, i) => `line${i + 1}`);
      await fs.writeFile(path.join(dir, 'a.txt'), lines.join('\n') + '\n');
      const git = simpleGit(dir);
      await git.add('.');
      await git.commit('seed long file');

      const modified = [...lines];
      modified[1] = 'LINE2';
      modified[10] = 'LINE11';
      await fs.writeFile(path.join(dir, 'a.txt'), modified.join('\n') + '\n');

      const detailed = await svc.getWorkingTreeHunks();
      const file = detailed.find((f) => f.path === 'a.txt')!;
      expect(file.hunks.length).toBeGreaterThanOrEqual(2);

      const firstHunkId = file.hunks[0].id;
      await svc.shelveHunks('hunk-shelf', '', [firstHunkId]);

      const after = await fs.readFile(path.join(dir, 'a.txt'), 'utf8');
      expect(after).toContain('line2');
      expect(after).not.toContain('LINE2');
      expect(after).toContain('LINE11');

      const list = await svc.listShelves();
      expect(list).toHaveLength(1);
      expect(list[0].meta.files[0].path).toBe('a.txt');
    });

    it('unshelveHunks applies only selected hunk and rewrites bundle when keep:false', async () => {
      const lines = Array.from({ length: 12 }, (_, i) => `line${i + 1}`);
      await fs.writeFile(path.join(dir, 'a.txt'), lines.join('\n') + '\n');
      const git = simpleGit(dir);
      await git.add('.');
      await git.commit('seed');

      const modified = [...lines];
      modified[1] = 'LINE2';
      modified[10] = 'LINE11';
      await fs.writeFile(path.join(dir, 'a.txt'), modified.join('\n') + '\n');
      await svc.shelveChanges('two-hunks', '');

      const list = await svc.listShelves();
      const name = list[0].meta.name;
      const detailed = await svc.getShelfHunks(name);
      const hunkIds = detailed[0].hunks.map((h) => h.id);
      expect(hunkIds.length).toBeGreaterThanOrEqual(2);

      const r = await svc.unshelveHunks(name, [hunkIds[0]], { keep: false });
      expect(r.applied).toContain('a.txt');
      expect(r.shelfRemaining).toBe(true);

      const after = await fs.readFile(path.join(dir, 'a.txt'), 'utf8');
      expect(after).toContain('LINE2');
      expect(after).not.toContain('LINE11');

      const updated = (await svc.listShelves())[0];
      const remainingHunks = await svc.getShelfHunks(updated.meta.name);
      expect(remainingHunks[0].hunks.length).toBe(hunkIds.length - 1);
    });

    it('shelveHunks rejects when no hunks selected', async () => {
      await fs.writeFile(path.join(dir, 'a.txt'), 'alpha\nBETA\ngamma\n');
      await expect(svc.shelveHunks('empty', '', [])).rejects.toThrow(/No hunks selected/);
    });
  });

  describe('conflict path', () => {
    async function shelveAndDivergeOnA(): Promise<string> {
      await fs.writeFile(path.join(dir, 'a.txt'), 'alpha\nBETA\ngamma\n');
      await svc.shelveChanges('feat-x', '');
      const name = (await svc.listShelves())[0].meta.name;
      await fs.writeFile(path.join(dir, 'a.txt'), 'alpha\nDIFFERENT\ngamma\n');
      const git = simpleGit(dir);
      await git.add('.');
      await git.commit('divergent change on same line');
      return name;
    }

    it('3-way unshelve onto divergent commit reports conflict and writes markers', async () => {
      const name = await shelveAndDivergeOnA();
      const r = await svc.unshelveChanges(name);
      expect(r.conflicted).toContain('a.txt');
      expect(r.applied).not.toContain('a.txt');
      const content = await fs.readFile(path.join(dir, 'a.txt'), 'utf8');
      expect(content).toMatch(/^<{7}/m);
      expect(content).toMatch(/^={7}\s*$/m);
      expect(content).toMatch(/^>{7}/m);
    });

    it('shelf is preserved on conflict even with keep:false', async () => {
      const name = await shelveAndDivergeOnA();
      const r = await svc.unshelveChanges(name, { keep: false });
      expect(r.conflicted).toContain('a.txt');
      expect(r.shelfRemaining).toBe(true);
      expect(await svc.listShelves()).toHaveLength(1);
      expect(await svc.listTrashed()).toHaveLength(0);
    });

    it('onConflict:abort throws instead of attempting 3-way', async () => {
      const name = await shelveAndDivergeOnA();
      await expect(svc.unshelveChanges(name, { onConflict: 'abort' })).rejects.toThrow(/git apply failed/);
      const content = await fs.readFile(path.join(dir, 'a.txt'), 'utf8');
      expect(content).not.toMatch(/^<{7}/m);
    });

    it('partial unshelve: only conflicting file conflicts; non-conflicting file applies cleanly', async () => {
      await fs.writeFile(path.join(dir, 'a.txt'), 'alpha\nBETA\ngamma\n');
      await fs.writeFile(path.join(dir, 'b.txt'), 'ONE\ntwo\nthree\n');
      await svc.shelveChanges('multi', '');
      const name = (await svc.listShelves())[0].meta.name;

      await fs.writeFile(path.join(dir, 'a.txt'), 'alpha\nDIFFERENT\ngamma\n');
      const git = simpleGit(dir);
      await git.add('.');
      await git.commit('divergent on a only');

      const r = await svc.unshelveChanges(name);
      expect(r.conflicted).toEqual(['a.txt']);
      expect(r.applied).toEqual(['b.txt']);
      const b = await fs.readFile(path.join(dir, 'b.txt'), 'utf8');
      expect(b).toBe('ONE\ntwo\nthree\n');
    });
  });
});
