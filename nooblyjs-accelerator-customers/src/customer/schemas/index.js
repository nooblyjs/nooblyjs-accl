/**
 * @fileoverview Customer-domain schemas (Architecture §5.2): Customer,
 * Organization, Address, Phone, Email, Identity, ConsentRecord, Note.
 *
 * @author NooblyJS Team
 * @since 0.2.0
 */

'use strict';

const { defineSchema } = require('../../shared/schema');

const CUSTOMER_STATUSES = Object.freeze(['active', 'inactive', 'blocked', 'merged', 'erased']);
const LIFECYCLE_STAGES = Object.freeze(['subscriber', 'lead', 'mql', 'sql', 'customer', 'advocate', 'churned']);
const PARTY_TYPES = Object.freeze(['customer', 'organization']);
const CONSENT_PURPOSES = Object.freeze(['marketing', 'profiling', 'analytics', 'third_party_sharing', 'service_messages']);
const CONSENT_CHANNELS = Object.freeze(['email', 'sms', 'voice', 'push', 'whatsapp', 'post', 'any']);
const CONSENT_STATUSES = Object.freeze(['opt_in', 'opt_out', 'pending']);
const LAWFUL_BASES = Object.freeze(['consent', 'legitimate_interest', 'contract', 'legal_obligation', 'vital_interest', 'public_task']);
const CONSENT_SOURCES = Object.freeze(['form', 'api', 'agent', 'import', 'unsubscribe_link', 'preference_centre']);

const NAMESPACE_RE = /^[a-z][a-z0-9_.-]{0,63}$/;
const ISO_DATE_HINT = 'YYYY-MM-DD';

const partyFields = {
  partyType: { type: 'enum', values: PARTY_TYPES, required: true, description: 'Owner type' },
  partyId: { type: 'ref', required: true, description: 'Owner id' }
};

const customer = defineSchema({
  name: 'customer',
  description: 'An individual person (Salesforce Person Account / schema.org Person)',
  numberPrefix: 'CUS',
  fields: {
    type: { type: 'enum', values: ['individual'], default: 'individual' },
    status: { type: 'enum', values: CUSTOMER_STATUSES, readOnly: true, description: 'Changed through the :status action' },
    lifecycleStage: { type: 'enum', values: LIFECYCLE_STAGES, default: 'subscriber' },
    name: {
      type: 'object',
      required: true,
      pii: true,
      fields: {
        prefix: { type: 'string', maxLength: 20 },
        given: { type: 'string', maxLength: 100 },
        middle: { type: 'string', maxLength: 100 },
        family: { type: 'string', maxLength: 100 },
        suffix: { type: 'string', maxLength: 20 },
        preferred: { type: 'string', maxLength: 100 },
        full: { type: 'string', maxLength: 400, description: 'Derived from the other parts unless given' }
      }
    },
    dateOfBirth: { type: 'date', pii: true, description: ISO_DATE_HINT },
    gender: { type: 'string', maxLength: 40, pii: true },
    language: { type: 'string', maxLength: 35, description: 'BCP-47' },
    locale: { type: 'string', maxLength: 35, description: 'BCP-47' },
    timezone: { type: 'string', maxLength: 64, description: 'IANA time zone' },
    currency: { type: 'string', maxLength: 3, description: 'ISO 4217' },
    primaryEmailId: { type: 'ref', readOnly: true },
    primaryPhoneId: { type: 'ref', readOnly: true },
    primaryAddressId: { type: 'ref', readOnly: true },
    ownerUserId: { type: 'ref', description: 'Account owner / relationship manager' },
    organizationId: { type: 'ref', description: 'Employer or account the person belongs to' },
    source: {
      type: 'object',
      fields: {
        channel: { type: 'string', maxLength: 50 },
        campaignId: { type: 'string', maxLength: 100 },
        system: { type: 'string', maxLength: 50 },
        capturedAt: { type: 'datetime' }
      }
    },
    householdId: { type: 'ref' },
    mergedInto: { type: 'ref', readOnly: true },
    traits: { type: 'json', readOnly: true, description: 'Computed traits cache' }
  },
  indexes: [
    { name: 'number', fields: ['number'], unique: true },
    { name: 'status', fields: ['status'] },
    { name: 'lifecycleStage', fields: ['lifecycleStage'] },
    { name: 'organization', fields: ['organizationId'] }
  ],
  search: ['number', 'name.full', 'name.preferred']
});

