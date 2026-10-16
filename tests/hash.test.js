import { contentHash } from '../src/integrations/hash.js';

test('same data in a different key order hashes the same', async () => {
  expect(await contentHash({ a: 1, b: { c: 2, d: [1, { y: 1, x: 2 }] } }))
    .toBe(await contentHash({ b: { d: [1, { x: 2, y: 1 }], c: 2 }, a: 1 }));
});

test('any changed value changes the hash', async () => {
  expect(await contentHash({ answered: true })).not.toBe(await contentHash({ answered: false }));
});
