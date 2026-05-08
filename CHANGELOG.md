# Changelog

All notable changes to Forge are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/) and the project uses
[semantic versioning](https://semver.org/).

## [0.2.0] - 2026-05-07

### Added
- **Shelving v2 — file-level visibility.** Shelves are collapsible and expand
  to show each changed file with A/M/D/R status icons. Click a file to open a
  side-by-side diff (base ↔ shelved) via the new `forge-shelf-file:` content
  provider. Backed by a v2 meta schema with per-file `ShelfFileEntry`; v1
  metas migrate on read.
- **Non-destructive unshelve.** Default `Unshelve` keeps the shelf
  (configurable). New commands: `Unshelve & Remove`, `Unshelve Selected
  Files…`, `Unshelve This File`. Partial unshelve with remove-after rewrites
  the bundle to keep un-applied files.
- **Soft-delete + Recently Deleted.** Deletes move shelves to
  `.forge/shelves/.trash/` (kept indefinitely, JetBrains-style). New tree node
  with per-entry Restore / Delete Permanently and "Empty Recently Deleted".
  Optional TTL via `forge.shelving.trashTtlDays`.
- **Rename / Edit Description** on shelves; filenames stay stable.
- **Conflict-aware unshelve.** Failed `git apply` retries with `--3way` and
  scans target files for conflict markers. Conflicts surface in a
  notification with an "Open Merge Editor" action that hands off to Forge's
  custom 3-way merge editor. Shelf is preserved on conflict even with
  `keep:false`.
- **Auto-shelf** API + `forge.shelving.autoShelf` setting + manual
  "Forge: Auto-shelf Working Tree". Hooks ready for future risky-op wiring.
- **Hunk-level shelve / unshelve.** New webview hunk picker with per-hunk
  checkboxes, file tri-state, colored `+`/`-` bodies. `Forge: Shelve Hunks…`
  shelves only selected hunks (others stay dirty). `Forge: Unshelve Hunks…`
  applies a subset; remove-after rewrites the bundle to keep the rest.
- **vitest test suite.** 36 tests covering the unified-diff parser and
  `ShelvingService` against real temp git repos, including the full conflict
  path. Wired into CI + release workflows.

### Changed
- **Merge editor UX.** Per-chunk accept/edit buttons no longer overlay code.
  Each side pane has a dedicated action row showing only the currently-active
  conflict's buttons; a `conflict N/M` indicator appears in the title bar.

### Internal
- v2 meta schema with automatic, idempotent v1 migration.
- `gitService.applyPatch(path, extraArgs?)` + `applyPatch3Way(path)` primitives.
- `parsePatchDetailed` / `synthesizePatch` for hunk-level ops without
  re-running git.

## [0.1.1] - 2026-05-06

### Fixed
- Marketplace icon (added PNG; SVG is not supported by the VS Code Marketplace).

## [0.1.0] - 2026-05-06

### Added
- **Shelving** — patch-based, named, persistent change storage in `.forge/shelves/`.
  Supports full-tree and per-file ("partial") shelving, preview, unshelve, delete.
  Optional cloud sync to a private GitHub gist.
- **Custom merge editor** — 3-way + result Webview UI built on Monaco. Accept
  yours/theirs per chunk, inline edit any side per chunk, keyboard shortcuts
  (Alt+↑/↓ to navigate, Alt+←/→ to accept, Cmd/Ctrl+S to save). Optional
  Tree-sitter AST-aware diff scaffold.
- **Git graph** — interactive D3 commit graph with branch lanes, branch filter,
  search, commit detail panel, click-file-to-diff.
- **Interactive rebase** — reorder, squash/fixup, drop commits via a Webview;
  applied with a `GIT_SEQUENCE_EDITOR` shim.
- **Inline blame** — current-line author/date/summary decoration; toggleable.
- **Conflict watcher** — status bar entry appears when a file with conflict
  markers is active.