const organization = defineSchema({
  name: 'organization',
  description: 'A business account (Salesforce Account / schema.org Organization)',
  numberPrefix: 'ORG',
  fields: {
    name: { type: 'string', required: true, maxLength: 200 },
    legalName: { type: 'string', maxLength: 300 },
    registrationNumber: { type: 'string', maxLength: 100 },
    taxId: { type: 'string', maxLength: 100 },
    industry: { type: 'string', maxLength: 100, description: 'NAICS / SIC code or label' },
    employeeBand: { type: 'enum', values: ['1-9', '10-49', '50-249', '250-999', '1000-4999', '5000+'] },
    annualRevenueBand: { type: 'string', maxLength: 50 },
    website: { type: 'string', maxLength: 300, pattern: /^https?:\/\/[^\s]+$/ },
    parentOrganizationId: { type: 'ref' },
    status: { type: 'enum', values: ['active', 'inactive'], default: 'active' },
    ownerUserId: { type: 'ref' },
    primaryEmailId: { type: 'ref', readOnly: true },
    primaryPhoneId: { type: 'ref', readOnly: true },
    primaryAddressId: { type: 'ref', readOnly: true }
  },
  indexes: [
    { name: 'number', fields: ['number'], unique: true },
    { name: 'status', fields: ['status'] },
    { name: 'parent', fields: ['parentOrganizationId'] }
  ],
  search: ['number', 'name', 'legalName']
});

const address = defineSchema({
  name: 'address',
  parentField: 'partyId',
  plural: 'addresses',
  description: 'A postal address (schema.org PostalAddress)',
  fields: {
    ...partyFields,
    type: { type: 'enum', values: ['home', 'work', 'billing', 'shipping', 'postal', 'other'], default: 'home' },
    isPrimary: { type: 'boolean', default: false },
    label: { type: 'string', maxLength: 100 },
    line1: { type: 'string', required: true, maxLength: 200, pii: true },
    line2: { type: 'string', maxLength: 200, pii: true },
    line3: { type: 'string', maxLength: 200, pii: true },
    locality: { type: 'string', maxLength: 100, description: 'City / town' },
    region: { type: 'string', maxLength: 100, description: 'State / province' },
    postalCode: { type: 'string', maxLength: 20, pii: true },
    countryCode: { type: 'string', required: true, uppercase: true, maxLength: 2, description: 'ISO 3166-1 alpha-2' },
    geo: { type: 'object', pii: true, fields: { lat: { type: 'number', min: -90, max: 90 }, lng: { type: 'number', min: -180, max: 180 } } },
    verification: {
      type: 'object',
      fields: {
        status: { type: 'enum', values: ['unverified', 'verified', 'invalid'] },
        provider: { type: 'string', maxLength: 50 },
        verifiedAt: { type: 'datetime' }
      }
    },
    validFrom: { type: 'date' },
    validTo: { type: 'date' }
  },
  indexes: [{ name: 'party', fields: ['partyId'] }]
});

const phone = defineSchema({
  name: 'phone',
  parentField: 'partyId',
  description: 'A phone number, normalised to E.164',
  fields: {
    ...partyFields,
    type: { type: 'enum', values: ['mobile', 'home', 'work', 'fax', 'other'], default: 'mobile' },
    isPrimary: { type: 'boolean', default: false },
    raw: { type: 'string', required: true, maxLength: 40, pii: true, description: 'As entered' },
    e164: { type: 'string', readOnly: true, pii: true },
    countryCode: { type: 'string', uppercase: true, maxLength: 2, description: 'Default country for national-format numbers' },
    extension: { type: 'string', maxLength: 10 },
    verified: { type: 'boolean', default: false },
    verifiedAt: { type: 'datetime' },
    capabilities: { type: 'object', fields: { sms: { type: 'boolean' }, voice: { type: 'boolean' }, whatsapp: { type: 'boolean' } } },
    status: { type: 'enum', values: ['active', 'invalid', 'disconnected'], default: 'active' },
    validFrom: { type: 'date' },
    validTo: { type: 'date' }
  },
  indexes: [{ name: 'party', fields: ['partyId'] }, { name: 'e164', fields: ['e164'] }],
  search: ['e164']
});

