/**
 * RfidPage — Live RFID scan log from shop devices.
 * Route: /rfid
 * APIs: GET /rfid/scans, Socket.IO rfid.scan.created
 * Docs: ../../../docs/PAGES.md#rfidpagetsx
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Container,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { DeleteOutline as DeleteIcon, Refresh as RefreshIcon } from '@mui/icons-material';
import toast from 'react-hot-toast';
import { isAxiosError } from 'axios';
import api from '../utils/axios';
import { listRosterDirectory, parseRosterNames, type RosterDirectoryRow } from '../utils/rfidTimesheetScans';
import { format } from 'date-fns';
import { useAuth } from '../context/AuthContext';
import { useSocketConnectionStatus, useSocketSubscription } from '../hooks/useSocketSubscription';
import { getTenantRoom } from '../services/socket';

interface RfidTagRow {
  _id: string;
  uid: string;
  displayName: string;
  notes?: string;
}

interface RfidPinRow {
  _id: string;
  pin: string;
  displayName: string;
  notes?: string;
}

interface RfidPhoneRow {
  _id: string;
  phone: string;
  phoneDigits?: string;
  displayName: string;
  notes?: string;
}

interface RosterProfile {
  employeeKey: string;
  displayName?: string;
  onRoster?: boolean;
}

interface RfidScanRow {
  _id: string;
  uid: string;
  pin?: string;
  phone?: string;
  displayName: string;
  scannedAt: string;
  source?: string;
  deviceLabel?: string;
}

function formatClockPhone(value: string) {
  const digits = String(value || '').replace(/\D/g, '').slice(-10);
  if (digits.length !== 10) return value || '';
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

const SCAN_LIST_LIMIT = 200;

function RfidPage() {
  const { tenantIdForBranding } = useAuth();
  const [loading, setLoading] = useState(true);
  const [tags, setTags] = useState<RfidTagRow[]>([]);
  const [profiles, setProfiles] = useState<RosterProfile[]>([]);
  const [rosterName, setRosterName] = useState('');
  const [savingRoster, setSavingRoster] = useState(false);
  const rosterFileRef = useRef<HTMLInputElement>(null);
  const [pins, setPins] = useState<RfidPinRow[]>([]);
  const [phones, setPhones] = useState<RfidPhoneRow[]>([]);
  const [scans, setScans] = useState<RfidScanRow[]>([]);
  const [tagUid, setTagUid] = useState('');
  const [tagName, setTagName] = useState('');
  const [pinCode, setPinCode] = useState('');
  const [pinName, setPinName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [phoneName, setPhoneName] = useState('');
  const [savingTag, setSavingTag] = useState(false);
  const [savingPin, setSavingPin] = useState(false);
  const [savingPhone, setSavingPhone] = useState(false);
  const [recentScanIds, setRecentScanIds] = useState<Set<string>>(() => new Set());
  const highlightTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const tenantRoom = getTenantRoom(tenantIdForBranding);
  const socketConnected = useSocketConnectionStatus();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tagsRes, pinsRes, phonesRes, scansRes, profilesRes] = await Promise.all([
        api.get<{ tags: RfidTagRow[] }>('/rfid/tags'),
        api.get<{ pins: RfidPinRow[] }>('/rfid/pins'),
        api.get<{ phones: RfidPhoneRow[] }>('/rfid/phones'),
        api.get<{ scans: RfidScanRow[] }>('/rfid/scans', { params: { limit: SCAN_LIST_LIMIT } }),
        api.get<{ profiles: RosterProfile[] }>('/rfid/employee-profiles'),
      ]);
      setTags(tagsRes.data.tags || []);
      setProfiles(profilesRes.data.profiles || []);
      setPins(pinsRes.data.pins || []);
      setPhones(phonesRes.data.phones || []);
      setScans(scansRes.data.scans || []);
    } catch (error) {
      console.error(error);
      toast.error(isAxiosError(error) ? error.response?.data?.error || 'Failed to load RFID data' : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return () => {
      highlightTimersRef.current.forEach((timer) => clearTimeout(timer));
      highlightTimersRef.current.clear();
    };
  }, []);

  const handleRealtimeScan = useCallback((payload: { scan?: RfidScanRow }) => {
    const incoming = payload?.scan;
    if (!incoming?._id) return;

    setScans((prev) => {
      const id = String(incoming._id);
      if (prev.some((s) => String(s._id) === id)) return prev;
      const scannedAt =
        typeof incoming.scannedAt === 'string'
          ? incoming.scannedAt
          : new Date(incoming.scannedAt).toISOString();
      return [{ ...incoming, scannedAt }, ...prev].slice(0, SCAN_LIST_LIMIT);
    });

    const id = String(incoming._id);
    setRecentScanIds((prev) => new Set(prev).add(id));
    const existingTimer = highlightTimersRef.current.get(id);
    if (existingTimer) clearTimeout(existingTimer);
    highlightTimersRef.current.set(
      id,
      setTimeout(() => {
        setRecentScanIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        highlightTimersRef.current.delete(id);
      }, 4000),
    );
  }, []);

  const handleRealtimeTagUpsert = useCallback((payload: { tag?: RfidTagRow }) => {
    const incoming = payload?.tag;
    if (!incoming?._id || !incoming.uid) return;

    setTags((prev) => {
      const id = String(incoming._id);
      const idx = prev.findIndex((t) => String(t._id) === id);
      if (idx === -1) {
        return [...prev, incoming].sort((a, b) => a.displayName.localeCompare(b.displayName));
      }
      const next = [...prev];
      next[idx] = { ...next[idx], ...incoming };
      return next.sort((a, b) => a.displayName.localeCompare(b.displayName));
    });
  }, []);

  const handleRealtimeTagDeleted = useCallback((payload: { tagId?: string }) => {
    const tagId = String(payload?.tagId || '').trim();
    if (!tagId) return;
    setTags((prev) => prev.filter((t) => String(t._id) !== tagId));
  }, []);

  const handleRealtimePinUpsert = useCallback((payload: { pinEntry?: RfidPinRow }) => {
    const incoming = payload?.pinEntry;
    if (!incoming?._id || !incoming.pin) return;

    setPins((prev) => {
      const id = String(incoming._id);
      const idx = prev.findIndex((p) => String(p._id) === id);
      if (idx === -1) {
        return [...prev, incoming].sort((a, b) => a.displayName.localeCompare(b.displayName));
      }
      const next = [...prev];
      next[idx] = { ...next[idx], ...incoming };
      return next.sort((a, b) => a.displayName.localeCompare(b.displayName));
    });
  }, []);

  const handleRealtimePinDeleted = useCallback((payload: { pinId?: string }) => {
    const pinId = String(payload?.pinId || '').trim();
    if (!pinId) return;
    setPins((prev) => prev.filter((p) => String(p._id) !== pinId));
  }, []);

  const handleRealtimePhoneUpsert = useCallback((payload: { phoneEntry?: RfidPhoneRow }) => {
    const incoming = payload?.phoneEntry;
    if (!incoming?._id || !incoming.phone) return;

    setPhones((prev) => {
      const id = String(incoming._id);
      const idx = prev.findIndex((p) => String(p._id) === id);
      if (idx === -1) {
        return [...prev, incoming].sort((a, b) => a.displayName.localeCompare(b.displayName));
      }
      const next = [...prev];
      next[idx] = { ...next[idx], ...incoming };
      return next.sort((a, b) => a.displayName.localeCompare(b.displayName));
    });
  }, []);

  const handleRealtimePhoneDeleted = useCallback((payload: { phoneId?: string }) => {
    const phoneId = String(payload?.phoneId || '').trim();
    if (!phoneId) return;
    setPhones((prev) => prev.filter((p) => String(p._id) !== phoneId));
  }, []);

  useSocketSubscription(tenantRoom, 'rfid.scan.created', handleRealtimeScan);
  useSocketSubscription(tenantRoom, 'rfid.tag.upserted', handleRealtimeTagUpsert);
  useSocketSubscription(tenantRoom, 'rfid.tag.deleted', handleRealtimeTagDeleted);
  useSocketSubscription(tenantRoom, 'rfid.pin.upserted', handleRealtimePinUpsert);
  useSocketSubscription(tenantRoom, 'rfid.pin.deleted', handleRealtimePinDeleted);
  useSocketSubscription(tenantRoom, 'rfid.phone.upserted', handleRealtimePhoneUpsert);
  useSocketSubscription(tenantRoom, 'rfid.phone.deleted', handleRealtimePhoneDeleted);

  const liveLabel = useMemo(() => {
    if (!tenantRoom) return 'Offline';
    return socketConnected ? 'Live' : 'Connecting…';
  }, [tenantRoom, socketConnected]);

  const liveColor = tenantRoom && socketConnected ? 'success.main' : 'warning.main';

  const roster = useMemo(
    () =>
      listRosterDirectory(tags, pins, phones, profiles).sort((a, b) => {
        if (a.onPayroll !== b.onPayroll) return a.onPayroll ? -1 : 1;
        return a.name.localeCompare(b.name);
      }),
    [tags, pins, phones, profiles],
  );

  const addRosterNames = async (names: string[]) => {
    const cleaned = parseRosterNames(names.join('\n'));
    if (cleaned.length === 0) {
      toast.error('Add at least one employee name');
      return;
    }
    setSavingRoster(true);
    try {
      const res = await api.post<{ count: number }>('/rfid/roster', { names: cleaned });
      const count = res.data?.count || cleaned.length;
      toast.success(count === 1 ? `${cleaned[0]} is on payroll` : `Added ${count} names to payroll`);
      setRosterName('');
      await load();
    } catch (error) {
      toast.error(isAxiosError(error) ? error.response?.data?.error || 'Could not add employees' : 'Could not add employees');
    } finally {
      setSavingRoster(false);
    }
  };

  const handleRosterFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const names = parseRosterNames(await file.text());
      if (names.length === 0) {
        toast.error('That file has no employee names');
        return;
      }
      await addRosterNames(names);
    } catch (error) {
      console.error(error);
      toast.error('Could not read that file');
    }
  };

  const setRosterMembership = async (row: RosterDirectoryRow, onRoster: boolean) => {
    if (!onRoster && !window.confirm(`Remove ${row.name} from payroll? Their tag, PIN, and phone stay saved.`)) {
      return;
    }
    setSavingRoster(true);
    try {
      await api.put(`/rfid/employee-profiles/${encodeURIComponent(row.id)}`, {
        displayName: row.name,
        onRoster,
      });
      toast.success(onRoster ? `${row.name} is on payroll` : `${row.name} is off payroll`);
      await load();
    } catch (error) {
      toast.error(isAxiosError(error) ? error.response?.data?.error || 'Could not update payroll' : 'Could not update payroll');
    } finally {
      setSavingRoster(false);
    }
  };

  const handleSaveTag = async () => {
    const uid = tagUid.trim();
    const displayName = tagName.trim();
    if (!uid || !displayName) {
      toast.error('UID and name are required');
      return;
    }
    setSavingTag(true);
    try {
      await api.post('/rfid/tags', { uid, displayName });
      toast.success('Tag saved');
      setTagUid('');
      setTagName('');
      await load();
    } catch (error) {
      toast.error(isAxiosError(error) ? error.response?.data?.error || 'Failed to save tag' : 'Failed to save');
    } finally {
      setSavingTag(false);
    }
  };

  const handleDeleteTag = async (id: string) => {
    if (!window.confirm('Remove this tag mapping?')) return;
    try {
      await api.delete(`/rfid/tags/${id}`);
      toast.success('Tag removed');
      await load();
    } catch (error) {
      toast.error(isAxiosError(error) ? error.response?.data?.error || 'Failed to delete' : 'Failed to delete');
    }
  };

  const handleSavePin = async () => {
    const pin = pinCode.replace(/\D/g, '').slice(0, 4);
    const displayName = pinName.trim();
    if (pin.length !== 4 || !displayName) {
      toast.error('4-digit PIN and name are required');
      return;
    }
    setSavingPin(true);
    try {
      await api.post('/rfid/pins', { pin, displayName });
      toast.success('PIN saved');
      setPinCode('');
      setPinName('');
      await load();
    } catch (error) {
      toast.error(isAxiosError(error) ? error.response?.data?.error || 'Failed to save PIN' : 'Failed to save');
    } finally {
      setSavingPin(false);
    }
  };

  const handleSavePhone = async () => {
    const digits = phoneNumber.replace(/\D/g, '').slice(-10);
    const displayName = phoneName.trim();
    if (digits.length !== 10 || !displayName) {
      toast.error('10-digit number and name are required');
      return;
    }
    setSavingPhone(true);
    try {
      await api.post('/rfid/phones', { phone: digits, displayName });
      toast.success('Number saved');
      setPhoneNumber('');
      setPhoneName('');
      await load();
    } catch (error) {
      toast.error(isAxiosError(error) ? error.response?.data?.error || 'Failed to save number' : 'Failed to save');
    } finally {
      setSavingPhone(false);
    }
  };

  const handleDeletePhone = async (id: string) => {
    if (!window.confirm('Remove this text-in number?')) return;
    try {
      await api.delete(`/rfid/phones/${id}`);
      toast.success('Number removed');
      await load();
    } catch (error) {
      toast.error(isAxiosError(error) ? error.response?.data?.error || 'Failed to delete' : 'Failed to delete');
    }
  };

  const handleDeletePin = async (id: string) => {
    if (!window.confirm('Remove this PIN mapping?')) return;
    try {
      await api.delete(`/rfid/pins/${id}`);
      toast.success('PIN removed');
      await load();
    } catch (error) {
      toast.error(isAxiosError(error) ? error.response?.data?.error || 'Failed to delete' : 'Failed to delete');
    }
  };

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Typography variant="h5" component="h1">
            RFID scans
          </Typography>
          {liveLabel ? (
            <Typography
              variant="caption"
              sx={{
                px: 1,
                py: 0.25,
                borderRadius: 1,
                bgcolor: liveColor,
                color: tenantRoom && socketConnected ? 'success.contrastText' : 'warning.contrastText',
                fontWeight: 600,
                letterSpacing: 0.5,
              }}
            >
              {liveLabel}
            </Typography>
          ) : null}
        </Box>
        <IconButton onClick={() => void load()} disabled={loading} aria-label="Refresh">
          <RefreshIcon />
        </IconButton>
      </Box>

      <Alert severity="info" sx={{ mb: 3 }}>
        Map a tag, kiosk PIN, or phone number to an employee name. A registered number clocks in by texting
        the shop line <strong>in</strong>, <strong>out</strong>, a period, or a blank/space. Anything else
        stays a normal text and is not a punch.
      </Alert>

      <Card variant="outlined" sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
            Payroll roster
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            These names are the employee list on payroll. Add a name, or upload a text or CSV file with one
            name per line. A column named Name works too. Tag, PIN, and phone numbers already saved for that
            name stay attached. Uploading adds people and does not remove anyone.
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'flex-start', mb: 2 }}>
            <TextField
              label="Employee name"
              size="small"
              value={rosterName}
              onChange={(e) => setRosterName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void addRosterNames([rosterName]);
                }
              }}
              placeholder="Carlos"
              sx={{ minWidth: 180 }}
            />
            <Button
              variant="contained"
              onClick={() => void addRosterNames([rosterName])}
              disabled={savingRoster}
            >
              {savingRoster ? <CircularProgress size={22} /> : 'Add to payroll'}
            </Button>
            <Button
              variant="outlined"
              onClick={() => rosterFileRef.current?.click()}
              disabled={savingRoster}
            >
              Upload names
            </Button>
            <input
              ref={rosterFileRef}
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              hidden
              onChange={(e) => void handleRosterFile(e)}
            />
          </Box>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Saved numbers</TableCell>
                <TableCell>Payroll</TableCell>
                <TableCell width={160} />
              </TableRow>
            </TableHead>
            <TableBody>
              {loading && roster.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4}>
                    <Typography variant="body2" color="text.secondary">
                      Loading employees…
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : roster.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4}>
                    <Typography variant="body2" color="text.secondary">
                      No employees yet. Add a name or upload a list.
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                roster.map((row) => {
                  const numbers = [
                    ...row.uids.map((uid) => `Tag ${uid}`),
                    ...row.pins.map((pin) => `PIN ${pin}`),
                    ...row.phones.map((phone) => formatClockPhone(phone)),
                  ];
                  return (
                    <TableRow key={row.id}>
                      <TableCell>{row.name}</TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
                        {numbers.length > 0 ? numbers.join(' · ') : 'No tag, PIN, or phone yet'}
                      </TableCell>
                      <TableCell>{row.onPayroll ? 'On payroll' : 'Off payroll'}</TableCell>
                      <TableCell>
                        {row.onPayroll ? (
                          <Button
                            size="small"
                            color="inherit"
                            onClick={() => void setRosterMembership(row, false)}
                            disabled={savingRoster}
                            aria-label={`Remove ${row.name} from payroll`}
                          >
                            Remove
                          </Button>
                        ) : (
                          <Button
                            size="small"
                            onClick={() => void setRosterMembership(row, true)}
                            disabled={savingRoster}
                            aria-label={`Add ${row.name} to payroll`}
                          >
                            Add back
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card variant="outlined" sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>
            Register tag
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'flex-start' }}>
            <TextField
              label="Tag UID"
              size="small"
              value={tagUid}
              onChange={(e) => setTagUid(e.target.value)}
              placeholder="142-1-4-200-91"
              sx={{ minWidth: 220 }}
            />
            <TextField
              label="Name"
              size="small"
              value={tagName}
              onChange={(e) => setTagName(e.target.value)}
              placeholder="Jake"
              sx={{ minWidth: 180 }}
            />
            <Button variant="contained" onClick={() => void handleSaveTag()} disabled={savingTag}>
              {savingTag ? <CircularProgress size={22} /> : 'Save mapping'}
            </Button>
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Scan once on the Pi and copy the UID from its console, or from the scan log below if it already logged as
            Unknown.
          </Typography>
        </CardContent>
      </Card>

      <Card variant="outlined" sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>
            Register kiosk PIN
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'flex-start' }}>
            <TextField
              label="4-digit PIN"
              size="small"
              value={pinCode}
              onChange={(e) => setPinCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="1234"
              inputProps={{ inputMode: 'numeric', pattern: '[0-9]*', maxLength: 4 }}
              sx={{ minWidth: 140 }}
            />
            <TextField
              label="Name"
              size="small"
              value={pinName}
              onChange={(e) => setPinName(e.target.value)}
              placeholder="Jake"
              sx={{ minWidth: 180 }}
            />
            <Button variant="contained" onClick={() => void handleSavePin()} disabled={savingPin}>
              {savingPin ? <CircularProgress size={22} /> : 'Save PIN'}
            </Button>
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Used when RFID is unavailable. Employees tap the kiosk logo and enter this PIN.
          </Typography>
        </CardContent>
      </Card>

      <Card variant="outlined" sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>
            Register text-in number
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'flex-start' }}>
            <TextField
              label="Phone number"
              size="small"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value.replace(/[^\d+()\-\s]/g, '').slice(0, 16))}
              placeholder="(714) 555-1234"
              inputProps={{ inputMode: 'tel' }}
              sx={{ minWidth: 180 }}
            />
            <TextField
              label="Name"
              size="small"
              value={phoneName}
              onChange={(e) => setPhoneName(e.target.value)}
              placeholder="Jake"
              sx={{ minWidth: 180 }}
            />
            <Button variant="contained" onClick={() => void handleSavePhone()} disabled={savingPhone}>
              {savingPhone ? <CircularProgress size={22} /> : 'Save number'}
            </Button>
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Use the same name as their tag or PIN so timesheets stay on one person. They text the shop
            number <strong>in</strong>, <strong>out</strong>, <strong>.</strong>, or a space. Notes like
            mileage stay in the inbox and do not clock them.
          </Typography>
        </CardContent>
      </Card>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : (
        <>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
            Tag registry ({tags.length})
          </Typography>
          <Card variant="outlined" sx={{ mb: 3, overflow: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>UID</TableCell>
                  <TableCell>Name</TableCell>
                  <TableCell width={56} />
                </TableRow>
              </TableHead>
              <TableBody>
                {tags.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3}>
                      <Typography variant="body2" color="text.secondary">
                        No tags registered yet.
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  tags.map((t) => (
                    <TableRow key={t._id}>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{t.uid}</TableCell>
                      <TableCell>{t.displayName}</TableCell>
                      <TableCell>
                        <IconButton size="small" onClick={() => void handleDeleteTag(t._id)} aria-label="Delete tag">
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>

          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
            PIN registry ({pins.length})
          </Typography>
          <Card variant="outlined" sx={{ mb: 3, overflow: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>PIN</TableCell>
                  <TableCell>Name</TableCell>
                  <TableCell width={56} />
                </TableRow>
              </TableHead>
              <TableBody>
                {pins.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3}>
                      <Typography variant="body2" color="text.secondary">
                        No PINs registered yet.
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  pins.map((p) => (
                    <TableRow key={p._id}>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{p.pin}</TableCell>
                      <TableCell>{p.displayName}</TableCell>
                      <TableCell>
                        <IconButton size="small" onClick={() => void handleDeletePin(p._id)} aria-label="Delete PIN">
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>

          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
            Text-in numbers ({phones.length})
          </Typography>
          <Card variant="outlined" sx={{ mb: 3, overflow: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Number</TableCell>
                  <TableCell>Name</TableCell>
                  <TableCell width={56} />
                </TableRow>
              </TableHead>
              <TableBody>
                {phones.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3}>
                      <Typography variant="body2" color="text.secondary">
                        No text-in numbers registered yet.
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  phones.map((p) => (
                    <TableRow key={p._id}>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
                        {formatClockPhone(p.phone || p.phoneDigits || '')}
                      </TableCell>
                      <TableCell>{p.displayName}</TableCell>
                      <TableCell>
                        <IconButton size="small" onClick={() => void handleDeletePhone(p._id)} aria-label="Delete number">
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>

          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
            Recent scans ({scans.length})
          </Typography>
          <Card variant="outlined" sx={{ overflow: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>When</TableCell>
                  <TableCell>Name</TableCell>
                  <TableCell>UID / PIN / Phone</TableCell>
                  <TableCell>Source</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {scans.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4}>
                      <Typography variant="body2" color="text.secondary">
                        No scans yet.
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  scans.map((s) => (
                    <TableRow
                      key={s._id}
                      sx={
                        recentScanIds.has(String(s._id))
                          ? {
                              bgcolor: 'action.selected',
                              transition: 'background-color 0.4s ease',
                            }
                          : undefined
                      }
                    >
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        {format(new Date(s.scannedAt), 'MMM d, yyyy h:mm:ss a')}
                      </TableCell>
                      <TableCell>{s.displayName}</TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
                        {s.phone ? formatClockPhone(s.phone) : s.pin ? `PIN ${s.pin}` : s.uid}
                      </TableCell>
                      <TableCell>
                        {[s.deviceLabel, s.source].filter(Boolean).join(' · ') || '—'}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </>
      )}
    </Container>
  );
}

export default RfidPage;
