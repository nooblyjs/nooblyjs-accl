// /operations (architecture.md §13): long-running work, its steps and log; cancel and retry.
import { handler } from '../util/http.js';
import { badRequest, notFound } from '../util/errors.js';
import { isGeneratedId } from '../util/ids.js';

const STATUSES = new Set(['active', 'queued', 'running', 'succeeded', 'failed', 'cancelled']);

export function operationRoutes({ host, operations }) {
  const r = host.express.Router();
  const id = (req) => {
    if (!isGeneratedId(req.params.id)) throw notFound(`No operation ${req.params.id}.`);
    return req.params.id;
  };
  r.get('/', handler(async (req, res) => {
    const { resource, status, account } = req.query;
    if (status !== undefined && !STATUSES.has(status)) throw badRequest(`status is one of ${[...STATUSES].join(', ')}.`);
    if (resource !== undefined && !/^[a-z]+:[a-z0-9][a-z0-9.-]{0,62}$/.test(resource)) throw badRequest('resource looks like vm:web-01.');
    res.json({ operations: await operations.list({ resource, status, account }) });
  }));
  r.get('/:id', handler(async (req, res) => res.json(await operations.get(id(req)))));
  r.post('/:id/cancel', handler(async (req, res) => res.json(await operations.cancel(id(req), req.person))));
  r.post('/:id/retry', handler(async (req, res) => res.status(202).json(await operations.retry(id(req), req.person))));
  return r;
}
