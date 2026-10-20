// Secrets (architecture.md §10): cloud credentials, database passwords, keys and tokens. Records hold only a `…Ref`;
// the value lives here, encrypted with AES-256-GCM, one file per secret under <dataDir>/secrets/. The key comes from
// INFRA_SECRET_KEY (else the launcher's SETTINGS_SECRET or SESSION_SECRET). In development, with none set, a random key
// is generated once and kept in secrets/dev-key.txt (readable by the owner only); in production the accelerator
// refuses to start without one.
//
// Not the nooblyjs-core settings service: that mounts /services/settings/api/values?reveal=true on the launcher's app,
// which would serve these values over HTTP, and keeps its file outside this accelerator's folder.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { newId, isGeneratedId } from '../util/ids.js';

const FOLDER = 'secrets';
const DEV_KEY = [FOLDER, 'dev-key.txt'];
const CHECK = [FOLDER, 'key-check.yaml'];
const CHECK_TEXT = 'noobly-cloud secrets key check';
const SALT = 'noobly-cloud/secrets/v1';
/** Values shorter than this aren't scrubbed from logs: too likely to match ordinary words. */
const MIN_SCRUB = 6;
export const MASK = '••••••';

const file = (ref) => [FOLDER, `${ref}.yaml`];

function encrypt(key, plaintext, aad) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad));
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

function decrypt(key, { iv, tag, data }, aad) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

/** Every string inside a value (a credentials JSON's private_key, a password), for scrubbing. */
function strings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) strings(v, out);
  return out;
}

/**
 * @param {{ store: object, log: object, keyMaterial?: string, production?: boolean, audit?: object }} o
 * @returns {Promise<object>} the secrets service
 */
export async function createSecrets({
  store, log, audit,
  keyMaterial = process.env.INFRA_SECRET_KEY || process.env.SETTINGS_SECRET || process.env.SESSION_SECRET,
  production = process.env.NODE_ENV === 'production',
}) {
  if (!keyMaterial) {
    if (production) throw new Error('Set INFRA_SECRET_KEY: Noobly Cloud encrypts cloud credentials and passwords with it.');
    keyMaterial = (await store.readText(DEV_KEY))?.trim();
    if (!keyMaterial) {
      keyMaterial = crypto.randomBytes(32).toString('base64');
      await store.writeText(DEV_KEY, `${keyMaterial}\n`);
      if (typeof store.resolve === 'function') await fs.chmod(store.resolve(DEV_KEY), 0o600).catch(() => {});
      log.warn('No INFRA_SECRET_KEY: secrets are encrypted with a development key kept in secrets/dev-key.txt. Set INFRA_SECRET_KEY before storing real credentials.');
    }
  }
  const key = crypto.scryptSync(keyMaterial, SALT, 32);

  // The key must open what is already here: a changed INFRA_SECRET_KEY would otherwise fail one secret at a time.
  const check = await store.readYaml(CHECK);
  if (check) {
    try {
      decrypt(key, check, CHECK_TEXT);
    } catch {
      throw new Error('INFRA_SECRET_KEY is not the key these secrets were encrypted with. Set the original key.');
    }
  } else {
    await store.writeYaml(CHECK, encrypt(key, CHECK_TEXT, CHECK_TEXT));
  }

  /** Values seen this run, so logs can be scrubbed of them. */
  const known = new Set();
  const remember = (value) => {
    for (const s of strings(value)) if (s.length >= MIN_SCRUB) known.add(s);
  };

  async function get(ref) {
    if (!isGeneratedId(ref)) return null;
    const record = await store.readYaml(file(ref));
    if (!record) return null;
    const text = decrypt(key, record, ref);
    const value = record.json ? JSON.parse(text) : text;
    remember(value);
    return value;
  }

  return {
    /** Stores a value (a string, or an object kept as JSON) and returns its ref. */
    async put(kind, value) {
      if (value === undefined || value === null || value === '') throw new Error('secrets.put needs a value.');
      const ref = newId('sec', 16);
      const json = typeof value !== 'string';
      await store.writeYaml(file(ref), { ref, kind, json, createdAt: new Date().toISOString(), ...encrypt(key, json ? JSON.stringify(value) : value, ref) });
      remember(value);
      return ref;
    },
    get,
    async remove(ref) {
      if (isGeneratedId(ref)) await store.remove(file(ref));
    },
    /** A value for a person to see: audited, with the reason. The caller has checked the permission. */
    async reveal(ref, person, reason) {
      const value = await get(ref);
      await audit?.record({ actor: person?.id ?? null, action: 'secret.revealed', target: ref, reason });
      return value;
    },
    /** `text` with every secret value seen this run replaced by a mask. */
    scrub(text) {
      let out = String(text ?? '');
      // Longest first, so a value that contains another is masked whole.
      for (const value of [...known].sort((a, b) => b.length - a.length)) if (out.includes(value)) out = out.split(value).join(MASK);
      return out;
    },
  };
}
