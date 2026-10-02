/**
 * @fileoverview Demo data generator (PRD PL-16).
 *
 * Deterministic (seeded PRNG) so tests and demos see the same data: by
 * default 500 customers and 50 organizations with mixed emails, phones,
 * addresses, identities and consent records. Runs only into an empty
 * customer container unless `force` is set.
 *
 * @author NooblyJS Team
 * @since 0.2.0
 */

'use strict';

const { systemContext } = require('../shared/context');

const GIVEN = ['Ada', 'Thabo', 'Lerato', 'Johan', 'Amara', 'Liam', 'Noah', 'Olivia', 'Zanele', 'Sipho', 'Emma', 'Mia', 'Lucas', 'Aisha', 'Pieter', 'Naledi', 'Grace', 'Kwame', 'Sofia', 'Yusuf', 'Hannah', 'Ethan', 'Chloe', 'Mandla', 'Isla', 'Ravi', 'Priya', 'Daniel', 'Lindiwe', 'Oscar'];
const FAMILY = ['Lovelace', 'Nkosi', 'Dlamini', 'van der Merwe', 'Okafor', 'Smith', 'Naidoo', 'Botha', 'Mokoena', 'Jones', 'Khumalo', 'Williams', 'Pillay', 'Brown', 'Mahlangu', 'Taylor', 'Ndlovu', 'Pretorius', 'Mensah', 'Fischer', 'Martin', 'Kruger', 'Patel', 'Zulu', 'Dubois', 'Molefe', 'Cohen', 'Mthembu', 'Rossi', 'Steyn'];
const ORG_WORDS = ['Acme', 'Baobab', 'Cape', 'Delta', 'Ember', 'Fynbos', 'Granite', 'Harbour', 'Indigo', 'Jacaranda', 'Kestrel', 'Lumen', 'Marula', 'Nimbus', 'Orbit', 'Protea', 'Quartz', 'Riverside', 'Summit', 'Tidal'];
const ORG_SUFFIX = ['Holdings', 'Logistics', 'Retail', 'Labs', 'Foods', 'Consulting', 'Energy', 'Media', 'Health', 'Finance'];
const INDUSTRIES = ['Retail', 'Logistics', 'Software', 'Food & Beverage', 'Consulting', 'Energy', 'Media', 'Healthcare', 'Financial services', 'Manufacturing'];
const LOCATIONS = [
  { countryCode: 'ZA', locality: 'Cape Town', region: 'Western Cape', postal: '8001', dial: '+27', mobile: '82', tz: 'Africa/Johannesburg', currency: 'ZAR', language: 'en-ZA' },
  { countryCode: 'ZA', locality: 'Johannesburg', region: 'Gauteng', postal: '2001', dial: '+27', mobile: '83', tz: 'Africa/Johannesburg', currency: 'ZAR', language: 'en-ZA' },
  { countryCode: 'ZA', locality: 'Durban', region: 'KwaZulu-Natal', postal: '4001', dial: '+27', mobile: '72', tz: 'Africa/Johannesburg', currency: 'ZAR', language: 'zu-ZA' },
  { countryCode: 'NA', locality: 'Windhoek', region: 'Khomas', postal: '10005', dial: '+264', mobile: '81', tz: 'Africa/Windhoek', currency: 'NAD', language: 'en-NA' },
  { countryCode: 'GB', locality: 'London', region: 'England', postal: 'EC1A 1BB', dial: '+44', mobile: '7700', tz: 'Europe/London', currency: 'GBP', language: 'en-GB' },
  { countryCode: 'US', locality: 'Seattle', region: 'WA', postal: '98101', dial: '+1', mobile: '206', tz: 'America/Los_Angeles', currency: 'USD', language: 'en-US' },
  { countryCode: 'DE', locality: 'Berlin', region: 'Berlin', postal: '10115', dial: '+49', mobile: '151', tz: 'Europe/Berlin', currency: 'EUR', language: 'de-DE' }
];
const STREETS = ['Long Street', 'Main Road', 'Church Street', 'Victoria Avenue', 'Park Lane', 'Station Road', 'Market Street', 'Beach Road'];
const STAGES = ['subscriber', 'lead', 'mql', 'sql', 'customer', 'customer', 'customer', 'advocate', 'churned'];
const DOMAINS = ['example.com', 'example.org', 'mail.example.net'];

/**
 * Mulberry32 PRNG.
 *
 * @param {number} seed - 32-bit seed
 * @return {function(): number} Generator of floats in [0, 1)
 */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Seeds demo customers and organizations.
 *
 * @param {Object} services - Customer-module services
 * @param {Object} [opts]
 * @param {number} [opts.customers=500] - Customers to create
 * @param {number} [opts.organizations=50] - Organizations to create
 * @param {number} [opts.seed=42] - PRNG seed
 * @param {boolean} [opts.force=false] - Seed even when customers exist
 * @param {Object} [opts.ctx] - Context (default: system context `seed`)
 * @return {Promise<{customers: number, organizations: number, skipped: boolean}>} Counts
 */
