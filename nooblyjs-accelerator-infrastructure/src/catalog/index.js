// The catalogue (architecture.md §12): what Noobly Cloud offers on each cloud and what it costs, from the dated files in
// data/. Read once and kept; GET /catalog serves a cloud's catalogue to the create forms, which price with the same
// estimate() as the server.
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { FsStore } = require('nooblyjs-core/src/store/fs-store.js');
const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data');
export const CLOUDS = ['gcp', 'aws'];

export async function createCatalog() {
  const files = new FsStore(DATA);
  const byCloud = {};
  for (const cloud of CLOUDS) {
    const catalog = await files.readYaml([`${cloud}.yaml`]);
    if (catalog?.cloud !== cloud) throw new Error(`src/catalog/data/${cloud}.yaml is missing or names another cloud.`);
    byCloud[cloud] = Object.freeze(catalog);
  }
  return {
    /** The catalogue of one cloud, or null. */
    forCloud: (cloud) => byCloud[cloud] ?? null,
    /** One region of a cloud, or null. */
    region: (cloud, id) => byCloud[cloud]?.regions.find((r) => r.id === id) ?? null,
  };
}
