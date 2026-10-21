// The SSH runner (architecture.md §9): runs our fixed scripts on a VM as `noobly`, with the install's control key.
// The script goes over stdin to `bash -s`, so nothing is left on the VM and only quoted arguments reach a command
// line. The VM's host key is pinned the first time (trust on first use) and checked every time after.
import crypto from 'node:crypto';
import { Client } from 'ssh2';
import { command, scriptText } from './shell.js';

/** "SHA256:…", as ssh-keygen -l prints it. */
export const fingerprint = (key) => `SHA256:${crypto.createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;

/**
 * @param {object} o
 * @param {string} o.host
 * @param {number} [o.port]
 * @param {string} o.privateKey          the control key (OpenSSH format)
 * @param {string|null} [o.hostKey]      the pinned fingerprint, or null the first time
 * @param {(fp: string) => Promise<void>} [o.pin]   keeps the fingerprint seen the first time
 * @param {number} [o.timeoutMs]
 */
export function createSshRunner({ host, port = 22, privateKey, hostKey = null, pin, timeoutMs = 20_000 }) {
  let connecting = null;
  let seen = null;

  function connect() {
    if (connecting) return connecting;
    connecting = new Promise((resolve, reject) => {
      const client = new Client();
      client
        .on('ready', () => resolve(client))
        .on('error', (err) => {
          connecting = null;
          reject(err);
        })
        .on('close', () => {
          connecting = null;
        })
        .connect({
          host,
          port,
          username: 'noobly',
          privateKey,
          readyTimeout: timeoutMs,
          hostVerifier: (key) => {
            seen = fingerprint(key);
            return !hostKey || seen === hostKey;
          },
        });
    });
    return connecting.then(async (client) => {
      if (!hostKey && seen) {
        hostKey = seen;
        await pin?.(seen);
      }
      return client;
    });
  }

  return {
    /** Runs a script: { code, stdout, stderr }. Rejects when the connection fails or `signal` aborts. */
    async run(script, args = [], { signal, timeoutMs: limit = 15 * 60_000 } = {}) {
      const text = scriptText(script);
      const client = await connect();
      return new Promise((resolve, reject) => {
        client.exec(command(args), (err, stream) => {
          if (err) return reject(err);
          let stdout = '';
          let stderr = '';
          const timer = setTimeout(() => stream.close(), limit);
          const abort = () => {
            stream.close();
            reject(signal.reason ?? new Error('aborted'));
          };
          signal?.addEventListener('abort', abort, { once: true });
          stream.on('data', (d) => { stdout += d; });
          stream.stderr.on('data', (d) => { stderr += d; });
          stream.on('close', (code) => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
            resolve({ code: code ?? -1, stdout, stderr });
          });
          stream.end(text);
          return undefined;
        });
      });
    },
    close() {
      connecting?.then((c) => c.end()).catch(() => {});
      connecting = null;
    },
  };
}
