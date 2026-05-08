import simpleGit, { SimpleGit, StatusResult } from 'simple-git';

export interface LogOptions {
  maxCount?: number;
  all?: boolean;
}

export interface CommitNode {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  authorEmail: string;
  date: string;
  parents: string[];
  refs: string[];
}

const LOG_FORMAT = '%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%P%x1f%D%x1f%s%x1e';

export class GitService {
  private git: SimpleGit;

  constructor(private workspaceRoot: string) {
    this.git = simpleGit(workspaceRoot);
  }

  async isGitRepo(): Promise<boolean> {
    try {
      return await this.git.checkIsRepo();
    } catch {
      return false;
    }
  }

  async getWorkspaceRoot(): Promise<string> {
    return this.workspaceRoot;
  }

  async getDiff(options: string[] = []): Promise<string> {
    return this.git.diff(options);
  }

  async getStatus(): Promise<StatusResult> {
    return this.git.status();
  }

  async getCurrentBranch(): Promise<string> {
    const r = await this.git.revparse(['--abbrev-ref', 'HEAD']);
    return r.trim();
  }

  async getHeadSha(): Promise<string> {
    const r = await this.git.revparse(['HEAD']);
    return r.trim();
  }

  async stageFile(filePath: string): Promise<void> {
    await this.git.add(filePath);
  }

  async stageAll(): Promise<void> {
    await this.git.add('.');
  }

  async checkoutFile(filePath: string): Promise<void> {
    await this.git.checkout(['--', filePath]);
  }

  async checkoutAll(): Promise<void> {
    await this.git.checkout(['--', '.']);
  }

  async applyPatch(patchPath: string, extraArgs: string[] = []): Promise<void> {
    await this.git.raw(['apply', ...extraArgs, patchPath]);
  }

  async applyPatch3Way(patchPath: string): Promise<void> {
    await this.git.raw(['apply', '--3way', patchPath]);
  }

  async showFileAtIndex(index: 1 | 2 | 3, relPath: string): Promise<string> {
    return this.git.raw(['show', `:${index}:${relPath}`]);
  }

  async showFileAtCommit(sha: string, relPath: string): Promise<string> {
    try {
      return await this.git.raw(['show', `${sha}:${relPath}`]);
    } catch {
      return '';
    }
  }

  async getLog(options: LogOptions = {}): Promise<CommitNode[]> {
    const args = ['log', `--format=${LOG_FORMAT}`];
    if (options.all !== false) args.push('--all');
    if (options.maxCount) args.push(`--max-count=${options.maxCount}`);
    const raw = await this.git.raw(args);
    return raw
      .split('\x1e')
      .map((r) => r.trim())
      .filter((r) => r.length > 0)
      .map((record) => {
        const [sha, shortSha, author, authorEmail, date, parents, refs, message] = record.split('\x1f');
        return {
          sha,
          shortSha,
          message: message ?? '',
          author,
          authorEmail,
          date,
          parents: parents ? parents.split(' ').filter(Boolean) : [],
          refs: refs
            ? refs
                .split(',')
                .map((s) => s.trim().replace(/^HEAD -> /, 'HEAD,').split(','))
                .flat()
                .map((s) => s.trim())
                .filter(Boolean)
            : [],
        };
      });
  }

  async getCommitStats(sha: string): Promise<string> {
    return this.git.raw(['show', '--stat', sha]);
  }

  async blame(relPath: string): Promise<string> {
    return this.git.raw(['blame', '--porcelain', '--', relPath]);
  }

  async getConflictedFiles(): Promise<string[]> {
    const r = await this.git.raw(['diff', '--name-only', '--diff-filter=U']);
    return r.split('\n').map((s) => s.trim()).filter(Boolean);
  }

  async getBranches(): Promise<string[]> {
    const b = await this.git.branch(['-a']);
    return b.all;
  }

  async getTags(): Promise<string[]> {
    const t = await this.git.tags();
    return t.all;
  }
}
