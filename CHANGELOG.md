# Changelog

All notable changes to Forge are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/) and the project uses
[semantic versioning](https://semver.org/).

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
