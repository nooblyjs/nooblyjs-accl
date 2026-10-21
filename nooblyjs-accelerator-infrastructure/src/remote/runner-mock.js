// The mock runner: what a VM on the mock cloud answers when Noobly Cloud runs a script on it. First boot takes two
// units of mock cloud time after the VM is running; health comes from the VM's `sim` figures (the seed story sets them
// from the mockups) or from steady defaults.

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(signal.reason ?? new Error('aborted'));
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => {
    clearTimeout(timer);
    reject(signal.reason ?? new Error('aborted'));
  }, { once: true });
});

const GB = 1e9;

export function createMockRunner({ cloud, ref, catalog }) {
  const vm = async () => (await cloud.resources((r) => r.id === ref && r.kind === 'vm'))[0] ?? null;
  const ok = (value) => ({ code: 0, stdout: `${JSON.stringify(value)}\n`, stderr: '' });

  return {
    async run(script, args = [], { signal } = {}) {
      const machine = await vm();
      if (!machine || machine.status !== 'running') return { code: 255, stdout: '', stderr: 'ssh: connect to host: Connection refused' };
      if (script === 'wait-ready') {
        if (!machine.ready) {
          await sleep(2 * cloud.stepMs, signal);
          await cloud.outOfBand(ref, { ready: true, docker: /docker/.test(machine.userData ?? '') ? '27.3.1' : '' });
        }
        const after = await vm();
        return ok({ ready: true, docker: after.docker ?? '' });
      }
      if (script === 'health') {
        const type = catalog?.machineTypes?.[machine.machineType];
        const sim = machine.sim ?? {};
        const memTotal = (type?.memoryGb ?? 4) * GB;
        const diskTotal = (machine.diskGb ?? 30) * GB;
        return ok({
          memory: { totalBytes: memTotal, usedBytes: Math.round((sim.memUsedGb ?? (type?.memoryGb ?? 4) * 0.4) * GB) },
          disk: { totalBytes: diskTotal, usedBytes: Math.round((sim.diskUsedGb ?? (machine.diskGb ?? 30) * 0.25) * GB) },
          uptimeSeconds: Math.max(0, Math.round((cloud.now() - new Date(machine.startedAt ?? machine.createdAt).getTime()) / 1000)),
        });
      }
      return { code: 127, stdout: '', stderr: `bash: ${script}: no such script on the mock cloud` };
    },
    close() {},
  };
}
