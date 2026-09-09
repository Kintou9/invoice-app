-- In-app notifications for the approval workflow: claim assigned, invoice
-- submitted for review, invoice approved/rejected. recipient_member_id
-- points at organization_members.id (not users.id), matching the
-- membership-based assignment model — a notification belongs to a specific
-- membership, not a person in the abstract, same reasoning as 004.

BEGIN;

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  recipient_member_id UUID NOT NULL REFERENCES organization_members(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  message TEXT NOT NULL,
  link TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notifications_recipient ON notifications(recipient_member_id, read_at);

COMMIT;
