import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInvoice, getInvoice } from '../src/billing/invoices.mjs';

test('an invoice is visible to its own organisation only', () => {
  assert.equal(getInvoice('org_a', 'inv_1')?.id, 'inv_1');
  assert.equal(getInvoice('org_b', 'inv_1'), null);
});

test('amounts must be positive whole cents', () => {
  assert.throws(() => createInvoice('org_a', 0));
  assert.throws(() => createInvoice('org_a', 10.5));
});
