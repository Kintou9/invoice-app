import { Lock, Briefcase, Wrench, Eye } from 'lucide-react';

// Single source of truth for what each role can/cannot do — drives both the
// invite modal's live permission preview and the member drawer's "Role and
// access explanation". 'owner' is included for that explanation text, but
// is deliberately never offered as an invite/edit choice anywhere in the
// UI — the only way a membership becomes 'owner' is Transfer Ownership.
export const ROLE_PERMISSIONS = {
  owner: {
    label: 'Owner',
    icon: Lock,
    can: [
      'Complete workspace control',
      'Manage billing and workspace settings',
      'Manage the team and invitations',
      'Approve work and access everything managers can',
    ],
    cannot: [],
  },
  manager: {
    label: 'Manager',
    icon: Briefcase,
    can: [
      'Manage workers and job assignments',
      'Review and approve submitted work',
      'Manage invoices and payments',
      'Invite and manage team members',
    ],
    cannot: ['Cannot change billing or remove the workspace owner'],
  },
  worker: {
    label: 'Worker',
    icon: Wrench,
    can: [
      'View assigned jobs',
      'Update job status',
      'Document work, add parts and photos',
      'Submit work for manager review',
    ],
    cannot: ['Cannot manage team members, approve work, or access billing settings'],
  },
  viewer: {
    label: 'Viewer',
    icon: Eye,
    can: ['Read-only access to authorized workspace information'],
    cannot: ['Cannot create, edit, approve, invite, or remove anything'],
  },
};

// Roles a normal invite/role-change action may ever grant — 'owner' is
// excluded on purpose everywhere this is used.
export const ASSIGNABLE_ROLES = ['manager', 'worker', 'viewer'];
