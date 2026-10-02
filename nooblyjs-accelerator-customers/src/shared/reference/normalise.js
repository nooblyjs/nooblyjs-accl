/**
 * @fileoverview Contact-point normalisation (PRD CU-3): phone → E.164,
 * email → lower case, locale/timezone/currency checks.
 *
 * @author NooblyJS Team
 * @since 0.2.0
 */

'use strict';

const { COUNTRIES, KEEPS_TRUNK_ZERO, isCountryCode, countryForE164 } = require('./countries');
const { validationError } = require('../errors');

const EMAIL_RE = /^[^\s@"(),:;<>[\\\]]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const EXTENSION_RE = /\s*(?:ext\.?|extension|x|#)\s*(\d{1,6})\s*$/i;

/**
 * Normalises a phone number to E.164.
 *
 * @param {string} raw - As entered (`082 123 4567`, `+27 82 123 4567`, `0027…`, `… ext 12`)
 * @param {string} [defaultCountry] - ISO alpha-2 used for national-format numbers
 * @return {{e164: string, countryCode: string, extension: ?string}} Normalised number
 * @throws {ClientError} 422 when the number cannot be normalised
 */
function normalisePhone(raw, defaultCountry) {
  const fail = (message) => validationError(message, [{ path: 'number', message }]);
  if (typeof raw !== 'string' || !raw.trim()) throw fail('Phone number is required');
  let text = raw.trim();
  let extension = null;
  const ext = EXTENSION_RE.exec(text);
  if (ext) {
    extension = ext[1];
    text = text.slice(0, ext.index);
  }
  if (/[^\d\s()+.\-/]/.test(text)) throw fail('Phone number contains invalid characters');
  let digits = text.replace(/[^\d+]/g, '');
  if (digits.indexOf('+') > 0) throw fail('Phone number has a misplaced +');

  let e164;
  let country = defaultCountry ? String(defaultCountry).toUpperCase() : null;
  if (digits.startsWith('+')) {
    e164 = `+${digits.slice(1)}`;
  } else if (digits.startsWith('00')) {
    e164 = `+${digits.slice(2)}`;
  } else {
    if (!country || !isCountryCode(country)) {
      throw fail('Phone number needs an international prefix (+…) or a country');
    }
    const { dial } = COUNTRIES[country];
    if (!KEEPS_TRUNK_ZERO.has(country)) digits = digits.replace(/^0+/, '');
    e164 = `+${dial}${digits}`;
  }
  const significant = e164.slice(1);
  if (!/^[1-9]\d{6,14}$/.test(significant)) throw fail('Phone number must have 7 to 15 digits after the country code');
  country = countryForE164(e164, country);
  if (!country) throw fail('Phone number has an unknown country code');
  return { e164, countryCode: country, extension };
}

/**
 * Normalises an email address (trim, lower case) and checks its shape.
 *
 * @param {string} raw - As entered
 * @return {string} Normalised address
 * @throws {ClientError} 422 when invalid
 */
function normaliseEmail(raw) {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!value || value.length > 254 || !EMAIL_RE.test(value) || value.split('@')[0].length > 64) {
    throw validationError('Invalid email address', [{ path: 'address', message: 'is not a valid email address' }]);
  }
  return value;
}

/**
 * Normalises and checks an ISO 3166-1 alpha-2 country code.
 *
 * @param {string} code - Candidate
 * @param {string} [path='countryCode'] - Field path for the error
 * @return {string} Upper-case code
 * @throws {ClientError} 422 when unknown
 */
function normaliseCountry(code, path = 'countryCode') {
  const value = typeof code === 'string' ? code.trim().toUpperCase() : '';
  if (!isCountryCode(value)) {
    throw validationError(`Unknown country code '${code}'`, [{ path, message: 'must be an ISO 3166-1 alpha-2 code' }]);
  }
  return value;
}

/**
 * Checks optional locale fields of a profile (language/locale BCP-47,
 * timezone IANA, currency ISO 4217). Returns canonical values.
 *
 * @param {Object} fields - `{ language?, locale?, timezone?, currency? }`
 * @return {Object} Canonicalised fields (only those present)
 * @throws {ClientError} 422 listing invalid fields
 */
function normaliseLocaleFields(fields) {
  const out = {};
  const errors = [];
  for (const key of ['language', 'locale']) {
    if (fields[key] === undefined || fields[key] === null) continue;
    try {
      [out[key]] = Intl.getCanonicalLocales(fields[key]);
    } catch {
      errors.push({ path: key, message: 'must be a BCP-47 language tag' });
    }
  }
  if (fields.timezone !== undefined && fields.timezone !== null) {
    try {
      out.timezone = new Intl.DateTimeFormat('en', { timeZone: fields.timezone }).resolvedOptions().timeZone;
    } catch {
      errors.push({ path: 'timezone', message: 'must be an IANA time zone' });
    }
  }
  if (fields.currency !== undefined && fields.currency !== null) {
    const c = String(fields.currency).toUpperCase();
    const known = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('currency') : null;
    if (!/^[A-Z]{3}$/.test(c) || (known && !known.includes(c))) errors.push({ path: 'currency', message: 'must be an ISO 4217 code' });
    else out.currency = c;
  }
  if (errors.length) throw validationError(`Invalid locale fields: ${errors.map((e) => e.path).join(', ')}`, errors);
  return out;
}

module.exports = { normalisePhone, normaliseEmail, normaliseCountry, normaliseLocaleFields, EMAIL_RE };
