# Forge Shelving v2 — Specification

> Make Forge's shelving feature reach JetBrains-level depth: file-level browsing, per-file diff, partial / non-destructive unshelve, rename, restore-deleted, and conflict-aware apply via the custom merge editor.

Reference: https://www.jetbrains.com/help/idea/shelving-and-unshelving-changes.html

---

## 1. Goals & Non-Goals

### Goals
- Treat a shelf as a **collection of file changes**, not an opaque patch blob.
- Per-file diff preview (base vs shelved) using `vscode.diff`.
- Non-destructive unshelve with explicit "remove after apply" choice.
- Partial unshelve (subset of files in a shelf).
- Rename shelf, edit description.
- Soft-delete + restore from a "Recently Deleted" bucket.
- Conflict-on-apply funnels into Forge's custom merge editor.
- Silent / auto shelf for risky operations (e.g. branch switch with dirty tree).

### Non-Goals (defer)
- Cross-machine cloud sync (already a v2+ item; out of scope here).
- Reordering / merging shelves.
- Drag-and-drop reorganisation between shelves.
- Encrypted shelves.

---

## 2. JetBrains Parity Matrix

| Capability                                  | Today | v2  | Notes                                                       |
|---------------------------------------------|:-----:|:---:|-------------------------------------------------------------|
| Named shelf + description                   |   ✓   |  ✓  |                                                              |
| List of changed files in a shelf            |  meta |  ✓  | Promote to first-class tree children                        |
| Per-file diff (base vs shelved)             |   ✗   |  ✓  | `vscode.diff` against `git show <baseCommit>:<file>`         |
| Per-file unshelve                           |   ✗   |  ✓  | Apply only selected hunks/files                             |
| Unshelve and **keep** shelf                 |   ✗   |  ✓  | Default = keep; "remove after apply" is opt-in              |
| Silent unshelve (no prompt)                 |   ✗   |  ✓  | Command `forge.shelf.unshelveSilent`                        |
| Rename shelf                                |   ✗   |  ✓  |                                                              |
| Edit description                            |   ✗   |  ✓  |                                                              |
| Restore recently deleted                    |   ✗   |  ✓  | Tombstone in `.forge/shelves/.trash/` with TTL              |
| Conflict resolution on apply                |   ✗   |  ✓  | Hand off to Forge custom merge editor                       |
| Auto-shelf on risky ops                     |   ✗   |  ✓  | Branch switch / pull / checkout with dirty tree             |
| Partial **shelve** (subset of files)        | (cli) |  ✓  | Already in service; expose via QuickPick                    |
| Hunk-level shelve                           |   ✗   |  ✓  | Stretch — requires diff parser                              |

---

## 3. Data Model Changes

### 3.1 `ShelfMeta` v2

```typescript
export interface ShelfFileEntry {
  path: string;                 // workspace-relative
  status: 'A' | 'M' | 'D' | 'R'; // added/modified/deleted/renamed
  oldPath?: string;             // when status === 'R'
  patchOffset: number;          // byte offset in the bundle .patch
  patchLength: number;          // byte length of this file's hunk(s)
}

export interface ShelfMeta {
  schemaVersion: 2;             // NEW — bump from implicit v1
  name: string;
  displayName: string;
  description: string;
  createdAt: string;
  updatedAt?: string;           // NEW — set by rename / edit-description
  branch: string;
  baseCommit: string;
  files: ShelfFileEntry[];      // CHANGED — was string[]
  origin: 'manual' | 'auto-checkout' | 'auto-pull' | 'auto-merge'; // NEW
}
```

### 3.2 Storage layout

```
.forge/
  shelves/
    <name>_<ts>.patch
    <name>_<ts>.meta.json
    .trash/
      <name>_<ts>__deleted_<deletedAtTs>.patch
      <name>_<ts>__deleted_<deletedAtTs>.meta.json
```

- `.trash/` entries are kept **indefinitely** by default (matching JetBrains). Users can purge individually, purge all, or set an optional TTL via `forge.shelving.trashTtlDays` (default `0` = never).
- When TTL is non-zero, sweep runs on extension activation; never blocks the UI.
- A soft cap (`forge.shelving.maxRecentDeleted`, default 50) controls how many trashed entries the tree displays at once; older ones still exist on disk and are reachable via "Show all".

### 3.3 Migration v1 → v2

- On `listShelves`, if `meta.schemaVersion` is missing **or** `files` is `string[]`:
  1. Re-parse the `.patch` to derive `ShelfFileEntry[]` with offsets.
  2. Rewrite the meta in-place with `schemaVersion: 2`.
  3. If parse fails, leave v1 untouched; tree shows the shelf as a leaf with a warning icon.

---

## 4. Service API

