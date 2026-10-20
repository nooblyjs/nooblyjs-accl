// Names and ids (architecture.md §5). VMs, apps and databases are named by people and the name is their URL id,
// unique across the install: lower-case letters, numbers and dashes, starting with a letter (RFC 1035, as both clouds
// require for instance names). Operations, endpoints and deploys get generated ids: <prefix>_<random>. Route params
// are checked here before they reach the store.
import crypto from 'node:crypto';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const RESOURCE_NAME = /^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$/;
const GENERATED_ID = /^[a-z]{2,8}_[a-z0-9]{4,32}$/;

export const isResourceName = (name) => typeof name === 'string' && RESOURCE_NAME.test(name);
export const isGeneratedId = (id) => typeof id === 'string' && GENERATED_ID.test(id);

/** A generated id, e.g. newId('op') → 'op_8f3k2q9a1b'. */
export function newId(prefix, length = 10) {
  if (!/^[a-z]{2,8}$/.test(prefix)) throw new Error(`id prefix must be 2–8 lower-case letters, not ${JSON.stringify(prefix)}`);
  let id = '';
  for (const b of crypto.randomBytes(length)) id += ALPHABET[b % ALPHABET.length];
  return `${prefix}_${id}`;
}
