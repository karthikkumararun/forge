# Forge — System Specification
 
> **Supercharged Git for VS Code**
> JetBrains-quality merge conflict resolution, shelving, and git graph — as a VS Code extension.
> Open source. Built for developers who refuse to give up their editor.
 
---
 
## Table of Contents
 
1. [Project Overview](#1-project-overview)
2. [Goals & Non-Goals](#2-goals--non-goals)
3. [Architecture Overview](#3-architecture-overview)
4. [Directory Structure](#4-directory-structure)
5. [package.json Specification](#5-packagejson-specification)
6. [Feature 1 — Shelving](#6-feature-1--shelving)
7. [Feature 2 — Custom Merge Editor](#7-feature-2--custom-merge-editor)
8. [Feature 3 — Git Graph](#8-feature-3--git-graph)
9. [Git Service (Shared Layer)](#9-git-service-shared-layer)
10. [Extension Entry Point](#10-extension-entry-point)
11. [Webview Architecture](#11-webview-architecture)
12. [Theming & Styling](#12-theming--styling)
13. [Build System](#13-build-system)
14. [Testing Strategy](#14-testing-strategy)
15. [Open Source Setup](#15-open-source-setup)
16. [Phased Roadmap](#16-phased-roadmap)
---
 
## 1. Project Overview
 
**Name:** Forge
**Publisher ID:** `forge-git`
**VS Code Marketplace ID:** `forge-git.forge`
**Repository:** `github.com/forge-git/forge`
**License:** MIT
**Language:** TypeScript (extension host) + React + TypeScript (webviews)
 
Forge is a VS Code extension that brings JetBrains-quality git tooling to VS Code and all editors built on it (Cursor, Windsurf, etc.). The three flagship features are:
 
1. **Shelving** — Named, persistent patch-based change storage (not git stash). Stored in `.forge/shelves/` as `.patch` + `.meta.json` files. Not part of git history.
2. **Custom Merge Editor** — A 3-way + result panel merge conflict resolution UI built entirely in a Webview using Monaco Editor and token-aware diffing via Tree-sitter WASM. Replaces VS Code's inferior native diff.
3. **Git Graph** — A rich, interactive commit graph with branch visualization, built with React and D3.js inside a Webview panel.
---
 
## 2. Goals & Non-Goals
 
### Goals
- Match or exceed JetBrains' merge conflict resolution UX
- Implement shelving as a first-class feature (not a wrapper around `git stash`)
- Build a beautiful, interactive git graph
- Be fully compatible with VS Code, Cursor, Windsurf, and any VS Code fork
- Be open source, MIT licensed, community-driven
### Non-Goals
- Replacing GitLens entirely (Forge focuses on depth in 3 areas, not breadth)
- Building a new SCM provider (Forge augments the existing git SCM)
- Supporting non-git VCS (Mercurial, SVN, etc.) in v1
- Cloud sync of shelves (v2+)
---
 
## 3. Architecture Overview
 
```
┌─────────────────────────────────────────────────────────────┐
│                        VS Code Extension Host                │
│                                                             │
│  extension.ts (entry)                                       │
│       │                                                     │
│       ├── GitService          (simple-git wrapper)          │
│       ├── ShelvingService     (patch file I/O)              │
│       ├── ShelvingProvider    (TreeDataProvider)            │
│       ├── MergeEditorProvider (CustomEditorProvider)        │
│       └── GitGraphProvider    (WebviewPanelProvider)        │
│                                                             │
└────────────────────┬────────────────────────────────────────┘
                     │ postMessage / acquireVsCodeApi
        ┌────────────┴────────────┐
        │                         │
┌───────▼──────────┐   ┌─────────▼──────────┐
│  Merge Editor    │   │    Git Graph        │
│  Webview         │   │    Webview          │
│                  │   │                     │
│  React + Monaco  │   │  React + D3.js      │
│  Tree-sitter     │   │                     │
│  WASM differ     │   │                     │
└──────────────────┘   └─────────────────────┘
```
 
**Communication pattern:** All webviews use `vscode.postMessage` / `window.addEventListener('message')` for bidirectional communication with the extension host. The extension host owns all git operations — webviews never call git directly.
 
---
 
## 4. Directory Structure
 
```
forge/
├── src/
│   ├── extension.ts                        # Activation, command registration, wiring
│   ├── git/
│   │   └── gitService.ts                   # All git operations via simple-git
│   ├── shelving/
│   │   ├── shelvingService.ts              # Core shelving logic (patch files)
│   │   ├── shelvingProvider.ts             # TreeDataProvider for sidebar
│   │   └── types.ts                        # ShelfItem, ShelfMeta interfaces
│   ├── mergeEditor/
│   │   ├── mergeEditorProvider.ts          # CustomEditorProvider / WebviewPanel
│   │   └── conflictParser.ts              # Parse git conflict markers from file
│   ├── gitGraph/
│   │   └── gitGraphProvider.ts            # WebviewPanel for git graph
│   └── webviews/
│       ├── mergeEditor/
│       │   ├── index.html                  # Webview shell
│       │   ├── index.tsx                   # React root
│       │   ├── MergeEditor.tsx             # 3-way + result UI component
│       │   ├── ConflictChunk.tsx           # Per-conflict chunk component
│       │   ├── ResultPane.tsx              # Monaco-backed result editor
│       │   ├── differ.ts                   # Token-aware diff using diff-match-patch
│       │   └── treeSitterDiffer.ts         # AST-aware diff via Tree-sitter WASM
│       └── gitGraph/
│           ├── index.html                  # Webview shell
│           ├── index.tsx                   # React root
│           ├── GitGraph.tsx                # D3 graph component
│           ├── CommitDetail.tsx            # Sidebar showing commit info
│           └── BranchLane.tsx             # D3 branch lane renderer
├── media/
│   └── forge-icon.svg                     # Extension icon
├── .forge/                                # Runtime directory (in user's repo, gitignored)
│   └── shelves/                           # Shelf patch + meta files stored here
├── package.json
├── tsconfig.json                          # Extension host TS config
├── tsconfig.webview.json                  # Webview TS config (DOM lib)
├── esbuild.js                             # Build script
├── .vscodeignore
├── .gitignore
├── README.md
├── CONTRIBUTING.md
├── CHANGELOG.md
└── system-spec.md                         # This file
```
 
---
 
## 5. package.json Specification
 
```json
{
  "name": "forge",
  "displayName": "Forge",
  "description": "Supercharged git for VS Code — JetBrains-quality merge editor, shelving, and git graph",
  "version": "0.1.0",
  "publisher": "forge-git",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/forge-git/forge"
  },
  "engines": {
    "vscode": "^1.85.0"
  },
  "categories": ["SCM Providers", "Other"],
  "keywords": ["git", "merge", "shelve", "graph", "diff"],
  "activationEvents": ["onStartupFinished"],
  "main": "./dist/extension.js",
  "contributes": {
    "commands": [
      {
        "command": "forge.shelveChanges",
        "title": "Forge: Shelve Current Changes",
        "icon": "$(archive)"
      },
      {
        "command": "forge.unshelveChanges",
        "title": "Forge: Unshelve",
        "icon": "$(arrow-down)"
      },
      {
        "command": "forge.deleteShelve",
        "title": "Forge: Delete Shelf",
        "icon": "$(trash)"
      },
      {
        "command": "forge.previewShelve",
        "title": "Forge: Preview Shelf",
        "icon": "$(eye)"
      },
      {
        "command": "forge.refreshShelves",
        "title": "Forge: Refresh Shelves",
        "icon": "$(refresh)"
      },
      {
        "command": "forge.openMergeEditor",
        "title": "Forge: Open Merge Editor",
        "icon": "$(git-merge)"
      },
      {
        "command": "forge.openGitGraph",
        "title": "Forge: Open Git Graph",
        "icon": "$(git-branch)"
      }
    ],
    "viewsContainers": {
      "activitybar": [
        {
          "id": "forge",
          "title": "Forge",
          "icon": "media/forge-icon.svg"
        }
      ]
    },
    "views": {
      "forge": [
        {
          "id": "forge-shelves",
          "name": "Shelves",
          "icon": "$(archive)",
          "contextualTitle": "Forge Shelves"
        }
      ]
    },
    "menus": {
      "view/title": [
        {
          "command": "forge.shelveChanges",
          "when": "view == forge-shelves",
          "group": "navigation"
        },
        {
          "command": "forge.refreshShelves",
          "when": "view == forge-shelves",
          "group": "navigation"
        }
      ],
      "view/item/context": [
        {
          "command": "forge.unshelveChanges",
          "when": "viewItem == shelf",
          "group": "inline"
        },
        {
          "command": "forge.previewShelve",
          "when": "viewItem == shelf",
          "group": "inline"
        },
        {
          "command": "forge.deleteShelve",
          "when": "viewItem == shelf",
          "group": "inline"
        }
      ],
      "editor/title": [
        {
          "command": "forge.openMergeEditor",
          "when": "resourceScheme == file",
          "group": "navigation"
        }
      ]
    },
    "configuration": {
      "title": "Forge",
      "properties": {
        "forge.shelves.autoGitignore": {
          "type": "boolean",
          "default": true,
          "description": "Automatically add .forge/ to .gitignore"
        },
        "forge.mergeEditor.useSyntaxAwareDiff": {
          "type": "boolean",
          "default": true,
          "description": "Use Tree-sitter AST-aware diffing in the merge editor (more accurate, slightly slower)"
        },
        "forge.gitGraph.maxCommits": {
          "type": "number",
          "default": 500,
          "description": "Maximum number of commits to load in the git graph"
        }
      }
    }
  },
  "dependencies": {
    "simple-git": "^3.22.0",
    "diff-match-patch": "^1.0.5"
  },
  "devDependencies": {
    "@types/vscode": "^1.85.0",
    "@types/node": "^20.0.0",
    "@types/react": "^18.0.0",
    "@types/react-dom": "^18.0.0",
    "@types/d3": "^7.0.0",
    "@types/diff-match-patch": "^1.0.36",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "d3": "^7.9.0",
    "esbuild": "^0.20.0",
    "typescript": "^5.3.0"
  }
}
```
 
---
 
## 6. Feature 1 — Shelving
 
### Overview
 
Shelving stores uncommitted working tree changes as named patch files on disk — inside the project's `.forge/shelves/` directory. This is **not** git stash. Shelves are:
- Named and described by the user
- Stored as standard unified diff `.patch` files
- Accompanied by a `.meta.json` sidecar
- Never committed to git (`.forge/` is auto-added to `.gitignore`)
- Applicable back to the working tree via `git apply`
### `src/shelving/types.ts`
 
```typescript
export interface ShelfMeta {
  name: string;                // sanitized filename-safe name
  displayName: string;         // original user-provided name
  description: string;
  createdAt: string;           // ISO 8601
  branch: string;              // branch at time of shelving
  baseCommit: string;          // HEAD SHA at time of shelving
  files: string[];             // list of modified file paths
}
 
export interface ShelfItem {
  meta: ShelfMeta;
  patchPath: string;           // absolute path to .patch file
  metaPath: string;            // absolute path to .meta.json file
}
```
 
### `src/shelving/shelvingService.ts`
 
Implement the following class:
 
```typescript
export class ShelvingService {
  constructor(private gitService: GitService, private workspaceRoot: string) {}
 
  async shelveChanges(displayName: string, description: string): Promise<void>
  async listShelves(): Promise<ShelfItem[]>
  async unshelveChanges(shelfName: string): Promise<void>
  async deleteShelve(shelfName: string): Promise<void>
  async peekShelf(shelfName: string): Promise<string>  // returns raw patch content
  private getShelvesDir(): string
  private ensureShelvesDir(): Promise<void>
  private ensureGitignore(): Promise<void>
  private sanitizeName(name: string): string
}
```
 
**`shelveChanges` implementation steps:**
1. Call `git diff HEAD` via GitService to get the full unified diff of staged + unstaged changes
2. If the diff is empty, throw an error: "No changes to shelve"
3. Generate a sanitized filename from `displayName` + timestamp: e.g. `my-feature_20240315T143022.patch`
4. Write the patch content to `.forge/shelves/<filename>.patch`
5. Call `git diff HEAD --name-only` to get list of affected files
6. Get current branch via `git rev-parse --abbrev-ref HEAD`
7. Get HEAD SHA via `git rev-parse HEAD`
8. Write `.forge/shelves/<filename>.meta.json` with all ShelfMeta fields
9. Run `git checkout -- .` to clean the working tree (reset to HEAD)
10. Call `ensureGitignore()` to make sure `.forge/` is in `.gitignore`
**`unshelveChanges` implementation steps:**
1. Find the shelf by name in `.forge/shelves/`
2. Run `git apply <patchPath>` via GitService
3. If `git apply` fails (e.g. conflicts), throw a descriptive error with the git output
4. Delete the `.patch` and `.meta.json` files
5. Refresh the tree view
**`ensureGitignore` implementation:**
- Read `.gitignore` at workspace root (create if missing)
- Check if `.forge/` is already listed
- If not, append `.forge/` on a new line with a comment `# Forge shelves`
### `src/shelving/shelvingProvider.ts`
 
Implement `ShelvingProvider` as a `vscode.TreeDataProvider<ShelfTreeItem>`:
 
- **Tree item per shelf:** Shows `displayName` as label, `description` + `branch` + `createdAt` as description/tooltip
- **Empty state:** If no shelves exist, show a single grayed-out item: "No shelves yet — shelve your changes to get started"
- **Refresh:** Implement `refresh()` which calls `this._onDidChangeTreeData.fire(undefined)`
- **Context menu:** Each item has `contextValue = "shelf"` to enable the menus defined in package.json
- **Inline buttons:** `unshelveChanges` and `deleteShelve` appear as inline icons on hover
**Preview shelf:** When `forge.previewShelve` is triggered:
- Call `shelvingService.peekShelf(name)` to get patch content
- Open it as a virtual document using `vscode.workspace.registerTextDocumentContentProvider`
- Use URI scheme `forge-shelf-preview:` with the shelf name as path
- Open with `vscode.window.showTextDocument` in a read-only diff view
---
 
## 7. Feature 2 — Custom Merge Editor
 
### Philosophy
 
VS Code's built-in diff and merge editor are line-based and inferior to JetBrains' implementation. Forge's merge editor is **100% custom**, built in a Webview. It does not use `vscode.diff` at all.
 
### Layout
 
```
┌─────────────────────────────────────────────────────────────────┐
│  FORGE MERGE EDITOR — filename.ts                 [✓ Mark Done] │
├─────────────────┬──────────────────┬──────────────────────────  ┤
│   ● YOURS       │   ◎ BASE         │   ● THEIRS                 │
│   (current)     │   (common anc.)  │   (incoming)               │
│                 │                  │                             │
│  [unchanged]    │  [unchanged]     │  [unchanged]               │
│                 │                  │                             │
│  ┌── CONFLICT ──────────────────────────────────────────────┐   │
│  │ fn greet()  │  fn greet()      │  fn greet()             │   │
│  │   "hey"     │    "hi"          │    "hello"              │   │
│  │ [✓ Accept] │                  │  [✓ Accept]             │   │
│  └─────────────────────────────────────────────────────────-┘   │
│                 │                  │                             │
├─────────────────┴──────────────────┴─────────────────────────── ┤
│  RESULT  (editable — Monaco Editor)                             │
│                                                                 │
│  fn greet() {                                                   │
│    return "hey";    ◄─ accepted from YOURS                      │
│  }                                                              │
│                                                                 │
│  [← Prev Conflict]  [→ Next Conflict]    [2 of 5 resolved]     │
└─────────────────────────────────────────────────────────────────┘
```
 
### `src/mergeEditor/conflictParser.ts`
 
Parse a file containing git conflict markers into structured conflict chunks:
 
```typescript
export interface ConflictChunk {
  id: string;
  startLine: number;
  endLine: number;
  ours: string[];        // lines between <<<<<<< and =======
  theirs: string[];      // lines between ======= and >>>>>>>
  baseLines?: string[];  // from diff3 format (between ||||||| and =======)
}
 
export interface ParsedConflicts {
  chunks: ConflictChunk[];
  totalLines: number;
  linesBeforeFirst: string[];
}
 
export function parseConflicts(fileContent: string): ParsedConflicts
```
 
Support both standard conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`) and diff3 style markers (`|||||||`).
 
### `src/mergeEditor/mergeEditorProvider.ts`
 
Implement as a `vscode.WebviewPanel` provider (not `CustomEditorProvider` — use a command-triggered panel so we can control exactly when it opens).
 
**When `forge.openMergeEditor` is invoked:**
1. Get the active file path from the active editor
2. Check if the file contains conflict markers — if not, show an info message: "No conflicts found in this file"
3. Run the following git commands to get the 3 versions:
   - `git show :1:<relative-path>` → base version
   - `git show :2:<relative-path>` → ours version  
   - `git show :3:<relative-path>` → theirs version
4. If any of these fail (e.g. file is not in a conflicted merge), fall back to reading the file directly and parsing conflict markers
5. Create a `WebviewPanel` with `retainContextWhenHidden: true`
6. Load the merge editor webview HTML
7. Send initial state to webview via `postMessage`:
```typescript
{
  type: 'init',
  payload: {
    filePath: string,
    fileName: string,
    base: string,        // full file content
    ours: string,        // full file content
    theirs: string,      // full file content
    language: string,    // detected language for syntax highlighting
  }
}
```
 
8. Listen for messages from the webview:
   - `{ type: 'save', payload: { content: string } }` → write resolved content to file, run `git add <file>`
   - `{ type: 'markDone' }` → same as save + close panel
### `src/webviews/mergeEditor/MergeEditor.tsx`
 
Top-level React component. State:
 
```typescript
interface MergeEditorState {
  base: string;
  ours: string;
  theirs: string;
  result: string;
  conflicts: ConflictChunk[];
  resolvedChunks: Set<string>;
  currentChunkIndex: number;
  language: string;
  fileName: string;
}
```
 
**Rendering:**
- 3-column top section (YOURS | BASE | THEIRS) using CSS Grid: `grid-template-columns: 1fr 1fr 1fr`
- Each column is a read-only Monaco Editor instance
- Conflict regions are highlighted with colored backgrounds:
  - YOURS conflicts: `rgba(86, 156, 214, 0.15)` (blue tint)
  - THEIRS conflicts: `rgba(181, 206, 168, 0.15)` (green tint)
  - BASE: `rgba(255, 255, 255, 0.05)` (subtle)
- "Accept" button floats at the top-right of each conflict region per column
- Bottom section: full-width Monaco Editor (editable) for the RESULT
- Footer bar: prev/next navigation, conflict counter, Save button
**Accepting a chunk:**
- Clicking "Accept Yours" / "Accept Theirs" replaces that conflict region in the RESULT editor with the chosen lines
- The accepted chunk is highlighted green in the RESULT
- The chunk is marked resolved in state
- Navigation auto-advances to next unresolved conflict
**Monaco integration in the webview:**
- Load Monaco from CDN: `https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs/loader.js`
- Use `monaco.editor.create()` for each panel
- Set `language` from the extension host's detected language
- For read-only panels: `readOnly: true, minimap: { enabled: false }`
- For result panel: full editor with minimap
### `src/webviews/mergeEditor/differ.ts`
 
Token-aware differ using `diff-match-patch`:
 
```typescript
export interface DiffToken {
  type: 'equal' | 'insert' | 'delete';
  text: string;
  line: number;
}
 
export function computeLineDiff(before: string, after: string): DiffToken[]
export function computeTokenDiff(before: string, after: string): DiffToken[]
export function isWhitespaceOnlyChange(before: string, after: string): boolean
```
 
Use `diff-match-patch`'s `diff_cleanupSemantic()` to improve diff readability. For the merge editor, use token-level diff to highlight what specifically changed within a line, not just which lines changed.
 
### Phase 2 — Tree-sitter (implement after Phase 1 is working)
 
`src/webviews/mergeEditor/treeSitterDiffer.ts`:
 
- Load Tree-sitter WASM (`web-tree-sitter`) in the webview
- Load the appropriate language grammar based on file extension
- Parse both versions of a conflict chunk into ASTs
- Diff at the AST node level, not line level
- This enables detecting: pure renames, reordered arguments, whitespace-only reformats
- Expose: `computeAstDiff(before: string, after: string, language: string): DiffToken[]`
Supported languages in Phase 2: TypeScript, JavaScript, Python, Java, Go, Rust, C/C++
 
---
 
## 8. Feature 3 — Git Graph
 
### `src/gitGraph/gitGraphProvider.ts`
 
Opens a `WebviewPanel` when `forge.openGitGraph` is invoked.
 
**Data fetching — call git from extension host:**
 
```typescript
interface CommitNode {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  authorEmail: string;
  date: string;           // ISO 8601
  parents: string[];      // parent SHAs
  refs: string[];         // branch/tag refs pointing here (e.g. ["HEAD", "main", "origin/main"])
}
```
 
Use `git log --all --format=<custom> --max-count=<maxCommits>` to get commit data. Parse into `CommitNode[]` and send to webview.
 
### `src/webviews/gitGraph/GitGraph.tsx`
 
**D3 Graph rendering:**
- Assign each branch to a horizontal "lane" (column)
- Render commits as circles on their lane's vertical track
- Draw bezier curves between commits and their parents, colored by branch
- Each commit circle is clickable → shows `CommitDetail` panel on the right
- Support zoom + pan (D3 zoom behavior)
- Render branch/tag ref badges next to the relevant commit
**`CommitDetail` panel (shown on right when a commit is clicked):**
- Commit SHA (full, copyable)
- Author + date
- Full commit message
- List of changed files (from `git show --stat <sha>`)
- Clicking a file → opens VS Code diff of that file at that commit
**Controls bar (top of graph):**
- Branch filter dropdown (show all / current branch / select branches)
- Search box (filter commits by message or author)
- "Refresh" button
---
 
## 9. Git Service (Shared Layer)
 
### `src/git/gitService.ts`
 
Single service class wrapping `simple-git`. All features use this — no feature calls git directly.
 
```typescript
import simpleGit, { SimpleGit } from 'simple-git';
 
export class GitService {
  private git: SimpleGit;
 
  constructor(workspaceRoot: string) {
    this.git = simpleGit(workspaceRoot);
  }
 
  // Core
  async isGitRepo(): Promise<boolean>
  async getWorkspaceRoot(): Promise<string>
 
  // Status
  async getDiff(options?: string[]): Promise<string>       // git diff with options
  async getStatus(): Promise<StatusResult>
  async getCurrentBranch(): Promise<string>
  async getHeadSha(): Promise<string>
 
  // Staging
  async stageFile(filePath: string): Promise<void>
  async stageAll(): Promise<void>
  async checkoutFile(filePath: string): Promise<void>      // git checkout -- <file>
  async checkoutAll(): Promise<void>                       // git checkout -- .
 
  // Patch
  async applyPatch(patchPath: string): Promise<void>       // git apply <path>
 
  // Show (for merge editor 3-way)
  async showFileAtIndex(index: 1 | 2 | 3, relPath: string): Promise<string>  // git show :N:<path>
  async showFileAtCommit(sha: string, relPath: string): Promise<string>
 
  // Log (for git graph)
  async getLog(options: LogOptions): Promise<CommitNode[]>
  async getCommitStats(sha: string): Promise<string>       // git show --stat <sha>
 
  // Conflicts
  async getConflictedFiles(): Promise<string[]>            // git diff --name-only --diff-filter=U
 
  // Refs
  async getBranches(): Promise<string[]>
  async getTags(): Promise<string[]>
}
```
 
---
 
## 10. Extension Entry Point
 
### `src/extension.ts`
 
```typescript
export async function activate(context: vscode.ExtensionContext): Promise<void>
export function deactivate(): void
```
 
**`activate` must:**
 
1. Detect workspace root — if no folder open, show message and return
2. Instantiate `GitService`, check `isGitRepo()` — if false, show message and return
3. Instantiate `ShelvingService(gitService, workspaceRoot)`
4. Instantiate `ShelvingProvider(shelvingService)` and register as TreeDataProvider for `forge-shelves`
5. Register all commands:
```typescript
vscode.commands.registerCommand('forge.shelveChanges', async () => {
  const name = await vscode.window.showInputBox({ prompt: 'Shelf name', placeHolder: 'e.g. wip-feature-auth' });
  if (!name) return;
  const desc = await vscode.window.showInputBox({ prompt: 'Description (optional)', placeHolder: '' });
  await shelvingService.shelveChanges(name, desc ?? '');
  shelvingProvider.refresh();
  vscode.window.showInformationMessage(`✓ Shelved: ${name}`);
});
 
vscode.commands.registerCommand('forge.unshelveChanges', async (item: ShelfTreeItem) => {
  await shelvingService.unshelveChanges(item.meta.name);
  shelvingProvider.refresh();
  vscode.window.showInformationMessage(`✓ Unshelved: ${item.meta.displayName}`);
});
 
vscode.commands.registerCommand('forge.deleteShelve', async (item: ShelfTreeItem) => {
  const confirm = await vscode.window.showWarningMessage(
    `Delete shelf "${item.meta.displayName}"?`, 'Delete', 'Cancel'
  );
  if (confirm !== 'Delete') return;
  await shelvingService.deleteShelve(item.meta.name);
  shelvingProvider.refresh();
});
 
vscode.commands.registerCommand('forge.previewShelve', async (item: ShelfTreeItem) => {
  // open virtual document with patch content
});
 
vscode.commands.registerCommand('forge.refreshShelves', () => shelvingProvider.refresh());
vscode.commands.registerCommand('forge.openGitGraph', () => gitGraphProvider.open(context));
vscode.commands.registerCommand('forge.openMergeEditor', () => mergeEditorProvider.open(context));
```
 
6. **Conflict detection watcher:**
   - On `vscode.workspace.onDidOpenTextDocument` and `vscode.window.onDidChangeActiveTextEditor`
   - Check if file contains `<<<<<<<` conflict markers
   - If yes, show a status bar item: `$(git-merge) Forge: Resolve Conflict`
   - Clicking it triggers `forge.openMergeEditor`
   - Remove status bar item when a non-conflicted file becomes active
7. **First install welcome:**
   - Check `context.globalState.get('forge.welcomed')`
   - If false, show `vscode.window.showInformationMessage('⚡ Forge is ready — supercharged git for VS Code', 'Open Git Graph', 'View Shelves')`
   - Set `context.globalState.update('forge.welcomed', true)`
---
 
## 11. Webview Architecture
 
### HTML Shell Template
 
Both webviews (`mergeEditor/index.html` and `gitGraph/index.html`) follow this pattern:
 
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" 
        content="default-src 'none'; 
                 script-src 'nonce-${nonce}' https://cdnjs.cloudflare.com;
                 style-src 'unsafe-inline' https://cdnjs.cloudflare.com;
                 font-src https://cdnjs.cloudflare.com;
                 worker-src blob:;" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Forge</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${webviewUri}/webviews/mergeEditor/index.js"></script>
</body>
</html>
```
 
The provider injects:
- `${nonce}` — a random nonce for CSP
- `${webviewUri}` — the `webview.asWebviewUri()` of the extension dist folder
### Message Protocol
 
All messages follow `{ type: string, payload: any }`.
 
**Extension → Webview:**
- `init` — initial data load
- `update` — data refresh
- `focusChunk` — scroll to a specific conflict chunk
**Webview → Extension:**
- `save` — save resolved content
- `markDone` — save + close
- `requestCommitDetail` — git graph requests stats for a commit
- `ready` — webview signals it has mounted
---
 
## 12. Theming & Styling
 
All webview CSS must use VS Code CSS variables so Forge respects the user's theme (light, dark, high contrast):
 
```css
/* Required variables to use */
--vscode-editor-background
--vscode-editor-foreground
--vscode-editor-lineHighlightBackground
--vscode-diffEditor-insertedTextBackground
--vscode-diffEditor-removedTextBackground
--vscode-focusBorder
--vscode-button-background
--vscode-button-foreground
--vscode-button-hoverBackground
--vscode-sideBar-background
--vscode-sideBarTitle-foreground
--vscode-badge-background
--vscode-badge-foreground
--vscode-font-family
--vscode-font-size
--vscode-editor-font-family
--vscode-editor-font-size
```
 
**Forge-specific color tokens (define in CSS, derived from VS Code vars):**
```css
--forge-conflict-ours-bg: rgba(86, 156, 214, 0.12);
--forge-conflict-theirs-bg: rgba(181, 206, 168, 0.12);
--forge-conflict-base-bg: rgba(255, 255, 255, 0.04);
--forge-conflict-resolved-bg: rgba(78, 201, 176, 0.12);
--forge-branch-colors: #569cd6, #4ec9b0, #ce9178, #dcdcaa, #c586c0, #9cdcfe;
```
 
---
 
## 13. Build System
 
### `esbuild.js`
 
Two separate esbuild pipelines:
 
**1. Extension host bundle:**
```javascript
esbuild.build({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  sourcemap: true,
})
```
 
**2. Webview bundles:**
```javascript
// Merge editor webview
esbuild.build({
  entryPoints: ['src/webviews/mergeEditor/index.tsx'],
  bundle: true,
  outfile: 'dist/webviews/mergeEditor/index.js',
  format: 'iife',
  platform: 'browser',
  sourcemap: true,
  loader: { '.wasm': 'binary' },   // for Tree-sitter WASM in Phase 2
})
 
// Git graph webview
esbuild.build({
  entryPoints: ['src/webviews/gitGraph/index.tsx'],
  bundle: true,
  outfile: 'dist/webviews/gitGraph/index.js',
  format: 'iife',
  platform: 'browser',
  sourcemap: true,
})
```
 
### `package.json` scripts:
```json
{
  "scripts": {
    "build": "node esbuild.js",
    "watch": "node esbuild.js --watch",
    "package": "vsce package",
    "lint": "eslint src --ext ts,tsx",
    "test": "node ./dist/test/runTest.js"
  }
}
```
 
---
 
## 14. Testing Strategy
 
### Unit Tests
 
- `shelvingService.test.ts` — test shelve/unshelve/delete on a temp git repo using `simple-git`
- `conflictParser.test.ts` — test parsing of conflict markers (standard and diff3 format)
- `differ.test.ts` — test token-aware diff output for known inputs
### Integration Tests
 
- Use `@vscode/test-electron` to run tests inside VS Code
- Test that commands register correctly
- Test that shelves TreeView populates after shelving
### Manual Test Checklist (include in CONTRIBUTING.md)
 
- [ ] Shelve changes in a dirty repo → changes disappear → shelf appears in sidebar
- [ ] Unshelve → changes reappear exactly as shelved
- [ ] Delete shelf → shelf removed from sidebar
- [ ] Preview shelf → shows patch content as read-only virtual document
- [ ] Open a file with conflict markers → status bar item appears
- [ ] Click status bar item → Forge merge editor opens with 3 panels + result
- [ ] Accept from YOURS → result pane updates correctly
- [ ] Accept from THEIRS → result pane updates correctly
- [ ] Save resolved file → conflict markers removed, file saved, `git add` run
- [ ] Open git graph → commits render with correct branch lanes
- [ ] Click a commit → detail panel shows author, message, changed files
---
 
## 15. Open Source Setup
 
### Files to create at repo root:
 
**`README.md`** — Include:
- Hero gif/screenshot of the merge editor
- Feature list with comparison table vs native VS Code
- Installation instructions
- Quick start guide
- Roadmap link
**`CONTRIBUTING.md`** — Include:
- Dev setup (clone, `npm install`, `npm run watch`, press F5 in VS Code)
- Code structure walkthrough (point to this system-spec.md)
- PR guidelines
- Manual test checklist (from §14)
**`CHANGELOG.md`** — Semantic versioning, start at `0.1.0`
 
**`.github/ISSUE_TEMPLATE/bug_report.md`**
**`.github/ISSUE_TEMPLATE/feature_request.md`**
**`.github/workflows/ci.yml`** — Run lint + tests on every PR
 
**`.gitignore`:**
```
node_modules/
dist/
*.vsix
.forge/
```
 
---
 
## 16. Phased Roadmap
 
### Phase 1 — MVP (build this first)
- [x] Project scaffold (package.json, tsconfig, esbuild)
- [ ] GitService with all methods
- [ ] Shelving — full service + tree view UI
- [ ] Merge editor — basic 3-panel layout with conflict parsing
- [ ] Merge editor — Monaco in result pane
- [ ] Merge editor — accept yours/theirs per chunk
- [ ] Merge editor — save resolved file + git add
- [ ] Conflict detection watcher + status bar button
- [ ] Git graph — basic commit list with D3 lanes
- [ ] Extension wiring + commands
### Phase 2 — Quality
- [ ] Tree-sitter AST-aware diffing in merge editor
- [ ] Move detection in diffs
- [ ] Git graph — search, filter by branch
- [ ] Git graph — click file in commit detail → open diff
- [ ] Shelving — partial shelve (select files to shelve)
- [ ] Keyboard shortcuts for merge editor chunk navigation
### Phase 3 — Polish
- [ ] Shelving — cloud sync option (via gist or custom backend)
- [ ] Merge editor — inline editing within conflict regions
- [ ] Git graph — interactive rebase UI
- [ ] Git blame gutter integration
- [ ] VS Code Marketplace publish
---
 
## Implementation Notes for Claude Code
 
When implementing this spec:
 
1. **Start with `GitService`** — everything depends on it. Implement and test it first with a real git repo.
2. **Then Shelving** — it's self-contained and gives an immediately usable feature. Good for validating the overall extension setup.
3. **Then the Merge Editor** — do Phase 1 (no Tree-sitter) first. Get the 3-panel layout working with Monaco. Tree-sitter is Phase 2.
4. **Then Git Graph** — it's mostly read-only data display, so lower risk.
5. **Always use `GitService`** — no feature should call `simple-git` or shell out to git directly. All git goes through `GitService`.
6. **Webviews are sandboxed** — they cannot access the filesystem or call git. All data must come from the extension host via `postMessage`. Design data flow accordingly.
7. **Monaco in webviews** — load from CDN (`cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0`). Do not bundle Monaco — it is too large. The CSP in the HTML shell already allows this CDN.
8. **Error handling** — every git operation can fail. Wrap all `GitService` calls in try/catch and surface errors to the user via `vscode.window.showErrorMessage`. Never silently swallow errors.
9. **`.forge/` directory** — create it lazily (on first shelve), not on extension activation. Don't pollute the user's repo until they opt in by shelving something.
10. **Respect VS Code theme** — use CSS variables everywhere in webviews. Never hardcode colors. Test in both light and dark themes.