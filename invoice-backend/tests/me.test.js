const sharp = require('sharp');
const app = require('../src/app');
const db = require('../src/db');
const azureBlob = require('../src/services/azureBlob');
const { signTestToken, request } = require('./helpers');

const ownerToken = signTestToken({ role: 'owner', organizationId: 'org-1', membershipId: 'member-1', id: 'user-1' });

let validJpeg;
beforeAll(async () => {
  validJpeg = await sharp({ create: { width: 100, height: 100, channels: 3, background: { r: 200, g: 50, b: 50 } } })
    .jpeg()
    .toBuffer();
});

beforeEach(() => {
  azureBlob.generateSasUrl.mockImplementation((url) => `${url}?sas=fake`);
});

describe('GET /api/me', () => {
  test('returns the current user\'s own profile, never someone else\'s', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{
        id: 'user-1', first_name: 'Jordan', last_name: 'Smith', name: 'Jordan Smith',
        email: 'jordan@apexservice.com', phone: '0412345678',
        avatar_blob_url: 'https://blob/avatars/user-1/a.jpg', avatar_thumb_blob_url: 'https://blob/avatars/user-1/b.jpg',
        role: 'owner', job_title: 'Owner / Manager', organization_name: 'Apex Service Team',
      }],
    });

    const res = await request(app, { method: 'GET', url: '/api/me', token: ownerToken });

    expect(res.status).toBe(200);
    expect(res.body.email).toBe('jordan@apexservice.com');
    expect(res.body.avatarUrl).toContain('sas=fake');
    // the query must be scoped by req.user.id / req.user.membershipId from
    // the verified JWT — never a client-supplied id
    expect(db.query).toHaveBeenCalledWith(expect.any(String), ['user-1', 'member-1']);
  });

  test('404s if the user row is somehow gone', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app, { method: 'GET', url: '/api/me', token: ownerToken });

    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/me', () => {
  test('updates permitted fields and returns the refreshed profile', async () => {
    db.query
      .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE users
      .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE organization_members
      .mockResolvedValueOnce({ rows: [] }) // logAction
      .mockResolvedValueOnce({ rows: [{ id: 'user-1', first_name: 'Jordan', last_name: 'Smith', name: 'Jordan Smith', email: 'jordan@apexservice.com', phone: '0412345678', avatar_blob_url: null, avatar_thumb_blob_url: null, role: 'owner', job_title: 'Owner', organization_name: 'Apex Service Team' }] });

    const res = await request(app, {
      method: 'PATCH', url: '/api/me', token: ownerToken,
      body: { firstName: 'Jordan', lastName: 'Smith', phone: '0412345678', jobTitle: 'Owner' },
    });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Jordan Smith');
  });

  test('rejects a missing first name', async () => {
    const res = await request(app, {
      method: 'PATCH', url: '/api/me', token: ownerToken,
      body: { firstName: '', lastName: 'Smith' },
    });

    expect(res.status).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('rejects an invalid phone number', async () => {
    const res = await request(app, {
      method: 'PATCH', url: '/api/me', token: ownerToken,
      body: { firstName: 'Jordan', lastName: 'Smith', phone: 'not-a-phone!!' },
    });

    expect(res.status).toBe(400);
  });

  // The route only ever reads firstName/lastName/phone/jobTitle off the
  // body — role, organizationId, and id are never destructured or used in
  // any query, so passing them does nothing. Asserted here by checking the
  // actual UPDATE params sent to the (mocked) db never carry a role/org
  // value at all.
  test('silently ignores an attempt to send role/organizationId in the body', async () => {
    db.query
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'user-1', first_name: 'Jordan', last_name: 'Smith', name: 'Jordan Smith', email: 'j@x.com', phone: null, avatar_blob_url: null, avatar_thumb_blob_url: null, role: 'owner', job_title: null, organization_name: 'Apex' }] });

    const res = await request(app, {
      method: 'PATCH', url: '/api/me', token: ownerToken,
      body: { firstName: 'Jordan', lastName: 'Smith', role: 'owner', organizationId: 'org-999' },
    });

    expect(res.status).toBe(200);
    const updateUsersCall = db.query.mock.calls[0];
    expect(updateUsersCall[0]).toMatch(/UPDATE users/);
    expect(updateUsersCall[1]).toEqual(['Jordan', 'Smith', 'Jordan Smith', null, 'user-1']);
  });
});

