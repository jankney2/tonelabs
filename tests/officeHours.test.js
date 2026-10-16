import { isBusinessHours } from '../src/officeHours.js';

test('weekday 8-18 Chicago is business hours, across daylight saving', () => {
  expect(isBusinessHours(new Date('2026-10-16T13:00:00Z'))).toBe(true);  // Fri 08:00 CDT
  expect(isBusinessHours(new Date('2026-10-16T12:59:00Z'))).toBe(false); // Fri 07:59 CDT
  expect(isBusinessHours(new Date('2026-10-16T22:59:00Z'))).toBe(true);  // Fri 17:59 CDT
  expect(isBusinessHours(new Date('2026-10-16T23:00:00Z'))).toBe(false); // Fri 18:00 CDT
  expect(isBusinessHours(new Date('2026-11-02T14:00:00Z'))).toBe(true);  // Mon 08:00 CST
});

test('weekends are off hours', () => {
  expect(isBusinessHours(new Date('2026-10-17T17:00:00Z'))).toBe(false); // Sat noon
});
