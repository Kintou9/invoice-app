const { Resend } = require('resend');
const config = require('../config');

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
async function sendInviteEmail({ to, organizationName, inviterName, role, inviteUrl }) {
  const client = getClient();
  const { error } = await client.emails.send({
    from: config.resend.fromEmail,
    to,
    subject: `${inviterName} invited you to join ${organizationName} on Trackly`,
    html: `
      <p>${inviterName} has invited you to join <strong>${organizationName}</strong> on Trackly as a <strong>${role}</strong>.</p>
      <p><a href="${inviteUrl}">Accept the invitation</a> to set up your account.</p>
      <p>This link expires in 7 days.</p>
    `,
  });
  if (error) throw new Error(error.message || 'Failed to send invite email');
}

module.exports = { sendInviteEmail };
