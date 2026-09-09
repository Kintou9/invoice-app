-- Password reset tokens. Lives directly on users (not organization_members
-- like invite tokens) since resetting a password is a per-user operation,
-- independent of any specific organization membership.

BEGIN;

ALTER TABLE users ADD COLUMN reset_token TEXT UNIQUE;
ALTER TABLE users ADD COLUMN reset_token_expires_at TIMESTAMPTZ;

COMMIT;
