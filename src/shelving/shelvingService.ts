import * as fs from 'fs/promises';
import * as path from 'path';
import { GitService } from '../git/gitService';
import { ShelfItem, ShelfMeta } from './types';

const SHELVES_DIR = '.forge/shelves';
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

    const nameArgs = ['HEAD', '--name-only'];
    if (files && files.length > 0) nameArgs.push('--', ...files);
    const fileList = (await this.gitService.getDiff(nameArgs))
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    const branch = await this.gitService.getCurrentBranch();
    const head = await this.gitService.getHeadSha();

    const meta: ShelfMeta = {
      name: baseName,
      displayName,
      description,
      createdAt: new Date().toISOString(),
      branch,
      baseCommit: head,
      files: fileList,
    };

    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8');
    if (files && files.length > 0) {
      for (const f of fileList) await this.gitService.checkoutFile(f);
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
        const meta: ShelfMeta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
        items.push({ meta, patchPath, metaPath });
      } catch {
        // skip corrupt entries
      }
    }
    items.sort((a, b) => b.meta.createdAt.localeCompare(a.meta.createdAt));
    return items;
  }

  async unshelveChanges(shelfName: string): Promise<void> {
    const item = await this.findShelf(shelfName);
    if (!item) throw new Error(`Shelf not found: ${shelfName}`);
    try {
      await this.gitService.applyPatch(item.patchPath);
    } catch (err: any) {
      throw new Error(`git apply failed: ${err?.message ?? String(err)}`);
    }
    await fs.unlink(item.patchPath).catch(() => {});
    await fs.unlink(item.metaPath).catch(() => {});
  }

  async deleteShelve(shelfName: string): Promise<void> {
    const item = await this.findShelf(shelfName);
    if (!item) throw new Error(`Shelf not found: ${shelfName}`);
    await fs.unlink(item.patchPath).catch(() => {});
    await fs.unlink(item.metaPath).catch(() => {});
  }

  async peekShelf(shelfName: string): Promise<string> {
    const item = await this.findShelf(shelfName);
    if (!item) throw new Error(`Shelf not found: ${shelfName}`);
    return fs.readFile(item.patchPath, 'utf8');
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
