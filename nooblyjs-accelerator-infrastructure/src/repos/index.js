// This accelerator's records over host.store (architecture.md §5). A record is its front matter plus `body`. Records
// hold what was asked for (spec), what was last seen in the cloud (observed) and the cloud's identifiers (ref); the
// cloud is the source of truth for what exists. A file someone edited by hand into something unreadable is skipped
// with a warning, so one bad file can't take a screen down.
import { isResourceName, isBucketName, isGeneratedId } from '../util/ids.js';

const split = ({ body = '', ...data }) => [data, body];

/** Markdown documents in one folder, one per id (`key` is the field that holds it). */
function docs(store, folder, isValid, log, key) {
  const segments = Array.isArray(folder) ? folder : [folder];
  const file = (id) => [...segments, `${id}.md`];
  async function read(path) {
    const doc = await store.readDoc(path);
    return doc && { ...doc.data, body: doc.body };
  }
  return {
    async list() {
      const out = [];
      for (const name of (await store.list(segments)) ?? []) {
        if (!name.endsWith('.md')) continue;
        try {
          const record = await read([...segments, name]);
          if (record?.[key]) out.push(record);
        } catch (err) {
          log.warn(`skipped ${segments.join('/')}/${name}: ${err.message}`);
        }
      }
      return out;
    },
    async get(id) {
      return isValid(id) ? read(file(id)) : null;
    },
    async write(record) {
      if (!isValid(record[key])) throw new Error(`not a valid ${segments.join('/')} id: ${record[key]}`);
      const [data, body] = split(record);
      await store.writeDoc(file(record[key]), data, body);
      return record;
    },
    /** Read-modify-write under the record's lock. `fn(current)` returns the new record (or nothing, to leave it). */
    async update(id, fn) {
      if (!isValid(id)) return null;
      return store.withLock(file(id), async () => {
        const next = await fn(await read(file(id)));
        if (next) {
          const [data, body] = split(next);
          await store.writeDoc(file(id), data, body);
        }
        return next ?? null;
      });
    },
    remove: (id) => (isValid(id) ? store.remove(file(id)) : null),
  };
}

/** A YAML list in one file, by id: ssh-keys.yaml. */
function yamlList(store, name, field) {
  const read = async () => (await store.readYaml([name]))?.[field] ?? [];
  return {
    list: read,
    get: async (id) => (await read()).find((item) => item.id === id) ?? null,
    add: (item) => store.withLock([name], async () => store.writeYaml([name], { [field]: [...await read(), item] })),
    remove: (id) => store.withLock([name], async () => store.writeYaml([name], { [field]: (await read()).filter((i) => i.id !== id) })),
  };
}

export function createRepos(store, { log }) {
  const apps = docs(store, 'apps', isResourceName, log, 'name');
  return {
    accounts: docs(store, 'accounts', isResourceName, log, 'id'),
    vms: docs(store, 'vms', isResourceName, log, 'name'),
    endpoints: docs(store, 'endpoints', isGeneratedId, log, 'id'),
    apps: {
      ...apps,
      /** One app's deploys: apps/<name>/deploys/<id>.md, whose body is the deploy log. */
      deploys: (app) => (isResourceName(app) ? docs(store, ['apps', app, 'deploys'], isGeneratedId, log, 'id') : null),
    },
    databases: docs(store, 'databases', isResourceName, log, 'name'),
    buckets: docs(store, 'buckets', isBucketName, log, 'name'),
    /** Long-running work (architecture.md §7); the body is the operation's log. */
    operations: docs(store, 'operations', isGeneratedId, log, 'id'),
    sshKeys: yamlList(store, 'ssh-keys.yaml', 'keys'),
    /** Everything that happened, oldest first (append-only). */
    activity: {
      append: (record) => store.appendYaml(['activity', 'ledger.yaml'], record),
      list: async () => (await store.readYamlStream(['activity', 'ledger.yaml'])) ?? [],
    },
  };
}
