import test from 'node:test';
import assert from 'node:assert/strict';
import { retailUsdCents } from '../supabase/functions/_shared/retailPrice.ts';

test('provider cost is doubled in dollars, not marked up 50 percent', () => {
  assert.equal(retailUsdCents('1.00'), 200);
  assert.equal(retailUsdCents('1.15'), 230);
  assert.equal(retailUsdCents('0'), 0);
});
test('fractional cents are rounded once using decimal arithmetic', () => {
  assert.equal(retailUsdCents('0.0075'), 2);
  assert.equal(retailUsdCents('0.014'), 3);
  assert.equal(retailUsdCents('0.000001'), 1);
});
test('missing, negative and malformed provider prices cannot become free prices', () => {
  for (const input of ['', '-1', 'NaN', 'Infinity', '1e3', '0.01 USD', '9007199254740991']) {
    assert.throws(() => retailUsdCents(input));
  }
});
