const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

// Skip rate limiting entirely under Jest — tests run many requests against
// the in-process app with no real network involved, and shouldn't trip
// limits meant for real traffic. Evaluated per-request (not captured once
// at module load) so a test can flip NODE_ENV for the duration of a single
// request and get real limiter behavior — otherwise there'd be no way to
// write a test that actually proves a 429 fires.
const isTest = () => process.env.NODE_ENV === 'test';

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
function rateLimitKey(req) {
  const forwardedFor = req.headers['x-forwarded-for'];
  const candidate = forwardedFor ? forwardedFor.split(',')[0].trim() : req.ip;
  // No XFF header and no req.ip (a real client always has one of these in
  // production — Azure's proxy always sets XFF, and Express always derives
  // req.ip from the real socket otherwise). Fall back to a fixed key rather
  // than throwing and taking the whole request down with a 500 — worst
  // case every such request shares one bucket, which is still strictly
  // safer than an unhandled crash.
  if (!candidate) return 'unknown-client';
  const bracketedIPv6 = candidate.match(/^\[(.+)\]:\d+$/); // "[::1]:1234"
  if (bracketedIPv6) return ipKeyGenerator(bracketedIPv6[1]);
  const ipv4WithPort = candidate.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):\d+$/);
  if (ipv4WithPort) return ipKeyGenerator(ipv4WithPort[1]);
  return ipKeyGenerator(candidate); // bare IPv4, bare IPv6, or already-clean req.ip
}

// Every limiter in this app shares the same test-skip and JSON 429 shape.
// keyGenerator defaults to per-IP (rateLimitKey above) but can be
// overridden — e.g. the invite limiter keys by organization instead, since
// IP alone would lump every employee behind one shared office connection
// into a single bucket.
function createLimiter({ windowMs, limit, keyGenerator = rateLimitKey }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => isTest(),
    keyGenerator,
    handler: jsonRateLimitHandler,
  });
}

module.exports = { createLimiter };
