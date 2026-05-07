# Forge — Supercharged Git for VS Code

[![CI](https://github.com/karthikkumararun/forge/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/karthikkumararun/forge/actions/workflows/ci.yml)
[![CodeQL](https://github.com/karthikkumararun/forge/actions/workflows/codeql.yml/badge.svg?branch=main)](https://github.com/karthikkumararun/forge/actions/workflows/codeql.yml)
[![Release](https://img.shields.io/github/v/release/karthikkumararun/forge?logo=github&label=release)](https://github.com/karthikkumararun/forge/releases/latest)

JetBrains-quality merge conflict resolution, shelving, and git graph — as a
VS Code extension. Open source, MIT licensed. Works in VS Code, Cursor,
Windsurf, and any VS Code fork.

## Features

| Capability | What you get |
|---|---|
| **Shelving** | Named, persistent patch-based change storage in `.forge/shelves/`. Not `git stash`. Partial shelves (pick files). Optional gist cloud sync. |
| **Merge editor** | Custom 3-way + result Webview built on Monaco. Per-chunk accept yours/theirs. Inline edit any side. Keyboard navigation. Optional Tree-sitter AST-aware diff. |
| **Git graph** | Interactive D3 commit graph with branch lanes, search, branch filter, commit-detail with click-to-diff. |
| **Interactive rebase** | Reorder, squash/fixup, drop — driven through a clean Webview. |
| **Inline blame** | Current-line author/date/summary decoration. Toggleable. |
| **Conflict watcher** | Status-bar shortcut surfaces the merge editor whenever a file has conflict markers. |

## Install

For now: clone, `npm install`, `npm run package` to produce a `.vsix`, then
`code --install-extension forge-*.vsix`. Marketplace publish coming.

## Quick start

1. Open a folder backed by a git repo.
2. `Cmd/Ctrl+Shift+P → Forge: Open Git Graph` to view history.
3. Edit files, then sidebar → archive icon to shelve.
4. Open a file with conflict markers — the status bar surfaces "Forge:
   Resolve Conflict". Click it to open the 3-way merge editor.

## Settings

| Key | Default | Purpose |
|---|---|---|
| `forge.shelves.autoGitignore` | `true` | Add `.forge/` to `.gitignore` on first shelve |
| `forge.mergeEditor.useSyntaxAwareDiff` | `true` | Use Tree-sitter for diffs |
| `forge.gitGraph.maxCommits` | `500` | Max commits loaded in graph |
| `forge.blame.enabled` | `true` | Show inline blame on the current line |
| `forge.shelves.cloudGistId` | `""` | Gist used for shelf cloud sync (set after first push) |

Token for cloud sync is stored in VS Code SecretStorage — set it with the
`Forge: Set Gist Token` command (gist scope only).

## Roadmap

See [system-spec.md](./system-spec.md) §16 for the full phase breakdown.
Phase 1–3 are implemented; Marketplace publish is the remaining outstanding
item.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). PRs welcome.

## License

[MIT](./LICENSE).
