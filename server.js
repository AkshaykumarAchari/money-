'use strict';
require('dotenv').config(); 
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const db = {
  owner: { 
    id: 'O1', 
    name: 'Workspace Admin', 
    workspace_name: 'HSR Layout Workspace', 
    vpa: process.env.DEMO_OWNER_VPA || 'demo@upi' 
  },
  invoices: [],
  transactions: []
};

const sseClients = new Set();
function broadcast(event, data) {
  for (const res of sseClients) {
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {}
  }
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/create-invoice', (req, res) => {
  const { phone, amount, desk } = req.body;
  if (!phone || !amount) {
    return res.status(400).json({ error: 'Phone and amount are required' });
  }
  
  const invoiceId = 'INV-' + Date.now();
  const amountPaise = Math.round(Number(amount) * 100);
  
  const newInvoice = { id: invoiceId, phone, desk: desk || 'General', amount_paise: amountPaise, status: 'pending', created_at: new Date().toISOString() };
  db.invoices.push(newInvoice);
  
  // CRITICAL FIX: This detects if you are on Render or local, so the link always works
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.get('host');
  const paymentLink = `${protocol}://${host}/pay/${invoiceId}`;

  res.json({ success: true, invoice: newInvoice, paymentLink });
});

app.get('/api/invoice/:id', (req, res) => {
  const inv = db.invoices.find(i => i.id === req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  
  const upiUri = `upi://pay?pa=${db.owner.vpa}&pn=${encodeURIComponent(db.owner.workspace_name)}&am=${(inv.amount_paise / 100).toFixed(2)}&cu=INR&tr=${inv.id}`;
  res.json({ invoice: inv, upiUri, workspace: db.owner.workspace_name, payee_vpa: db.owner.vpa });
});

app.get('/pay/:id', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pay.html'));
});

app.post('/api/bank-webhook-simulator', (req, res) => {
  const { invoice_id, utr } = req.body;
  const inv = db.invoices.find(i => i.id === invoice_id);
  
  if (inv && inv.status === 'pending') {
    inv.status = 'paid';
    const txn = { id: 'TXN-' + Date.now(), invoice_id, desk: inv.desk, phone: inv.phone, amount: inv.amount_paise, utr: utr || ('SIM' + Math.floor(Math.random() * 1e9)), time: new Date().toISOString() };
    db.transactions.unshift(txn);
    broadcast('payment_received', txn); 
    return res.json({ success: true, message: 'Bank settlement confirmed' });
  }
  res.status(400).json({ error: 'Invalid invoice or already paid' });
});

app.get('/api/dashboard-stream', (req, res) => {
  res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
  res.flushHeaders();
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

app.listen(PORT, () => {
  console.log(`✔ Workspace UPI platform running on port ${PORT}`);
});