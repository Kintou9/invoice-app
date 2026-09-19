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

// Builds a real multipart/form-data body so multer parses it exactly like
// a browser upload — needed for testing routes/me.js's avatar endpoint
// (and any other multer route) beyond just the pre-multer role checks.
// `file`: { fieldName, filename, contentType, buffer }. `fields`: plain
// string fields alongside the file, same as FormData.append.
function buildMultipart({ file, fields = {} }) {
  const boundary = `----testboundary${Math.random().toString(16).slice(2)}`;
  const parts = [];
  for (const [key, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`));
  }
  if (file) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${file.fieldName}"; filename="${file.filename}"\r\n` +
      `Content-Type: ${file.contentType}\r\n\r\n`
    ));
    parts.push(file.buffer);
    parts.push(Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { buffer: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

// supertest can't be used in this repo's test suite — tests/setup.js
// blocks Server.prototype.listen (a deliberate no-real-network guard), and
// supertest binds an ephemeral port internally when given a bare Express
// app. This mirrors the raw IncomingMessage/ServerResponse + app.handle()
// pattern already established in tests/health.test.js, generalized to
// support a method, a JSON body, multipart file upload, and headers
// (notably Authorization).
function request(app, { method = 'GET', url, token, body, file, fields } = {}) {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    const req = new IncomingMessage(socket);
    req.method = method;
    req.url = url;
    req.headers = { ...(token ? { authorization: `Bearer ${token}` } : {}) };

    // This synthetic req/socket pairing spuriously emits 'aborted' right
    // after a normal 'end' (there's no real connection for Node to know
    // the request actually completed cleanly). Every request in this test
    // suite always delivers its full body synchronously, so 'aborted' is
    // never real here — but multer listens for it, and without this it
    // wrongly aborts otherwise-successful multipart uploads. json-body
    // routes never noticed because nothing else in this app listens for it.
    const realOn = req.on.bind(req);
    req.on = (event, listener) => (event === 'aborted' ? req : realOn(event, listener));

    let payload;
    if (file || fields) {
      const multipart = buildMultipart({ file, fields });
      payload = multipart.buffer;
      req.headers['content-type'] = multipart.contentType;
      req.headers['content-length'] = String(payload.length);
    } else if (body !== undefined) {
      payload = Buffer.from(JSON.stringify(body));
      req.headers['content-type'] = 'application/json';
      req.headers['content-length'] = String(payload.length);
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

    if (payload !== undefined) req.push(payload);
    req.push(null);
  });
}

module.exports = { signTestToken, request };
