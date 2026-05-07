import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';
import { GitService, CommitNode } from '../git/gitService';

export type RebaseAction = 'pick' | 'squash' | 'fixup' | 'drop' | 'reword' | 'edit';

export interface RebaseStep {
  sha: string;
  action: RebaseAction;
  message: string;
}

export class RebaseService {
  constructor(private git: GitService, private workspaceRoot: string) {}

  async listCommitsSince(baseRef: string): Promise<CommitNode[]> {
    const commits = await this.git.getLog({ all: false, maxCount: 200 });
    // Walk until we hit a commit that is the baseRef OR an ancestor of it
    const out: CommitNode[] = [];
    for (const c of commits) {
      if (c.sha === baseRef || c.sha.startsWith(baseRef)) break;
      out.push(c);
    }
    return out.reverse(); // oldest first, as rebase-todo expects
  }

  async run(baseRef: string, steps: RebaseStep[]): Promise<{ ok: boolean; output: string }> {
    const todo = steps
      .filter((s) => s.action !== 'drop')
      .map((s) => `${s.action} ${s.sha} ${s.message.split('\n')[0]}`)
      .join('\n') + '\n';

    const dropped = steps.filter((s) => s.action === 'drop');
    const finalTodo = todo + dropped.map((s) => `# drop ${s.sha} ${s.message.split('\n')[0]}`).join('\n');

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-rebase-'));
    const todoFile = path.join(tmpDir, 'rebase-todo.txt');
    const sequenceEditor = path.join(tmpDir, 'sequence-editor.js');
    await fs.writeFile(todoFile, finalTodo, 'utf8');

    const script = `#!/usr/bin/env node
const fs = require('fs');
const target = process.argv[2];
const src = ${JSON.stringify(todoFile)};
fs.writeFileSync(target, fs.readFileSync(src, 'utf8'));
`;
    await fs.writeFile(sequenceEditor, script, { mode: 0o755 });

    const env = {
      ...process.env,
      GIT_SEQUENCE_EDITOR: `node ${sequenceEditor}`,
      // Suppress reword/edit message-edit prompts; user must do those manually after.
      GIT_EDITOR: 'true',
    };

    return new Promise((resolve) => {
      execFile('git', ['rebase', '-i', baseRef], { cwd: this.workspaceRoot, env }, (err, stdout, stderr) => {
        const output = `${stdout}\n${stderr}`.trim();
        resolve({ ok: !err, output });
      });
    });
  }

  async abort(): Promise<{ ok: boolean; output: string }> {
    return new Promise((resolve) => {
      execFile('git', ['rebase', '--abort'], { cwd: this.workspaceRoot }, (err, stdout, stderr) => {
        resolve({ ok: !err, output: `${stdout}\n${stderr}`.trim() });
      });
    });
  }
}
