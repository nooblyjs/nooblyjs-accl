// A development host: everything register() needs from a launcher (architecture.md §3.2), built from nooblyjs-core,
// with a dev sign-in. It is the reference implementation of the host contract. server.js uses it to run this
// accelerator on its own, the tests use it (test/fixtures/host.js), and a launcher such as ../app.js may use it
// until it builds a host of its own. Exported as `nooblyjs-accelerator-infrastructure/host`.
//
//   const { createDevLauncher } = await import('nooblyjs-accelerator-infrastructure/host');
//   const launcher = createDevLauncher({ express, rootDir: dataRoot, log });
//   launcher.mount(app);                                    // CSRF, /login, the shell's API and the /ui kit
//   const hosted = await register(app, serverManager, { mountPath, dataDir, host: launcher.hostFor(dataDir) });
//   launcher.add(hosted, mountPath);                        // on the rail
//
// Sign-in is for development only: the person is named by the X-Dev-Person header (tests, curl) or the
// noobly.dev-person cookie (set by /login). Permissions come from the access role, through MATRIX. Events and audit
// records are kept in memory, and appended under rootDir when `persist` is set. Takes the launcher's `express`, so
// it works the same on Express 4 and 5.
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { FsStore } = require('nooblyjs-core/src/store/fs-store.js');

/** The dev people, one per access role (product.md §2). */
export const PEOPLE = [
  { id: 'stevie', name: 'Stevie', email: 'stevie@noobly.local', accessRole: 'Owner', workRole: 'Platform engineer', active: true },
  { id: 'lerato-m', name: 'Lerato M.', email: 'lerato-m@noobly.local', accessRole: 'Approver', workRole: 'Product manager', active: true },
  { id: 'thabo-n', name: 'Thabo N.', email: 'thabo-n@noobly.local', accessRole: 'Architect', workRole: 'Architect', active: true },
  { id: 'priya-s', name: 'Priya S.', email: 'priya-s@noobly.local', accessRole: 'Contributor', workRole: 'Developer', active: true },
  { id: 'naledi-k', name: 'Naledi K.', email: 'naledi-k@noobly.local', accessRole: 'Viewer', workRole: 'Product manager', active: true },
  // An agent actor: agents are capped at Contributor and marked kind: 'agent'.
  { id: 'ada-quill', name: 'Ada Quill', email: 'ada-quill@agents.noobly.local', accessRole: 'Contributor', workRole: 'Research agent', kind: 'agent', active: true },
];

/** Which access roles have each permission (product.md §7). Unknown permissions are refused. */
export const MATRIX = {
  read: ['Viewer', 'Contributor', 'Approver', 'Architect', 'Owner'],
  draft: ['Contributor', 'Approver', 'Architect', 'Owner'],
  approve: ['Approver', 'Architect', 'Owner'],
  'set-budgets': ['Owner'],
  'change-guardrails': ['Owner'],
};

export const PERSON_HEADER = 'x-dev-person';
export const PERSON_COOKIE = 'noobly.dev-person';
export const CSRF_COOKIE = 'noobly.csrf';
const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

const sendError = (res, status, code, message) => res.status(status).json({ error: { code, message } });
const wantsJson = (req) => req.originalUrl.split('?')[0].includes('/api/') || req.get('accept')?.includes('application/json') === true;
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function readCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

/**
 * The stand-in host.
 * @param {object} o
 * @param {typeof import('express')} o.express   the launcher's express (4 or 5)
 * @param {string} [o.rootDir]        the launcher's data folder; events and audit records are appended here with `persist`
 * @param {object[]} [o.people]
 * @param {Record<string, object>} [o.services]   other accelerators' services, by name
 * @param {Function} [o.frame]        the frame page handler (createDevLauncher passes the nooblyjs-core shell's)
 * @param {boolean} [o.persist]       append events and audit records under rootDir
 * @param {string} [o.publicBaseUrl]
 */
