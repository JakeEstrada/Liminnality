/**
 * AccountSettingsPage — Profile, password, tenant branding.
 * Route: /account-settings
 * Docs: ../../../docs/PAGES.md#accountsettingspagetsx
 */
import { useState, useEffect } from 'react';
import {
  Box,
  Container,
  Typography,
  Paper,
  TextField,
  Button,
  Alert,
  CircularProgress,
  Chip,
  GridLegacy as Grid,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Switch,
  FormControlLabel,
} from '@mui/material';
import {
  Person as PersonIcon,
  Lock as LockIcon,
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
  PhotoCamera as PhotoCameraIcon,
} from '@mui/icons-material';
import axios from 'axios';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import api from '../utils/axios';
import ProfilePhotoFieldPreview from '../components/common/ProfilePhotoFieldPreview';
import { useTheme } from '@mui/material/styles';
import { useShopViewSensitive, SHOP_VIEW_SENSITIVE_PIN } from '../hooks/useShopViewSensitive';
import { useFinancialPinLockContext } from '../context/FinancialPinLockContext';
import LiminalitySettingsPanel from '../components/voice/LiminalitySettingsPanel';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

function AccountSettingsPage() {
  const { user: currentUser, fetchCurrentUser, isSuperAdmin } = useAuth();
  const theme = useTheme();
  const { isShopViewRole, sensitiveUnlocked, setSensitiveUnlocked } = useShopViewSensitive(currentUser?.role);
  const financialPin = useFinancialPinLockContext();
  const [loading, setLoading] = useState(true);
  const [userData, setUserData] = useState(null);
  const [updating, setUpdating] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  
  // Profile form state
  const [profileForm, setProfileForm] = useState({
    name: '',
    address: '',
  });

  // Password form state
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  const [showPasswords, setShowPasswords] = useState({
    current: false,
    new: false,
    confirm: false,
  });
  const [uploadingProfilePhoto, setUploadingProfilePhoto] = useState(false);
  const [shopViewPinDialogOpen, setShopViewPinDialogOpen] = useState(false);
  const [shopViewPinInput, setShopViewPinInput] = useState('');
  const tenantIdValue =
    typeof userData?.tenantId === 'object' && userData?.tenantId !== null
      ? userData?.tenantId?._id || ''
      : userData?.tenantId || '';

  useEffect(() => {
    fetchUserData();
  }, []);

  const fetchUserData = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('accessToken');
      const response = await axios.get(`${API_URL}/auth/me`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      const user = response.data.user;
      setUserData(user);
      setProfileForm({
        name: user.name || '',
        address: user.address || '',
      });
    } catch (error) {
      console.error('Error fetching user data:', error);
      toast.error('Failed to load account data');
    } finally {
      setLoading(false);
    }
  };

  const handleProfileUpdate = async () => {
    if (!profileForm.name.trim()) {
      toast.error('Name is required');
      return;
    }

    try {
      setUpdating(true);
      const token = localStorage.getItem('accessToken');
      await axios.patch(`${API_URL}/auth/profile`, {
        name: profileForm.name,
        address: profileForm.address,
      }, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      toast.success('Profile updated successfully');
      await fetchUserData();
      // Update AuthContext user
      if (token && fetchCurrentUser) {
        await fetchCurrentUser(token);
      }
    } catch (error) {
      console.error('Error updating profile:', error);
      toast.error(error.response?.data?.error || 'Failed to update profile');
    } finally {
      setUpdating(false);
    }
  };

  const handleUserProfilePhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Please choose an image file');
      e.target.value = '';
      return;
    }
    try {
      setUploadingProfilePhoto(true);
      const formData = new FormData();
      formData.append('photo', file);
      await api.post('/auth/profile-photo', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success('Profile photo updated.');
      await fetchUserData();
      const token = localStorage.getItem('accessToken');
      if (token && fetchCurrentUser) {
        await fetchCurrentUser(token);
      }
    } catch (error) {
      console.error('Profile photo upload:', error);
      toast.error(error.response?.data?.error || 'Failed to upload profile photo');
    } finally {
      setUploadingProfilePhoto(false);
      e.target.value = '';
    }
  };

  const handlePasswordChange = async () => {
    if (!passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.confirmPassword) {
      toast.error('All password fields are required');
      return;
    }

    if (passwordForm.newPassword.length < 6) {
      toast.error('New password must be at least 6 characters');
      return;
    }

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast.error('New passwords do not match');
      return;
    }

    try {
      setChangingPassword(true);
      const token = localStorage.getItem('accessToken');
      await axios.patch(`${API_URL}/auth/change-password`, {
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      }, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      toast.success('Password changed successfully');
      setPasswordForm({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      });
    } catch (error) {
      console.error('Error changing password:', error);
      toast.error(error.response?.data?.error || 'Failed to change password');
    } finally {
      setChangingPassword(false);
    }
  };

  const getRoleColor = (role) => {
    const colors = {
      super_admin: 'error',
      admin: 'warning',
      manager: 'info',
      sales: 'primary',
      installer: 'success',
      read_only: 'default',
      employee: 'secondary',
    };
    return colors[role] || 'default';
  };

  const handleShopViewToggle = (nextChecked) => {
    if (!isShopViewRole) return;
    if (!nextChecked) {
      setSensitiveUnlocked(false);
      toast.success('Sensitive amounts hidden in Shop View');
      return;
    }
    setShopViewPinInput('');
    setShopViewPinDialogOpen(true);
  };

  const handleConfirmShopViewPin = () => {
    if (shopViewPinInput.trim() === SHOP_VIEW_SENSITIVE_PIN) {
      setSensitiveUnlocked(true);
      setShopViewPinDialogOpen(false);
      toast.success('Sensitive amounts visible in Shop View');
      return;
    }
    toast.error('Invalid PIN');
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" sx={{ fontWeight: 600, mb: 1 }}>
          Account Settings
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Manage your account information and security settings
        </Typography>
      </Box>

      {/* Account Information Section */}
      <Paper
        elevation={0}
        sx={{
          borderRadius: '16px',
          p: 4,
          mb: 3,
          background: theme.palette.background.paper,
          boxShadow:
            theme.palette.mode === 'dark'
              ? '0 2px 12px rgba(0, 0, 0, 0.35)'
              : '0 2px 12px rgba(0, 0, 0, 0.06)',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
          <PersonIcon sx={{ fontSize: 28, color: 'primary.main' }} />
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            Account Information
          </Typography>
        </Box>

        {userData && (
          <Grid container spacing={3}>
            <Grid item xs={12}>
              <Box sx={{ mb: 2 }}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                  Email
                </Typography>
                <Typography variant="body1" sx={{ fontWeight: 500 }}>
                  {userData.email}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                  Email cannot be changed
                </Typography>
              </Box>
            </Grid>

            {isSuperAdmin() ? (
              <Grid item xs={12}>
                <Box sx={{ mb: 1 }}>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                    Tenant ID
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{ fontFamily: 'monospace', wordBreak: 'break-all', fontWeight: 500 }}
                  >
                    {tenantIdValue || 'Unavailable'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                    Organization identifier for this account
                  </Typography>
                </Box>
              </Grid>
            ) : null}

            <Grid item xs={12}>
              <TextField
                label="Name"
                value={profileForm.name}
                onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })}
                fullWidth
                required
                helperText="This name is used in activity and update logs."
              />
            </Grid>

            <Grid item xs={12}>
              <TextField
                label="Address"
                value={profileForm.address}
                onChange={(e) => setProfileForm({ ...profileForm, address: e.target.value })}
                fullWidth
                multiline
                minRows={2}
                placeholder="Street, city, state, postal code"
                helperText="Optional. Stored on your account for your reference."
              />
            </Grid>

            <Grid item xs={12}>
              <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                Profile photo
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                One image for your account (shown in the header next to your name). PNG, JPG, GIF, WebP, or SVG.
                Max 2&nbsp;MB.
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 3, flexWrap: 'wrap' }}>
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5 }}>
                  <ProfilePhotoFieldPreview
                    revision={userData?.updatedAt}
                    emptyLabel="No profile photo"
                    sx={{ width: 88, height: 88 }}
                  />
                  <Button
                    variant="outlined"
                    component="label"
                    disabled={uploadingProfilePhoto}
                    startIcon={uploadingProfilePhoto ? <CircularProgress size={18} /> : <PhotoCameraIcon />}
                  >
                    {uploadingProfilePhoto ? 'Uploading…' : 'Upload or replace'}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/gif,image/webp,image/svg+xml"
                      hidden
                      onChange={handleUserProfilePhotoUpload}
                    />
                  </Button>
                </Box>
              </Box>
            </Grid>

            <Grid item xs={12} sm={6}>
              <Box>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                  Role
                </Typography>
                <Chip
                  label={userData.role?.replace('_', ' ').toUpperCase() || 'N/A'}
                  color={getRoleColor(userData.role)}
                  size="small"
                />
              </Box>
            </Grid>

            <Grid item xs={12} sm={6}>
              <Box>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                  Account Status
                </Typography>
                <Chip
                  label={userData.isActive ? 'Active' : 'Inactive'}
                  color={userData.isActive ? 'success' : 'default'}
                  size="small"
                />
              </Box>
            </Grid>

            {userData.createdAt && (
              <Grid item xs={12} sm={6}>
                <Box>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                    Account Created
                  </Typography>
                  <Typography variant="body2">
                    {new Date(userData.createdAt).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })}
                  </Typography>
                </Box>
              </Grid>
            )}

            {userData.updatedAt && (
              <Grid item xs={12} sm={6}>
                <Box>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                    Last Updated
                  </Typography>
                  <Typography variant="body2">
                    {new Date(userData.updatedAt).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })}
                  </Typography>
                </Box>
              </Grid>
            )}

            <Grid item xs={12}>
              <Button
                variant="contained"
                onClick={handleProfileUpdate}
                disabled={
                  updating ||
                  (profileForm.name === userData.name &&
                    (profileForm.address || '') === (userData.address || ''))
                }
                sx={{ mt: 1 }}
              >
                {updating ? <CircularProgress size={20} sx={{ mr: 1 }} /> : null}
                Save Changes
              </Button>
            </Grid>
          </Grid>
        )}
      </Paper>

      <LiminalitySettingsPanel />

      <Paper
        elevation={0}
        sx={{
          borderRadius: '16px',
          p: 4,
          mb: 3,
          background: theme.palette.background.paper,
          boxShadow:
            theme.palette.mode === 'dark'
              ? '0 2px 12px rgba(0, 0, 0, 0.35)'
              : '0 2px 12px rgba(0, 0, 0, 0.06)',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
          <LockIcon sx={{ fontSize: 28, color: 'primary.main' }} />
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            Sensitive data
          </Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Turn this on if you want job totals hidden until a PIN is entered. Leave it off so amounts
          stay visible.
        </Typography>
        <FormControlLabel
          control={
            <Switch
              checked={financialPin.protectEnabled}
              onChange={(e) => financialPin.setProtectEnabled(e.target.checked)}
            />
          }
          label="Protect sensitive data with PIN"
        />
        {financialPin.protectEnabled && !financialPin.unlocked ? (
          <Box sx={{ mt: 1 }}>
            <Button variant="outlined" onClick={() => financialPin.openUnlockDialog()}>
              Unlock amounts
            </Button>
          </Box>
        ) : null}
      </Paper>

      {isShopViewRole && (
        <Paper
          elevation={0}
          sx={{
            borderRadius: '16px',
            p: 4,
            mb: 3,
            background: theme.palette.background.paper,
            boxShadow:
              theme.palette.mode === 'dark'
                ? '0 2px 12px rgba(0, 0, 0, 0.35)'
                : '0 2px 12px rgba(0, 0, 0, 0.06)',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
            <LockIcon sx={{ fontSize: 28, color: 'primary.main' }} />
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              Shop View Sensitive Amounts
            </Typography>
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Amounts and financial totals stay hidden in Shop View unless you enable this setting.
          </Typography>
          <FormControlLabel
            control={
              <Switch
                checked={sensitiveUnlocked}
                onChange={(e) => handleShopViewToggle(e.target.checked)}
              />
            }
            label={sensitiveUnlocked ? 'Show sensitive amounts' : 'Hide sensitive amounts'}
          />
        </Paper>
      )}

      {/* Change Password Section */}
      <Paper
        elevation={0}
        sx={{
          borderRadius: '16px',
          p: 4,
          background: theme.palette.background.paper,
          boxShadow:
            theme.palette.mode === 'dark'
              ? '0 2px 12px rgba(0, 0, 0, 0.35)'
              : '0 2px 12px rgba(0, 0, 0, 0.06)',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
          <LockIcon sx={{ fontSize: 28, color: 'primary.main' }} />
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            Change Password
          </Typography>
        </Box>

        <Alert severity="info" sx={{ mb: 3 }}>
          Your password must be at least 6 characters long. Make sure to choose a strong password.
        </Alert>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <TextField
            label="Current Password"
            type={showPasswords.current ? 'text' : 'password'}
            value={passwordForm.currentPassword}
            onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
            fullWidth
            required
            InputProps={{
              endAdornment: (
                <Box
                  component="button"
                  onClick={() => setShowPasswords({ ...showPasswords, current: !showPasswords.current })}
                  sx={{
                    border: 'none',
                    background: 'none',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    color: 'text.secondary',
                    '&:hover': { color: 'text.primary' },
                  }}
                >
                  {showPasswords.current ? <VisibilityOffIcon /> : <VisibilityIcon />}
                </Box>
              ),
            }}
          />

          <TextField
            label="New Password"
            type={showPasswords.new ? 'text' : 'password'}
            value={passwordForm.newPassword}
            onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
            fullWidth
            required
            helperText="Minimum 6 characters"
            InputProps={{
              endAdornment: (
                <Box
                  component="button"
                  onClick={() => setShowPasswords({ ...showPasswords, new: !showPasswords.new })}
                  sx={{
                    border: 'none',
                    background: 'none',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    color: 'text.secondary',
                    '&:hover': { color: 'text.primary' },
                  }}
                >
                  {showPasswords.new ? <VisibilityOffIcon /> : <VisibilityIcon />}
                </Box>
              ),
            }}
          />

          <TextField
            label="Confirm New Password"
            type={showPasswords.confirm ? 'text' : 'password'}
            value={passwordForm.confirmPassword}
            onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
            fullWidth
            required
            error={passwordForm.confirmPassword && passwordForm.newPassword !== passwordForm.confirmPassword}
            helperText={
              passwordForm.confirmPassword && passwordForm.newPassword !== passwordForm.confirmPassword
                ? 'Passwords do not match'
                : ''
            }
            InputProps={{
              endAdornment: (
                <Box
                  component="button"
                  onClick={() => setShowPasswords({ ...showPasswords, confirm: !showPasswords.confirm })}
                  sx={{
                    border: 'none',
                    background: 'none',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    color: 'text.secondary',
                    '&:hover': { color: 'text.primary' },
                  }}
                >
                  {showPasswords.confirm ? <VisibilityOffIcon /> : <VisibilityIcon />}
                </Box>
              ),
            }}
          />

          <Button
            variant="contained"
            onClick={handlePasswordChange}
            disabled={
              changingPassword ||
              !passwordForm.currentPassword ||
              !passwordForm.newPassword ||
              !passwordForm.confirmPassword ||
              passwordForm.newPassword !== passwordForm.confirmPassword
            }
            sx={{ mt: 1 }}
          >
            {changingPassword ? <CircularProgress size={20} sx={{ mr: 1 }} /> : null}
            Change Password
          </Button>
        </Box>
      </Paper>
      <Dialog open={shopViewPinDialogOpen} onClose={() => setShopViewPinDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Enable Sensitive Amounts</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            Enter PIN to show financial amounts in Shop View.
          </DialogContentText>
          <TextField
            autoFocus
            fullWidth
            label="PIN"
            type="password"
            value={shopViewPinInput}
            onChange={(e) => setShopViewPinInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleConfirmShopViewPin();
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShopViewPinDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleConfirmShopViewPin}>
            Enable
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}

export default AccountSettingsPage;

