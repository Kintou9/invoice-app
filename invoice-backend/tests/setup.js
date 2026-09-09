// Factories prevent evaluating modules that load .env or initialize clients.
jest.mock('../src/config', () => ({
  port: 0, frontendUrl: 'http://localhost:3000',
  jwtSecret: 'test-only-secret', jwtExpiresIn: '1h',
  db: {}, azure: {}, anthropic: {}, resend: {},
}));
jest.mock('../src/db', () => {
  const unexpected = jest.fn(() => { throw new Error('Unexpected database call'); });
  return { query: unexpected, pool: { query: unexpected, connect: unexpected, end: unexpected } };
});
jest.mock('../src/services/azureBlob', () => {
  const unexpected = jest.fn(() => { throw new Error('Unexpected Azure call'); });
  return { uploadBuffer: unexpected, downloadBuffer: unexpected,
    generateSasUrl: unexpected, deleteBlob: unexpected, listBlobs: unexpected };
});
jest.mock('../src/services/claude', () => {
  const unexpected = jest.fn(() => { throw new Error('Unexpected Claude call'); });
  return { extractEquipmentInfo: unexpected, generateIssueDescription: unexpected,
    suggestParts: unexpected, extractClaimInfo: unexpected };
});
jest.mock('../src/services/email', () => {
  const unexpected = jest.fn(() => { throw new Error('Unexpected email send'); });
  return { sendInviteEmail: unexpected, sendPasswordResetEmail: unexpected };
});

const blocked = () => { throw new Error('Network access is forbidden in backend tests'); };
jest.spyOn(require('node:net').Socket.prototype, 'connect').mockImplementation(blocked);
jest.spyOn(require('node:net').Server.prototype, 'listen').mockImplementation(blocked);
jest.spyOn(require('node:tls'), 'connect').mockImplementation(blocked);
for (const protocol of ['node:http', 'node:https']) {
  jest.spyOn(require(protocol), 'request').mockImplementation(blocked);
  jest.spyOn(require(protocol), 'get').mockImplementation(blocked);
}
if (global.fetch) jest.spyOn(global, 'fetch').mockImplementation(blocked);
