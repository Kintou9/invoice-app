const express = require('express');

const authRoutes = require('./routes/auth');
const claimRoutes = require('./routes/claims');
const invoiceRoutes = require('./routes/invoices');
const partsRoutes = require('./routes/parts');
const uploadRoutes = require('./routes/upload');
const userRoutes = require('./routes/users');

const app = express();

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin || origin.startsWith('http://localhost:')) {
    res.header('Access-Control-Allow-Origin', origin || '*');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/claims', claimRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/parts', partsRoutes);
app.use('/api/upload', uploadRoutes);

app.use((err, req, res, next) => {
  console.error(err.stack);
  // Only allow our own expected status codes — never leak a 401 from an external API
  // (e.g. Anthropic auth errors) which would trigger the frontend logout interceptor
  const allowed = [400, 403, 404, 409, 422];
  const status = allowed.includes(err.status) ? err.status : 500;
  res.status(status).json({ error: err.message || 'Internal server error' });
});

module.exports = app;
