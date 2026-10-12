/**
 * Sidebar — Primary navigation groups (workspace, finance, operations, archive).
 * Admin-only items filtered via useAuth().isAdmin(); super-admin items via isSuperAdmin().
 */
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Box,
  Typography,
  Divider,
  Chip,
  useTheme,
  useMediaQuery,
} from '@mui/material';
import {
  Dashboard as DashboardIcon,
  AccountTree as PipelineIcon,
  People as CustomersIcon,
  CalendarToday as CalendarIcon,
  Assignment as TasksIcon,
  Archive as ArchiveIcon,
  CheckCircle as CompletedJobsIcon,
  Code as DeveloperIcon,
  AccountBalance as PayrollIcon,
  Nfc as RfidTimesheetIcon,
  Person as UsersIcon,
  Receipt as ReceiptIcon,
  TableChart as TableChartIcon,
  ViewWeek as PipelineViewKioskIcon,
  AccountBalanceWallet as FinanceHubIcon,
  TableRows as TakeoffIcon,
  Sms as SmsIcon,
  Store as StoreIcon,
  Language as WebsiteIcon,
  Insights as AnalyticsIcon,
  Nfc as NfcIcon,
  RecordVoiceOver as VoiceCommandsIcon,
} from '@mui/icons-material';
import { useAuth } from '../../context/AuthContext';
import BrandLogo from '../common/BrandLogo';
import api from '../../utils/axios';
import { fetchUnreadSmsCount } from '../../utils/twilioApi';
import { useSocketSubscription } from '../../hooks/useSocketSubscription';
import { getTenantRoom } from '../../services/socket';

const DRAWER_WIDTH = 260;

const workspaceItems = [
  { text: 'Dashboard', icon: <DashboardIcon />, path: '/dashboard' },
  { text: 'Pipeline', icon: <PipelineIcon />, path: '/pipeline' },
  { text: 'Customers', icon: <CustomersIcon />, path: '/customers' },
  { text: 'Projects & Tasks', icon: <TasksIcon />, path: '/tasks' },
  { text: 'Calendar', icon: <CalendarIcon />, path: '/calendar' },
  { text: 'Messages', icon: <SmsIcon />, path: '/messages' },
];

const financeItems = [
  { text: 'Finance Hub', icon: <FinanceHubIcon />, path: '/finance', superAdminOnly: true },
  { text: 'Bills', icon: <ReceiptIcon />, path: '/bills', superAdminOnly: true },
  { text: 'Payroll', icon: <PayrollIcon />, path: '/payroll' },
  { text: 'RFID Timesheets', icon: <RfidTimesheetIcon />, path: '/rfid-timesheets' },
  { text: 'Commission Logs', icon: <TableChartIcon />, path: '/commission-logs' },
];

const operationsItems = [
  { text: 'Take Off Sheet', icon: <TakeoffIcon />, path: '/takeoff-sheet' },
  { text: 'Vendors', icon: <StoreIcon />, path: '/vendors' },
  { text: 'Users', icon: <UsersIcon />, path: '/users', superAdminOnly: true },
];

const archiveItems = [
  { text: 'Job Archive', icon: <ArchiveIcon />, path: '/archive' },
  { text: 'Completed Jobs', icon: <CompletedJobsIcon />, path: '/completed-jobs' },
  { text: 'Weekly Activity Log', icon: <TasksIcon />, path: '/completed-tasks' },
];

/** Phones only get these pages — see utils/mobileNav.ts for the matching route guard. */
const mobileItems = [
  { text: 'Calendar', icon: <CalendarIcon />, path: '/calendar' },
  { text: 'Pipeline', icon: <PipelineIcon />, path: '/pipeline' },
  { text: 'Customers', icon: <CustomersIcon />, path: '/customers' },
  { text: 'Commission Logs', icon: <TableChartIcon />, path: '/commission-logs' },
  { text: 'Website Analytics', icon: <AnalyticsIcon />, path: '/developer/analytics', superAdminOnly: true },
];

