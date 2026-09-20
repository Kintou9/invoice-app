// Tests the REAL services/email.js — every other test file gets it
// auto-mocked away via tests/setup.js, but the whole point here is to
// prove the actual HTML sent to Resend has user-controlled content
// (inviterName, organizationName, role, message) properly escaped.
// Only the Resend SDK itself is mocked, so the request never leaves
// this process.
jest.unmock('../src/services/email');
jest.mock('../src/config', () => ({
  frontendUrl: 'http://localhost:3000',
  resend: { apiKey: 'test-key', fromEmail: 'test@example.com' },
}));

const mockSend = jest.fn().mockResolvedValue({ error: null });
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({ emails: { send: mockSend } })),
}));

const { sendInviteEmail } = require('../src/services/email');

beforeEach(() => mockSend.mockClear());

describe('sendInviteEmail — HTML escaping', () => {
  const maliciousPayload = '<img src=x onerror="alert(document.cookie)">';

  test('a malicious inviter name is encoded, not executable, in the sent HTML', async () => {
    await sendInviteEmail({
      to: 'victim@example.com',
      organizationName: 'Safe Org',
      inviterName: maliciousPayload,
      role: 'worker',
      inviteUrl: 'http://localhost:3000/accept-invite?token=abc',
    });

    const html = mockSend.mock.calls[0][0].html;
    expect(html).not.toContain('<img src=x onerror=');
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(document.cookie)&quot;&gt;');
  });

  test('a malicious organization name is encoded', async () => {
    await sendInviteEmail({
      to: 'victim@example.com',
      organizationName: maliciousPayload,
      inviterName: 'Safe Person',
      role: 'worker',
      inviteUrl: 'http://localhost:3000/accept-invite?token=abc',
    });

    const html = mockSend.mock.calls[0][0].html;
    expect(html).not.toContain('<img src=x onerror=');
  });

  test('a malicious role value is encoded', async () => {
    await sendInviteEmail({
      to: 'victim@example.com',
      organizationName: 'Safe Org',
      inviterName: 'Safe Person',
      role: '<script>alert(1)</script>',
      inviteUrl: 'http://localhost:3000/accept-invite?token=abc',
    });

    const html = mockSend.mock.calls[0][0].html;
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('a malicious invite message is encoded', async () => {
    await sendInviteEmail({
      to: 'victim@example.com',
      organizationName: 'Safe Org',
      inviterName: 'Safe Person',
      role: 'worker',
      inviteUrl: 'http://localhost:3000/accept-invite?token=abc',
      message: maliciousPayload,
    });

    const html = mockSend.mock.calls[0][0].html;
    expect(html).not.toContain('<img src=x onerror=');
  });

  test('the invite link URL itself is never escaped — it would break the href', async () => {
    await sendInviteEmail({
      to: 'victim@example.com',
      organizationName: 'Safe Org',
      inviterName: 'Safe Person',
      role: 'worker',
      inviteUrl: 'http://localhost:3000/accept-invite?token=abc&ref=1',
    });

    const html = mockSend.mock.calls[0][0].html;
    expect(html).toContain('href="http://localhost:3000/accept-invite?token=abc&ref=1"');
  });
});

describe('sendInviteEmail — legitimate content still renders correctly', () => {
  test('an apostrophe in the inviter name is encoded but reads correctly', async () => {
    await sendInviteEmail({
      to: 'victim@example.com',
      organizationName: 'Acme',
      inviterName: "Pat O'Brien",
      role: 'manager',
      inviteUrl: 'http://localhost:3000/accept-invite?token=abc',
    });

    const html = mockSend.mock.calls[0][0].html;
    // &#39; is the correct, standard HTML entity for an apostrophe — not
    // mangled, not double-escaped, and renders as a real ' in any mail client.
    expect(html).toContain('Pat O&#39;Brien');
    expect(html).not.toContain("Pat O'Brien has invited"); // raw quote never reaches the HTML unescaped
  });

  test('an ampersand in the organization name is encoded but reads correctly', async () => {
    await sendInviteEmail({
      to: 'victim@example.com',
      organizationName: 'Smith & Sons Plumbing',
      inviterName: 'Alex',
      role: 'worker',
      inviteUrl: 'http://localhost:3000/accept-invite?token=abc',
    });

    const html = mockSend.mock.calls[0][0].html;
    expect(html).toContain('Smith &amp; Sons Plumbing');
  });

  test('an ordinary invite message renders in full, just escaped', async () => {
    await sendInviteEmail({
      to: 'victim@example.com',
      organizationName: 'Acme',
      inviterName: 'Alex',
      role: 'worker',
      inviteUrl: 'http://localhost:3000/accept-invite?token=abc',
      message: "Looking forward to having you on the team — let's get started!",
    });

    const html = mockSend.mock.calls[0][0].html;
    expect(html).toContain('Looking forward to having you on the team');
    expect(html).toContain('let&#39;s get started!');
  });

  test('the correct sender, recipient, and subject are still set', async () => {
    await sendInviteEmail({
      to: 'victim@example.com',
      organizationName: 'Acme',
      inviterName: 'Alex',
      role: 'worker',
      inviteUrl: 'http://localhost:3000/accept-invite?token=abc',
    });

    const call = mockSend.mock.calls[0][0];
    expect(call.from).toBe('test@example.com');
    expect(call.to).toBe('victim@example.com');
    expect(call.subject).toBe('Alex invited you to join Acme on Trackly');
  });
});
