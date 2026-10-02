'use strict';

const { normalisePhone, normaliseEmail, normaliseCountry, normaliseLocaleFields } = require('../../../src/shared/reference/normalise');
const { COUNTRIES, isCountryCode, countryForE164 } = require('../../../src/shared/reference/countries');

describe('countries', () => {
  test('has every ISO 3166-1 alpha-2 code with a calling code', () => {
    expect(Object.keys(COUNTRIES)).toHaveLength(249);
    for (const c of Object.values(COUNTRIES)) {
      expect(c.code).toMatch(/^[A-Z]{2}$/);
      expect(c.dial).toMatch(/^\d{1,4}$/);
    }
    expect(isCountryCode('za')).toBe(true);
    expect(isCountryCode('XX')).toBe(false);
    expect(isCountryCode(5)).toBe(false);
  });

  test('countryForE164 picks the longest code and honours hints', () => {
    expect(countryForE164('+27821234567')).toBe('ZA');
    expect(countryForE164('+12125550100')).toBe('US');
    expect(countryForE164('+14165550100', 'CA')).toBe('CA');
    expect(countryForE164('+12645550100')).toBe('AI');
    expect(countryForE164('+447700900123', 'ZA')).toBe('GB');
    expect(countryForE164('+999')).toBeNull();
  });
});

describe('normalisePhone', () => {
  test.each([
    ['082 123 4567', 'ZA', '+27821234567', 'ZA', null],
    ['+27 (82) 123-4567', undefined, '+27821234567', 'ZA', null],
    ['0027 82 123 4567', undefined, '+27821234567', 'ZA', null],
    ['(212) 555-0100 ext. 42', 'us', '+12125550100', 'US', '42'],
    ['020 7946 0958 x7', 'GB', '+442079460958', 'GB', '7'],
    ['06 1234 5678', 'IT', '+390612345678', 'IT', null],
    ['+49 151 23456789', undefined, '+4915123456789', 'DE', null]
  ])('%s (%s)', (raw, country, e164, cc, ext) => {
    expect(normalisePhone(raw, country)).toEqual({ e164, countryCode: cc, extension: ext });
  });

  test.each([
    [''], ['abc'], ['082 123 4567'], ['+27 82+1'], ['+0123456789'], ['+27 12'], ['+999 1234567']
  ])('rejects %j without a usable country', (raw) => {
    expect(() => normalisePhone(raw)).toThrow(expect.objectContaining({ statusCode: 422 }));
  });

  test('rejects non-strings and unknown default countries', () => {
    expect(() => normalisePhone(null)).toThrow(/required/);
    expect(() => normalisePhone('0821234567', 'XX')).toThrow(/international prefix/);
  });
});

describe('normaliseEmail / country / locale', () => {
  test('emails', () => {
    expect(normaliseEmail('  Ada.Lovelace@Example.COM ')).toBe('ada.lovelace@example.com');
    for (const bad of ['', 'no-at', 'a@b', 'a b@example.com', `${'x'.repeat(65)}@example.com`, 5]) {
      expect(() => normaliseEmail(bad)).toThrow(expect.objectContaining({ statusCode: 422 }));
    }
  });

  test('countries', () => {
    expect(normaliseCountry(' za ')).toBe('ZA');
    expect(() => normaliseCountry('ZZ')).toThrow(/Unknown country/);
    expect(() => normaliseCountry(undefined, 'x')).toThrow(expect.objectContaining({ details: [expect.objectContaining({ path: 'x' })] }));
  });

  test('locale fields', () => {
    expect(normaliseLocaleFields({ language: 'EN-za', locale: 'af-ZA', timezone: 'africa/johannesburg', currency: 'zar' }))
      .toEqual({ language: 'en-ZA', locale: 'af-ZA', timezone: 'Africa/Johannesburg', currency: 'ZAR' });
    expect(normaliseLocaleFields({ language: null })).toEqual({});
    let err;
    try { normaliseLocaleFields({ language: 'not a tag!', timezone: 'Mars/Base', currency: 'XYZW' }); } catch (e) { err = e; }
    expect(err.details.map((d) => d.path)).toEqual(['language', 'timezone', 'currency']);
    expect(() => normaliseLocaleFields({ currency: 'QQQ' })).toThrow(/currency/);
  });
});
