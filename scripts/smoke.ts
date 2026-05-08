import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { GitService } from '../src/git/gitService';
import { ShelvingService } from '../src/shelving/shelvingService';
import { parseConflicts, hasConflictMarkers } from '../src/mergeEditor/conflictParser';
import { detectMoves, isWhitespaceOnlyChange } from '../src/webviews/mergeEditor/differ';
import { RebaseService } from '../src/rebase/rebaseService';

let pass = 0;
let fail = 0;

function check(label: string, cond: boolean, info?: string) {
  if (cond) {
    console.log(`  ✓ ${label}`);
    pass++;
  } else {
    console.log(`  ✗ ${label}${info ? ` — ${info}` : ''}`);
    fail++;
  }
}

async function makeRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-smoke-'));
  execSync('git init -q -b main', { cwd: dir });
  execSync('git config user.email t@t', { cwd: dir });
  execSync('git config user.name Tester', { cwd: dir });
  await fs.writeFile(path.join(dir, 'a.txt'), 'line1\nline2\nline3\n');
  execSync('git add a.txt && git commit -q -m initial', { cwd: dir });
  return dir;
}

async function testGitService() {
  console.log('\n[GitService]');
  const dir = await makeRepo();
  const g = new GitService(dir);
  check('isGitRepo', await g.isGitRepo());
  check('getCurrentBranch', (await g.getCurrentBranch()) === 'main');
  const head = await g.getHeadSha();
  check('getHeadSha 40 chars', head.length === 40);
  await fs.writeFile(path.join(dir, 'a.txt'), 'line1\nline2\nCHANGED\n');
  const diff = await g.getDiff(['HEAD']);
  check('getDiff sees change', diff.includes('CHANGED'));
  const log = await g.getLog({ maxCount: 5 });
  check('getLog returns commits', log.length === 1 && log[0].sha === head);
  await fs.rm(dir, { recursive: true, force: true });
}

async function testShelving() {
  console.log('\n[ShelvingService]');
  const dir = await makeRepo();
  const g = new GitService(dir);
  const s = new ShelvingService(g, dir);

  let threw = false;
  try { await s.shelveChanges('empty', ''); } catch { threw = true; }
  check('shelve empty repo throws', threw);

  await fs.writeFile(path.join(dir, 'a.txt'), 'line1\nline2\nMODIFIED\n');
  await s.shelveChanges('my feature!', 'WIP work');
  const after = await fs.readFile(path.join(dir, 'a.txt'), 'utf8');
  check('working tree reset after shelve', !after.includes('MODIFIED'));

  const list = await s.listShelves();
  check('shelf listed', list.length === 1 && list[0].meta.displayName === 'my feature!');
  check('shelf branch recorded', list[0].meta.branch === 'main');
  check('shelf files recorded', list[0].meta.files.some((f) => f.path === 'a.txt'));
  check('shelf schema v2', list[0].meta.schemaVersion === 2);

  const gi = await fs.readFile(path.join(dir, '.gitignore'), 'utf8');
  check('.forge/ added to .gitignore', gi.includes('.forge/'));

  const peek = await s.peekShelf(list[0].meta.name);
  check('peekShelf returns patch', peek.includes('MODIFIED'));

  await s.unshelveChanges(list[0].meta.name, { keep: false });
  const restored = await fs.readFile(path.join(dir, 'a.txt'), 'utf8');
  check('unshelve restores changes', restored.includes('MODIFIED'));

  const list2 = await s.listShelves();
  check('shelf removed after unshelve+keep:false', list2.length === 0);
  const trashedAfter = await s.listTrashed();
  check('shelf moved to trash after unshelve+keep:false', trashedAfter.length === 1);
  await s.purgeTrash(0);

  // partial shelve
  execSync('git checkout -- a.txt', { cwd: dir });
  await fs.writeFile(path.join(dir, 'a.txt'), 'modA\n');
  await fs.writeFile(path.join(dir, 'b.txt'), 'newfileB\n');
  execSync('git add b.txt', { cwd: dir });
  const changed = await s.listChangedFiles();
  check('listChangedFiles sees both', changed.includes('a.txt') && changed.includes('b.txt'));
  await s.shelveChanges('partial', '', ['a.txt']);
  const aAfter = await fs.readFile(path.join(dir, 'a.txt'), 'utf8');
  const bStill = await fs.readFile(path.join(dir, 'b.txt'), 'utf8');
  check('partial shelve resets only chosen file', !aAfter.includes('modA') && bStill.includes('newfileB'));
  const partialList = await s.listShelves();
  check('partial shelf lists only a.txt', partialList[0]?.meta.files.length === 1 && partialList[0].meta.files[0].path === 'a.txt');
  await s.deleteShelve(partialList[0].meta.name, { hard: true });
  execSync('git checkout -- a.txt', { cwd: dir });
  execSync('git rm -f b.txt', { cwd: dir });

  // delete path

  await fs.writeFile(path.join(dir, 'a.txt'), 'X\n');
  await s.shelveChanges('to-delete-soft', '');
  const list3 = await s.listShelves();
  await s.deleteShelve(list3[0].meta.name);
  check('deleteShelve soft-removes from active list', (await s.listShelves()).length === 0);
  check('deleteShelve places in trash', (await s.listTrashed()).length === 1);
  const trashed = await s.listTrashed();
  const trashedKey = path.basename(trashed[0].metaPath, '.meta.json');
  await s.restoreFromTrash(trashedKey);
  check('restoreFromTrash brings shelf back', (await s.listShelves()).length === 1 && (await s.listTrashed()).length === 0);
  const restoredItem = (await s.listShelves())[0];
  await s.deleteShelve(restoredItem.meta.name, { hard: true });
  check('hard delete removes entirely', (await s.listShelves()).length === 0 && (await s.listTrashed()).length === 0);

  await fs.rm(dir, { recursive: true, force: true });
}

