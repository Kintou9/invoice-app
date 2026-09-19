-- Real "Last active" signal for the Team page — stamped wherever a fresh
-- JWT is actually issued (login, register, accept-invite, switch-org,
-- password-reset auto-login; see touchLastActive in routes/auth.js).
-- Session-level, not per-request, but real rather than fabricated.
ALTER TABLE organization_members ADD COLUMN last_active_at TIMESTAMPTZ;
