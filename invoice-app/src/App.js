import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import ProtectedRoute from './components/auth/ProtectedRoute';
import AppLayout from './components/layout/AppLayout';

import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import CreateAccountPage from './pages/CreateAccountPage';
import AcceptInvitePage from './pages/AcceptInvitePage';
import DashboardPage from './pages/DashboardPage';
import ClaimsPage from './pages/ClaimsPage';
import ClaimDetailPage from './pages/ClaimDetailPage';
import InvoicesPage from './pages/InvoicesPage';
import InvoiceDetailPage from './pages/InvoiceDetailPage';
import ManagerFolderPage from './pages/ManagerFolderPage';
import TeamPage from './pages/TeamPage';
import OnboardingPage from './pages/OnboardingPage';
import InvoiceTemplatesSettingsPage from './pages/InvoiceTemplatesSettingsPage';
import DocumentTemplatesPage from './pages/DocumentTemplatesPage';
import MapYourFormPage from './pages/MapYourFormPage';
import TestAndActivatePage from './pages/TestAndActivatePage';
import MyDocumentsPage from './pages/MyDocumentsPage';
import ProfilePage from './pages/ProfilePage';

function App() {
  return (
    <ThemeProvider>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/register" element={<CreateAccountPage />} />
          <Route path="/accept-invite" element={<AcceptInvitePage />} />

          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <AppLayout><DashboardPage /></AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/claims"
            element={
              <ProtectedRoute>
                <AppLayout><ClaimsPage /></AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/claims/:id"
            element={
              <ProtectedRoute>
                <AppLayout><ClaimDetailPage /></AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/invoices"
            element={
              <ProtectedRoute>
                <AppLayout><InvoicesPage /></AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/invoices/:id"
            element={
              <ProtectedRoute>
                <AppLayout><InvoiceDetailPage /></AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/manager-folder"
            element={
              <ProtectedRoute roles={['owner', 'manager']}>
                <AppLayout><ManagerFolderPage /></AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/team"
            element={
              <ProtectedRoute roles={['owner', 'manager']}>
                <AppLayout><TeamPage /></AppLayout>
              </ProtectedRoute>
            }
          />
          <Route path="/users" element={<Navigate to="/team" replace />} />
          <Route
            path="/onboarding"
            element={
              <ProtectedRoute skipOnboardingRedirect>
                <OnboardingPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/documents"
            element={
              <ProtectedRoute>
                <AppLayout><MyDocumentsPage /></AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/profile"
            element={
              <ProtectedRoute>
                <AppLayout><ProfilePage /></AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings/invoice-templates"
            element={
              <ProtectedRoute roles={['owner']}>
                <AppLayout><InvoiceTemplatesSettingsPage /></AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings/document-templates"
            element={
              <ProtectedRoute roles={['owner', 'manager']}>
                <AppLayout><DocumentTemplatesPage /></AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings/document-templates/:id/map/:versionId"
            element={
              <ProtectedRoute roles={['owner', 'manager']}>
                <AppLayout><MapYourFormPage /></AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings/document-templates/:id/test/:versionId"
            element={
              <ProtectedRoute roles={['owner', 'manager']}>
                <AppLayout><TestAndActivatePage /></AppLayout>
              </ProtectedRoute>
            }
          />

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
      <ToastContainer position="top-right" autoClose={3000} hideProgressBar />
    </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
