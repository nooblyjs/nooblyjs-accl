/**
 * @fileoverview Safe template renderer (Architecture §10 "Inputs").
 *
 * A small Mustache subset, with no code execution:
 *   {{path.to.value}}     value (HTML-escaped in HTML bodies)
 *   {{#path}}…{{/path}}   section, rendered when the value is truthy
 *                         (arrays: once per item, with `.` / item fields in scope)
 *   {{^path}}…{{/path}}   inverted section, rendered when falsy / empty
 *
 * Only declared variables and the built-in roots may be referenced:
 * `customer`, `campaign`, `message`, `unsubscribeUrl`, `now`, plus the roots
 * of the template's declared variables (sendTransactional `data`).
 *
 * HTML bodies are sanitised on save: scripts, frames, embedded objects,
 * event-handler attributes and script URLs are removed.
 *
 * @author NooblyJS Team
 * @since 0.3.0
 */

'use strict';

const BUILTIN_ROOTS = Object.freeze(['customer', 'campaign', 'message', 'unsubscribeUrl', 'now']);
const TAG_RE = /\{\{\s*([#^/]?)\s*([A-Za-z_.][A-Za-z0-9_.]*)\s*\}\}/g;
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

class TemplateError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = 'TemplateError';
    this.details = details;
  }
}

/**
 * Parses a template string into a token tree.
 *
 * @param {string} source - Template text
 * @return {Array<Object>} Tokens: `{type:'text',value}`, `{type:'var',path}`, `{type:'section',path,inverted,children}`
 * @throws {TemplateError} On unbalanced sections
 */
function parse(source) {
  const root = [];
  const stack = [{ path: null, children: root }];
  let last = 0;
  TAG_RE.lastIndex = 0;
  let m;
  while ((m = TAG_RE.exec(source)) !== null) {
    const top = stack[stack.length - 1];
    if (m.index > last) top.children.push({ type: 'text', value: source.slice(last, m.index) });
    const [, kind, path] = m;
    if (kind === '#' || kind === '^') {
      const node = { type: 'section', path, inverted: kind === '^', children: [] };
      top.children.push(node);
      stack.push(node);
    } else if (kind === '/') {
      if (stack.length === 1 || top.path !== path) {
        throw new TemplateError(`Unexpected {{/${path}}}`, [{ path, message: 'closes a section that is not open' }]);
      }
      stack.pop();
    } else {
      top.children.push({ type: 'var', path });
    }
    last = TAG_RE.lastIndex;
  }
  if (stack.length > 1) {
    const open = stack[stack.length - 1].path;
    throw new TemplateError(`Section {{#${open}}} is not closed`, [{ path: open, message: 'is not closed' }]);
  }
  if (last < source.length) root.push({ type: 'text', value: source.slice(last) });
  return root;
}

/**
 * Lists the variable paths a template references (outside section scopes).
 *
 * @param {string} source - Template text
 * @return {string[]} Unique paths
 */
function referencedPaths(source) {
  const out = new Set();
  const walk = (nodes, inSection) => {
    for (const n of nodes) {
      if (n.type === 'var' && n.path !== '.' && !inSection) out.add(n.path);
      if (n.type === 'section') {
        out.add(n.path);
        // inside an array section, bare names may refer to item fields
        walk(n.children, true);
      }
    }
  };
  walk(parse(source || ''), false);
  return [...out];
}

/**
 * Checks that every referenced path is declared or built in.
 *
 * @param {Object<string, string>} parts - Named template strings (`subject`, `bodyHtml`, …)
 * @param {Array<{name: string}>} variables - Declared variables
 * @return {void}
 * @throws {TemplateError} Listing undeclared references and syntax errors
 */
function checkReferences(parts, variables = []) {
  const roots = new Set([...BUILTIN_ROOTS, ...variables.map((v) => v.name.split('.')[0])]);
  const errors = [];
  for (const [name, source] of Object.entries(parts)) {
    if (!source) continue;
    try {
      for (const p of referencedPaths(source)) {
        if (!roots.has(p.split('.')[0])) errors.push({ path: name, message: `uses undeclared variable '${p}'` });
      }
    } catch (err) {
      errors.push({ path: name, message: err.message });
    }
  }
  if (errors.length) throw new TemplateError('Template references are invalid', errors);
}

function lookup(scopes, path) {
  if (path === '.') return scopes[scopes.length - 1];
  const parts = path.split('.');
  for (let i = scopes.length - 1; i >= 0; i--) {
    const scope = scopes[i];
    if (scope !== null && typeof scope === 'object' && Object.prototype.hasOwnProperty.call(scope, parts[0])) {
      let cur = scope;
      for (const p of parts) {
        if (cur === null || cur === undefined) return undefined;
        cur = Object.prototype.hasOwnProperty.call(Object(cur), p) ? cur[p] : undefined;
      }
      return cur;
    }
  }
  return undefined;
}

function stringify(value) {
  if (value === undefined || value === null) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * Renders a template string.
 *
 * @param {string} source - Template text
 * @param {Object} context - Values
 * @param {Object} [opts]
 * @param {boolean} [opts.html=false] - HTML-escape values
 * @return {string} Rendered text
 */
function render(source, context, { html = false } = {}) {
  if (!source) return '';
  const nodes = parse(source);
  const esc = html ? (s) => s.replace(/[&<>"']/g, (c) => ESC[c]) : (s) => s;
  const walk = (list, scopes) => list.map((n) => {
    if (n.type === 'text') return n.value;
    const value = lookup(scopes, n.path);
    if (n.type === 'var') return esc(stringify(value));
    const truthy = Array.isArray(value) ? value.length > 0 : Boolean(value);
    if (n.inverted) return truthy ? '' : walk(n.children, scopes);
    if (!truthy) return '';
    if (Array.isArray(value)) return value.slice(0, 1000).map((item) => walk(n.children, [...scopes, item])).join('');
    return walk(n.children, typeof value === 'object' ? [...scopes, value] : scopes);
  }).join('');
  return walk(nodes, [context]);
}

/**
 * Removes active content from HTML: script/style-less dangerous elements,
 * event handlers and script URLs. Email-safe `<style>` blocks are kept.
 *
 * @param {string} html - Author HTML
 * @return {string} Sanitised HTML
 */
function sanitizeHtml(html) {
  if (!html) return html;
  let out = String(html);
  // whole elements whose content is active
  out = out.replace(/<(script|iframe|object|embed|applet|frame|frameset|noscript)\b[\s\S]*?<\/\1\s*>/gi, '');
  // stray / self-closing dangerous tags
  out = out.replace(/<\/?(script|iframe|object|embed|applet|frame|frameset|base|meta|link|form|input|button|textarea|select)\b[^>]*>/gi, '');
  // event-handler attributes
  out = out.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  // script URLs in href/src/action/background/style url()
  out = out.replace(/\s+(href|src|action|background|formaction|xlink:href)\s*=\s*("|')?\s*(javascript|vbscript|data:text\/html)[^"'>\s]*("|')?/gi, '');
  out = out.replace(/url\(\s*(['"]?)\s*(javascript|vbscript):[^)]*\)/gi, 'url()');
  out = out.replace(/expression\s*\(/gi, '');
  return out;
}

/**
 * Builds sample data from declared variables (for previews).
 *
 * @param {Array<{name: string, sample?: *}>} variables - Declared variables
 * @return {Object} Nested sample object
 */
function sampleData(variables = []) {
  const out = {};
  for (const v of variables) {
    const parts = v.name.split('.');
    let cur = out;
    parts.slice(0, -1).forEach((p) => { cur[p] = cur[p] && typeof cur[p] === 'object' ? cur[p] : {}; cur = cur[p]; });
    cur[parts[parts.length - 1]] = v.sample !== undefined ? v.sample : `[${v.name}]`;
  }
  return out;
}

/**
 * Checks transactional data against declared variables.
 *
 * @param {Array<{name: string, required?: boolean}>} variables - Declared variables
 * @param {Object} data - Payload
 * @return {Array<{path: string, message: string}>} Problems (empty when fine)
 */
function missingRequired(variables = [], data = {}) {
  return variables
    .filter((v) => v.required)
    .filter((v) => {
      const value = v.name.split('.').reduce((cur, k) => (cur == null ? undefined : cur[k]), data);
      return value === undefined || value === null || value === '';
    })
    .map((v) => ({ path: `data.${v.name}`, message: 'is required by the template' }));
}

module.exports = {
  BUILTIN_ROOTS, TemplateError, parse, referencedPaths, checkReferences, render, sanitizeHtml, sampleData, missingRequired
};
