import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync } from 'node:fs';

const run = promisify(execFile);
const git = async (...args) => (await run('git', args, { encoding: 'utf8' })).stdout;
const card = readFileSync(process.argv[2], 'utf8');
const section = card.match(/^고칠 파일:\s*\n([\s\S]*?)(?=^크기:)/m);
const size = card.match(/^크기:\s*(작음|보통|큼)/m)?.[1];
if (!section || !size) throw Error('Card needs file list and size');
const patterns = section[1].split('\n').filter(line => line.startsWith('- '))
  .flatMap(line => line.slice(2).replace(/\([^)]*\)/g, '').split(','))
  .map(value => value.trim().replace(/`/g, ''));
const allowed = patterns.map(pattern => new RegExp(`^${pattern.split('*')
  .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`));
const split = value => value.split('\0').filter(Boolean);
const untracked = new Set(split(await git('ls-files', '--others', '--exclude-standard', '-z')));
const files = [...new Set([...split(await git('diff', '--name-only', '--no-renames', '-z', 'HEAD')), ...untracked])]
  .filter(file => !file.startsWith('cards/') && !['progress.md', 'package-lock.json', '.gitignore'].includes(file));
let failed = false;
let total = 0;
for (const file of files) {
  const inScope = allowed.some(pattern => pattern.test(file));
  let lines;
  if (!existsSync(file)) {
    lines = 0; // Deleted files still undergo the scope check.
  } else if (readFileSync(file).includes(0)) {
    lines = 0; // Binary assets still undergo the scope check.
  } else if (untracked.has(file)) {
    const contents = readFileSync(file, 'utf8');
    lines = contents ? contents.split('\n').length - Number(contents.endsWith('\n')) : 0;
  } else {
    const stats = (await git('diff', '--numstat', '--no-renames', 'HEAD', '--', file)).trim().split('\n');
    lines = stats.filter(Boolean).reduce((sum, row) => {
      const [added, removed] = row.split('\t');
      return sum + (added === '-' ? Infinity : Number(added) + Number(removed));
    }, 0);
  }
  total += lines;
  console.log(`${inScope ? 'OK' : 'OUT OF SCOPE'}: ${file} (${lines} lines)`);
  if (!inScope) failed = true;
}
const limit = { 작음: 40, 보통: 150, 큼: 400 }[size];
console.log(`${total <= limit ? 'OK' : 'OVER LIMIT'}: ${total}/${limit} lines`);
process.exitCode = failed || total > limit ? 1 : 0;
