import * as fs from 'fs/promises';
import * as path from 'path';
import { ShelvingService } from './shelvingService';

const API = 'https://api.github.com';

export interface CloudSyncOptions {
  token: string;
  gistId?: string;
}

export class CloudSync {
  constructor(private service: ShelvingService, private workspaceRoot: string) {}

  async push(opts: CloudSyncOptions): Promise<{ gistId: string; url: string }> {
    const items = await this.service.listShelves();
    const files: Record<string, { content: string }> = {};
    for (const it of items) {
      const patch = await fs.readFile(it.patchPath, 'utf8');
      const meta = await fs.readFile(it.metaPath, 'utf8');
      files[`${it.meta.name}.patch`] = { content: patch };
      files[`${it.meta.name}.meta.json`] = { content: meta };
    }
    if (Object.keys(files).length === 0) {
      throw new Error('No shelves to push');
    }
    const body = JSON.stringify({
      description: `Forge shelves (${path.basename(this.workspaceRoot)})`,
      public: false,
      files,
    });
    const url = opts.gistId ? `${API}/gists/${opts.gistId}` : `${API}/gists`;
    const method = opts.gistId ? 'PATCH' : 'POST';
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${opts.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body,
    });
    if (!res.ok) {
      throw new Error(`Gist push failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as { id: string; html_url: string };
    return { gistId: json.id, url: json.html_url };
  }

  async pull(opts: CloudSyncOptions): Promise<{ pulled: number }> {
    if (!opts.gistId) throw new Error('Gist ID required for pull');
    const res = await fetch(`${API}/gists/${opts.gistId}`, {
      headers: {
        Authorization: `Bearer ${opts.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!res.ok) throw new Error(`Gist pull failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { files: Record<string, { content: string }> };
    const dir = path.join(this.workspaceRoot, '.forge', 'shelves');
    await fs.mkdir(dir, { recursive: true });
    let pulled = 0;
    for (const [name, file] of Object.entries(json.files)) {
      await fs.writeFile(path.join(dir, name), file.content, 'utf8');
      if (name.endsWith('.meta.json')) pulled++;
    }
    return { pulled };
  }
}
