// Reaching inside a VM (architecture.md §9). forVm() gives a runner for one VM: on the mock cloud a mock runner, on a
// real cloud an SSH runner as `noobly` with the install's control key. The control key is made the first time it is
// needed and kept in secrets; its public half goes into every VM's first boot.
import ssh2 from 'ssh2';
import { createSshRunner } from './runner-ssh.js';
import { createMockRunner } from './runner-mock.js';

export function createRemote({ providers, secrets, config, catalog, repos }) {
  let control = null;

  /** The install's control key pair: { publicKey, privateKey }. Made once. */
  async function controlKey() {
    if (control) return control;
    const current = await config.get();
    if (current.controlKeyRef) {
      const privateKey = await secrets.get(current.controlKeyRef);
      if (privateKey) {
        control = { publicKey: current.controlPublicKey, privateKey };
        return control;
      }
    }
    const pair = ssh2.utils.generateKeyPairSync('ed25519', { comment: `noobly-cloud ${current.installId}` });
    const ref = await secrets.put('control-key', pair.private);
    await config.set({ controlKeyRef: ref, controlPublicKey: pair.public.trim() });
    control = { publicKey: pair.public.trim(), privateKey: pair.private };
    return control;
  }

  return {
    controlKey,
    /** A runner for the VM `vm` in `account`. */
    async forVm(vm, account) {
      if (account.provider === 'mock') {
        return createMockRunner({ cloud: providers.mockCloud(account), ref: vm.ref?.instance, catalog: catalog.forCloud(account.cloud) });
      }
      const host = vm.observed?.publicIp;
      if (!host) throw new Error(`${vm.name} has no public address to reach it on.`);
      const { privateKey } = await controlKey();
      return createSshRunner({
        host,
        privateKey,
        hostKey: vm.observed?.hostKey ?? null,
        pin: (hostKey) => repos.vms.update(vm.name, (r) => r && { ...r, observed: { ...(r.observed ?? {}), hostKey } }),
      });
    },
    /** Forgets the key read into memory (after the seed rewrote the folder). */
    forget() {
      control = null;
    },
  };
}