```typescript
export class ShelvingService {
  // Existing — kept signature-compatible
  shelveChanges(name: string, description: string, files?: string[]): Promise<void>;
  listShelves(): Promise<ShelfItem[]>;
  deleteShelve(name: string, opts?: { hard?: boolean }): Promise<void>;
  peekShelf(name: string): Promise<string>;

  // Changed
  unshelveChanges(name: string, opts?: {
    files?: string[];           // partial unshelve
    keep?: boolean;             // default true; false = delete after apply
    onConflict?: 'abort' | 'merge'; // default 'merge'
  }): Promise<UnshelveResult>;

  // New
  renameShelf(name: string, newDisplayName: string): Promise<void>;
  setShelfDescription(name: string, description: string): Promise<void>;
  getFilePatch(name: string, file: string): Promise<string>;  // sub-patch for one file
  getFileBaseContent(name: string, file: string): Promise<string>; // git show baseCommit:file
  getFileShelvedContent(name: string, file: string): Promise<string>; // base + sub-patch applied
  listTrashed(): Promise<ShelfItem[]>;
  restoreFromTrash(name: string): Promise<void>;
  purgeTrash(olderThanDays?: number): Promise<void>;
  autoShelf(reason: ShelfMeta['origin']): Promise<string | undefined>; // returns shelf name
}

export interface UnshelveResult {
  applied: string[];
  conflicted: string[];        // files needing merge editor
  skipped: string[];
}
```

### 4.1 Per-file content reconstruction