const email = defineSchema({
  name: 'email',
  parentField: 'partyId',
  description: 'An email address, stored lower-cased',
  fields: {
    ...partyFields,
    type: { type: 'enum', values: ['personal', 'work', 'other'], default: 'personal' },
    isPrimary: { type: 'boolean', default: false },
    address: { type: 'string', required: true, maxLength: 254, lowercase: true, pii: true },
    verified: { type: 'boolean', default: false },
    verifiedAt: { type: 'datetime' },
    deliverability: { type: 'enum', values: ['ok', 'soft_bounce', 'hard_bounce', 'complaint'], default: 'ok' },
    lastBounceAt: { type: 'datetime' },
    validFrom: { type: 'date' },
    validTo: { type: 'date' }
  },
  indexes: [{ name: 'party', fields: ['partyId'] }, { name: 'address', fields: ['address'] }],
  search: ['address']
});

const identity = defineSchema({
  name: 'identity',
  parentField: 'customerId',
  plural: 'identities',
  description: 'An external identifier for a customer (identity graph)',
  fields: {
    customerId: { type: 'ref', required: true },
    namespace: { type: 'string', required: true, lowercase: true, pattern: NAMESPACE_RE, description: 'e.g. commerce, loyalty, crm, device' },
    value: { type: 'string', required: true, maxLength: 256, pii: true },
    source: { type: 'string', maxLength: 50 },
    firstSeenAt: { type: 'datetime', readOnly: true },
    lastSeenAt: { type: 'datetime', readOnly: true }
  },
  indexes: [
    { name: 'key', fields: ['namespace', 'value'], unique: true },
    { name: 'customer', fields: ['customerId'] }
  ],
  search: ['value']
});

const consent = defineSchema({
  name: 'consent',
  parentField: 'customerId',
  description: 'Append-only consent ledger entry (GDPR Art. 7)',
  appendOnly: true,
  fields: {
    customerId: { type: 'ref', required: true },
    purpose: { type: 'enum', values: CONSENT_PURPOSES, required: true },
    channel: { type: 'enum', values: CONSENT_CHANNELS, required: true },
    topicId: { type: 'string', maxLength: 100 },
    status: { type: 'enum', values: CONSENT_STATUSES, required: true },
    lawfulBasis: { type: 'enum', values: LAWFUL_BASES, default: 'consent' },
    source: { type: 'enum', values: CONSENT_SOURCES, default: 'api' },
    evidence: {
      type: 'object',
      fields: {
        ip: { type: 'string', maxLength: 64, pii: true },
        userAgent: { type: 'string', maxLength: 500, pii: true },
        formId: { type: 'string', maxLength: 100 },
        communicationId: { type: 'string', maxLength: 100 },
        text: { type: 'string', maxLength: 2000 },
        textVersion: { type: 'string', maxLength: 50 }
      }
    },
    capturedAt: { type: 'datetime' },
    expiresAt: { type: 'datetime' }
  },
  indexes: [{ name: 'customer', fields: ['customerId'] }]
});

const note = defineSchema({
  name: 'note',
  parentField: 'subjectId',
  description: 'A free-text note on a customer or organization',
  fields: {
    subjectType: { type: 'enum', values: PARTY_TYPES, required: true },
    subjectId: { type: 'ref', required: true },
    body: { type: 'string', required: true, maxLength: 10000, trim: false, pii: true },
    visibility: { type: 'enum', values: ['internal', 'team'], default: 'internal' },
    pinned: { type: 'boolean', default: false }
  },
  indexes: [{ name: 'subject', fields: ['subjectId'] }]
});

module.exports = {
  customer, organization, address, phone, email, identity, consent, note,
  CUSTOMER_STATUSES, LIFECYCLE_STAGES, PARTY_TYPES, CONSENT_PURPOSES, CONSENT_CHANNELS, CONSENT_STATUSES,
  LAWFUL_BASES, CONSENT_SOURCES, NAMESPACE_RE
};
