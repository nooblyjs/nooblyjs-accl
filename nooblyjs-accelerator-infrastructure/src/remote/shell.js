// Building commands for a VM (architecture.md §9). Remote work is a fixed script from src/remote/scripts/, piped to
// `bash -s` over SSH, with its arguments single-quoted here. No value a person typed is ever placed in a command line
// unquoted, and a script that isn't one of ours can't be named.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'scripts');
export const SCRIPTS = Object.freeze(fs.readdirSync(DIR).filter((f) => f.endsWith('.sh')).map((f) => f.slice(0, -3)));

/** One shell word: 'it'\''s' for it's. */
export const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;

/** The script's text, to pipe to bash. Throws for a name that isn't one of ours. */
export function scriptText(name) {
  if (!SCRIPTS.includes(name)) throw new Error(`No remote script ${name}.`);
  return fs.readFileSync(path.join(DIR, `${name}.sh`), 'utf8');
}

/** The command that runs a script read from stdin with these arguments. */
export function command(args = []) {
  for (const a of args) if (typeof a !== 'string' && typeof a !== 'number') throw new Error('Remote arguments are strings or numbers.');
  return ['bash', '-s', '--', ...args.map(quote)].join(' ');
}
