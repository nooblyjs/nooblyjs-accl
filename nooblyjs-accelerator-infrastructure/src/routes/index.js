// The API router, mounted at <mountPath>/api/v1 (architecture.md §13). Signed in only, every write audited, and every
// answer (including unknown routes and errors) in the one error shape. Reads need the `read` permission; who may
// change what is checked by the services (product.md §7), which record every refusal.
import { apiNotFound, apiErrors, forbidden, badRequest, notFound } from '../util/errors.js';
import { handler } from '../util/http.js';
import { ACTIVITY_KINDS } from '../services/activity.js';
import { accountRoutes } from './accounts.js';
import { operationRoutes } from './operations.js';

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function createApi({ host, log, about, seed, summary, accounts, operations, activity, catalog, cost }) {
  const api = host.express.Router();
  api.use(host.express.json({ limit: '1mb' }));
  api.use(host.auth);
  // The launcher may audit every write itself and pass host.audit through; the dev host records here.
  api.use((req, res, next) => (READS.has(req.method) ? next() : host.audit(req, res, next)));
  api.use(host.requireRole('read'));

  // ---------- system ----------
  api.get('/about', (req, res) => res.json(about));
  api.get('/summary', handler(async (req, res) => res.json(await summary.summary())));
  /** One cloud's catalogue: ?cloud=gcp, or ?account=<id> for that account's cloud. */
  api.get('/catalog', handler(async (req, res) => {
    let cloud = req.query.cloud;
    if (req.query.account !== undefined) cloud = (await accounts.get(String(req.query.account))).cloud;
    const found = catalog.forCloud(cloud);
    if (!found) throw notFound('Ask for ?cloud=gcp or ?cloud=aws.');
    res.json(found);
  }));
  api.get('/activity', handler(async (req, res) => {
    const { kind, person, limit } = req.query;
    if (kind !== undefined && !ACTIVITY_KINDS.includes(kind)) throw badRequest(`kind is one of ${ACTIVITY_KINDS.join(', ')}.`);
    res.json({ activity: await activity.list({ kind, person: person ? String(person) : undefined, limit }) });
  }));
  api.get('/cost', handler(async (req, res) => res.json(await cost.month())));
  // Rewrites data/infrastructure/ with the seed story. Owner only, and never in production.
  api.post('/seed', host.requireRole('change-guardrails'), handler(async (req, res) => {
    if (process.env.NODE_ENV === 'production') throw forbidden('Resetting to the seed story is not allowed in production.');
    const result = await seed({ reset: req.body?.reset === true });
    res.status(result.seeded ? 201 : 200).json(result);
  }));

  // ---------- resources ----------
  api.use('/accounts', accountRoutes({ host, accounts }));
  api.use('/operations', operationRoutes({ host, operations }));

  api.use(apiNotFound);
  api.use(apiErrors({ log }));
  return api;
}
