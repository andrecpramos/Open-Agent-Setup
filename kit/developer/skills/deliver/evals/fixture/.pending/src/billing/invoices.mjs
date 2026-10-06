import { db } from '../db.mjs';

export function getInvoice(orgId, id) {
  const invoice = db.findInvoice(id);
  return invoice && invoice.orgId === orgId ? invoice : null;
}

export function listInvoices(orgId) {
  return db.listInvoices(orgId);
}

export function createInvoice(orgId, amountCents) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error('amountCents must be a positive integer');
  const invoice = { id: `inv_${Date.now()}`, orgId, amountCents, status: 'open' };
  db.saveInvoice(invoice);
  return invoice;
}

export function deleteInvoice(id) {
  const invoice = db.findInvoice(id);
  if (!invoice) return false;
  if (invoice.status === 'paid') throw new Error('paid invoices cannot be deleted');
  return db.removeInvoice(id);
}
