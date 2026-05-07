# Contributing to Forge

Thanks for considering a contribution!

## Dev setup

```sh
git clone https://github.com/forge-git/forge.git
cd forge
npm install
npm run watch          # rebuild on change
```

Then open the folder in VS Code and press **F5** — this opens an Extension
Development Host with `.smoke-workspace/` as the workspace. The smoke
workspace ships with a pre-made conflict in `greet.ts` so you can exercise
the merge editor without manual setup.

Node 18+ is required (use `nvm use` — `.nvmrc` pins lts/iron).

## Code structure

See [system-spec.md](./system-spec.md). The high-level layout:

- `src/extension.ts` — activation, command registration, wiring
- `src/git/gitService.ts` — single chokepoint for all git ops
- `src/shelving/` — shelving service, tree view, cloud sync
- `src/mergeEditor/` — conflict parser + Webview provider
- `src/gitGraph/` — git graph Webview provider
- `src/rebase/` — interactive rebase service + Webview provider
- `src/blame/` — inline blame decorations
- `src/webviews/` — React/TSX entry points (one bundle per Webview)

All git operations go through `GitService`. Webviews never call git directly —
they `postMessage` to the extension host.

## Manual test checklist

- [ ] Shelve dirty repo → working tree clean → shelf appears in sidebar
- [ ] Unshelve → changes restored exactly as shelved
- [ ] Partial shelve (pick subset) → only chosen files are reset/restored
- [ ] Preview shelf → patch shown read-only
- [ ] Cloud push → gist created/updated; cloud pull → shelves restored
- [ ] Open conflict file → status bar surfaces "Forge: Resolve Conflict"
- [ ] Merge editor: accept yours/theirs per chunk; inline-edit a chunk; save → file written, `git add` run
- [ ] Merge editor keys: Alt+↑/↓, Alt+←/→, Cmd/Ctrl+S
- [ ] Git graph: render, branch filter, search, click-commit, click-file → diff opens
- [ ] Interactive rebase: reorder + drop + squash → applies cleanly
- [ ] Blame: current line shows author/date/summary; toggle off

## Headless tests

```sh
npx esbuild scripts/smoke.ts --bundle --platform=node --target=node18 \
  --external:simple-git --outfile=dist/smoke.js
node dist/smoke.js
```

## PR guidelines

- Keep PRs scoped to one feature or fix.
- Include a short note in `CHANGELOG.md`.
- For UI changes, add a screenshot or short capture to the PR.
- All git operations must go through `GitService`.