async function seedCustomers(services, { customers = 500, organizations = 50, seed = 42, force = false, ctx = systemContext('seed') } = {}) {
  if (!force && (await services.customers.repo.count(ctx)) > 0) return { customers: 0, organizations: 0, skipped: true };
  const rand = prng(seed);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const digits = (n) => Array.from({ length: n }, () => Math.floor(rand() * 10)).join('');

  const orgIds = [];
  for (let i = 0; i < organizations; i++) {
    const name = `${ORG_WORDS[i % ORG_WORDS.length]} ${ORG_SUFFIX[Math.floor(i / ORG_WORDS.length) % ORG_SUFFIX.length]}`;
    const loc = pick(LOCATIONS);
    const org = await services.organizations.create({
      name,
      legalName: `${name} (Pty) Ltd`,
      registrationNumber: `${2000 + Math.floor(rand() * 25)}/${digits(6)}/07`,
      industry: pick(INDUSTRIES),
      employeeBand: pick(['1-9', '10-49', '50-249', '250-999', '1000-4999']),
      website: `https://www.${name.toLowerCase().replace(/[^a-z]+/g, '')}.example.com`
    }, ctx);
    const slug = name.toLowerCase().replace(/[^a-z]+/g, '');
    await services.contactPoints.email.add('organization', org.id, { address: `info@${slug}.example.com`, type: 'work' }, ctx);
    await services.contactPoints.phone.add('organization', org.id, { raw: `${loc.dial} ${loc.mobile} ${digits(7)}`, type: 'work' }, ctx);
    await services.contactPoints.address.add('organization', org.id, {
      type: 'work', line1: `${1 + Math.floor(rand() * 200)} ${pick(STREETS)}`, locality: loc.locality, region: loc.region, postalCode: loc.postal, countryCode: loc.countryCode
    }, ctx);
    orgIds.push(org.id);
  }

  const now = Date.now();
  for (let i = 0; i < customers; i++) {
    const given = pick(GIVEN);
    const family = pick(FAMILY);
    const loc = pick(LOCATIONS);
    const handle = `${given}.${family}`.toLowerCase().replace(/[^a-z.]+/g, '');
    const emails = [{ address: `${handle}${i}@${pick(DOMAINS)}`, type: 'personal' }];
    if (rand() < 0.25) emails.push({ address: `${handle.split('.')[0]}${i}@work.example.com`, type: 'work' });
    const phones = rand() < 0.85 ? [{ raw: `${loc.dial} ${loc.mobile} ${digits(7)}`, type: 'mobile', capabilities: { sms: true, voice: true, whatsapp: rand() < 0.6 } }] : [];
    const addresses = rand() < 0.7 ? [{
      type: pick(['home', 'home', 'billing', 'shipping']),
      line1: `${1 + Math.floor(rand() * 300)} ${pick(STREETS)}`,
      locality: loc.locality, region: loc.region, postalCode: loc.postal, countryCode: loc.countryCode
    }] : [];
    const identities = [{ namespace: 'commerce', value: `C${100000 + i}`, source: 'seed' }];
    if (rand() < 0.4) identities.push({ namespace: 'loyalty', value: `L-${String(70000000 + i)}`, source: 'seed' });
    const daysAgo = Math.floor(rand() * 365);
    const capturedAt = new Date(now - daysAgo * 86400000).toISOString();
    const consents = [{ purpose: 'marketing', channel: 'email', status: rand() < 0.7 ? 'opt_in' : 'opt_out', source: pick(['form', 'import', 'api']), capturedAt }];
    if (phones.length && rand() < 0.5) consents.push({ purpose: 'marketing', channel: 'sms', status: rand() < 0.6 ? 'opt_in' : 'opt_out', source: 'form', capturedAt });

    const customer = await services.customers.create({
      name: { given, family },
      lifecycleStage: pick(STAGES),
      language: loc.language,
      timezone: loc.tz,
      currency: loc.currency,
      dateOfBirth: rand() < 0.5 ? `${1950 + Math.floor(rand() * 55)}-${String(1 + Math.floor(rand() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rand() * 28)).padStart(2, '0')}` : undefined,
      organizationId: orgIds.length && rand() < 0.3 ? pick(orgIds) : undefined,
      source: { channel: pick(['web', 'store', 'referral', 'event']), system: 'seed', capturedAt },
      tags: rand() < 0.1 ? ['vip'] : [],
      emails, phones, addresses, identities, consents
    }, ctx);
    if (rand() < 0.08) await services.customers.setStatus(customer.id, pick(['inactive', 'blocked']), ctx, { reason: 'seed' });
    if (rand() < 0.15) {
      await services.notes.add('customer', customer.id, { body: pick(['Prefers email contact.', 'Asked about delivery times.', 'VIP: handle with care.', 'Called about a refund.']), pinned: rand() < 0.3 }, ctx);
    }
  }
  return { customers, organizations, skipped: false };
}

module.exports = { seedCustomers, prng };
