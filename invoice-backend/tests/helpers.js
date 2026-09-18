const jwt = require('jsonwebtoken');
const { IncomingMessage, ServerResponse } = require('node:http');
const { Socket } = require('node:net');

// Matches the payload shape signed by routes/auth.js's signToken, and the
// secret jest.mock'd for src/config in setup.js.
function signTestToken(overrides = {}) {
  return jwt.sign(
    {
      id: 'user-1', email: 'owner@example.com', name: 'Test Owner',
      organizationId: 'org-1', membershipId: 'member-1', role: 'owner',
      ...overrides,
    },
    'test-only-secret',
    { expiresIn: '1h' }
  );
}

// supertest can't be used in this repo's test suite — tests/setup.js
// blocks Server.prototype.listen (a deliberate no-real-network guard), and
// supertest binds an ephemeral port internally when given a bare Express
// app. This mirrors the raw IncomingMessage/ServerResponse + app.handle()
// pattern already established in tests/health.test.js, generalized to
// support a method, a JSON body, and headers (notably Authorization).
function request(app, { method = 'GET', url, token, body } = {}) {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    const req = new IncomingMessage(socket);
    req.method = method;
    req.url = url;
    req.headers = { ...(token ? { authorization: `Bearer ${token}` } : {}) };

    const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;
    if (bodyStr !== undefined) {
      req.headers['content-type'] = 'application/json';
      req.headers['content-length'] = String(Buffer.byteLength(bodyStr));
    }

    const res = new ServerResponse(req);
    res.end = (chunk) => {
      const text = chunk ? String(chunk) : '';
      socket.destroy();
      resolve({ status: res.statusCode, body: text ? JSON.parse(text) : undefined });
      return res;
    };

    app.handle(req, res, (err) => {
      socket.destroy();
      reject(err || new Error(`No route responded for ${method} ${url}`));
    });

    if (bodyStr !== undefined) req.push(Buffer.from(bodyStr));
    req.push(null);
  });
}

module.exports = { signTestToken, request };
