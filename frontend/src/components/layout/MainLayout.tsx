import { useState } from 'react';
import { Box } from '@mui/material';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import SiteAssistantChat from '../assistant/SiteAssistantChat';
import JobOverlayHost from '../voice/JobOverlayHost';
import LiminalityRuntime from '../voice/LiminalityRuntime';
import { useIsMobile } from '../../hooks/useIsMobile';

function MainLayout({ children }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const isMobile = useIsMobile();

  const handleDrawerToggle = () => {
    setMobileOpen(!mobileOpen);
  };

  return (
      <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} />
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          width: '100%',
          minWidth: 0,
          backgroundColor: 'background.default',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <TopBar onMenuClick={handleDrawerToggle} />
        <Box
          sx={{
            flex: 1,
            overflow: 'auto',
            p: { xs: 1, sm: 2, md: 3 },
            width: '100%',
            minWidth: 0,
            boxSizing: 'border-box',
          }}
        >
          {children}
        </Box>
      </Box>
      {/* Voice + help stay off the phone layout. */}
      {!isMobile && <LiminalityRuntime />}
      {!isMobile && <JobOverlayHost />}
      {!isMobile && <SiteAssistantChat />}
    </Box>
  );
}

export default MainLayout;

