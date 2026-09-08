-- Email invitations: an owner/manager invites someone by email; that
-- creates a real users row (no password yet — they set one on accept) and
-- an organization_members row with status='invited', carrying a one-time
-- token used in the invite email link. Applied directly against the live
-- DB, same pattern as 002_multi_tenancy.sql.

BEGIN;

-- Invited users don't have a password until they accept.
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

ALTER TABLE organization_members ADD COLUMN invite_token TEXT UNIQUE;
ALTER TABLE organization_members ADD COLUMN invite_expires_at TIMESTAMPTZ;

COMMIT;
