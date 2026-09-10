const express = require('express');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

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

const app = express();

// App Service sits behind Azure's reverse proxy — without this, req.ip (and
// therefore every rate limiter below) sees the proxy's address, not the
// real client's, and every user would share one bucket.
app.set('trust proxy', 1);

// Skip rate limiting entirely under Jest — tests run many requests against
// the in-process app with no real network involved, and shouldn't trip
// limits meant for real traffic.
const isTest = process.env.NODE_ENV === 'test';

const jsonRateLimitHandler = (req, res) => {
  res.status(429).json({ error: 'Too many requests — please try again later' });
};

// Azure App Service's X-Forwarded-For entry is "<client-ip>:<client-port>",
// not a bare IP — the port is the client's ephemeral source port, which is
// different on every single connection. express-rate-limit's default
// keyGenerator (req.ip, via Express's trust-proxy handling) keeps that port
// as part of the key, so every request looked like a brand-new client and
// the limit never tripped. Strip the port, then hand the bare address to
// express-rate-limit's own ipKeyGenerator so IPv6 addresses still get
// collapsed to a /56 subnet the same way the library's default would —
// skipping that step would let an IPv6 client bypass the limit by rotating
// addresses within their own subnet.
const rateLimitKey = (req) => {
  const forwardedFor = req.headers['x-forwarded-for'];
  const candidate = forwardedFor ? forwardedFor.split(',')[0].trim() : req.ip;
  const bracketedIPv6 = candidate.match(/^\[(.+)\]:\d+$/); // "[::1]:1234"
  if (bracketedIPv6) return ipKeyGenerator(bracketedIPv6[1]);
  const ipv4WithPort = candidate.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):\d+$/);
  if (ipv4WithPort) return ipKeyGenerator(ipv4WithPort[1]);
  return ipKeyGenerator(candidate); // bare IPv4, bare IPv6, or already-clean req.ip
};

// Backstop against scraping/DoS across the whole API.
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
  keyGenerator: rateLimitKey,
  handler: jsonRateLimitHandler,
});

// Tighter limit on the auth endpoints that are actual brute-force/spam/
// enumeration targets (credential stuffing on login, mass account creation,
// reset-link spam).
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
  keyGenerator: rateLimitKey,
  handler: jsonRateLimitHandler,
});

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
// TEMP DIAGNOSTIC — removed before commit
app.get('/_debug/rl', (req, res) => res.json({
  xff: req.headers['x-forwarded-for'],
  reqIp: req.ip,
  reqIps: req.ips,
  key: rateLimitKey(req),
  allHeaders: req.headers,
}));

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

app.use((err, req, res, next) => {
  console.error(err.stack);
  // Only allow our own expected status codes — never leak a 401 from an external API
  // (e.g. Anthropic auth errors) which would trigger the frontend logout interceptor
  const allowed = [400, 403, 404, 409, 422];
  const status = allowed.includes(err.status) ? err.status : 500;
  res.status(status).json({ error: err.message || 'Internal server error' });
});

module.exports = app;
