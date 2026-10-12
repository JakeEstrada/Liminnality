/**
 * PayrollPage — Manual timesheet plus RFID payroll on a second tab.
 * Route: /payroll  (?tab=payroll for RFID hours)
 * Docs: ../../../docs/PAGES.md#payrollpagetsx
 */
import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import axios from 'axios';
import {
  Box,
  Paper,
  Typography,
  TextField,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Button,
  GridLegacy as Grid,
  Card,
  CardContent,
  Divider,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Tab,
  Tabs,
  useTheme,
} from '@mui/material';
import RfidTimesheetPage from './RfidTimesheetPage';
import BrandLogo from '../components/common/BrandLogo';
import {
  Print as PrintIcon,
  AccessTime as TimeIcon,
  DirectionsCar as CarIcon,
  Receipt as ReceiptIcon,
  AccountBalance as PaycheckIcon,
  Add as AddIcon,
  Save as SaveIcon,
  Delete as DeleteIcon,
} from '@mui/icons-material';

const DAYS = ['Friday', 'Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday'];

const PRESETS_STORAGE_KEY = 'payroll_saved_presets';
const DEFAULT_PRESET_NAME = 'Day Shift';
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

const COMPACT_BTN_SX = {
  textTransform: 'none',
  borderRadius: 1.5,
  py: 0.4,
  px: 1.25,
  fontSize: '0.8125rem',
  minHeight: 32,
};

function normalizeWorkHours(hours) {
  const byDay = {};
  for (const entry of hours || []) {
    if (entry?.day) {
      byDay[entry.day] = entry;
    }
  }
  return DAYS.map((day) => ({
    day,
    in: String(byDay[day]?.in ?? '0'),
    out: String(byDay[day]?.out ?? '0'),
    breaks: String(byDay[day]?.breaks ?? '0'),
  }));
}

const DAY_SHIFT_HOURS = DAYS.map((day) => ({
  day,
  in: '600',
  out: '1430',
  breaks: '30',
}));