async function testConflictParser() {
  console.log('\n[conflictParser]');
  const sample = [
    'function greet() {',
    '<<<<<<< HEAD',
    '  return "hey";',
    '=======',
    '  return "hello";',
    '>>>>>>> theirs',
    '}',
  ].join('\n');
  check('hasConflictMarkers true', hasConflictMarkers(sample));
  check('hasConflictMarkers false on clean', !hasConflictMarkers('plain\nfile\n'));
  const parsed = parseConflicts(sample);
  check('one chunk parsed', parsed.chunks.length === 1);
  check('ours captured', parsed.chunks[0].ours.join('') === '  return "hey";');
  check('theirs captured', parsed.chunks[0].theirs.join('') === '  return "hello";');
  check('linesBeforeFirst captured', parsed.linesBeforeFirst[0] === 'function greet() {');

  const diff3 = [
    '<<<<<<< HEAD',
    'A',
    '|||||||',
    'B',
    '=======',
    'C',
    '>>>>>>> theirs',
  ].join('\n');
  const p3 = parseConflicts(diff3);
  check('diff3 base parsed', p3.chunks[0].baseLines?.[0] === 'B');
}

async function testRebase() {
  console.log('\n[RebaseService]');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-smoke-rebase-'));
  execSync('git init -q -b main && git config user.email t@t && git config user.name t', { cwd: dir });
  for (let i = 1; i <= 4; i++) {
    await fs.writeFile(path.join(dir, `f${i}.txt`), `${i}\n`);
    execSync(`git add f${i}.txt && git commit -q -m "commit ${i}"`, { cwd: dir });
  }
  const g = new GitService(dir);
  const r = new RebaseService(g, dir);
  const log = await g.getLog({ all: false, maxCount: 10 });
  const baseSha = log[3].sha; // oldest commit
  const list = await r.listCommitsSince(baseSha);
  check('rebase list excludes base', list.every((c) => c.sha !== baseSha));
  check('rebase list ordered oldest-first', list[0].message.includes('commit 2') && list[list.length - 1].message.includes('commit 4'));

  const steps = list.map((c, i) => ({ sha: c.sha, action: i === 1 ? 'drop' as const : 'pick' as const, message: c.message }));
  const res = await r.run(baseSha, steps);
  check('rebase ran ok', res.ok, res.output);
  const newLog = await g.getLog({ all: false, maxCount: 10 });
  check('rebase dropped commit', newLog.length === 3);

  await fs.rm(dir, { recursive: true, force: true });
}

async function testDiffer() {
  console.log('\n[differ]');
  check('whitespace-only true', isWhitespaceOnlyChange('a b\nc', 'a   b\nc'));
  check('whitespace-only false', !isWhitespaceOnlyChange('a b', 'a c'));
  const before = ['x1', 'x2', 'BLOCK1', 'BLOCK2', 'BLOCK3', 'y1', 'y2'].join('\n');
  const after = ['x1', 'x2', 'y1', 'y2', 'BLOCK1', 'BLOCK2', 'BLOCK3'].join('\n');
  const moves = detectMoves(before, after);
  check('detectMoves finds moved block', moves.some((m) => m.text.includes('BLOCK2')));
}

(async () => {
  try {
    await testGitService();
    await testShelving();
    await testConflictParser();
    await testDiffer();
    await testRebase();
    console.log(`\n${pass} pass / ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
  } catch (e) {
    console.error(e);
    process.exit(2);
  }
})();
