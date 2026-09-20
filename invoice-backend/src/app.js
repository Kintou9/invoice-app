const express = require('express');
const { createLimiter } = require('./middleware/rateLimit');

const config = require('./config');
const authRoutes = require('./routes/auth');
const claimRoutes = require('./routes/claims');
const invoiceRoutes = require('./routes/invoices');
const partsRoutes = require('./routes/parts');
const uploadRoutes = require('./routes/upload');
const userRoutes = require('./routes/users');
const notificationRoutes = require('./routes/notifications');
const purchaseRoutes = require('./routes/partPurchases');
const auditLogRoutes = require('./routes/auditLog');
const onboardingRoutes = require('./routes/onboarding');
const invoiceFieldTemplateRoutes = require('./routes/invoiceFieldTemplates');
const invoiceLineItemRoutes = require('./routes/invoiceLineItems');
const documentsRoutes = require('./routes/documents');
const documentTemplateRoutes = require('./routes/documentTemplates');
const meRoutes = require('./routes/me');

const app = express();

// App Service sits behind Azure's reverse proxy — without this, req.ip (and
// therefore every rate limiter below) sees the proxy's address, not the
// real client's, and every user would share one bucket.
app.set('trust proxy', 1);

// Backstop against scraping/DoS across the whole API.
const globalLimiter = createLimiter({ windowMs: 15 * 60 * 1000, limit: 300 });

// Tighter limit on the auth endpoints that are actual brute-force/spam/
// enumeration targets (credential stuffing on login, mass account creation,
// reset-link spam).
const authLimiter = createLimiter({ windowMs: 15 * 60 * 1000, limit: 10 });

// Normalize FRONTEND_URL defensively: tolerate a missing scheme (bare
// hostname), surrounding whitespace, and a trailing slash, so a small
// App Setting typo doesn't silently CORS-block every request in prod.
const normalizeOrigin = (value) => {
  if (!value) return null;
  const trimmed = value.trim().replace(/\/$/, '');
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
};
const allowedOrigin = normalizeOrigin(config.frontendUrl);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  const isLocalhost = origin && origin.startsWith('http://localhost:');
  const isConfiguredFrontend = origin && allowedOrigin && origin === allowedOrigin;
  if (!origin || isLocalhost || isConfiguredFrontend) {
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

app.use('/api', globalLimiter);
// Brute-force/enumeration/spam targets get a much tighter limit on top of
// the global one.
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);
app.use('/api/auth/reset-password', authLimiter);
app.use('/api/auth/accept-invite', authLimiter);

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/claims', claimRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/parts', partsRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/purchases', purchaseRoutes);
app.use('/api/audit-log', auditLogRoutes);
app.use('/api/onboarding', onboardingRoutes);
app.use('/api/invoice-field-templates', invoiceFieldTemplateRoutes);
app.use('/api/invoice-line-items', invoiceLineItemRoutes);
app.use('/api/documents', documentsRoutes);
app.use('/api/document-templates', documentTemplateRoutes);
app.use('/api/me', meRoutes);

app.use((err, req, res, next) => {
  console.error(err.stack);
  // Only allow our own expected status codes — never leak a 401 from an external API
  // (e.g. Anthropic auth errors) which would trigger the frontend logout interceptor
  const allowed = [400, 403, 404, 409, 422];
  const status = allowed.includes(err.status) ? err.status : 500;
  res.status(status).json({ error: err.message || 'Internal server error' });
});

module.exports = app;
