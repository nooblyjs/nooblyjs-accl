// Scheduled jobs (architecture.md §8). One timer checks, every `checkEveryMs`, which jobs are due by the launcher's
// clock (business time, which a dev clock can move), and runs them one after another, never two at once. A job's
// interval may depend on the state of things (the inventory sync runs every minute while something is changing).
// The timer is unref'd, so it never keeps the process alive, and close() stops it.

/**
 * @param {object} o
 * @param {() => number} o.now
 * @param {object} o.log
 * @param {number} o.checkEveryMs   0: no timer (tests call tick() or run())
 * @param {{ name: string, every: number | (() => Promise<number>), run: () => Promise<void> }[]} o.jobs
 */
export function createJobs({ now, log, checkEveryMs, jobs }) {
  const last = new Map();
  let running = null;
  let timer = null;

  async function runJob(job) {
    last.set(job.name, now());
    try {
      await job.run();
    } catch (err) {
      log.warn(`job ${job.name}: ${err.stack ?? err.message}`);
    }
  }

  /** Runs every job that is due. A job that has never run is due. */
  function tick() {
    if (running) return running;
    running = (async () => {
      for (const job of jobs) {
        const every = typeof job.every === 'function' ? await job.every() : job.every;
        if (last.has(job.name) && now() - last.get(job.name) < every) continue;
        await runJob(job);
      }
    })().finally(() => {
      running = null;
    });
    return running;
  }

  return {
    tick,
    /** Runs one job now, whether due or not (tests, and a person in a hurry). */
    async run(name) {
      const job = jobs.find((j) => j.name === name);
      if (!job) throw new Error(`No job ${name}.`);
      if (running) await running;
      await runJob(job);
    },
    start() {
      if (checkEveryMs > 0 && !timer) {
        timer = setInterval(() => tick().catch(() => {}), checkEveryMs);
        timer.unref?.();
      }
    },
    async close() {
      if (timer) clearInterval(timer);
      timer = null;
      if (running) await running;
    },
  };
}