To render `vscode.diff` for a file inside a shelf:
- **Left (base):** `git show <baseCommit>:<file>` — handles renames via `oldPath`.
- **Right (shelved):** Apply the sub-patch (`getFilePatch`) to the base content **in memory** using a JS patch applier (e.g. `diff` package's `applyPatch`). Never touch the working tree.
- Both sides served via a `forge-shelf-file:` `TextDocumentContentProvider` with URIs:
  - `forge-shelf-file://<shelfName>/base/<encodedPath>`
  - `forge-shelf-file://<shelfName>/shelved/<encodedPath>`
- Open via `vscode.commands.executeCommand('vscode.diff', baseUri, shelvedUri, title, { preview: true })`.

### 4.2 Sub-patch extraction

Parse the bundle `.patch` once; record per-file `(offset, length)` against each `diff --git` header. `getFilePatch` slices that range and prepends a synthetic `--- a/.. / +++ b/..` envelope if the slice doesn't already include it (it should). Cache parsed offsets on first read.

### 4.3 Conflict-on-apply

- Run `git apply --3way <patch>` for each file.
- For files where 3-way fails, fall back to writing conflict markers via `git apply --reject` and surfacing the `.rej` file path.
- Better path: write the three sides (base / current working tree / shelved) to temp blobs and **launch the Forge merge editor** (`forge.openMergeEditor`) with those URIs. On "Mark Done", write the resolved buffer back to the working file.
- `UnshelveResult.conflicted` drives a notification: *"3 files need merging — Open Merge Editor"*.

---

## 5. Tree View UX

### 5.1 Hierarchy

```
SHELVES
├── ▸ feature-x   ● 4 files · main · 2 days ago
│     ├── M  src/foo.ts
│     ├── M  src/bar.ts
│     ├── A  src/baz.ts
│     └── D  src/old.ts
├── ▸ wip-refactor   ● 12 files · refactor/io · 5 hours ago
└── ▾ Recently Deleted
      └── ▸ stale-thing  ● 2 files · deleted 1h ago
```

- Top-level shelves are **collapsible** (`vscode.TreeItemCollapsibleState.Collapsed`).
- Children are `ShelfFileItem` (leaf) with `contextValue = 'shelf-file'`, status letter as icon (`diff-added`, `diff-modified`, `diff-removed`, `diff-renamed` codicons).
- Optional "Recently Deleted" virtual root, only shown when trash is non-empty.

### 5.2 Default click behaviour

- Click a shelf: no-op (toggles collapse).
- Click a file: opens the `vscode.diff` view (§4.1).
- Inline icons on hover (shelf level): **Unshelve**, **Unshelve silently**, **Rename**, **Delete**.
- Inline icons on hover (file level): **Unshelve this file**, **Open diff**.

### 5.3 Context-menu commands

Add to `package.json` `menus.view/item/context`:

| Command id                          | When                              | Group         |
|-------------------------------------|-----------------------------------|---------------|
| `forge.shelf.unshelve`              | `viewItem == shelf`              | inline / nav  |
| `forge.shelf.unshelveSilent`        | `viewItem == shelf`              | nav           |
| `forge.shelf.unshelveAndKeep`       | `viewItem == shelf`              | nav           |
| `forge.shelf.rename`                | `viewItem == shelf`              | nav           |
| `forge.shelf.editDescription`       | `viewItem == shelf`              | nav           |
| `forge.shelf.delete`                | `viewItem == shelf`              | 1_modify      |
| `forge.shelf.openFileDiff`          | `viewItem == shelf-file`         | inline        |
| `forge.shelf.unshelveFile`          | `viewItem == shelf-file`         | nav           |
| `forge.shelf.restore`               | `viewItem == shelf-trashed`      | inline        |
| `forge.shelf.purgeOne`              | `viewItem == shelf-trashed`      | 1_modify      |
| `forge.shelf.purgeAll`              | view title (when trash non-empty)| navigation    |

### 5.4 Shelve-changes flow (richer)

Replace the single-input prompt with a multi-step wizard via `vscode.window.createQuickPick`:

1. **Files**: multi-select changed files (default = all), with status badges.
2. **Name**: input box (pre-filled with branch + short timestamp).
3. **Description**: optional input (skippable with Enter).
4. **After shelving**: choice — *"Revert working tree"* (default) | *"Keep changes in working tree"*.
   - "Keep" simply skips the `git checkout` step. Useful for "snapshot" shelves.

---

## 6. Auto-Shelf (Silent Shelf)

Triggers, all opt-in via `forge.shelving.autoShelf` setting (`'off' | 'risky-ops' | 'always'`):

- **Risky-ops** (default if enabled): before `git checkout <branch>`, `git pull`, `git merge`, `git rebase` if `working tree is dirty`:
  - Create a shelf named `auto-<ts>` with `origin: 'auto-<op>'`. The originating op + branch are recorded in `meta.description` (e.g. `"Auto-shelved before checkout main"`) so the flat name stays clean while context is still discoverable.
  - Notify with a "View" button → reveals it in the tree.
- Forge does **not** intercept the user's terminal git commands; this only fires on operations Forge initiates (graph "Switch branch", future pull/merge buttons).

---

## 7. Settings

```jsonc
{
  "forge.shelving.trashTtlDays": 0, // 0 = keep indefinitely (JetBrains-style)
  "forge.shelving.autoShelf": "risky-ops", // off | risky-ops | always
  "forge.shelving.confirmHardDelete": true,
  "forge.shelving.defaultUnshelveKeepShelf": true,
  "forge.shelving.maxRecentDeleted": 50
}
```

---

## 8. Error Handling

- Empty diff → friendly toast, no file written.
- `git apply` failure → conflict path (§4.3), never silent.
- Corrupt `.meta.json` → shelf still visible with a warning icon; right-click → "Reveal in Explorer" / "Delete".
- Concurrent shelf mutation (file replaced under us) → re-read meta and retry once; if still inconsistent, show error.
- Migration failure → leave v1 untouched, log to output channel `Forge`.

---

## 9. Testing

Unit (`vitest` or extension test harness):
- Patch parser: extracts file offsets correctly for added / modified / deleted / renamed entries.
- `applyPatch` to base content reproduces shelved content exactly for synthetic fixtures.
- Migration: v1 meta with `files: string[]` upgrades cleanly.
- Trash TTL sweep respects `trashTtlDays`.

Integration (against a temp git repo):
- Shelve → working tree clean → unshelve → diff matches original.
- Partial unshelve applies only selected files; remaining stay in shelf.
- Conflict path: modify file post-shelve, unshelve → conflict surfaced, merge editor opens, resolution writes back.
- Auto-shelf fires on programmatic branch switch with dirty tree.

---

## 10. Phased Delivery

**Phase A — File-level visibility** (highest user impact, lowest risk)
1. Patch parser + `ShelfFileEntry` derivation.
2. Meta v2 migration (read-only fallback for v1).
3. Collapsible tree with file children, status icons.
4. Per-file `vscode.diff` via `forge-shelf-file:` provider.

**Phase B — Non-destructive ops**
5. `unshelveChanges` `keep` option (flip default to keep).
6. Partial unshelve (per file).
7. Soft delete + `Recently Deleted` node + restore + TTL sweep.

**Phase C — Editing & integration**
8. Rename shelf, edit description.
9. Conflict-on-apply → custom merge editor handoff.
10. Auto-shelf for risky ops (gated by setting).

**Phase D — Hunk-level + polish**
11. **Custom hunk picker** (own implementation, not `vscode.git`):
    - Parse the working-tree diff into hunks per file.
    - Render in a webview (reuses Forge's Monaco + diff infra) with per-hunk checkboxes and "Stage hunk / Skip hunk" affordances similar to JetBrains' "Shelve Changes" dialog.
    - Output: a synthesized patch containing only the selected hunks, fed into `shelveChanges`.
    - Same picker is reused for **partial unshelve at hunk granularity** by feeding it the shelf's bundle patch instead of the working-tree diff.
12. Shelf search / filter in the tree.

Each phase is independently shippable and behind no feature flag — the data model migration in Phase A is the only breaking-ish change and is backward-readable.

---

## 11. Resolved Decisions

1. **Shared picker** — partial-shelve and partial-unshelve use a single multi-select component. Inputs differ (working-tree files vs. shelf entries) but the UI/UX is unified. In Phase D this same picker drops down to hunk granularity.
2. **Indefinite trash retention** — JetBrains-style. `trashTtlDays` defaults to `0` (never purge). Users prune manually via the "Recently Deleted" node.
3. **Flat auto-shelf names** — `auto-<ts>`. Op + branch context lives in `meta.description` and `meta.origin`, keeping the on-disk filename and tree label clean.
4. **Own hunk picker** — built in a webview using Forge's existing Monaco + diff stack. Avoids coupling to `vscode.git`'s internals and matches JetBrains' interaction model.

---

## 12. Out-of-Scope Reminders

- Encryption, cloud sync, cross-repo shelves — defer.
- Replacing `git stash` integration — Forge shelves remain orthogonal.
