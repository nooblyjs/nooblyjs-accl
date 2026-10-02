'use strict';

const {
  defineSchema, validate, mask, maskValue, piiPaths, toOpenApi, getPath, mergePatch
} = require('../../../src/shared/schema');

const person = defineSchema({
  name: 'person',
  description: 'A test person',
  numberPrefix: 'PER',
  fields: {
    status: { type: 'enum', values: ['active', 'inactive'], default: 'active' },
    name: {
      type: 'object',
      required: true,
      fields: {
        given: { type: 'string', required: true, maxLength: 20, pii: true },
        family: { type: 'string', pii: true }
      }
    },
    email: { type: 'string', lowercase: true, pii: true, pattern: /@/ },
    code: { type: 'string', uppercase: true, minLength: 2 },
    age: { type: 'integer', min: 0, max: 150 },
    score: { type: 'number' },
    vip: { type: 'boolean' },
    dob: { type: 'date', pii: true },
    seenAt: { type: 'datetime' },
    ownerId: { type: 'ref' },
    phones: { type: 'array', maxItems: 2, items: { type: 'object', fields: { e164: { type: 'string', pii: true }, kind: { type: 'string' } } } },
    labels: { type: 'array' },
    meta: { type: 'json' },
    loose: { type: 'object' }
  },
  indexes: [{ name: 'email', fields: ['email'], unique: true }],
  search: ['name.given']
});

describe('defineSchema', () => {
  test('adds envelope fields and a number field for numbered entities', () => {
    expect(person.fields.id.readOnly).toBe(true);
    expect(person.fields.version.type).toBe('integer');
    expect(person.fields.number.readOnly).toBe(true);
    expect(person.plural).toBe('persons');
    expect(person.indexes[0]).toEqual({ name: 'email', fields: ['email'], unique: true });
    expect(Object.isFrozen(person)).toBe(true);
  });

  test.each([
    [undefined, /name is required/],
    [{ name: 'x' }, /fields are required/],
    [{ name: 'x', fields: { id: { type: 'string' } } }, /envelope field/],
    [{ name: 'x', fields: { a: { type: 'nope' } } }, /unknown type/],
    [{ name: 'x', fields: { a: { type: 'enum' } } }, /needs values/],
    [{ name: 'x', fields: { a: { type: 'object', fields: { b: { type: 'bad' } } } } }, /'a.b'/],
    [{ name: 'x', fields: { a: { type: 'array', items: { type: 'bad' } } } }, /unknown type/],
    [{ name: 'x', fields: { a: { type: 'string' } }, indexes: [{ name: 'i' }] }, /index needs/]
  ])('rejects invalid definition %#', (def, message) => {
    expect(() => defineSchema(def)).toThrow(message);
  });

  test('keeps an explicit plural and number field', () => {
    const s = defineSchema({ name: 'x', plural: 'xes', numberPrefix: 'X', fields: { number: { type: 'string' } } });
    expect(s.plural).toBe('xes');
    expect(s.fields.number.readOnly).toBeUndefined();
  });
});

describe('validate', () => {
  const valid = { name: { given: 'Ada' } };

  test('applies defaults and normalises values', () => {
    const v = validate(person, {
      ...valid, email: ' ADA@Example.com ', code: 'za', seenAt: '2026-01-01T10:00:00+02:00', dob: '1990-02-28',
      phones: [{ e164: '+27821234567' }], labels: ['a'], meta: { deep: { x: 1 } }, loose: { any: true }
    });
    expect(v.status).toBe('active');
    expect(v.tags).toEqual([]);
    expect(v.customFields).toEqual({});
    expect(v.email).toBe('ada@example.com');
    expect(v.code).toBe('ZA');
    expect(v.seenAt).toBe('2026-01-01T08:00:00.000Z');
    expect(v.meta).toEqual({ deep: { x: 1 } });
  });

  test('drops read-only fields silently', () => {
    const v = validate(person, { ...valid, id: 'x', version: 9, number: 'PER-1' });
    expect(v.id).toBeUndefined();
    expect(v.version).toBeUndefined();
    expect(v.number).toBeUndefined();
  });

  test('reports every violation with paths', () => {
    let err;
    try {
      validate(person, {
        name: { given: '' }, status: 'gone', age: 1.5, score: 'x', vip: 'yes', dob: '1990-02-30', seenAt: 'nope',
        email: 'no-at', code: 'A', ownerId: 5, phones: [{ e164: 1 }, {}, {}], labels: 'x', loose: [], unknown: 1
      });
    } catch (e) { err = e; }
    expect(err.statusCode).toBe(422);
    expect(err.code).toBe('validation_failed');
    const paths = err.details.map((d) => d.path);
    expect(paths).toEqual(expect.arrayContaining([
      'name.given', 'status', 'age', 'score', 'vip', 'dob', 'seenAt', 'email', 'code', 'ownerId', 'phones', 'labels', 'loose', 'unknown'
    ]));
  });

  test('checks numeric bounds, string length and array items', () => {
    expect(() => validate(person, { ...valid, age: -1 })).toThrow(/age must be >= 0/);
    expect(() => validate(person, { ...valid, age: 151 })).toThrow(/age must be <= 150/);
    expect(() => validate(person, { name: { given: 'x'.repeat(21) } })).toThrow(/at most 20/);
    expect(() => validate(person, { ...valid, phones: [{ e164: 5 }] })).toThrow(/phones\[0\]\.e164/);
    expect(() => validate(person, { ...valid, meta: undefined })).not.toThrow();
  });

  test('requires required fields and rejects non-objects', () => {
    expect(() => validate(person, {})).toThrow(/name is required/);
    expect(() => validate(person, { name: null })).toThrow(/name is required/);
    expect(() => validate(person, [])).toThrow(/must be a JSON object/);
  });

  test('partial mode skips required checks and defaults, keeps nulls', () => {
    const v = validate(person, { email: null, name: { family: 'L' } }, { partial: true });
    expect(v).toEqual({ email: null, name: { family: 'L' } });
    expect(validate(person, { name: null }, { partial: true })).toEqual({ name: null });
  });

  test('default strings longer than 2000 are rejected', () => {
    expect(() => validate(person, { ...valid, ownerId: 'x'.repeat(2001) })).toThrow(/at most 2000/);
  });

  test('non-function defaults are cloned', () => {
    const s = defineSchema({ name: 'd', fields: { list: { type: 'array', default: ['a'] } } });
    const a = validate(s, {});
    a.list.push('b');
    expect(validate(s, {}).list).toEqual(['a']);
  });

  test('untrimmed strings keep whitespace', () => {
    const s = defineSchema({ name: 'raw', fields: { body: { type: 'string', trim: false } } });
    expect(validate(s, { body: ' x ' }).body).toBe(' x ');
  });
});

