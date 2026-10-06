// In-memory store standing in for the database.
const invoices = new Map([
  ['inv_1', { id: 'inv_1', orgId: 'org_a', amountCents: 12000, status: 'open' }],
  ['inv_2', { id: 'inv_2', orgId: 'org_b', amountCents: 4500, status: 'paid' }],
]);

export const db = {
  findInvoice: (id) => invoices.get(id) ?? null,
  listInvoices: (orgId) => [...invoices.values()].filter((i) => i.orgId === orgId),
  saveInvoice: (invoice) => invoices.set(invoice.id, invoice),
  removeInvoice: (id) => invoices.delete(id),
};