function ManualPayrollPage() {
  const theme = useTheme();
  const [employeeName, setEmployeeName] = useState('');
  const [ratePerHour, setRatePerHour] = useState('');
  const [date, setDate] = useState(new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'short' }));
  const [presetSelect, setPresetSelect] = useState('');
  const [savedPresets, setSavedPresets] = useState([]);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [presetName, setPresetName] = useState(DEFAULT_PRESET_NAME);
  const printSummaryRef = useRef(null);
  
  // Work hours - default 6:45 AM - 3:00 PM (645 - 1500)
  const [workHours, setWorkHours] = useState(
    DAYS.map(day => ({
      day,
      in: day === 'Saturday' || day === 'Sunday' ? '0' : '645',
      out: day === 'Saturday' || day === 'Sunday' ? '0' : '1500',
      breaks: day === 'Saturday' || day === 'Sunday' ? '0' : '30',
    }))
  );

  const readSavedPresets = () => {
    try {
      const saved = localStorage.getItem(PRESETS_STORAGE_KEY);
      if (!saved) return [];
      const parsed = JSON.parse(saved);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.error('Error loading saved presets:', error);
      return [];
    }
  };

  const persistSavedPresets = (presets) => {
    localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(presets));
    setSavedPresets(presets);
  };

  // Load saved presets from localStorage on mount
  useEffect(() => {
    setSavedPresets(readSavedPresets());
  }, []);

  // Travel miles
  const [travelMiles, setTravelMiles] = useState(
    DAYS.map(day => ({
      day,
      miles: '',
    }))
  );

  // Receipts - array of { amount: '', description: '' }
  const [receipts, setReceipts] = useState([]);

  // Price per mile
  const pricePerMile = 0.725;

  // Convert time string (e.g., "630" or "1430") to minutes since midnight
  const timeToMinutes = (timeStr) => {
    if (!timeStr || timeStr === '') return 0;
    const padded = timeStr.padStart(4, '0');
    const hours = parseInt(padded.substring(0, 2), 10);
    const minutes = parseInt(padded.substring(2, 4), 10);
    return hours * 60 + minutes;
  };

  // Convert minutes to hours (decimal)
  const minutesToHours = (minutes) => {
    return minutes / 60;
  };

  // Calculate hours worked for a day
  const calculateHours = (inTime, outTime, breaks) => {
    if (!inTime || !outTime) return 0;
    const inMinutes = timeToMinutes(inTime);
    const outMinutes = timeToMinutes(outTime);
    const breakMinutes = parseInt(breaks || '0', 10);
    
    if (outMinutes <= inMinutes) return 0; // Invalid time range
    
    const totalMinutes = outMinutes - inMinutes - breakMinutes;
    return Math.max(0, minutesToHours(totalMinutes));
  };

  // Calculate weighted hours (overtime calculation)
  // Per day: first 8 hours at 1x, hours over 8 at 1.5x
  // Example: 10 hours in a day = 8 regular + (2 * 1.5) = 8 + 3 = 11 weighted hours
  const calculateWeightedHours = () => {
    let totalRegular = 0;
    let totalOvertime = 0;
    let totalWeighted = 0;

    workHours.forEach((day) => {
      const dayHours = calculateHours(day.in, day.out, day.breaks);
      
      if (dayHours <= 8) {
        // 8 hours or less: all regular
        totalRegular += dayHours;
        totalWeighted += dayHours;
      } else {
        // Over 8 hours: first 8 are regular, rest are overtime (1.5x)
        const regular = 8;
        const overtime = dayHours - 8;
        const weightedOvertime = overtime * 1.5;
        
        totalRegular += regular;
        totalOvertime += overtime;
        totalWeighted += regular + weightedOvertime;
      }
    });

    return { 
      regular: totalRegular, 
      overtime: totalOvertime, 
      weighted: totalWeighted 
    };
  };

  // Calculate total hours
  const totalHours = workHours.reduce((sum, day) => {
    return sum + calculateHours(day.in, day.out, day.breaks);
  }, 0);

  // Calculate calculatable hours (total hours)
  const calculatableHours = totalHours;

  // Calculate total travel miles
  const totalMiles = travelMiles.reduce((sum, day) => {
    return sum + (parseFloat(day.miles) || 0);
  }, 0);

  // Calculate travel cost
  const travelCost = totalMiles * pricePerMile;

  // Calculate total receipts
  const totalReceipts = receipts.reduce((sum, receipt) => {
    return sum + (parseFloat(receipt.amount) || 0);
  }, 0);

  // Calculate pay hours (weighted hours × rate per hour)
  const weightedHoursData = calculateWeightedHours();
  const payHours = (parseFloat(ratePerHour) || 0) * weightedHoursData.weighted;

  // Calculate overall total
  const overallTotal = payHours + travelCost + totalReceipts;

  // Format time for display (e.g., "630" -> "6:30 AM")
  const formatTime = (timeStr) => {
    if (!timeStr || timeStr === '') return '';
    const padded = timeStr.padStart(4, '0');
    const hours = parseInt(padded.substring(0, 2), 10);
    const minutes = padded.substring(2, 4);
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours > 12 ? hours - 12 : hours === 0 ? 12 : hours;
    return `${displayHours}:${minutes} ${period}`;
  };

  // Handle work hours change
  const handleWorkHoursChange = (index, field, value) => {
    const updated = [...workHours];
    updated[index] = { ...updated[index], [field]: value };
    setWorkHours(updated);
  };

  // Handle travel miles change
  const handleTravelMilesChange = (index, value) => {
    const updated = [...travelMiles];
    updated[index] = { ...updated[index], miles: value };
    setTravelMiles(updated);
  };

  // Handle receipts change
  const handleReceiptsChange = (index, field, value) => {
    const updated = [...receipts];
    updated[index] = { ...updated[index], [field]: value };
    setReceipts(updated);
  };

  // Add new receipt
  const handleAddReceipt = () => {
    setReceipts([...receipts, { amount: '', description: '' }]);
  };

  // Remove receipt
  const handleRemoveReceipt = (index) => {
    const updated = receipts.filter((_, i) => i !== index);
    setReceipts(updated);
  };

  // Load preset hours
  const handlePresetChange = (preset) => {
    if (preset === 'zero') {
      // All zeros
      setWorkHours(
        DAYS.map(day => ({
          day,
          in: '0',
          out: '0',
          breaks: '0',
        }))
      );
    } else if (preset === 'standard') {
      // Friday and Mon-Thurs: 645-1500 with 30min break
      setWorkHours(
        DAYS.map(day => {
          if (day === 'Friday' || day === 'Monday' || day === 'Tuesday' || day === 'Wednesday' || day === 'Thursday') {
            return {
              day,
              in: '645',
              out: '1500',
              breaks: '30',
            };
          } else {
            // Saturday and Sunday
            return {
              day,
              in: '0',
              out: '0',
              breaks: '0',
            };
          }
        })
      );
      toast.success('Loaded Standard Week');
    } else if (preset === 'dayShift') {
      setWorkHours(DAY_SHIFT_HOURS.map((h) => ({ ...h })));
      toast.success('Loaded Day Shift (6:00–14:30, all days)');
    } else {
      // Load saved preset (match id as string — Select values are always strings)
      const presets = readSavedPresets();
      const savedPreset = presets.find((p) => String(p.id) === String(preset));
      if (savedPreset) {
        setWorkHours(normalizeWorkHours(savedPreset.hours));
        toast.success(`Loaded "${savedPreset.name}"`);
      } else {
        toast.error('Saved hours not found — try saving again');
      }
    }
    // Reset the select after loading
    setPresetSelect('');
  };

  // Save current hours (upsert by name; name defaults to "Day Shift")
  const handleSavePreset = (nameOverride) => {
    const name = String(nameOverride ?? presetName).trim() || DEFAULT_PRESET_NAME;
    const hours = normalizeWorkHours(workHours);
    const existing = readSavedPresets().find(
      (p) => String(p.name || '').trim().toLowerCase() === name.toLowerCase(),
    );

    const preset = {
      id: existing?.id || Date.now().toString(),
      name,
      hours,
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      const current = readSavedPresets();
      const updatedPresets = existing
        ? current.map((p) => (String(p.id) === String(existing.id) ? preset : p))
        : [...current, preset];
      persistSavedPresets(updatedPresets);
      setPresetName(name);
      setSaveDialogOpen(false);
      toast.success(existing ? `Updated "${name}"` : `Saved "${name}" — pick it from Load Hours`);
    } catch (err) {
      console.error('Save preset failed:', err);
      toast.error('Could not save hours. Check browser storage settings.');
    }
  };

  // Delete a saved preset
  const handleDeletePreset = (presetId, e) => {
    e.stopPropagation(); // Prevent dropdown from closing
    if (window.confirm('Are you sure you want to delete this preset?')) {
      const updatedPresets = readSavedPresets().filter((p) => String(p.id) !== String(presetId));
      persistSavedPresets(updatedPresets);
      toast.success('Preset deleted');
    }
  };

  // Print functionality
  const handlePrint = async () => {
    // Log the payroll print activity
    try {
      await axios.post(`${API_URL}/activities/payroll/print`, {
        employeeName: employeeName.trim() || 'Unknown Employee'
      });
    } catch (error) {
      console.error('Error logging payroll print:', error);
      // Don't prevent printing if logging fails
    }
    
    // Trigger browser print dialog
    window.print();
  };

  return (
    <>
      {/* Print-specific styles */}
      <style>{`
        @media print {
          @page {
            margin: 0.5in;
          }
          body * {
            visibility: hidden;
          }
          .print-summary, .print-summary * {
            visibility: visible;
          }
          .print-summary {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            color: #000000 !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .print-summary .MuiTypography-root,
          .print-summary .MuiTableCell-root,
          .print-summary strong {
            color: #000000 !important;
          }
          .print-summary .MuiDivider-root {
            border-color: #000000 !important;
          }
          /* Hide sidebar and navigation */
          nav, aside, header, footer,
          [class*="Sidebar"], [class*="sidebar"],
          [class*="Drawer"], [class*="drawer"] {
            display: none !important;
          }
        }
      `}</style>
      
      <Box sx={{ p: { xs: 1, sm: 2, md: 4 }, width: '100%', '@media print': { p: 0 } }}>
        {/* Print Summary - Only visible when printing */}
        <Box
          ref={printSummaryRef}
          className="print-summary"
          sx={{
            display: 'none',
            color: '#000',
            backgroundColor: '#fff',
            '& .MuiTypography-root': { color: '#000' },
            '& .MuiTableCell-root': { color: '#000' },
            '& .MuiTableRow-root': { color: '#000' },
            '& .MuiDivider-root': { borderColor: '#000', opacity: 1 },
            '@media print': { display: 'block', p: 2 },
          }}
        >
        <Box sx={{ mb: 3, display: 'flex', alignItems: 'flex-start', gap: 2 }}>
          {/* Logo at top left */}
          <Box sx={{ flexShrink: 0 }}>
            <BrandLogo
              alt="Liminnality"
              sx={{
                height: 60,
                width: 60,
                objectFit: 'contain',
              }}
            />
          </Box>
          {/* Employee info on the right */}
          <Box sx={{ flex: 1, display: 'flex', justifyContent: 'space-around', flexWrap: 'wrap', gap: 2 }}>
            <Typography variant="body1" sx={{ fontSize: '10pt' }}><strong>Employee:</strong> {employeeName}</Typography>
            <Typography variant="body1" sx={{ fontSize: '10pt' }}><strong>Rate Per Hour:</strong> ${ratePerHour || '0.00'}</Typography>
            <Typography variant="body1" sx={{ fontSize: '10pt' }}><strong>Date:</strong> {date}</Typography>
          </Box>
        </Box>

        <Box sx={{ mb: 2 }}>
          <Box
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: 1,
              borderBottom: '2px solid #000',
              pb: 0.5,
              mb: 1,
            }}
          >
            <Typography variant="h6" sx={{ fontWeight: 700, fontSize: '12pt', m: 0 }}>
              Work Hours
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 1.5, columnGap: 2 }}>
              <Typography component="span" variant="body2" sx={{ fontSize: '9pt', whiteSpace: 'nowrap' }}>
                <strong>Total hours:</strong> {totalHours.toFixed(2)} hrs
              </Typography>
              <Typography component="span" variant="body2" sx={{ fontSize: '9pt', whiteSpace: 'nowrap' }}>
                <strong>Weighted hours:</strong> {weightedHoursData.weighted.toFixed(2)} hrs
              </Typography>
              {weightedHoursData.overtime > 0 && (
                <Typography component="span" variant="caption" sx={{ fontSize: '8pt', color: '#000' }}>
                  ({weightedHoursData.regular.toFixed(2)} reg + {weightedHoursData.overtime.toFixed(2)} OT × 1.5)
                </Typography>
              )}
            </Box>
          </Box>
          <Table size="small" sx={{ mb: 1, border: '1px solid #000', borderCollapse: 'collapse', '& td, & th': { borderCollapse: 'collapse' } }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700, borderRight: '1px solid #000', borderBottom: '1px solid #000', fontSize: '9pt', py: 0.5 }}>Day</TableCell>
                <TableCell sx={{ fontWeight: 700, borderRight: '1px solid #000', borderBottom: '1px solid #000', fontSize: '9pt', py: 0.5 }}>In</TableCell>
                <TableCell sx={{ fontWeight: 700, borderRight: '1px solid #000', borderBottom: '1px solid #000', fontSize: '9pt', py: 0.5 }}>Out</TableCell>
                <TableCell sx={{ fontWeight: 700, borderRight: '1px solid #000', borderBottom: '1px solid #000', fontSize: '9pt', py: 0.5 }} align="center">Hours</TableCell>
                <TableCell sx={{ fontWeight: 700, borderBottom: '1px solid #000', fontSize: '9pt', py: 0.5 }} align="center">Breaks (min)</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {workHours.map((day) => {
                const hours = calculateHours(day.in, day.out, day.breaks);
                return (
                  <TableRow key={day.day}>
                    <TableCell sx={{ fontWeight: 600, borderRight: '1px solid #000', fontSize: '8pt', py: 0.5 }}>{day.day}</TableCell>
                    <TableCell sx={{ borderRight: '1px solid #000', fontSize: '8pt', py: 0.5 }}>{day.in || '0'}</TableCell>
                    <TableCell sx={{ borderRight: '1px solid #000', fontSize: '8pt', py: 0.5 }}>{day.out || '0'}</TableCell>
                    <TableCell sx={{ borderRight: '1px solid #000', fontSize: '8pt', py: 0.5 }} align="center">{hours.toFixed(2)} hrs</TableCell>
                    <TableCell sx={{ fontSize: '8pt', py: 0.5 }} align="center">{day.breaks || '0'}</TableCell>
                  </TableRow>
                );
              })}
              <TableRow
                sx={{
                  backgroundColor: '#f0f0f0',
                  '& td': {
                    fontWeight: 700,
                    borderTop: '2px solid #000',
                    fontSize: '9pt',
                    py: 0.5,
                    color: '#000',
                  },
                }}
              >
                <TableCell sx={{ borderRight: '1px solid #000' }}>Total</TableCell>
                <TableCell sx={{ borderRight: '1px solid #000' }}></TableCell>
                <TableCell sx={{ borderRight: '1px solid #000' }}></TableCell>
                <TableCell sx={{ borderRight: '1px solid #000' }} align="center">{totalHours.toFixed(2)} hrs</TableCell>
                <TableCell></TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Box>

        {/* Miles + Receipts side-by-side to save vertical space on print/PDF */}
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'row',
            gap: 2,
            mb: 2,
            alignItems: 'flex-start',
            '@media print': { gap: 1.5 },
          }}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5, fontSize: '11pt' }}>
              Miles
            </Typography>
            <Box sx={{ borderBottom: '1px solid #000', mb: 1 }} />
            {totalMiles > 0 ? (
              <>
                {travelMiles
                  .filter((day) => parseFloat(day.miles) > 0)
                  .map((day) => (
                    <Typography key={day.day} variant="body2" sx={{ fontSize: '8.5pt', mb: 0.25, lineHeight: 1.35 }}>
                      {day.day}: {day.miles} mi
                    </Typography>
                  ))}
                <Typography variant="body2" sx={{ fontSize: '9pt', mt: 0.75 }}>
                  <strong>Travel cost:</strong> ${travelCost.toFixed(2)}
                </Typography>
              </>
            ) : (
              <Typography variant="body2" sx={{ fontSize: '8.5pt' }}>
                None (0 mi)
              </Typography>
            )}
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5, fontSize: '11pt' }}>
              Receipts
            </Typography>
            <Box sx={{ borderBottom: '1px solid #000', mb: 1 }} />
            {receipts.length > 0 ? (
              <>
                {receipts.map((receipt, idx) => (
                  <Typography
                    key={idx}
                    variant="body2"
                    sx={{ fontSize: '8.5pt', mb: 0.25, lineHeight: 1.35 }}
                  >
                    {(receipt.description || 'Receipt').slice(0, 48)}
                    {(receipt.description || '').length > 48 ? '…' : ''}: $
                    {(parseFloat(receipt.amount) || 0).toFixed(2)}
                  </Typography>
                ))}
                <Typography variant="body2" sx={{ fontSize: '9pt', mt: 0.75 }}>
                  <strong>Total:</strong> ${totalReceipts.toFixed(2)}
                </Typography>
              </>
            ) : (
              <Typography variant="body2" sx={{ fontSize: '8.5pt' }}>
                None — $0.00
              </Typography>
            )}
          </Box>
        </Box>

        <Box
          sx={{
            mt: 1.5,
            p: 1.25,
            border: '2px solid #000',
            backgroundColor: '#fff',
            color: '#000',
            '& .MuiTypography-root': { color: '#000' },
          }}
        >
          <Typography variant="h6" sx={{ fontWeight: 700, mb: 1, textAlign: 'center', fontSize: '11pt', color: '#000' }}>
            Paycheck Summary
          </Typography>
          <Box sx={{ mb: 1, display: 'flex', flexWrap: 'wrap', columnGap: 2, rowGap: 0.5, justifyContent: 'center' }}>
            <Typography component="span" variant="body2" sx={{ fontSize: '8.5pt', color: '#000' }}><strong>Pay:</strong> ${payHours.toFixed(2)}</Typography>
            <Typography component="span" variant="body2" sx={{ fontSize: '8.5pt', color: '#000' }}><strong>Travel:</strong> ${travelCost.toFixed(2)}</Typography>
            <Typography component="span" variant="body2" sx={{ fontSize: '8.5pt', color: '#000' }}><strong>Receipts:</strong> ${totalReceipts.toFixed(2)}</Typography>
          </Box>
          <Divider sx={{ my: 1, borderWidth: 1, borderColor: '#000' }} />
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="h6" sx={{ fontWeight: 700, fontSize: '12pt', color: '#000' }}>
              Overall Total: ${overallTotal.toFixed(2)}
            </Typography>
          </Box>
        </Box>
      </Box>

      {/* Interactive Form - Hidden when printing */}
      <Box sx={{ '@media print': { display: 'none' } }}>
        {/* Header */}
        <Box sx={{ 
          display: 'flex', 
          flexDirection: { xs: 'column', md: 'row' },
          justifyContent: 'space-between', 
          alignItems: { xs: 'stretch', md: 'center' }, 
          mb: { xs: 3, sm: 4, md: 5 },
          gap: { xs: 2, md: 0 }
        }}>
          <Box>
            <Typography variant="h4" sx={{ fontWeight: 700, mb: 1, color: theme.palette.primary.main, fontSize: { xs: '1.5rem', sm: '2rem' } }}>
              SAN CLEMENTE WOODWORKING
            </Typography>
            <Typography variant="body1" color="text.secondary" sx={{ fontSize: { xs: '0.875rem', sm: '1rem' } }}>
              Timesheet
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center', width: { xs: '100%', md: 'auto' } }}>
            <FormControl size="small" sx={{ minWidth: 200 }}>
              <InputLabel>Load Hours</InputLabel>
              <Select
                label="Load Hours"
                value={presetSelect}
                onChange={(e) => {
                  const preset = e.target.value;
                  if (preset) {
                    handlePresetChange(preset);
                  }
                }}
                sx={{ textTransform: 'none' }}
              >
                <MenuItem value="zero">Clear All (Set to Zero)</MenuItem>
                <MenuItem value="dayShift">Day Shift (all days: 6:00–14:30, 30 min break)</MenuItem>
                <MenuItem value="standard">Standard Week (Mon–Fri: 6:45–15:00; weekends off)</MenuItem>
                {savedPresets.length > 0 && (
                  <>
                    <Divider sx={{ my: 0.5 }} />
                    {savedPresets.map((preset) => (
                      <MenuItem 
                        key={preset.id} 
                        value={String(preset.id)}
                        sx={{ 
                          display: 'flex', 
                          justifyContent: 'space-between', 
                          alignItems: 'center',
                          pr: 0.5
                        }}
                      >
                        <Box sx={{ flex: 1 }}>{preset.name}</Box>
                        <IconButton
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            handleDeletePreset(preset.id, e);
                          }}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                          }}
                          sx={{ 
                            ml: 1,
                            '&:hover': { backgroundColor: 'error.light', color: 'error.main' }
                          }}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </MenuItem>
                    ))}
                  </>
                )}
              </Select>
            </FormControl>
            <Button
              size="small"
              variant="outlined"
              startIcon={<SaveIcon fontSize="small" />}
              onClick={() => handleSavePreset(DEFAULT_PRESET_NAME)}
              sx={COMPACT_BTN_SX}
            >
              Save Hours
            </Button>
            <Button
              size="small"
              variant="text"
              onClick={() => {
                setPresetName(DEFAULT_PRESET_NAME);
                setSaveDialogOpen(true);
              }}
              sx={COMPACT_BTN_SX}
            >
              Save as…
            </Button>
            <Button
              size="small"
              variant="contained"
              startIcon={<PrintIcon fontSize="small" />}
              onClick={handlePrint}
              sx={COMPACT_BTN_SX}
            >
              Print
            </Button>
          </Box>
        </Box>

        {/* Employee Info Card */}
        <Card sx={{ mb: { xs: 2, sm: 3, md: 4 }, boxShadow: 2 }}>
          <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
            <Grid container spacing={{ xs: 2, sm: 3, md: 4 }}>
              <Grid item xs={12} sm={4}>
                <TextField
                  label="Employee Name"
                  value={employeeName}
                  onChange={(e) => setEmployeeName(e.target.value)}
                  fullWidth
                  variant="outlined"
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  label="Rate Per Hour ($)"
                  value={ratePerHour}
                  onChange={(e) => setRatePerHour(e.target.value)}
                  fullWidth
                  type="number"
                  variant="outlined"
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  label="Date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  fullWidth
                  variant="outlined"
                />
              </Grid>
            </Grid>
          </CardContent>
        </Card>

        {/* Locked Container for Sections - Same width as header card */}
        <Box sx={{ 
          width: '100%',
          border: '1px solid #e0e0e0',
          borderRadius: 2,
          p: { xs: 1.5, sm: 2, md: 3 },
          backgroundColor: theme.palette.mode === 'dark' ? '#1E1E1E' : '#fafafa'
        }}>
          {/* Flexbox container for all widgets */}
          <Box sx={{ 
            display: 'flex',
            flexDirection: 'column',
            gap: { xs: 2, sm: 3 },
            width: '100%'
          }}>
            {/* Top Row: Work Hours and Travel Miles */}
            <Box sx={{ 
              display: 'flex',
              flexDirection: { xs: 'column', lg: 'row' },
              gap: { xs: 2, sm: 3 },
              width: '100%'
            }}>
              {/* Work Hours Section */}
              <Card sx={{ 
                flex: 1,
                boxShadow: 2,
                display: 'flex',
                flexDirection: 'column',
                '@media print': { boxShadow: 'none' }
              }}>
                <CardContent sx={{ p: 3, flex: 1, display: 'flex', flexDirection: 'column' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
                <TimeIcon sx={{ color: 'primary.main', fontSize: 28 }} />
                <Typography variant="h5" sx={{ fontWeight: 600 }}>
                  Work Hours
                </Typography>
              </Box>

              <Table size="small" sx={{ mb: 4, width: '100%' }}>
                <TableHead>
                  <TableRow sx={{ backgroundColor: theme.palette.mode === 'dark' ? '#2A2A2A' : '#f5f5f5' }}>
                    <TableCell sx={{ fontWeight: 700, width: '20%' }}>Day</TableCell>
                    <TableCell sx={{ fontWeight: 700, width: '20%' }}>In</TableCell>
                    <TableCell sx={{ fontWeight: 700, width: '20%' }}>Out</TableCell>
                    <TableCell sx={{ fontWeight: 700, width: '20%' }} align="center">Hours</TableCell>
                    <TableCell sx={{ fontWeight: 700, width: '20%' }} align="center">Breaks (min)</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {workHours.map((day, index) => {
                    const hours = calculateHours(day.in, day.out, day.breaks);
                    return (
                      <TableRow key={day.day} hover>
                        <TableCell sx={{ fontWeight: 600, width: '20%' }}>{day.day}</TableCell>
                        <TableCell sx={{ width: '20%' }}>
                          <TextField
                            value={day.in}
                            onChange={(e) => handleWorkHoursChange(index, 'in', e.target.value)}
                            size="small"
                            placeholder="645"
                            fullWidth
                            inputProps={{ 
                              style: { textAlign: 'center', padding: '8px' },
                              maxLength: 4
                            }}
                            sx={{ 
                              '@media print': { '& .MuiOutlinedInput-notchedOutline': { border: 'none' } }
                            }}
                          />
                        </TableCell>
                        <TableCell sx={{ width: '20%' }}>
                          <TextField
                            value={day.out}
                            onChange={(e) => handleWorkHoursChange(index, 'out', e.target.value)}
                            size="small"
                            placeholder="1500"
                            fullWidth
                            inputProps={{ 
                              style: { textAlign: 'center', padding: '8px' },
                              maxLength: 4
                            }}
                            sx={{ 
                              '@media print': { '& .MuiOutlinedInput-notchedOutline': { border: 'none' } }
                            }}
                          />
                        </TableCell>
                        <TableCell align="center" sx={{ fontWeight: 600, color: hours > 0 ? 'primary.main' : 'text.secondary', width: '20%' }}>
                          {hours.toFixed(2)} hrs
                        </TableCell>
                        <TableCell sx={{ width: '20%' }}>
                          <TextField
                            value={day.breaks}
                            onChange={(e) => handleWorkHoursChange(index, 'breaks', e.target.value)}
                            size="small"
                            placeholder="30"
                            fullWidth
                            inputProps={{ 
                              style: { textAlign: 'center', padding: '8px' },
                              maxLength: 3
                            }}
                            sx={{ 
                              '@media print': { '& .MuiOutlinedInput-notchedOutline': { border: 'none' } }
                            }}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  <TableRow sx={{ backgroundColor: theme.palette.mode === 'dark' ? 'rgba(25, 118, 210, 0.16)' : '#e3f2fd', '& td': { fontWeight: 700, borderTop: `2px solid ${theme.palette.primary.main}` } }}>
                    <TableCell sx={{ width: '20%' }}>Total</TableCell>
                    <TableCell sx={{ width: '20%' }}></TableCell>
                    <TableCell sx={{ width: '20%' }}></TableCell>
                    <TableCell align="center" sx={{ color: 'primary.main', fontSize: '1.1rem', width: '20%' }}>
                      {totalHours.toFixed(2)} hrs
                    </TableCell>
                    <TableCell sx={{ width: '20%' }}></TableCell>
                  </TableRow>
                </TableBody>
              </Table>

              {/* Total and Weighted Hours */}
              <Box sx={{ mt: 3, pt: 3, borderTop: '2px solid #e0e0e0' }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                  <Typography variant="body1" sx={{ fontWeight: 600, fontSize: '1.1rem' }}>
                    Total Hours:
                  </Typography>
                  <Typography variant="h6" sx={{ fontWeight: 700, color: 'primary.main', fontSize: '1.2rem' }}>
                    {totalHours.toFixed(2)} hrs
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography variant="body1" sx={{ fontWeight: 600, fontSize: '1.1rem' }}>
                    Weighted Hours:
                  </Typography>
                  <Typography variant="h6" sx={{ fontWeight: 700, color: '#f57c00', fontSize: '1.2rem' }}>
                    {weightedHoursData.weighted.toFixed(2)} hrs
                  </Typography>
                </Box>
                {weightedHoursData.overtime > 0 && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1, textAlign: 'right' }}>
                    ({weightedHoursData.regular.toFixed(2)} reg + {weightedHoursData.overtime.toFixed(2)} OT × 1.5)
                  </Typography>
                )}
              </Box>
                </CardContent>
              </Card>

              {/* Travel Miles Section */}
              <Card sx={{ 
                flex: 1,
                boxShadow: 2,
                display: 'flex',
                flexDirection: 'column'
              }}>
                <CardContent sx={{ p: 3, flex: 1, display: 'flex', flexDirection: 'column' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
                <CarIcon sx={{ color: 'primary.main', fontSize: 28 }} />
                <Typography variant="h5" sx={{ fontWeight: 600 }}>
                  Travel Miles
                </Typography>
              </Box>

              <Table size="small" sx={{ mb: 3, width: '100%' }}>
                <TableHead>
                  <TableRow sx={{ backgroundColor: theme.palette.mode === 'dark' ? '#2A2A2A' : '#f5f5f5' }}>
                    <TableCell sx={{ fontWeight: 700, width: '50%' }}>Day</TableCell>
                    <TableCell sx={{ fontWeight: 700, width: '50%' }} align="right">Miles</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {travelMiles.map((day, index) => (
                    <TableRow key={day.day} hover>
                      <TableCell sx={{ fontWeight: 600, width: '50%' }}>{day.day}</TableCell>
                      <TableCell align="right" sx={{ width: '50%' }}>
                        <TextField
                          value={day.miles}
                          onChange={(e) => handleTravelMilesChange(index, e.target.value)}
                          size="small"
                          type="text"
                          placeholder="0"
                          fullWidth
                          inputProps={{ 
                            style: { textAlign: 'right', padding: '8px' },
                            inputMode: 'numeric',
                            pattern: '[0-9]*'
                          }}
                          sx={{ 
                            '& input[type=number]': {
                              MozAppearance: 'textfield',
                            },
                            '& input[type=number]::-webkit-outer-spin-button': {
                              WebkitAppearance: 'none',
                              margin: 0,
                            },
                            '& input[type=number]::-webkit-inner-spin-button': {
                              WebkitAppearance: 'none',
                              margin: 0,
                            },
                            '@media print': { '& .MuiOutlinedInput-notchedOutline': { border: 'none' } }
                          }}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow sx={{ backgroundColor: theme.palette.mode === 'dark' ? 'rgba(25, 118, 210, 0.16)' : '#e3f2fd', '& td': { fontWeight: 700, borderTop: `2px solid ${theme.palette.primary.main}` } }}>
                    <TableCell sx={{ width: '50%' }}>Total</TableCell>
                    <TableCell align="right" sx={{ color: 'primary.main', fontSize: '1.1rem', width: '50%' }}>
                      {totalMiles.toFixed(0)} miles
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>

              <Box sx={{ mt: 3 }}>
                <Paper sx={{ p: 2.5, backgroundColor: theme.palette.mode === 'dark' ? '#2A2A2A' : '#f5f5f5' }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
                    <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.95rem' }}>
                      Price per mile
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.95rem' }}>
                      ${pricePerMile.toFixed(4)}
                    </Typography>
                  </Box>
                  <Divider sx={{ my: 1.5 }} />
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="body1" sx={{ fontWeight: 600, fontSize: '1.1rem' }}>
                      Travel Cost
                    </Typography>
                    <Typography variant="h6" sx={{ fontWeight: 700, color: 'primary.main', fontSize: '1.2rem' }}>
                      ${travelCost.toFixed(2)}
                    </Typography>
                  </Box>
                </Paper>
              </Box>
                </CardContent>
              </Card>
            </Box>

            {/* Bottom Row: Receipts and Paycheck Summary */}
            <Box sx={{ 
              display: 'flex',
              flexDirection: { xs: 'column', lg: 'row' },
              gap: { xs: 2, sm: 3 },
              width: '100%'
            }}>
              {/* Receipts Section */}
              <Card sx={{ 
                flex: 1,
                boxShadow: 2,
                display: 'flex',
                flexDirection: 'column'
              }}>
                <CardContent sx={{ p: 3, flex: 1, display: 'flex', flexDirection: 'column' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <ReceiptIcon sx={{ color: 'primary.main', fontSize: 28 }} />
                  <Typography variant="h5" sx={{ fontWeight: 600 }}>
                    Receipts
                  </Typography>
                </Box>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={handleAddReceipt}
                  sx={{ textTransform: 'none', '@media print': { display: 'none' } }}
                >
                  Add Receipt
                </Button>
              </Box>

              {receipts.length === 0 ? (
                <Box sx={{ textAlign: 'center', py: 5 }}>
                  <Typography variant="body2" color="text.secondary">
                    No receipts added. Click "Add Receipt" to add one.
                  </Typography>
                </Box>
              ) : (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
                  {receipts.map((receipt, index) => (
                    <Box key={index} sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
                      <TextField
                        label="Description"
                        value={receipt.description || ''}
                        onChange={(e) => handleReceiptsChange(index, 'description', e.target.value)}
                        size="small"
                        placeholder="Receipt description"
                        sx={{ flex: 1, '@media print': { '& .MuiOutlinedInput-notchedOutline': { border: 'none' } } }}
                      />
                      <TextField
                        label="Amount"
                        value={receipt.amount || ''}
                        onChange={(e) => handleReceiptsChange(index, 'amount', e.target.value)}
                        size="small"
                        type="number"
                        placeholder="0.00"
                        InputProps={{
                          startAdornment: <Typography sx={{ mr: 1, color: 'text.secondary' }}>$</Typography>
                        }}
                        sx={{ 
                          width: 150,
                          '@media print': { '& .MuiOutlinedInput-notchedOutline': { border: 'none' } }
                        }}
                      />
                      <Button
                        variant="outlined"
                        color="error"
                        size="small"
                        onClick={() => handleRemoveReceipt(index)}
                        sx={{ 
                          minWidth: 'auto',
                          px: 1.5,
                          '@media print': { display: 'none' }
                        }}
                      >
                        Remove
                      </Button>
                    </Box>
                  ))}
                </Box>
              )}

              {receipts.length > 0 && (
                <Box sx={{ mt: 4 }}>
                  <Paper sx={{ p: 2.5, backgroundColor: '#f5f5f5', textAlign: 'center' }}>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5, fontSize: '0.95rem' }}>
                      Total Receipts
                    </Typography>
                    <Typography variant="h6" sx={{ fontWeight: 700, color: 'primary.main', fontSize: '1.2rem' }}>
                      ${totalReceipts.toFixed(2)}
                    </Typography>
                  </Paper>
                </Box>
              )}
                </CardContent>
              </Card>

              {/* Paycheck Summary */}
              <Card sx={{ 
                flex: 1,
                boxShadow: 3,
                backgroundColor: theme.palette.mode === 'dark' ? '#2A2A2A' : '#f8f9fa',
                display: 'flex',
                flexDirection: 'column'
              }}>
                <CardContent sx={{ p: 3, flex: 1, display: 'flex', flexDirection: 'column' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
                <PaycheckIcon sx={{ color: 'primary.main', fontSize: 28 }} />
                <Typography variant="h5" sx={{ fontWeight: 600 }}>
                  Paycheck Summary
                </Typography>
              </Box>

              <Box sx={{ mb: 3 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2.5, pb: 2, borderBottom: '1px solid #e0e0e0' }}>
                  <Typography variant="body1" color="text.secondary" sx={{ fontSize: '1.05rem' }}>
                    Pay Hours
                  </Typography>
                  <Typography variant="h6" sx={{ fontWeight: 600, fontSize: '1.2rem' }}>
                    ${payHours.toFixed(2)}
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2.5, pb: 2, borderBottom: '1px solid #e0e0e0' }}>
                  <Typography variant="body1" color="text.secondary" sx={{ fontSize: '1.05rem' }}>
                    Travel Cost
                  </Typography>
                  <Typography variant="h6" sx={{ fontWeight: 600, fontSize: '1.2rem' }}>
                    ${travelCost.toFixed(2)}
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                  <Typography variant="body1" color="text.secondary" sx={{ fontSize: '1.05rem' }}>
                    Receipts
                  </Typography>
                  <Typography variant="h6" sx={{ fontWeight: 600, fontSize: '1.2rem' }}>
                    ${totalReceipts.toFixed(2)}
                  </Typography>
                </Box>
              </Box>

              <Divider sx={{ my: 3 }} />

              <Paper sx={{ p: 3.5, backgroundColor: '#1976d2', color: 'white', textAlign: 'center' }}>
                <Typography variant="body2" sx={{ mb: 1.5, opacity: 0.9, fontSize: '1rem' }}>
                  Overall Total
                </Typography>
                <Typography variant="h4" sx={{ fontWeight: 700, fontSize: '2rem' }}>
                  ${overallTotal.toFixed(2)}
                </Typography>
              </Paper>
                </CardContent>
              </Card>
            </Box>
          </Box>
        </Box>
      </Box>

      {/* Save Preset Dialog */}
      <Dialog open={saveDialogOpen} onClose={() => {
        setSaveDialogOpen(false);
        setPresetName(DEFAULT_PRESET_NAME);
      }} maxWidth="sm" fullWidth>
        <DialogTitle>Save hours as…</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2 }}>
            Optional label for this shift. Use &ldquo;Day Shift&rdquo; for the usual 6:00–14:30 schedule, or name
            another shift (e.g. &ldquo;Late Shift&rdquo;).
          </Typography>
          <TextField
            autoFocus
            margin="dense"
            label="Preset name (optional)"
            fullWidth
            variant="outlined"
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            placeholder={DEFAULT_PRESET_NAME}
            sx={{ mt: 1 }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleSavePreset();
              }
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => {
            setSaveDialogOpen(false);
            setPresetName(DEFAULT_PRESET_NAME);
          }}>
            Cancel
          </Button>
          <Button 
            size="small"
            onClick={() => handleSavePreset()} 
            variant="contained"
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
    </>
  );
}

function PayrollPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') === 'payroll' ? 'payroll' : 'manual';

  return (
    <Box>
      <Box
        sx={{
          px: { xs: 1, sm: 2, md: 4 },
          pt: { xs: 1, sm: 2, md: 3 },
          '@media print': { display: 'none' },
        }}
      >
        <Tabs
          value={tab}
          onChange={(_event, next) => {
            setSearchParams(next === 'payroll' ? { tab: 'payroll' } : {}, { replace: true });
          }}
          sx={{ borderBottom: 1, borderColor: 'divider' }}
        >
          <Tab value="manual" label="Manual" sx={{ textTransform: 'none' }} />
          <Tab value="payroll" label="Payroll" sx={{ textTransform: 'none' }} />
        </Tabs>
      </Box>
      {tab === 'payroll' ? <RfidTimesheetPage hidePageTitle /> : <ManualPayrollPage />}
    </Box>
  );
}

export default PayrollPage;
