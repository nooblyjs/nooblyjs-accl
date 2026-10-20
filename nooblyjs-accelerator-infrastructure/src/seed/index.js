// The seed story (product.md §9). Everything it writes is sample data. A launcher calls seed({ reset: false }) on
// the first start (an empty data/infrastructure/); `npm run seed -- --reset` and POST /api/v1/seed rewrite it.
//
// The story is kept as plain files in src/seed/data/, laid out exactly like data/infrastructure/. Times in it are
// written relative to the moment of seeding ({{ago:40m}}, {{ago:2d}}, {{in:55d}}, {{today:02:00}}, {{month-start}}), so "40 min
// ago" is true on any day. seed.yaml records which story is in the folder and when it was written.
//
// The story is the mockups' (product.md §9): Stevie's GCP and AWS accounts on the mock cloud, five VMs, six apps, three
// databases and four buckets, the mock cloud's matching state (mock-cloud/), and the activity on the Overview. The
// mock accounts' credentials are secrets, which can't be written as files: register() adds them after seeding.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const STORY = { id: 'noobly-cloud', title: 'Stevie\'s GCP and AWS accounts (the mockups)' };
const MARKER = ['seed.yaml'];
const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data');
const UNIT_MS = { m: 60_000, h: 3_600_000, d: 86_400_000 };
/** What the accelerator needs to run with no sample content (a launcher's host.sampleData is false). */
const SYSTEM = [];
/** Kept by a reset: the key that opens the secrets (a new one would orphan every secret written before). */
const KEEP = { secrets: ['dev-key.txt', 'key-check.yaml'] };

/** Today at hh:mm UTC, or yesterday when that is still to come. */
function today(hh, mm, now) {
  const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), Number(hh), Number(mm)));
  if (at > now) at.setUTCDate(at.getUTCDate() - 1);
  return at.toISOString();
}

/** Replaces the story's relative times with ISO times around `now`. */
export function placeTimes(text, now) {
  return text
    .replace(/\{\{ago:(\d+)([mhd])\}\}/g, (_, n, unit) => new Date(now.getTime() - Number(n) * UNIT_MS[unit]).toISOString())
    .replace(/\{\{today:(\d\d):(\d\d)\}\}/g, (_, hh, mm) => today(hh, mm, now))
    .replace(/\{\{in:(\d+)([mhd])\}\}/g, (_, n, unit) => new Date(now.getTime() + Number(n) * UNIT_MS[unit]).toISOString())
    .replace(/\{\{month-start\}\}/g, `${now.toISOString().slice(0, 7)}-01T00:00:00.000Z`);
}

async function storyFiles() {
  const entries = await fs.readdir(DATA_DIR, { recursive: true, withFileTypes: true }).catch((err) => {
    if (err.code === 'ENOENT') return [];
    throw err;
  });
  return entries
    .filter((e) => e.isFile() && !e.name.startsWith('.'))
    .map((e) => path.relative(DATA_DIR, path.join(e.parentPath, e.name)).split(path.sep))
    .sort((a, b) => a.join('/').localeCompare(b.join('/')));
}

/**
 * Writes the seed story into the store.
 * @param {object} store   the accelerator's FsStore (rooted at its dataDir)
 * @param {{ reset?: boolean, now?: () => number|Date, content?: boolean }} [options]
 *   reset: remove everything in the folder first. Without it, a folder that is already seeded is left alone.
 *   content: false writes only what the accelerator needs to run, no sample data.
 */
export async function seed(store, { reset = false, now = () => Date.now(), content = true } = {}) {
  const existing = await store.readYaml(MARKER);
  if (existing && !reset) return { seeded: false, story: existing.story, seededAt: existing.seededAt };

  if (reset) {
    // Only what is inside this accelerator's folder: the store refuses any path outside it.
    for (const name of [...await store.list([], { dirs: true }), ...await store.list([])]) {
      if (!KEEP[name]) {
        await store.remove([name]);
        continue;
      }
      for (const file of await store.list([name])) if (!KEEP[name].includes(file)) await store.remove([name, file]);
      for (const dir of await store.list([name], { dirs: true })) await store.remove([name, dir]);
    }
  }
  const at = new Date(now());
  const files = (await storyFiles()).filter((segments) => content || SYSTEM.includes(segments.join('/')));
  for (const segments of files) {
    await store.writeText(segments, placeTimes(await fs.readFile(path.join(DATA_DIR, ...segments), 'utf8'), at));
  }
  const marker = content
    ? { story: STORY.id, title: STORY.title, seededAt: at.toISOString(), sampleData: true }
    : { story: null, content: false, seededAt: at.toISOString() };
  await store.writeYaml(MARKER, marker);
  return { seeded: true, story: marker.story, seededAt: marker.seededAt, files: files.length };
}
