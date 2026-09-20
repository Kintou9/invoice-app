const { Resend } = require('resend');
const config = require('../config');

// inviterName/organizationName/message are all user-controlled (set at
// registration or typed into the invite form) and land directly in HTML
// email bodies below — escape before interpolating so a name like
// "<img src=x onerror=...>" can't inject markup into the sent email.
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let _client = null;
const getClient = () => {
  if (!_client) {
    if (!config.resend.apiKey) {
      throw new Error('RESEND_API_KEY is missing. Get yours at resend.com');
    }
    _client = new Resend(config.resend.apiKey);
  }
  return _client;
};

/**
 * Send a team invitation email with a link to accept it.
 * inviteUrl should already include the token as a query param.
 */
async function sendInviteEmail({ to, organizationName, inviterName, role, inviteUrl, message, expiresInDays = 7 }) {
  const client = getClient();
  const safeInviter = escapeHtml(inviterName);
  const safeOrg = escapeHtml(organizationName);
  const safeRole = escapeHtml(role);
  const safeMessage = escapeHtml(message);
  const { error } = await client.emails.send({
    from: config.resend.fromEmail,
    to,
    subject: `${inviterName} invited you to join ${organizationName} on Trackly`,
    html: `
      <p>${safeInviter} has invited you to join <strong>${safeOrg}</strong> on Trackly as a <strong>${safeRole}</strong>.</p>
      ${message ? `<p>"${safeMessage}"</p>` : ''}
      <p><a href="${inviteUrl}">Accept the invitation</a> to set up your account.</p>
      <p>This link expires in ${expiresInDays} day${expiresInDays === 1 ? '' : 's'}.</p>
    `,
  });
  if (error) throw new Error(error.message || 'Failed to send invite email');
}

/**
 * Send a password reset email with a link to set a new password.
 * resetUrl should already include the token as a query param.
 */
async function sendPasswordResetEmail({ to, resetUrl }) {
  const client = getClient();
  const { error } = await client.emails.send({
    from: config.resend.fromEmail,
    to,
    subject: 'Reset your Trackly password',
    html: `
      <p>Someone requested a password reset for this account.</p>
      <p><a href="${resetUrl}">Reset your password</a> — this link expires in 1 hour.</p>
      <p>If you didn't request this, you can safely ignore this email.</p>
    `,
  });
  if (error) throw new Error(error.message || 'Failed to send password reset email');
}

module.exports = { sendInviteEmail, sendPasswordResetEmail };
