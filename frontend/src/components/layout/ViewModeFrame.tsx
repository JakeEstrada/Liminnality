import { useState, useEffect } from 'react';
import JobOverlayHost from '../voice/JobOverlayHost';
import LiminalityRuntime from '../voice/LiminalityRuntime';
import { useIsMobile } from '../../hooks/useIsMobile';
import {
  Box,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  TextField,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import {
  disableKioskDisplayMode,
  enableKioskDisplayMode,
  refreshAccessToken,
} from '../../utils/authSession';
import KioskViewNav from './KioskViewNav';

function ViewModeFrame({ currentView, children }) {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [exitDialogOpen, setExitDialogOpen] = useState(false);
  const [exitPin, setExitPin] = useState('');

  const exitPathByView = {
    dashboard: '/dashboard',
    pipeline: '/pipeline',
    calendar: '/calendar',
    customers: '/customers',
  };
  const handleExitConfirm = () => {
    if (exitPin.trim() !== '7212') return;
    disableKioskDisplayMode();
    navigate(exitPathByView[currentView] || '/pipeline');
    setExitDialogOpen(false);
    setExitPin('');
  };

  useEffect(() => {
    enableKioskDisplayMode();
    void refreshAccessToken({ kiosk: true });
  }, []);

  return (
    <Box sx={{ position: 'relative', minHeight: '100vh' }}>
      <Box
        sx={{
          display: { xs: 'none', sm: 'flex' },
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
          px: 2,
          pt: 2,
          pb: 0,
        }}
      >
        <KioskViewNav currentView={currentView} />
        <Button
          size="small"
          variant="outlined"
          onClick={() => setExitDialogOpen(true)}
          sx={{ textTransform: 'none', borderRadius: 2, px: 2, flexShrink: 0 }}
        >
          Exit view
        </Button>
      </Box>
      <Dialog
        open={exitDialogOpen}
        onClose={() => {
          setExitDialogOpen(false);
          setExitPin('');
        }}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Exit view</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            Enter passcode to leave view mode.
          </DialogContentText>
          <TextField
            autoFocus
            fullWidth
            label="Passcode"
            type="password"
            value={exitPin}
            onChange={(e) => setExitPin(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleExitConfirm();
            }}
            error={Boolean(exitPin) && exitPin.trim() !== '7212'}
            helperText={
              Boolean(exitPin) && exitPin.trim() !== '7212' ? 'Incorrect passcode' : ' '
            }
          />
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setExitDialogOpen(false);
              setExitPin('');
            }}
          >
            Cancel
          </Button>
          <Button variant="contained" onClick={handleExitConfirm}>
            Exit
          </Button>
        </DialogActions>
      </Dialog>
      {children}
      {!isMobile ? <LiminalityRuntime /> : null}
      {!isMobile ? <JobOverlayHost /> : null}
    </Box>
  );
}

export default ViewModeFrame;
