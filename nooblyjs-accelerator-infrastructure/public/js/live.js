// How a Noobly Cloud page stays current (architecture.md §11.2). No imports, so it can be tested outside a browser.

/** The events that change what a Noobly Cloud page shows: every event this accelerator emits (architecture.md §7). */
const LIVE = ['infrastructure.'];
/** With an event stream, a page redraws at most this often however busy the stream is. */
const LIVE_EVERY_MS = 500;

/**
 * Draws the page with `draw()`, and again on data-action="reload".
 *
 * Under a launcher with an event stream the page then follows it (ctx.sse): it redraws when a Noobly Cloud event
 * arrives, so an operation's progress moves with no refresh and no polling. Where there is no stream (this repo on its own,
 * `npm start`), `draw` may return a number of milliseconds and the page is drawn again after that long instead.
 */
export function reloadable(view, ctx, draw) {
  let timer = null;
  let last = 0;
  const live = Boolean(ctx.sse?.enabled);
  const run = async () => {
    clearTimeout(timer);
    last = Date.now();
    const again = await draw();
    if (!live && again && !ctx.signal.aborted && ctx.isCurrent()) timer = setTimeout(run, again);
  };
  view.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="reload"]')) run();
  }, { signal: ctx.signal });
  ctx.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
  if (live) {
    ctx.sse.on('*', (event) => {
      if (!LIVE.some((prefix) => String(event?.type ?? '').startsWith(prefix))) return;
      clearTimeout(timer);
      timer = setTimeout(() => { if (ctx.isCurrent()) run().catch(() => {}); }, Math.max(50, last + LIVE_EVERY_MS - Date.now()));
    });
  }
  return run().then(() => run);
}
