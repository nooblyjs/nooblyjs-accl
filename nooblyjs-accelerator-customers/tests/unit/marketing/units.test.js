'use strict';

const r = require('../../../src/marketing/templating/renderer');
const { TokenSigner, TrackingUrls, withUtm, rewriteLinks, addOpenPixel, hashIp, isMachineOpen } = require('../../../src/marketing/tracking');
const { ChannelAdapter, ConsoleAdapter, SmtpAdapter, adapters } = require('../../../src/marketing/channels');
const { sanitizeError } = require('../../../src/marketing/pipeline/dispatcher');
const crypto = require('crypto');

describe('renderer', () => {
  test('variables, escaping, sections and inverted sections', () => {
    const ctx = { customer: { givenName: '<Ada>' }, order: { items: [{ name: 'Hat', qty: 2 }, { name: 'Scarf', qty: 1 }], vip: false, notes: [] }, n: 0 };
    expect(r.render('Hi {{customer.givenName}}', ctx)).toBe('Hi <Ada>');
    expect(r.render('Hi {{ customer.givenName }}', ctx, { html: true })).toBe('Hi &lt;Ada&gt;');
    expect(r.render('{{#order.items}}{{qty}}×{{name}};{{/order.items}}', ctx)).toBe('2×Hat;1×Scarf;');
    expect(r.render('{{#order.vip}}VIP{{/order.vip}}{{^order.vip}}regular{{/order.vip}}', ctx)).toBe('regular');
    expect(r.render('{{^order.notes}}none{{/order.notes}}', ctx)).toBe('none');
    expect(r.render('{{#customer}}{{givenName}}{{/customer}}', ctx)).toBe('<Ada>');
    expect(r.render('{{#order.items}}{{.}}{{/order.items}}', { order: { items: ['a', 'b'] } })).toBe('ab');
    expect(r.render('{{missing.deep}}|{{n}}|{{order.items}}', ctx)).toBe('|0|[{"name":"Hat","qty":2},{"name":"Scarf","qty":1}]');
    expect(r.render('{{d}}', { d: new Date('2026-01-01T00:00:00Z') })).toBe('2026-01-01T00:00:00.000Z');
    expect(r.render('{{constructor.name}}{{__proto__}}', {})).toBe('');
    expect(r.render('', ctx)).toBe('');
    expect(r.render('{{#flag}}yes{{/flag}}', { flag: 'x' })).toBe('yes');
  });

  test('parse errors and reference checks', () => {
    expect(() => r.parse('{{#a}}x')).toThrow(/not closed/);
    expect(() => r.parse('x{{/a}}')).toThrow(/Unexpected/);
    expect(() => r.parse('{{#a}}{{/b}}')).toThrow(/Unexpected/);
    expect(r.referencedPaths('{{a.b}} {{#c}}{{d}}{{/c}} {{.}}').sort()).toEqual(['a.b', 'c']);
    expect(() => r.checkReferences({ subject: '{{customer.givenName}} {{order.number}}', body: '' }, [{ name: 'order.number' }])).not.toThrow();
    let err;
    try { r.checkReferences({ subject: '{{secret}}', bodyHtml: '{{#x}}' }, []); } catch (e) { err = e; }
    expect(err.details).toEqual([{ path: 'subject', message: "uses undeclared variable 'secret'" }, { path: 'bodyHtml', message: 'Section {{#x}} is not closed' }]);
  });

  test('sanitizeHtml removes active content but keeps email styling', () => {
    const dirty = '<style>p{color:red}</style><p onclick="x()" style="background:url(javascript:alert(1))">Hi</p><script>alert(1)</script><iframe src="x"></iframe><a href="javascript:alert(1)">x</a><a href=\'https://ok.example\'>ok</a><img src="data:text/html,x"><form action="x"><input></form><meta http-equiv="refresh"><object data="x"></object>';
    const clean = r.sanitizeHtml(dirty);
    expect(clean).toContain('<style>p{color:red}</style>');
    expect(clean).toContain("href='https://ok.example'");
    for (const bad of ['<script', 'onclick', 'javascript:', '<iframe', 'data:text/html', '<form', '<input', '<meta', '<object']) expect(clean).not.toContain(bad);
    expect(r.sanitizeHtml('')).toBe('');
    expect(r.sanitizeHtml('<p style="width:expression(alert(1))">')).not.toMatch(/expression\(/);
  });

  test('sample data and required variables', () => {
    expect(r.sampleData([{ name: 'order.number', sample: 'O-1' }, { name: 'order.total' }, { name: 'name', sample: 'x' }]))
      .toEqual({ order: { number: 'O-1', total: '[order.total]' }, name: 'x' });
    expect(r.missingRequired([{ name: 'order.number', required: true }, { name: 'x', required: false }, { name: 'y', required: true }], { order: { number: '' }, y: 0 }))
      .toEqual([{ path: 'data.order.number', message: 'is required by the template' }]);
    expect(r.missingRequired(undefined, undefined)).toEqual([]);
  });
});

describe('tracking', () => {
  const signer = new TokenSigner('0123456789abcdef0123');

  test('tokens round-trip and reject tampering, wrong kinds and expiry', () => {
    const token = signer.sign({ k: 'o', n: 'default', c: 'abc' });
    expect(signer.verify(token, 'o')).toEqual({ k: 'o', n: 'default', c: 'abc' });
    expect(signer.verify(token, 'c')).toBeNull();
    const [body, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ k: 'o', n: 'default', c: 'other' })).toString('base64url');
    expect(signer.verify(`${forged}.${sig}`)).toBeNull();
    expect(signer.verify(`${body}.${sig.slice(0, -1)}A`)).toBeNull();
    expect(signer.verify(`${body}`)).toBeNull();
    expect(signer.verify(42)).toBeNull();
    expect(signer.verify('x'.repeat(3000))).toBeNull();
    expect(signer.verify(signer.sign({ k: 'u', x: Date.now() - 1 }))).toBeNull();
    expect(new TokenSigner('another-secret-12345').verify(token)).toBeNull();
    const notJson = `${Buffer.from('nope').toString('base64url')}`;
    expect(signer.verify(`${notJson}.${signer.mac_(notJson)}`)).toBeNull();
    const scalar = Buffer.from('5').toString('base64url');
    expect(signer.verify(`${scalar}.${signer.mac_(scalar)}`)).toBeNull();
    expect(() => new TokenSigner('short')).toThrow(/at least 16/);
  });

  test('URLs, UTM, link rewriting and pixel', async () => {
    const urls = new TrackingUrls({ signer, publicBase: 'https://x.example/m/p/' });
    expect(urls.open('t', 'c1')).toMatch(/^https:\/\/x\.example\/m\/p\/o\/.+\.gif$/);
    expect(urls.unsubscribe('t', 'c1')).toMatch(/\/u\//);
    expect(withUtm('https://a.example/x?utm_source=keep', { source: 'news', medium: 'email', campaign: '' })).toBe('https://a.example/x?utm_source=keep&utm_medium=email');
    expect(withUtm('not a url', { source: 'x' })).toBe('not a url');
    expect(withUtm('https://a.example/', undefined)).toBe('https://a.example/');
    const registered = [];
    const out = await rewriteLinks({
      bodyHtml: '<a href="https://a.example/sale?x=1&amp;y=2">Sale</a> <a class="b" href=\'https://a.example/sale?x=1&y=2\'>again</a> <a href="https://x.example/m/p/u/tok">unsub</a> <a href="mailto:a@b.c">mail</a>',
      bodyText: 'Go to https://a.example/sale?x=1&y=2 now (or https://b.example/).'
    }, {
      skipPrefix: 'https://x.example/m/p',
      utm: { source: 'news' },
      register: async (url, position) => { registered.push([url, position]); return `https://t.example/c/${position}?a=1&b=2`; }
    });
    expect(registered).toEqual([['https://a.example/sale?x=1&y=2&utm_source=news', 0], ['https://b.example/?utm_source=news', 1]]);
    expect(out.bodyHtml).toBe('<a href="https://t.example/c/0?a=1&amp;b=2">Sale</a> <a class="b" href=\'https://t.example/c/0?a=1&amp;b=2\'>again</a> <a href="https://x.example/m/p/u/tok">unsub</a> <a href="mailto:a@b.c">mail</a>');
    expect(out.bodyText).toBe('Go to https://t.example/c/0?a=1&b=2 now (or https://t.example/c/1?a=1&b=2).');
    expect(addOpenPixel('<html><body>x</body></html>', 'https://p/o.gif')).toMatch(/<img src="https:\/\/p\/o\.gif"[^>]*><\/body>/);
    expect(addOpenPixel('x', 'https://p/o.gif')).toMatch(/^x<img/);
    expect(hashIp('1.2.3.4', 's')).toHaveLength(32);
    expect(hashIp('', 's')).toBeNull();
    expect(isMachineOpen('Mozilla/5.0 (Windows NT 10.0; Win64; x64) via ggpht.com GoogleImageProxy')).toBe(true);
    expect(isMachineOpen('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe(false);
    expect(isMachineOpen(undefined)).toBe(false);
  });
});

describe('channel adapters', () => {
  test('base adapter: send is abstract; webhook signature and parsing', async () => {
    const a = new ChannelAdapter({ name: 'x', webhookSecret: 'whsec' });
    await expect(a.send({})).rejects.toThrow(/not implemented/);
    const body = { events: [{ providerMessageId: 'p1', type: 'delivered' }, { providerMessageId: 'p2', type: 'bogus' }, { type: 'open' }, null, { providerMessageId: 'p3', type: 'click', url: 'https://x', occurredAt: '2026-01-01T00:00:00Z', error: 5 }] };
    const raw = JSON.stringify(body);
    const sig = `sha256=${crypto.createHmac('sha256', 'whsec').update(raw).digest('hex')}`;
    expect(a.verifySignature({ headers: { 'x-cx-signature': sig }, rawBody: raw })).toBe(true);
    expect(a.verifySignature({ headers: { 'x-cx-signature': sig }, body })).toBe(true);
    expect(a.verifySignature({ headers: { 'x-cx-signature': 'sha256=00' }, rawBody: raw })).toBe(false);
    expect(a.verifySignature({ headers: {}, rawBody: raw })).toBe(false);
    expect(new ChannelAdapter().verifySignature({ headers: {} })).toBe(false);
    const events = a.parseWebhook({ body });
    expect(events.map((e) => e.providerMessageId)).toEqual(['p1', 'p3']);
    expect(events[1]).toMatchObject({ occurredAt: '2026-01-01T00:00:00.000Z', url: 'https://x', error: undefined });
    expect(a.parseWebhook({})).toEqual([]);
  });

  test('console adapter keeps a capped outbox and can simulate failures', async () => {
    const logger = { info: jest.fn() };
    const c = adapters.console({ logger, outboxSize: 2, fail: (m) => m.to === 'fail@example.com' });
    for (const to of ['a', 'b', 'c']) await c.send({ channel: 'email', to, communicationId: to });
    expect(c.outbox.map((m) => m.to)).toEqual(['b', 'c']);
    expect(c.outbox[0].providerMessageId).toMatch(/^console-/);
    await expect(c.send({ to: 'fail@example.com' })).rejects.toMatchObject({ code: 'simulated_failure' });
    expect(logger.info).toHaveBeenCalledTimes(3);
    c.clear();
    expect(c.outbox).toEqual([]);
    expect(new ConsoleAdapter().name).toBe('console');
  });

  test('smtp adapter maps to sendMail', async () => {
    expect(() => new SmtpAdapter({})).toThrow(/transport/);
    const sendMail = jest.fn().mockResolvedValue({ messageId: '<abc@mail>' });
    const smtp = adapters.smtp({ transport: { sendMail } });
    const res = await smtp.send({ channel: 'email', to: 'a@b.c', from: { address: 'n@x.com', name: 'News "Team"' }, subject: 's', html: '<p>', text: 't', headers: { X: '1' }, communicationId: 'c1' });
    expect(res).toEqual({ providerMessageId: 'abc@mail' });
    expect(sendMail.mock.calls[0][0]).toMatchObject({ from: '"News Team" <n@x.com>', to: 'a@b.c', headers: { X: '1' } });
    sendMail.mockResolvedValueOnce({});
    expect(await smtp.send({ channel: 'email', to: 'a', from: { address: 'n@x.com' }, communicationId: 'c2' })).toEqual({ providerMessageId: 'smtp-c2' });
    expect(sendMail.mock.calls[1][0].from).toBe('n@x.com');
    await smtp.send({ channel: 'email', to: 'a', communicationId: 'c3' });
    expect(sendMail.mock.calls[2][0].from).toBeUndefined();
    await expect(smtp.send({ channel: 'sms' })).rejects.toThrow(/only sends email/);
  });

  test('provider errors are reduced to a code', () => {
    expect(sanitizeError({ code: 'EENVELOPE' })).toBe('EENVELOPE');
    expect(sanitizeError({ responseCode: 550 })).toBe('550');
    expect(sanitizeError(new Error('Invalid recipient a@b.c'))).toBe('Error');
    expect(sanitizeError(null)).toBe('send_failed');
    expect(sanitizeError({ code: '@@@' })).toBe('send_failed');
  });
});
