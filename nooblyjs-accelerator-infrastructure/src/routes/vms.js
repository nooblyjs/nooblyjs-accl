// /vms, /ssh-keys and /my-ip (architecture.md §13). Who may do what is checked in the services (product.md §7).
import { handler } from '../util/http.js';
import { badRequest } from '../util/errors.js';
import { ipCidr } from '../services/vms.js';

const CLOUDS = new Set(['gcp', 'aws']);
const ROLES = new Set(['app', 'database', 'all']);

export function vmRoutes({ host, vms }) {
  const r = host.express.Router();
  r.get('/', handler(async (req, res) => {
    const { cloud, q, role } = req.query;
    if (cloud !== undefined && !CLOUDS.has(cloud)) throw badRequest('cloud is gcp or aws.');
    if (role !== undefined && !ROLES.has(role)) throw badRequest('role is app, database or all.');
    res.json({ vms: await vms.list({ cloud, q: q === undefined ? undefined : String(q).slice(0, 100), role }) });
  }));
  r.post('/', handler(async (req, res) => res.status(202).json(await vms.launch(req.body ?? {}, req.person, { ip: req.ip }))));
  r.get('/:name', handler(async (req, res) => res.json(await vms.get(req.params.name))));
  r.get('/:name/health', handler(async (req, res) => res.json(await vms.health(req.params.name))));
  for (const action of ['start', 'stop', 'restart']) {
    r.post(`/:name/${action}`, handler(async (req, res) => res.status(202).json(await vms[action](req.params.name, req.person))));
  }
  r.delete('/:name', handler(async (req, res) => res.status(202).json(await vms.remove(req.params.name, req.body ?? {}, req.person))));
  return r;
}

export function sshKeyRoutes({ host, sshKeys }) {
  const r = host.express.Router();
  r.get('/', handler(async (req, res) => res.json({ keys: await sshKeys.list() })));
  r.post('/', handler(async (req, res) => res.status(201).json(await sshKeys.add(req.body ?? {}, req.person))));
  r.delete('/:id', handler(async (req, res) => res.json(await sshKeys.remove(req.params.id, req.person))));
  return r;
}

/** The address a request came from, as the launcher sees it (its `trust proxy` setting decides behind a proxy). */
export const myIp = (req, res) => {
  const ip = String(req.ip ?? '').replace(/^::ffff:/, '');
  res.json({ ip: ip || null, cidr: ipCidr(ip) });
};
