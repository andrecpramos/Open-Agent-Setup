import { requireAuth } from './auth/session.mjs';
import { createInvoice, getInvoice, listInvoices } from './billing/invoices.mjs';

// Route table: method, path, handler. A tiny router keeps the example dependency-free.
export const routes = [
  ['GET', '/health', (req, res) => res.json({ ok: true })],
  ['GET', '/invoices', requireAuth, (req, res) => res.json(listInvoices(req.user.orgId))],
  [
    'GET',
    '/invoices/:id',
    requireAuth,
    (req, res) => {
      const invoice = getInvoice(req.user.orgId, req.params.id);
      if (!invoice) return res.status(404).json({ error: 'Invoce not found' });
      return res.json(invoice);
    },
  ],
  ['POST', '/invoices', requireAuth, (req, res) => res.status(201).json(createInvoice(req.user.orgId, req.body.amountCents))],
];
