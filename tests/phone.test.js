import { normalizePhone, samePhone } from '../src/lib/phone.js';

test.each([
  ['(206) 555-0103', '+12065550103'], // Lawllama phone leads
  ['206.555.0131', '+12065550131'], // Lawllama web form leads
  ['206-555-0103', '+12065550103'],
  ['2065550103', '+12065550103'],
  ['+1 (206) 555-0103', '+12065550103'],
  ['1-206-555-0103', '+12065550103'],
  ['  206 555 0103  ', '+12065550103'],
  ['(206) 555-0103 x42', '+12065550103'],
  ['206.555.0103 ext. 7', '+12065550103'],
  ['(888) 477-7204', '+18884777204'], // the firm's own number
])('normalises %s', (input, expected) => expect(normalizePhone(input)).toBe(expected));

test.each([null, undefined, '', '   ', 'n/a', '555-0103', '0000000000', '(106) 555-0103', '206555010', '12065550103999', '+44 20 7946 0958'])(
  'rejects %p', (input) => expect(normalizePhone(input)).toBeNull());

test('samePhone compares across formats and never matches two invalid values', () => {
  expect(samePhone('(206) 555-0103', '206.555.0103')).toBe(true);
  expect(samePhone('(206) 555-0103', '206.555.0104')).toBe(false);
  expect(samePhone('n/a', 'n/a')).toBe(false);
});