describe('POST /api/me/avatar', () => {
  test('uploads and crops-server-normalizes a valid JPEG, replacing any prior photo', async () => {
    azureBlob.uploadBuffer
      .mockResolvedValueOnce('https://blob/avatars/user-1/large.jpg')
      .mockResolvedValueOnce('https://blob/avatars/user-1/small.jpg');
    azureBlob.deleteBlob.mockResolvedValue(undefined);
    db.query
      .mockResolvedValueOnce({ rows: [{ avatar_blob_url: 'https://blob/avatars/user-1/old-large.jpg', avatar_thumb_blob_url: 'https://blob/avatars/user-1/old-small.jpg' }] }) // prev lookup
      .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE users
      .mockResolvedValueOnce({ rows: [] }) // logAction
      .mockResolvedValueOnce({ rows: [{ id: 'user-1', first_name: 'Jordan', last_name: 'Smith', name: 'Jordan Smith', email: 'j@x.com', phone: null, avatar_blob_url: 'https://blob/avatars/user-1/large.jpg', avatar_thumb_blob_url: 'https://blob/avatars/user-1/small.jpg', role: 'owner', job_title: null, organization_name: 'Apex' }] });

    const res = await request(app, {
      method: 'POST', url: '/api/me/avatar', token: ownerToken,
      file: { fieldName: 'avatar', filename: 'photo.jpg', contentType: 'image/jpeg', buffer: validJpeg },
    });

    expect(res.status).toBe(201);
    expect(res.body.avatarUrl).toContain('sas=fake');
    // the blob folder must be keyed by the server-derived user id, and the
    // prior photo blobs must be retired
    expect(azureBlob.uploadBuffer.mock.calls[0][2]).toBe('avatars/user-1');
    expect(azureBlob.deleteBlob).toHaveBeenCalledWith('https://blob/avatars/user-1/old-large.jpg');
    expect(azureBlob.deleteBlob).toHaveBeenCalledWith('https://blob/avatars/user-1/old-small.jpg');
  });

  test('400s with no file uploaded', async () => {
    const res = await request(app, { method: 'POST', url: '/api/me/avatar', token: ownerToken, fields: {} });

    expect(res.status).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('rejects an unsupported mimetype before it ever reaches storage', async () => {
    const res = await request(app, {
      method: 'POST', url: '/api/me/avatar', token: ownerToken,
      file: { fieldName: 'avatar', filename: 'doc.pdf', contentType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') },
    });

    expect(res.status).toBe(400);
    expect(azureBlob.uploadBuffer).not.toHaveBeenCalled();
  });

  test('rejects a corrupt / non-image file even with an image mimetype and extension', async () => {
    const res = await request(app, {
      method: 'POST', url: '/api/me/avatar', token: ownerToken,
      file: { fieldName: 'avatar', filename: 'fake.jpg', contentType: 'image/jpeg', buffer: Buffer.from('not actually a jpeg') },
    });

    expect(res.status).toBe(400);
    expect(azureBlob.uploadBuffer).not.toHaveBeenCalled();
  });

  test('rejects a file over the 5MB limit', async () => {
    const oversized = Buffer.alloc(5 * 1024 * 1024 + 1);
    const res = await request(app, {
      method: 'POST', url: '/api/me/avatar', token: ownerToken,
      file: { fieldName: 'avatar', filename: 'huge.jpg', contentType: 'image/jpeg', buffer: oversized },
    });

    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/me/avatar', () => {
  test('removes the photo and restores the initials fallback', async () => {
    azureBlob.deleteBlob.mockResolvedValue(undefined);
    db.query
      .mockResolvedValueOnce({ rows: [{ avatar_blob_url: 'https://blob/avatars/user-1/a.jpg', avatar_thumb_blob_url: 'https://blob/avatars/user-1/b.jpg' }] })
      .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE users
      .mockResolvedValueOnce({ rows: [] }) // logAction
      .mockResolvedValueOnce({ rows: [{ id: 'user-1', first_name: 'Jordan', last_name: 'Smith', name: 'Jordan Smith', email: 'j@x.com', phone: null, avatar_blob_url: null, avatar_thumb_blob_url: null, role: 'owner', job_title: null, organization_name: 'Apex' }] });

    const res = await request(app, { method: 'DELETE', url: '/api/me/avatar', token: ownerToken });

    expect(res.status).toBe(200);
    expect(res.body.avatarUrl).toBeNull();
    expect(azureBlob.deleteBlob).toHaveBeenCalledTimes(2);
  });

  test('404s when there is no photo to remove', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ avatar_blob_url: null, avatar_thumb_blob_url: null }] });

    const res = await request(app, { method: 'DELETE', url: '/api/me/avatar', token: ownerToken });

    expect(res.status).toBe(404);
  });
});
