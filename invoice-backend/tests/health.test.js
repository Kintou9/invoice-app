const { IncomingMessage, ServerResponse } = require('node:http');
const { Socket } = require('node:net');
const app = require('../src/app');
const db = require('../src/db');
const azure = require('../src/services/azureBlob');
const claude = require('../src/services/claude');

test('GET /health returns JSON OK without authentication, services, or a network port', async () => {
  // An unconnected socket supplies Node request metadata; no server is created.
  const socket = new Socket();
  try {
    const req = new IncomingMessage(socket);
    req.method = 'GET';
    req.url = '/health';
    req.headers = {};
    const res = new ServerResponse(req);
    const body = await new Promise((resolve, reject) => {
      res.end = (chunk) => { resolve(String(chunk)); return res; };
      app.handle(req, res, (err) => reject(err || new Error('Health route did not respond')));
    });
    expect(res.statusCode).toBe(200);
    expect(res.getHeader('content-type')).toMatch(/application\/json/);
    expect(JSON.parse(body)).toEqual({ status: 'ok' });
    for (const service of [db, db.pool, azure, claude]) {
      for (const method of Object.values(service)) {
        if (jest.isMockFunction(method)) expect(method).not.toHaveBeenCalled();
      }
    }
  } finally {
    socket.destroy();
  }
});