export function createStandaloneHost({ express, rootDir, people = PEOPLE, services = {}, frame, persist = false, publicBaseUrl = '' } = {}) {
  if (typeof express?.Router !== 'function') throw new Error('createStandaloneHost needs the launcher\'s express.');
  const rootStore = rootDir ? new FsStore(rootDir) : null;
  const auditLog = [];
  const eventLog = [];
  const bus = new EventEmitter().setMaxListeners(100);
  const day = (at) => [at.slice(0, 4), at.slice(5, 7), `${at.slice(0, 10)}.yaml`];

  const byId = (id) => people.find((p) => p.id === id && p.active) ?? null;
  const can = async (accessRole, permission) => (MATRIX[permission] ?? []).includes(accessRole);
  const permissionsFor = async (accessRole) => Object.keys(MATRIX).filter((p) => MATRIX[p].includes(accessRole));

  async function record(entry) {
    const full = { at: new Date().toISOString(), ...entry };
    auditLog.push(full);
    if (persist && rootStore) await rootStore.appendYaml(['audit', ...day(full.at)], full);
  }

  /** Who is signed in: the header (tests, curl) or the dev sign-in cookie. Never refuses. */
  function identify(req) {
    if (req.person !== undefined) return req.person;
    const header = req.get(PERSON_HEADER);
    req.signedInBy = header ? 'header' : 'cookie';
    req.person = byId(header ?? readCookies(req)[PERSON_COOKIE]);
    return req.person;
  }

  /** host.auth: a person on req.person, or 401 (API) / a redirect to /login (pages). */
  function auth(req, res, next) {
    if (identify(req)) return next();
    if (wantsJson(req)) return sendError(res, 401, 'unauthenticated', 'Sign in to continue.');
    res.redirect(302, `/login?next=${encodeURIComponent(req.originalUrl)}`);
  }

  /** host.requireRole(permission): 403, with an audit record, unless the access role has the permission. */
  function requireRole(permission) {
    return async (req, res, next) => {
      const role = req.person?.accessRole;
      if (await can(role, permission)) return next();
      await record({ actor: req.person?.id ?? null, action: 'access.refused', target: `${req.method} ${req.originalUrl.split('?')[0]}`, permission });
      sendError(res, 403, 'forbidden', `This needs the "${permission}" permission. Your access role is ${role ?? 'none'}.`);
    };
  }

  /** host.audit: middleware that records the write once it is answered, and record() for anything else. */
  const audit = Object.assign((req, res, next) => {
    res.on('finish', () => {
      record({ actor: req.person?.id ?? null, action: `${req.method} ${req.originalUrl.split('?')[0]}`, status: res.statusCode }).catch(() => {});
    });
    next();
  }, { record });

  const events = {
    async emit(type, payload, { actor } = {}) {
      const event = { at: new Date().toISOString(), type, actor: actor ?? null, payload };
      eventLog.push(event);
      if (persist && rootStore) await rootStore.appendYaml(['events', ...day(event.at)], event);
      bus.emit(type, event);
      return event;
    },
    on(type, fn) {
      bus.on(type, fn);
      return () => bus.off(type, fn);
    },
  };

  /**
   * The CSRF check a launcher makes before an accelerator sees a change. Only cookie sign-ins need it: a browser
   * can't add the X-Dev-Person header to a cross-site request without a preflight.
   */
  function csrf(req, res, next) {
    if (READS.has(req.method)) return next();
    identify(req);
    if (!req.person || req.signedInBy === 'header') return next();
    const token = readCookies(req)[CSRF_COOKIE];
    const sent = req.get('x-csrf-token') ?? '';
    const ok = token && sent.length === token.length && crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(token));
    if (ok) return next();
    sendError(res, 403, 'csrf', 'The form expired. Reload the page and try again.');
  }

  return {
    auditLog,
    eventLog,
    events,
    people,
    can,
    permissionsFor,
    auth,
    csrf,
    /** The `host` handed to one accelerator's register(), with its store rooted at the accelerator's dataDir. */
    hostFor(appDir) {
      return {
        express,
        auth,
        requireRole,
        can,
        audit,
        events,
        store: new FsStore(appDir),
        people: { list: async () => people, get: async (id) => byId(id), getByEmail: async (email) => people.find((p) => p.email === email) ?? null },
        service: (name) => services[name],
        frame: frame ?? ((req, res) => res.status(501).type('text').send('The NooblyJS frame is not available on the stand-in host.')),
        publicBaseUrl,
        clock: { now: () => Date.now() },
        development: true,
        checksCsrf: true,
      };
    },
  };
}