describe('mask', () => {
  test('masks PII fields by shape, recursing into objects and arrays', () => {
    const doc = {
      id: '1', status: 'active', name: { given: 'Ada', family: 'L' }, email: 'ada@example.com', dob: '1990-01-01',
      phones: [{ e164: '+27821234567', kind: 'mobile' }, 'raw'], vip: true
    };
    const m = mask(person, doc);
    expect(m.name).toEqual({ given: 'A***', family: '***' });
    expect(m.email).toBe('a***@example.com');
    expect(m.dob).toBe('***');
    expect(m.phones[0]).toEqual({ e164: '+27***67', kind: 'mobile' });
    expect(m.phones[1]).toBe('raw');
    expect(m.status).toBe('active');
    expect(doc.email).toBe('ada@example.com');
    expect(mask(person, null)).toBeNull();
  });

  test('maskValue handles every value kind', () => {
    expect(maskValue(42)).toBe('***');
    expect(maskValue('')).toBe('');
    expect(maskValue('a')).toBe('***');
    expect(maskValue(['bob', { x: 'yo' }])).toEqual(['b***', { x: 'y***' }]);
    expect(maskValue('082 123 4567')).toBe('08***67');
  });

  test('a PII object field is masked wholesale', () => {
    const s = defineSchema({ name: 'p', fields: { addr: { type: 'object', pii: true } } });
    expect(mask(s, { addr: { line1: '1 Main', zip: 8001 } }).addr).toEqual({ line1: '1***', zip: '***' });
  });
});

describe('helpers', () => {
  test('piiPaths lists nested PII paths', () => {
    expect([...piiPaths(person)].sort()).toEqual(['dob', 'email', 'name.family', 'name.given'].sort());
  });

  test('toOpenApi maps types and omits read-only fields for input', () => {
    const out = toOpenApi(person);
    expect(out.description).toBe('A test person');
    expect(out.required).toEqual(['name']);
    expect(out.properties.status).toEqual({ type: 'string', enum: ['active', 'inactive'] });
    expect(out.properties.email).toMatchObject({ type: 'string', pattern: '@', 'x-pii': true });
    expect(out.properties.dob.format).toBe('date');
    expect(out.properties.seenAt.format).toBe('date-time');
    expect(out.properties.age.type).toBe('integer');
    expect(out.properties.score.type).toBe('number');
    expect(out.properties.vip.type).toBe('boolean');
    expect(out.properties.phones.items.properties.e164['x-pii']).toBe(true);
    expect(out.properties.labels).toEqual({ type: 'array', items: {} });
    expect(out.properties.loose.additionalProperties).toBe(true);
    expect(out.properties.meta).toEqual({});
    expect(out.properties.deletedAt).toMatchObject({ readOnly: true, nullable: true });
    expect(out.properties.id.description).toBe('Unique id');
    const input = toOpenApi(person, { input: true });
    expect(input.properties.id).toBeUndefined();
    expect(input.properties.name.properties.given.maxLength).toBe(20);
  });

  test('getPath reads dotted paths', () => {
    expect(getPath({ a: { b: { c: 1 } } }, 'a.b.c')).toBe(1);
    expect(getPath({ a: null }, 'a.b')).toBeUndefined();
  });

  test('mergePatch follows RFC 7396', () => {
    const target = { a: 1, b: { c: 2, d: 3 }, e: [1] };
    expect(mergePatch(target, { a: null, b: { c: 5, d: null }, e: [2], f: { g: 1 } }))
      .toEqual({ b: { c: 5 }, e: [2], f: { g: 1 } });
    expect(mergePatch(target, [1])).toEqual([1]);
    expect(mergePatch(null, { a: 1 })).toEqual({ a: 1 });
    expect(target).toEqual({ a: 1, b: { c: 2, d: 3 }, e: [1] });
  });
});
