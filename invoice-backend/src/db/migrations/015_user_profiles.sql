-- My Profile feature. All columns nullable — existing users are
-- unaffected, and every existing query selecting `users.name` keeps
-- working unchanged (name stays the source of truth for display; first/
-- last are kept in sync alongside it on save rather than replacing it,
-- since dozens of existing queries already join on u.name).
-- Reversible: DROP COLUMN each of these to roll back.
ALTER TABLE users ADD COLUMN first_name TEXT;
ALTER TABLE users ADD COLUMN last_name TEXT;
ALTER TABLE users ADD COLUMN phone TEXT;
-- Two sizes only (not three) — a client-cropped square is normalized
-- server-side into a ~400px "large" version (profile page, crop preview)
-- and a ~96px "small" version (every other avatar instance: sidebar,
-- team list, job assignments, comments). The original upload is never
-- stored or served.
ALTER TABLE users ADD COLUMN avatar_blob_url TEXT;
ALTER TABLE users ADD COLUMN avatar_thumb_blob_url TEXT;

-- Job title is scoped to a membership, not the account — the same person
-- can hold a different title at each organization they belong to.
ALTER TABLE organization_members ADD COLUMN job_title TEXT;
