// The API router, mounted at <mountPath>/api/v1 (architecture.md §13). Signed in only, every write audited, and every
// answer (including unknown routes and errors) in the one error shape. Reads need the `read` permission; the
// resource routes add their own checks (product.md §7) as they arrive in roadmap phases 1–6.
import { apiNotFound, apiErrors, forbidden } from '../util/errors.js';
import { handler } from '../util/http.js';

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function createApi({ host, log, about, seed, summary }) {
  const api = host.express.Router();
  api.use(host.express.json({ limit: '1mb' }));
  api.use(host.auth);
  // The launcher may audit every write itself and pass host.audit through; the dev host records here.
  api.use((req, res, next) => (READS.has(req.method) ? next() : host.audit(req, res, next)));
  api.use(host.requireRole('read'));

  // ---------- system ----------
  api.get('/about', (req, res) => res.json(about));
  api.get('/summary', handler(async (req, res) => res.json(await summary.summary())));
  // Rewrites data/infrastructure/ with the seed story. Owner only, and never in production.
  api.post('/seed', host.requireRole('change-guardrails'), handler(async (req, res) => {
    if (process.env.NODE_ENV === 'production') throw forbidden('Resetting to the seed story is not allowed in production.');
    const result = await seed({ reset: req.body?.reset === true });
    res.status(result.seeded ? 201 : 200).json(result);
  }));

  api.use(apiNotFound);
  api.use(apiErrors({ log }));
  return api;
}
