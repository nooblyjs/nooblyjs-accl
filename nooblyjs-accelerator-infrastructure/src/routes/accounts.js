// /accounts (architecture.md §13): the cloud accounts. Who may do what is checked in the service (product.md §7).
import { handler } from '../util/http.js';
import { notFound } from '../util/errors.js';
import { isResourceName } from '../util/ids.js';

export function accountRoutes({ host, accounts }) {
  const r = host.express.Router();
  const id = (req) => {
    if (!isResourceName(req.params.id)) throw notFound(`No cloud account ${req.params.id}.`);
    return req.params.id;
  };
  r.get('/', handler(async (req, res) => res.json({ accounts: await accounts.list() })));
  r.post('/', handler(async (req, res) => res.status(202).json(await accounts.connect(req.body ?? {}, req.person))));
  r.get('/:id', handler(async (req, res) => res.json(await accounts.get(id(req)))));
  r.patch('/:id', handler(async (req, res) => res.json(await accounts.update(id(req), req.body ?? {}, req.person))));
  r.post('/:id/verify', host.requireRole('draft'), handler(async (req, res) => res.json(await accounts.check(id(req)))));
  r.delete('/:id', handler(async (req, res) => res.json(await accounts.remove(id(req), req.body ?? {}, req.person))));
  return r;
}