/**
 * A development launcher: the stand-in host plus nooblyjs-core's shell (rail, sidebar, the frame page and the /ui kit)
 * and a /login page. Refuses to run in production, because anyone can sign in as anyone.
 * @param {object} o
 * @param {typeof import('express')} o.express   the launcher's express (4 or 5)
 * @param {string} o.rootDir    the launcher's data folder (each accelerator gets a folder inside it)
 * @param {{ info: Function, warn: Function }} [o.log]
 * @param {object[]} [o.people]
 */
export function createDevLauncher({ express, rootDir, log = console, people = PEOPLE } = {}) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('The dev launcher signs anyone in as anyone, so it does not run with NODE_ENV=production.');
  }
  const { createShell, UI_DIR } = require('nooblyjs-core/src/shell');
  let shell = null;
  const stand = createStandaloneHost({ express, rootDir, people, persist: true, frame: (req, res, next) => shell.frame(req, res, next) });
  shell = createShell({ express, auth: stand.auth, can: stand.can, permissionsFor: stand.permissionsFor, log });

  const cookie = (name, value, { httpOnly = true } = {}) =>
    `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax${httpOnly ? '; HttpOnly' : ''}`;
  const safeNext = (next) => (typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : '/');

  /** Adds, in the order a launcher needs them: CSRF → /login and /logout → the shell's API → the /ui kit. */
  function mount(app) {
    app.use(stand.csrf);
    app.get('/login', (req, res) => {
      const next = safeNext(req.query.next);
      const rows = stand.people.map((p) => `
      <form method="post" action="/login?next=${encodeURIComponent(next)}">
        <input type="hidden" name="person" value="${escapeHtml(p.id)}">
        <button type="submit">${escapeHtml(p.name)}</button> ${escapeHtml(p.accessRole)} · ${escapeHtml(p.workRole)}
      </form>`).join('');
      res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Sign in · Noobly Cloud (development)</title></head>
    <body><h1>Sign in as</h1><p>Development sign-in. Anyone can be anyone here.</p>${rows}</body></html>`);
    });
    app.post('/login', express.urlencoded({ extended: false }), (req, res) => {
      const person = stand.people.find((p) => p.id === req.body?.person);
      if (!person) return res.status(400).type('text').send('Pick a person.');
      // The CSRF cookie is readable by the page, which sends it back as X-CSRF-Token (the kit's /ui/js/api.js does this).
      res.setHeader('Set-Cookie', [cookie(PERSON_COOKIE, person.id), cookie(CSRF_COOKIE, crypto.randomBytes(24).toString('base64url'), { httpOnly: false })]);
      res.redirect(303, safeNext(req.query.next));
    });
    app.post('/logout', (req, res) => {
      res.setHeader('Set-Cookie', [`${PERSON_COOKIE}=; Path=/; Max-Age=0`, `${CSRF_COOKIE}=; Path=/; Max-Age=0`]);
      res.redirect(303, '/login');
    });
    app.use(shell.router);
    app.use('/ui', express.static(UI_DIR, { index: false, redirect: false }));
  }

  return {
    stand,
    shell,
    mount,
    hostFor: (dataDir) => stand.hostFor(dataDir),
    /** Puts an accelerator whose register() succeeded on the rail. */
    add: (hosted, mountPath) => shell.add(hosted, { name: hosted.name, mountPath }),
  };
}
