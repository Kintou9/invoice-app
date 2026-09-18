import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

export default function ProtectedRoute({ children, roles, skipOnboardingRedirect }) {
  const { user, loading } = useAuth();

  if (loading) return <div className="loading-screen">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/dashboard" replace />;

  // Only an owner drives onboarding — workers/managers have onboardingStatus
  // null (see routes/auth.js toUserResponse) and are never redirected here.
  // "Save & exit" on the onboarding page sets this for the rest of the
  // browser session, so leaving mid-way actually works instead of bouncing
  // straight back — progress up to that point is already persisted
  // server-side, so the next real login (sessionStorage cleared) resumes
  // onboarding normally.
  const dismissedThisSession = sessionStorage.getItem('onboarding_dismissed') === '1';
  if (!skipOnboardingRedirect && !dismissedThisSession && user.role === 'owner' && user.onboardingStatus && user.onboardingStatus !== 'completed') {
    return <Navigate to="/onboarding" replace />;
  }

  return children;
}
