import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { releaseProblems } from './release-rules.js';

const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' });
const tracked = git('ls-files', '-z').split('\0').filter(Boolean);
const files = [...new Set([...tracked, ...git('ls-files', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean)])];
const failures: string[] = [];
for (const path of files) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) { failures.push(`${path}: Non-regular source file.`); continue; }
  if (stat.size > 2_000_000) { failures.push(`${path}: File exceeds source size limit.`); continue; }
  for (const problem of releaseProblems(path, readFileSync(path, 'utf8'))) failures.push(`${path}: ${problem}`);
  if (tracked.includes(path)) {
    for (const problem of releaseProblems(path, git('show', `:${path}`))) failures.push(`${path} (index): ${problem}`);
  }
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Checked ${files.length} source files and their staged versions. No blocked files or configured patterns found.`);
  console.log('This is not proof of absence of personal information. Review all source and fictional fixtures before release.');
}
