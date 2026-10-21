// SSH keys (product.md §6.3, "Access"): the public keys people log in to their VMs with. Only public keys are kept;
// each new VM gets one on its image's default user. A key a VM still uses can't be removed.
import crypto from 'node:crypto';
import { HttpError, notFound, unprocessable } from '../util/errors.js';
import { needs } from '../util/http.js';
import { isGeneratedId, newId } from '../util/ids.js';
import { isPublicKey } from '../remote/cloud-init.js';
import { who } from './operations.js';

/** "SHA256:…" of an OpenSSH public key, as ssh-keygen -l prints it. */
export function keyFingerprint(publicKey) {
  const blob = Buffer.from(publicKey.trim().split(/\s+/)[1], 'base64');
  return `SHA256:${crypto.createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')}`;
}

const TYPE = { 'ssh-ed25519': 'ed25519', 'ssh-rsa': 'rsa' };

export function createSshKeys({ repos, host, now }) {
  const view = (key, vms = []) => ({
    id: key.id,
    name: key.name,
    type: key.type,
    fingerprint: key.fingerprint,
    addedBy: key.addedBy ?? null,
    addedAt: key.addedAt,
    usedBy: vms.filter((v) => v.spec?.sshKeyId === key.id).map((v) => v.name),
  });

  async function add(body, person) {
    await needs(host, person, 'draft', 'add an SSH key');
    const fields = {};
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const publicKey = typeof body.publicKey === 'string' ? body.publicKey.trim() : '';
    if (!name || name.length > 60) fields.name = 'Give the key a name, up to 60 characters.';
    if (!isPublicKey(publicKey)) fields.publicKey = 'Paste an SSH public key: it starts with ssh-ed25519, ssh-rsa or ecdsa-sha2-, then a long string of letters.';
    else if (/PRIVATE KEY/.test(publicKey)) fields.publicKey = 'That is a private key. Paste the public one (the .pub file).';
    if (Object.keys(fields).length) throw unprocessable('Check the highlighted fields.', { fields });
    const fingerprint = keyFingerprint(publicKey);
    const existing = (await repos.sshKeys.list()).find((k) => k.fingerprint === fingerprint);
    if (existing) return view(existing);
    const key = {
      id: newId('key'),
      name,
      type: TYPE[publicKey.split(' ')[0]] ?? publicKey.split(' ')[0].replace('ecdsa-sha2-', 'ecdsa-'),
      publicKey,
      fingerprint,
      addedBy: who(person),
      addedAt: new Date(now()).toISOString(),
    };
    await repos.sshKeys.add(key);
    return view(key);
  }

  return {
    async list() {
      const vms = await repos.vms.list();
      return (await repos.sshKeys.list()).map((k) => view(k, vms));
    },
    add,
    /** The key itself (public), for first boot. */
    async publicKey(id) {
      return isGeneratedId(id) ? (await repos.sshKeys.get(id))?.publicKey ?? null : null;
    },
    async remove(id, person) {
      await needs(host, person, 'draft', 'remove an SSH key');
      const key = isGeneratedId(id) ? await repos.sshKeys.get(id) : null;
      if (!key) throw notFound(`No SSH key ${id}.`);
      const users = (await repos.vms.list()).filter((v) => v.spec?.sshKeyId === id).map((v) => v.name);
      if (users.length) throw new HttpError(409, 'conflict', `${key.name} is the key of ${users.join(', ')}. Delete those VMs first.`);
      await repos.sshKeys.remove(id);
      return { removed: id };
    },
  };
}
