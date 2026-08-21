import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const clientRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(clientRoot, 'src');

function collectTests(directory, output = []) {
  for (const entry of readdirSync(directory)) {
    const fullPath = path.join(directory, entry);
    if (statSync(fullPath).isDirectory()) {
      collectTests(fullPath, output);
    } else if (/\.test\.tsx?$/.test(entry)) {
      output.push(fullPath);
    }
  }
  return output;
}

const tests = collectTests(sourceRoot).sort();
if (tests.length === 0) {
  console.error('No client test files found');
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ['--import', 'tsx', '--test', ...tests],
  { cwd: clientRoot, stdio: 'inherit' },
);
process.exit(result.status ?? 1);
