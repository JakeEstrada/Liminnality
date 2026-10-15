/**
 * App — Root router: public auth routes, kiosk views, and MainLayout shell.
 * Route map: see ../../docs/PAGES.md
 */
import type { JSX } from 'react';
import { useEffect } from 'react';
import { Box, useTheme } from '@mui/material';
import { Routes, Route, Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { FinancialPinLockProvider } from './context/FinancialPinLockContext';
import FinancialPinUnlockDialogHost from './components/common/FinancialPinUnlockDialogHost';
import UserAuditTracker from './components/common/UserAuditTracker';
import MainLayout from './components/layout/MainLayout';
import ViewModeFrame from './components/layout/ViewModeFrame';
import ProtectedRoute from './components/ProtectedRoute';
import MobileRouteGuard from './components/MobileRouteGuard';
import { useIsMobile } from './hooks/useIsMobile';
import { MOBILE_HOME_PATH } from './utils/mobileNav';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import ForgotUsernamePage from './pages/ForgotUsernamePage';
import PrivacyPolicy from './pages/PrivacyPolicy';
import TermsAndConditions from './pages/TermsAndConditions';
import SmsConsentPage from './pages/SmsConsentPage';
import PipelinePage from './pages/PipelinePage';
import JobArchivePage from './pages/JobArchivePage';
import CompletedJobsPage from './pages/CompletedJobsPage';
import CompletedTasksPage from './pages/CompletedTasksPage';
import CalendarPage from './pages/CalendarPage';
import TasksPage from './pages/TasksPage';
import DeveloperTasksPage from './pages/DeveloperTasksPage';
import WebsitePage from './pages/WebsitePage';
import WebsiteAnalyticsPage from './pages/WebsiteAnalyticsPage';
import CustomersPage from './pages/CustomersPage';
import PayrollPage from './pages/PayrollPage';
import CommissionLogsPage from './pages/CommissionLogsPage';
import UsersPage from './pages/UsersPage';
import BillsPage from './pages/BillsPage';
import AccountSettingsPage from './pages/AccountSettingsPage';
import DashboardPage from './pages/DashboardPage';
import KioskDashboardPage from './pages/KioskDashboardPage';
import PdfViewerPage from './pages/PdfViewerPage';
import PictureViewerPage from './pages/PictureViewerPage';
import ContractCoverPrintPage from './pages/ContractCoverPrintPage';
import FinanceHubPage from './pages/FinanceHubPage';
import TakeoffSheetPage from './pages/TakeoffSheetPage';
import VendorsPage from './pages/VendorsPage';
import MessagePage from './pages/MessagePage';
import RfidPage from './pages/RfidPage';

function OutlookToMessagesRedirect() {
  const [params] = useSearchParams();
  const next = new URLSearchParams(params);
  next.set('tab', 'inbox');
  return <Navigate to={`/messages?${next.toString()}`} replace />;
}

function ShopWindowOrPage({
  view,
  children,
}: {
  view: 'dashboard' | 'pipeline' | 'calendar' | 'customers';
  children: JSX.Element;
}) {
  const { user } = useAuth();
  if (user?.role === 'shop_view') {
    return <Navigate to={`/${view}-view`} replace />;
  }
  return children;
}

function App(): JSX.Element | null {
  const { user, loading } = useAuth();
  const theme = useTheme();
  const isMobile = useIsMobile();
  const homePath = isMobile ? MOBILE_HOME_PATH : '/dashboard';

  useEffect(() => {
    document.title = 'Liminnality';
  }, []);

  if (loading) {
    return null; // Loading handled by ProtectedRoute
  }

  return (
    <FinancialPinLockProvider>
    <Box
      sx={{
        minHeight: '100vh',
        background: theme.palette.mode === 'dark'
          ? '#121212'
          : 'linear-gradient(135deg, #E9EEF3 0%, #DEE7F0 100%)',
      }}
    >
      <Routes>
        {/* --- Public auth & legal (no sidebar) --- */}
        <Route path="/login" element={user ? <Navigate to="/pipeline" replace /> : <LoginPage />} />
        <Route path="/register" element={user ? <Navigate to="/pipeline" replace /> : <RegisterPage />} />
        <Route path="/forgot-password" element={user ? <Navigate to="/pipeline" replace /> : <ForgotPasswordPage />} />
        <Route path="/reset-password" element={user ? <Navigate to="/pipeline" replace /> : <ResetPasswordPage />} />
        <Route path="/forgot-username" element={user ? <Navigate to="/pipeline" replace /> : <ForgotUsernamePage />} />
        <Route path="/privacy-policy" element={<PrivacyPolicy />} />
        <Route path="/terms" element={<TermsAndConditions />} />
        <Route path="/sms-consent" element={<SmsConsentPage />} />

        {/* --- Kiosk / TV full-screen views --- */}
        <Route
          path="/dashboard-view"
          element={
            <ProtectedRoute>
              <ViewModeFrame currentView="dashboard">
                <KioskDashboardPage />
              </ViewModeFrame>
            </ProtectedRoute>
          }
        />
        <Route
          path="/calendar-view"
          element={
            <ProtectedRoute>
              <ViewModeFrame currentView="calendar">
                <CalendarPage tvMode externalViewControls />
              </ViewModeFrame>
            </ProtectedRoute>
          }
        />
        <Route
          path="/pipeline-view"
          element={
            <ProtectedRoute>
              <ViewModeFrame currentView="pipeline">
                <PipelinePage tvMode externalViewControls />
              </ViewModeFrame>
            </ProtectedRoute>
          }
        />
        <Route
          path="/customers-view"
          element={
            <ProtectedRoute>
              <ViewModeFrame currentView="customers">
                <CustomersPage viewMode externalViewControls />
              </ViewModeFrame>
            </ProtectedRoute>
          }
        />

        {/* --- Standalone file viewers (no sidebar) --- */}
        <Route
          path="/pdf/:fileId"
          element={
            <ProtectedRoute>
              <PdfViewerPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/picture/:fileId"
          element={
            <ProtectedRoute>
              <PictureViewerPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/print/contract-cover"
          element={
            <ProtectedRoute>
              <ContractCoverPrintPage />
            </ProtectedRoute>
          }
        />

        {/* --- Main app: sidebar + nested page routes --- */}
        <Route
          path="/*"
          element={
            <ProtectedRoute>
              <MainLayout>
                <MobileRouteGuard>
                <Routes>
                  <Route
                    path="/"
                    element={<Navigate to={user?.role === 'shop_view' ? '/dashboard-view' : homePath} replace />}
                  />
                  <Route
                    path="/dashboard"
                    element={(
                      <ShopWindowOrPage view="dashboard">
                        <DashboardPage />
                      </ShopWindowOrPage>
                    )}
                  />
                  <Route
                    path="/pipeline"
                    element={(
                      <ShopWindowOrPage view="pipeline">
                        <PipelinePage />
                      </ShopWindowOrPage>
                    )}
                  />
                  <Route path="/outlook" element={<OutlookToMessagesRedirect />} />
                  <Route
                    path="/customers"
                    element={(
                      <ShopWindowOrPage view="customers">
                        <CustomersPage />
                      </ShopWindowOrPage>
                    )}
                  />
                  <Route
                    path="/calendar"
                    element={(
                      <ShopWindowOrPage view="calendar">
                        <CalendarPage />
                      </ShopWindowOrPage>
                    )}
                  />
                  <Route path="/tasks" element={<TasksPage />} />
                  <Route path="/documents" element={<Navigate to="/dashboard" replace />} />
                  <Route path="/messages" element={<MessagePage />} />
                  <Route path="/rfid" element={<RfidPage />} />
                  <Route path="/dead-estimates" element={<Navigate to="/archive" replace />} />
                  <Route path="/archive" element={<JobArchivePage />} />
                  <Route path="/completed-appointments" element={<Navigate to="/completed-tasks" replace />} />
                  <Route path="/completed-jobs" element={<CompletedJobsPage />} />
                  <Route path="/completed-tasks" element={<CompletedTasksPage />} />
                  <Route path="/website" element={<ProtectedRoute requireSuperAdmin><WebsitePage /></ProtectedRoute>} />
                  <Route path="/developer/analytics" element={<ProtectedRoute requireSuperAdmin><WebsiteAnalyticsPage /></ProtectedRoute>} />
                  <Route path="/developer" element={<ProtectedRoute requireSuperAdmin><DeveloperTasksPage /></ProtectedRoute>} />
                  <Route path="/payroll" element={<PayrollPage />} />
                  <Route path="/rfid-timesheets" element={<Navigate to="/payroll?tab=payroll" replace />} />
                  <Route path="/commission-logs" element={<CommissionLogsPage />} />
                  <Route path="/bills" element={<ProtectedRoute requireSuperAdmin><BillsPage /></ProtectedRoute>} />
                  <Route path="/finance" element={<ProtectedRoute requireSuperAdmin><FinanceHubPage /></ProtectedRoute>} />
                  <Route path="/takeoff-sheet" element={<TakeoffSheetPage />} />
                  <Route path="/vendors" element={<VendorsPage />} />
                  <Route path="/users" element={<ProtectedRoute requireSuperAdmin><UsersPage /></ProtectedRoute>} />
                  <Route path="/account-settings" element={<AccountSettingsPage />} />
                </Routes>
                </MobileRouteGuard>
              </MainLayout>
            </ProtectedRoute>
          }
        />
      </Routes>
    </Box>
    <FinancialPinUnlockDialogHost />
    <UserAuditTracker />
    </FinancialPinLockProvider>
  );
}

export default App;
