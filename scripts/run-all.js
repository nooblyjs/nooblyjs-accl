#!/usr/bin/env node
/**
 * Runs an npm script in every accelerator folder (nooblyjs-accelerator-*).
 *
 *   node scripts/run-all.js <script> [--parallel] [name-filter ...]
 *
 * Sequential scripts (build, clean, test, coverage) run one folder at a time and
 * keep going after a failure so every solution is reported. Parallel scripts
 * (start, dev) run together, each on its own port starting at BASE_PORT (3001).
 * The special script name "install" runs `npm install` itself in each folder.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');
const [script, ...rest] = process.argv.slice(2);
const parallel = rest.includes('--parallel');
const filters = rest.filter((a) => !a.startsWith('--'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

if (!script) {
  console.error('Usage: node scripts/run-all.js <script> [--parallel] [name-filter ...]');
  process.exit(1);
}

const packages = fs
  .readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name.startsWith('nooblyjs-accelerator-'))
  .map((d) => d.name)
  .filter((name) => fs.existsSync(path.join(root, name, 'package.json')))
  .filter((name) => filters.length === 0 || filters.some((f) => name.includes(f)))
  .sort();

if (packages.length === 0) {
  console.error('No matching accelerator packages found.');
  process.exit(1);
}

function run(name, env) {
  return new Promise((resolve) => {
    const args = script === 'install' ? ['install'] : ['run', script, '--if-present'];
    const child = spawn(npm, args, {
      cwd: path.join(root, name),
      env: { ...process.env, ...env },
      stdio: parallel ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      shell: process.platform === 'win32',
    });
    if (parallel) {
      const tag = `[${name.replace('nooblyjs-accelerator-', '')}] `;
      const prefix = (stream, out) => {
        let buffer = '';
        stream.on('data', (chunk) => {
          buffer += chunk;
          const lines = buffer.split('\n');
          buffer = lines.pop();
          lines.forEach((line) => out.write(tag + line + '\n'));
        });
        stream.on('end', () => buffer && out.write(tag + buffer + '\n'));
      };
      prefix(child.stdout, process.stdout);
      prefix(child.stderr, process.stderr);
    }
    child.on('close', (code) => resolve({ name, code }));
  });
}

async function main() {
  let results;
  if (parallel) {
    const basePort = Number(process.env.BASE_PORT) || 3001;
    packages.forEach((name, i) => console.log(`${name} -> port ${basePort + i}`));
    results = await Promise.all(packages.map((name, i) => run(name, { PORT: String(basePort + i) })));
  } else {
    results = [];
    for (const name of packages) {
      console.log(`\n=== ${name}: npm ${script === 'install' ? '' : 'run '}${script} ===`);
      results.push(await run(name));
    }
  }

  const failed = results.filter((r) => r.code !== 0);
  console.log(`\n${script}: ${results.length - failed.length}/${results.length} succeeded`);
  failed.forEach((r) => console.log(`  FAILED ${r.name} (exit ${r.code})`));
  process.exit(failed.length ? 1 : 0);
}

main();