function Sidebar({ mobileOpen, onMobileClose }) {
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const { isAdmin, isSuperAdmin, user, tenantIdForBranding } = useAuth();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [inboxCount, setInboxCount] = useState(0);
  const [unreadSmsCount, setUnreadSmsCount] = useState(0);
  const reloadUnreadRef = useRef(() => {});

  useEffect(() => {
    if (!user || (user.role !== 'super_admin' && user.role !== 'admin')) return undefined;
    let cancelled = false;
    api
      .get('/outlook/status')
      .then(({ data }) => {
        if (!cancelled) setInboxCount(Number(data?.worksheetCount) || 0);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [location.pathname, user]);

  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;
    const load = () => {
      fetchUnreadSmsCount()
        .then((count) => {
          if (!cancelled) setUnreadSmsCount(count);
        })
        .catch(() => {
          if (!cancelled) setUnreadSmsCount(0);
        });
    };
    load();
    reloadUnreadRef.current = load;
    const timer = window.setInterval(load, 45_000);
    const onFocus = () => load();
    const onUnreadChanged = () => load();
    window.addEventListener('focus', onFocus);
    window.addEventListener('paarth:sms-unread-changed', onUnreadChanged);
    return () => {
      cancelled = true;
      reloadUnreadRef.current = () => {};
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('paarth:sms-unread-changed', onUnreadChanged);
    };
  }, [location.pathname, user]);

  // A reply pushed from Twilio updates the badge straight away instead of on the next poll.
  const handleInboundSms = useCallback(() => {
    reloadUnreadRef.current();
  }, []);

  useSocketSubscription(
    user ? getTenantRoom(tenantIdForBranding) : null,
    'sms.inbound.created',
    handleInboundSms,
  );

  const isActive = (path, { exact } = {}) => {
    const [pathnameOnly, queryOnly] = String(path || '').split('?');
    if (queryOnly) {
      return location.pathname === pathnameOnly && location.search === `?${queryOnly}`;
    }
    if (exact) return location.pathname === path;
    return location.pathname === path || location.pathname.startsWith(path + '/');
  };

  const handleNavigation = (path) => {
    navigate(path);
    if (isMobile) {
      onMobileClose();
    }
  };

  const navButtonSx = {
    mx: 1,
    mb: 0.5,
    borderRadius: '8px',
    '&.Mui-selected': {
      backgroundColor:
        theme.palette.mode === 'dark' ? 'rgba(25, 118, 210, 0.16)' : '#E3F2FD',
      color: theme.palette.primary.main,
      '&:hover': {
        backgroundColor:
          theme.palette.mode === 'dark' ? 'rgba(25, 118, 210, 0.24)' : '#BBDEFB',
      },
      '& .MuiListItemIcon-root': {
        color: theme.palette.primary.main,
      },
    },
    '&:hover': {
      backgroundColor:
        theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.08)' : '#F5F5F5',
    },
  };

  const canSeeItem = (item) => {
    if (item.superAdminOnly) return isSuperAdmin();
    if (item.adminOnly) return isAdmin();
    return true;
  };

  const renderNavItem = (item, { nested = false } = {}) => (
    <ListItem key={item.path} disablePadding>
      <ListItemButton
        onClick={() => handleNavigation(item.path)}
        selected={isActive(item.path)}
        sx={{ ...navButtonSx, ...(nested ? { pl: 5 } : {}) }}
      >
        <ListItemIcon
          sx={{
            minWidth: 40,
            color: isActive(item.path) ? theme.palette.primary.main : 'inherit',
          }}
        >
          {item.icon}
        </ListItemIcon>
        <ListItemText
          primary={item.text}
          primaryTypographyProps={{
            fontSize: nested ? '0.875rem' : '0.9375rem',
            fontWeight: isActive(item.path) ? 600 : 400,
          }}
        />
        {item.path === '/messages' && inboxCount > 0 ? (
          <Chip size="small" color="warning" label={inboxCount} sx={{ ml: 1, height: 22 }} />
        ) : null}
        {item.path === '/messages' && unreadSmsCount > 0 ? (
          <Chip
            size="small"
            color="error"
            label={`+${unreadSmsCount}`}
            aria-label={`${unreadSmsCount} unread message${unreadSmsCount === 1 ? '' : 's'}`}
            sx={{ ml: 1, height: 22, fontWeight: 700 }}
          />
        ) : null}
      </ListItemButton>
    </ListItem>
  );

  const renderNavList = (items) => (
    <List>
      {items.filter(canSeeItem).map((item) => (
        <Fragment key={item.path}>
          {renderNavItem(item)}
          {(item.children || []).filter(canSeeItem).map((child) => renderNavItem(child, { nested: true }))}
        </Fragment>
      ))}
    </List>
  );

  const brandHeader = (
    <Box
      sx={{
        p: isMobile ? 1.5 : 3,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderBottom: `1px solid ${theme.palette.divider}`,
      }}
    >
      <BrandLogo
        alt="Liminnality"
        sx={{
          height: isMobile ? 56 : 96,
          width: 'auto',
          maxWidth: '100%',
          objectFit: 'contain',
        }}
      />
    </Box>
  );

  const mobileDrawerContent = (
    <>
      {brandHeader}
      {renderNavList(mobileItems)}
    </>
  );

  const drawerContent = (
    <>
      {brandHeader}

      <Box sx={{ px: 2, pt: 2, pb: 1 }}>
        <Typography
          variant="caption"
          sx={{
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            fontWeight: 600,
            color: theme.palette.text.secondary,
            fontSize: '0.75rem',
          }}
        >
          Workspace
        </Typography>
      </Box>

      {renderNavList(workspaceItems)}

      <List>
        {user?.role === 'shop_view' && (
          <ListItem disablePadding>
            <ListItemButton
              onClick={() => handleNavigation('/dashboard-view')}
              selected={isActive('/dashboard-view')}
              sx={navButtonSx}
            >
              <ListItemIcon
                sx={{
                  minWidth: 40,
                  color: isActive('/dashboard-view') ? theme.palette.primary.main : 'inherit',
                }}
              >
                <PipelineViewKioskIcon />
              </ListItemIcon>
              <ListItemText
                primary="Shop View"
                primaryTypographyProps={{
                  fontSize: '0.9375rem',
                  fontWeight: isActive('/dashboard-view') ? 600 : 400,
                }}
              />
            </ListItemButton>
          </ListItem>
        )}
      </List>

      <Divider sx={{ my: 2 }} />

      <Box sx={{ px: 2, pb: 1 }}>
        <Typography
          variant="caption"
          sx={{
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            fontWeight: 600,
            color: theme.palette.text.secondary,
            fontSize: '0.75rem',
          }}
        >
          Finance
        </Typography>
      </Box>

      {renderNavList(financeItems)}

      <Divider sx={{ my: 2 }} />

      <Box sx={{ px: 2, pb: 1 }}>
        <Typography
          variant="caption"
          sx={{
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            fontWeight: 600,
            color: theme.palette.text.secondary,
            fontSize: '0.75rem',
          }}
        >
          Operations
        </Typography>
      </Box>

      {renderNavList(operationsItems)}

      <Divider sx={{ my: 2 }} />

      <Box sx={{ px: 2, pb: 1 }}>
        <Typography
          variant="caption"
          sx={{
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            fontWeight: 600,
            color: theme.palette.text.secondary,
            fontSize: '0.75rem',
          }}
        >
          Archive & History
        </Typography>
      </Box>

      <List>
        {archiveItems.map((item) => (
          <ListItem key={item.path} disablePadding>
            <ListItemButton
              onClick={() => handleNavigation(item.path)}
              selected={isActive(item.path)}
              sx={navButtonSx}
            >
              <ListItemIcon
                sx={{
                  minWidth: 40,
                  color: isActive(item.path) ? theme.palette.primary.main : 'inherit',
                }}
              >
                {item.icon}
              </ListItemIcon>
              <ListItemText
                primary={item.text}
                primaryTypographyProps={{
                  fontSize: '0.9375rem',
                  fontWeight: isActive(item.path) ? 600 : 400,
                }}
              />
            </ListItemButton>
          </ListItem>
        ))}
      </List>

      <Divider sx={{ my: 2 }} />

      <Box sx={{ px: 2, pb: 1 }}>
        <Typography
          variant="caption"
          sx={{
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            fontWeight: 600,
            color: theme.palette.text.secondary,
            fontSize: '0.75rem',
          }}
        >
          Developer
        </Typography>
      </Box>

      <List>
        <ListItem disablePadding>
          <ListItemButton
            onClick={() => handleNavigation('/rfid')}
            selected={isActive('/rfid')}
            sx={navButtonSx}
          >
            <ListItemIcon
              sx={{
                minWidth: 40,
                color: isActive('/rfid') ? theme.palette.primary.main : 'inherit',
              }}
            >
              <NfcIcon />
            </ListItemIcon>
            <ListItemText
              primary="RFID scans"
              primaryTypographyProps={{
                fontSize: '0.9375rem',
                fontWeight: isActive('/rfid') ? 600 : 400,
              }}
            />
          </ListItemButton>
        </ListItem>
        {isSuperAdmin() ? (
        <>
        <ListItem disablePadding>
          <ListItemButton
            onClick={() => handleNavigation('/website')}
            selected={isActive('/website')}
            sx={navButtonSx}
          >
            <ListItemIcon
              sx={{
                minWidth: 40,
                color: isActive('/website') ? theme.palette.primary.main : 'inherit',
              }}
            >
              <WebsiteIcon />
            </ListItemIcon>
            <ListItemText
              primary="Website"
              primaryTypographyProps={{
                fontSize: '0.9375rem',
                fontWeight: isActive('/website') ? 600 : 400,
              }}
            />
          </ListItemButton>
        </ListItem>
        <ListItem disablePadding>
          <ListItemButton
            onClick={() => handleNavigation('/developer/analytics')}
            selected={isActive('/developer/analytics')}
            sx={navButtonSx}
          >
            <ListItemIcon
              sx={{
                minWidth: 40,
                color: isActive('/developer/analytics') ? theme.palette.primary.main : 'inherit',
              }}
            >
              <AnalyticsIcon />
            </ListItemIcon>
            <ListItemText
              primary="Website Analytics"
              primaryTypographyProps={{
                fontSize: '0.9375rem',
                fontWeight: isActive('/developer/analytics') ? 600 : 400,
              }}
            />
          </ListItemButton>
        </ListItem>
        <ListItem disablePadding>
          <ListItemButton
            onClick={() => handleNavigation('/developer')}
            selected={isActive('/developer', { exact: true }) && !isActive('/developer?tab=voice')}
            sx={{
              mx: 1,
              mb: 0.5,
              borderRadius: '8px',
              '&.Mui-selected': {
                backgroundColor: theme.palette.mode === 'dark'
                  ? 'rgba(245, 124, 0, 0.16)'
                  : '#FFF3E0',
                color: '#F57C00',
                '&:hover': {
                  backgroundColor: theme.palette.mode === 'dark'
                    ? 'rgba(245, 124, 0, 0.24)'
                    : '#FFE0B2',
                },
                '& .MuiListItemIcon-root': {
                  color: '#F57C00',
                },
              },
              '&:hover': {
                backgroundColor: theme.palette.mode === 'dark'
                  ? 'rgba(255, 255, 255, 0.08)'
                  : '#F5F5F5',
              },
            }}
          >
            <ListItemIcon
              sx={{
                minWidth: 40,
                color: isActive('/developer', { exact: true }) && !isActive('/developer?tab=voice') ? '#F57C00' : 'inherit',
              }}
            >
              <DeveloperIcon />
            </ListItemIcon>
            <ListItemText
              primary="Developer Tasks"
              primaryTypographyProps={{
                fontSize: '0.9375rem',
                fontWeight: isActive('/developer', { exact: true }) && !isActive('/developer?tab=voice') ? 600 : 400,
              }}
            />
          </ListItemButton>
        </ListItem>
        <ListItem disablePadding>
          <ListItemButton
            onClick={() => handleNavigation('/developer?tab=voice')}
            selected={isActive('/developer?tab=voice')}
            sx={navButtonSx}
          >
            <ListItemIcon
              sx={{
                minWidth: 40,
                color: isActive('/developer?tab=voice') ? theme.palette.primary.main : 'inherit',
              }}
            >
              <VoiceCommandsIcon />
            </ListItemIcon>
            <ListItemText
              primary="Voice commands"
              primaryTypographyProps={{
                fontSize: '0.9375rem',
                fontWeight: isActive('/developer?tab=voice') ? 600 : 400,
              }}
            />
          </ListItemButton>
        </ListItem>
        </>
        ) : null}
      </List>
    </>
  );

  return (
    <>
      {/* Mobile drawer */}
      <Drawer
        variant="temporary"
        open={mobileOpen}
        onClose={onMobileClose}
        ModalProps={{
          keepMounted: true, // Better open performance on mobile
        }}
        sx={{
          display: { xs: 'block', md: 'none' },
          '& .MuiDrawer-paper': {
            boxSizing: 'border-box',
            width: DRAWER_WIDTH,
            borderRight: `1px solid ${theme.palette.divider}`,
            backgroundColor: theme.palette.mode === 'dark' ? '#1E1E1E' : '#FAFAFA',
          },
        }}
      >
        {mobileDrawerContent}
      </Drawer>
      
      {/* Desktop drawer */}
      <Drawer
        variant="permanent"
        sx={{
          display: { xs: 'none', md: 'block' },
          width: DRAWER_WIDTH,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: DRAWER_WIDTH,
            boxSizing: 'border-box',
            borderRight: `1px solid ${theme.palette.divider}`,
            backgroundColor: theme.palette.mode === 'dark' ? '#1E1E1E' : '#FAFAFA',
          },
        }}
      >
        {drawerContent}
      </Drawer>
    </>
  );
}

export default Sidebar;
export { DRAWER_WIDTH };

