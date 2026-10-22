/**
 * TakeoffSheetPage — Field takeoff form with job autofill.
 * Route: /takeoff-sheet
 * Docs: ../../../docs/PAGES.md#takeoffsheetpagetsx
 */
// @ts-nocheck — large page; tighten types incrementally
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Container,
  TextField,
  Typography,
} from '@mui/material';
import {
  Add as AddIcon,
  PictureAsPdf as PictureAsPdfIcon,
  Save as SaveIcon,
  Settings as SettingsIcon,
} from '@mui/icons-material';
import TakeoffAutocompleteSettingsDialog from '../components/takeoff/TakeoffAutocompleteSettingsDialog';
import { loadTakeoffAutocompleteLists } from '../utils/takeoffAutocompleteStorage';
import {
  applyAddDoubleRow,
  newTakeoffRow as newRow,
  toggleTakeoffRowDouble,
} from '../utils/takeoffRows';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import axios from 'axios';
import toast from 'react-hot-toast';
import { formatPhoneForDisplay } from '../utils/phoneFormat';
import BrandLogo from '../components/common/BrandLogo';

const DEFAULT_ROWS = 12;
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';
const SUPER = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
const SUB = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉' };

function mergeRefs(...refs) {
  return (el) => {
    refs.filter(Boolean).forEach((r) => {
      if (typeof r === 'function') r(el);
      else r.current = el;
    });
  };
}

/** One Tab step toward `target`, stopping at dot/dash/slash/space boundaries (terminal-style). */
function expandOneTab(input, target) {
  const a = String(input);
  const b = String(target);
  if (!b.toLowerCase().startsWith(a.toLowerCase()) || b.length <= a.length) return a;
  let pos = a.length;
  if (pos < b.length && /[.\-_/\s]/.test(b[pos])) {
    while (pos < b.length && /[.\-_/\s]/.test(b[pos])) pos += 1;
  }
  while (pos < b.length && !/[.\-_/\s]/.test(b[pos])) pos += 1;
  while (pos < b.length && /[.\-_/\s]/.test(b[pos])) pos += 1;
  let out = b.slice(0, pos).replace(/[.\-_/\s]+$/g, '');
  if (out.length <= a.length) return b;
  return out;
}

/**
 * Readline-style Tab: complete from saved lists.
 * One match: do a single segment step (e.g. W -> W.O), then next Tab moves cell.
 * Several matches: fill full strings in list order; repeat cycles alternates.
 */
function terminalTabComplete(options, value, cycleKey, cycleRef) {
  const raw = String(value ?? '');
  if (!raw.trim()) return null;
  const prefix = raw.toLowerCase();
  const list = Array.isArray(options) ? options : [];
  const matches = list.filter((o) => String(o).toLowerCase().startsWith(prefix));
  const extending = matches.filter((o) => String(o) !== raw);
  if (!extending.length) return null;
  const ordered = list.filter((o) => extending.includes(o));
  if (ordered.length === 1) {
    // After the first segmented completion (contains delimiter), let Tab navigate forward.
    if (/[.\-_/ ]/.test(raw)) return null;
    const only = ordered[0];
    const step = expandOneTab(raw, only);
    if (step !== raw) return step;
    return only;
  }
  if (cycleRef.current.key !== cycleKey) {
    cycleRef.current = { key: cycleKey, idx: 0 };
  } else {
    cycleRef.current.idx = (cycleRef.current.idx + 1) % ordered.length;
  }
  return ordered[cycleRef.current.idx];
}

function normalizeSavedRow(r) {
  if (!r || typeof r !== 'object') return newRow();
  const base = {
    item: typeof r.item === 'string' ? r.item : '',
    qty: typeof r.qty === 'string' ? r.qty : '',
    material: typeof r.material === 'string' ? r.material : '',
    description: typeof r.description === 'string' ? r.description : '',
  };
  const tall = r.doubleHeight === true || r.mergeTail === true;
  return tall ? { ...base, doubleHeight: true } : base;
}

function normalizeSavedForm(saved) {
  if (!saved || typeof saved !== 'object') return null;
  const rows = Array.isArray(saved.rows) && saved.rows.length > 0
    ? saved.rows.map(normalizeSavedRow)
    : Array.from({ length: DEFAULT_ROWS }, () => newRow());
  return {
    customerId: saved.customerId ?? null,
    soldTo: typeof saved.soldTo === 'string' ? saved.soldTo : '',
    phoneNumber:
      typeof saved.phoneNumber === 'string' && saved.phoneNumber.trim()
        ? formatPhoneForDisplay(saved.phoneNumber.trim())
        : '',
    date:
      typeof saved.date === 'string' && saved.date.trim()
        ? saved.date
        : new Date().toLocaleDateString('en-US'),
    nameAddress: typeof saved.nameAddress === 'string' ? saved.nameAddress : '',
    notes: typeof saved.notes === 'string' ? saved.notes : '',
    bay: typeof saved.bay === 'string' ? saved.bay : '',
    rows,
  };
}


function formatVerticalFractions(text) {
  if (!text || typeof text !== 'string') return text;
  return text.replace(/\b(\d{1,2})\/(\d{1,2})\b/g, (_, num, den) => {
    const top = String(num)
      .split('')
      .map((d) => SUPER[d] || d)
      .join('');
    const bottom = String(den)
      .split('')
      .map((d) => SUB[d] || d)
      .join('');
    return `${top}⁄${bottom}`;
  });
}

function wrapWords(text, maxChars = 28) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  const words = raw.split(/\s+/);
  const lines = [];
  let current = '';
  words.forEach((word) => {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  });
  if (current) lines.push(current);
  return lines.join('\n');
}

function wrapMultilineText(text, maxChars = 28) {
  const raw = String(text || '');
  if (!raw.trim()) return '';
  return raw
    .split('\n')
    .map((line) => wrapWords(line, maxChars))
    .filter((line, idx, arr) => line !== '' || idx < arr.length - 1)
    .join('\n');
}
function enforceStreetCityLines(raw) {
  const text = String(raw || '').replace(/\r/g, '').trim();
  if (!text) return '';
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const streetLine = lines[0] || '';
  const cityLine = lines[1] || '';
  return [streetLine, cityLine].filter(Boolean).join('\n');
}

/** Sold-to / customer fields always follow the linked job (not user-picked). */
function takeoffCustomerFieldsFromJob(job) {
  const cust = job?.customerId;
  if (!cust || typeof cust !== 'object' || !cust._id) {
    return {
      customerId: null,
      soldTo: '',
      phoneNumber: '',
      nameAddress: '',
    };
  }
  const streetLine = wrapWords(cust.address?.street || '', 30);
  const cityLine = String(cust.address?.city || '').trim();
  return {
    customerId: cust._id,
    soldTo: String(cust.name || '').trim(),
    phoneNumber: cust.primaryPhone ? formatPhoneForDisplay(cust.primaryPhone) : '',
    nameAddress: [streetLine, cityLine].filter(Boolean).join('\n'),
  };
}

function defaultTakeoffForm() {
  return {
    customerId: null,
    soldTo: '',
    phoneNumber: '',
    date: new Date().toLocaleDateString('en-US'),
    nameAddress: '',
    notes: '',
    bay: '',
    rows: Array.from({ length: DEFAULT_ROWS }, () => newRow()),
  };
}

function TakeoffSheetPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const jobId = searchParams.get('jobId');
  const sheetRef = useRef(null);
  const cellRefs = useRef([]);
  const tabCompleteCycleRef = useRef({ key: '', idx: 0 });
  const [jobs, setJobs] = useState([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [loadingJobSheet, setLoadingJobSheet] = useState(false);
  const [savingTakeoff, setSavingTakeoff] = useState(false);
  const [pendingFocus, setPendingFocus] = useState(null);
  const [isExportMode, setIsExportMode] = useState(false);
  const [takeoffAutocompleteOpen, setTakeoffAutocompleteOpen] = useState(false);
  const [takeoffAutocompleteLists, setTakeoffAutocompleteLists] = useState(loadTakeoffAutocompleteLists);
  const [form, setForm] = useState(defaultTakeoffForm);

  useEffect(() => {
    const fetchJobs = async () => {
      try {
        setLoadingJobs(true);
        const response = await axios.get(`${API_URL}/jobs?limit=500`);
        setJobs(response.data.jobs || response.data || []);
      } catch (error) {
        console.error('Error fetching jobs for takeoff sheet:', error);
      } finally {
        setLoadingJobs(false);
      }
    };
    fetchJobs();
  }, []);

  useEffect(() => {
    if (!jobId) return undefined;
    let cancelled = false;
    (async () => {
      try {
        setLoadingJobSheet(true);
        const { data: job } = await axios.get(`${API_URL}/jobs/${jobId}`);
        if (cancelled) return;
        setJobs((prev) =>
          prev.some((j) => String(j._id) === String(job._id)) ? prev : [job, ...prev]
        );
        const fromJob = takeoffCustomerFieldsFromJob(job);
        const sheet = job.takeoff?.sheetData;
        const normalized = sheet && typeof sheet === 'object' ? normalizeSavedForm(sheet) : null;
        if (normalized) {
          setForm({
            ...normalized,
            customerId: fromJob.customerId,
            soldTo: fromJob.soldTo,
            phoneNumber: normalized.phoneNumber?.trim()
              ? formatPhoneForDisplay(normalized.phoneNumber.trim())
              : fromJob.phoneNumber,
            nameAddress: normalized.nameAddress?.trim() ? normalized.nameAddress : fromJob.nameAddress,
          });
          return;
        }
        if (fromJob.customerId) {
          setForm({
            ...defaultTakeoffForm(),
            ...fromJob,
            date: new Date().toLocaleDateString('en-US'),
          });
        } else {
          setForm(defaultTakeoffForm());
        }
      } catch (error) {
        console.error('Error loading takeoff job:', error);
        toast.error(error.response?.data?.error || 'Could not load job');
      } finally {
        if (!cancelled) setLoadingJobSheet(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  useEffect(() => {
    if (jobId) return;
    setForm(defaultTakeoffForm());
  }, [jobId]);

  useEffect(() => {
    if (!pendingFocus) return;
    const { row, col } = pendingFocus;
    const input = cellRefs.current?.[row]?.[col];
    if (input && typeof input.focus === 'function') {
      input.focus();
      if (typeof input.select === 'function') input.select();
    }
    setPendingFocus(null);
  }, [pendingFocus, form.rows.length]);

  const setField = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const normalizeNameAddressWrapping = () => {
    setForm((prev) => ({
      ...prev,
      nameAddress: enforceStreetCityLines(wrapMultilineText(prev.nameAddress, 30)),
    }));
  };

  const setRowField = (index, field, value) => {
    setForm((prev) => ({
      ...prev,
      rows: prev.rows.map((row, i) => (i === index ? { ...row, [field]: value } : row)),
    }));
  };

  const addRow = () => {
    setForm((prev) => ({ ...prev, rows: [...prev.rows, newRow()] }));
  };

  const addDoubleRow = () => {
    setForm((prev) => ({ ...prev, rows: applyAddDoubleRow(prev.rows) }));
  };

  const toggleDoubleRow = (index) => {
    setForm((prev) => ({ ...prev, rows: toggleTakeoffRowDouble(prev.rows, index) }));
  };

  const focusCell = (row, col) => {
    const input = cellRefs.current?.[row]?.[col];
    if (input && typeof input.focus === 'function') {
      input.focus();
      if (typeof input.select === 'function') input.select();
      return true;
    }
    return false;
  };

  const handleGridKeyDown = (event, rowIndex, colIndex, opts = {}) => {
    const { enterNavigates = true } = opts;
    const totalCols = 4;
    const lastRow = form.rows.length - 1;

    if (event.key === 'Enter') {
      if (!enterNavigates) return;
      event.preventDefault();
      const nextRow = rowIndex + 1;
      if (nextRow > lastRow) {
        addRow();
        setPendingFocus({ row: form.rows.length, col: 0 });
        return;
      }
      focusCell(nextRow, 0);
      return;
    }

    if (event.key === 'Tab') {
      event.preventDefault();
      const direction = event.shiftKey ? -1 : 1;
      let nextRow = rowIndex;
      let nextCol = colIndex + direction;

      if (nextCol >= totalCols) {
        nextCol = 0;
        nextRow += 1;
      } else if (nextCol < 0) {
        nextCol = totalCols - 1;
        nextRow -= 1;
      }

      if (nextRow < 0) {
        focusCell(0, 0);
        return;
      }
      if (nextRow > lastRow) {
        addRow();
        setPendingFocus({ row: form.rows.length, col: 0 });
        return;
      }
      focusCell(nextRow, nextCol);
    }
  };

  const removeLastRow = () => {
    setForm((prev) => {
      if (prev.rows.length <= 1) return prev;
      return { ...prev, rows: prev.rows.slice(0, -1) };
    });
  };

  const normalizeFractionField = (index, field) => {
    setForm((prev) => ({
      ...prev,
      rows: prev.rows.map((row, i) =>
        i === index ? { ...row, [field]: formatVerticalFractions(row[field]) } : row
      ),
    }));
  };

  const lineAutocompleteKeyDown = (event, rowIndex, colIndex, field, optionList) => {
    if (event.key === 'Tab' && !event.shiftKey) {
      const value = form.rows[rowIndex]?.[field] ?? '';
      const cycleKey = `${rowIndex}-${colIndex}-${field}|${value}`;
      const completed = terminalTabComplete(optionList, value, cycleKey, tabCompleteCycleRef);
      if (completed != null) {
        event.preventDefault();
        event.stopPropagation();
        setRowField(rowIndex, field, completed);
        return;
      }
    }
    handleGridKeyDown(event, rowIndex, colIndex, { enterNavigates: false });
  };

  const downloadPdf = async () => {
    if (!sheetRef.current) {
      toast.error('Sheet not ready for export');
      return;
    }
    try {
      normalizeNameAddressWrapping();
      setIsExportMode(true);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const canvas = await html2canvas(sheetRef.current, {
        backgroundColor: '#ffffff',
        scale: 2,
        useCORS: true,
      });
      const imageData = canvas.toDataURL('image/png');
      const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
      doc.addImage(imageData, 'PNG', 0, 0, 612, 792, undefined, 'FAST');
      doc.save(`Takeoff-Sheet-${form.soldTo || 'untitled'}.pdf`);
      toast.success('Take Off Sheet PDF downloaded');
    } catch (error) {
      console.error('Error generating takeoff PDF:', error);
      toast.error('Failed to generate PDF');
    } finally {
      setIsExportMode(false);
    }
  };

  const saveTakeoff = async () => {
    if (!jobId) {
      toast.error('Select a job to save this takeoff (use the job list above or open from a job card)');
      return;
    }
    if (!form.customerId) {
      toast.error('This job has no customer on file, or select a job first');
      return;
    }
    try {
      setSavingTakeoff(true);
      const { data: job } = await axios.get(`${API_URL}/jobs/${jobId}`);
      const existing = job.takeoff && typeof job.takeoff === 'object' ? job.takeoff : {};
      await axios.patch(`${API_URL}/jobs/${jobId}`, {
        takeoff: {
          ...existing,
          sheetData: form,
          sheetUpdatedAt: new Date().toISOString(),
        },
      });
      toast.success('Take off sheet saved to job');
    } catch (error) {
      console.error('Error saving takeoff sheet:', error);
      toast.error(error.response?.data?.error || 'Could not save take off sheet');
    } finally {
      setSavingTakeoff(false);
    }
  };

  const printPdf = async () => {
    if (!sheetRef.current) {
      toast.error('Sheet not ready for print');
      return;
    }
    try {
      normalizeNameAddressWrapping();
      setIsExportMode(true);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const canvas = await html2canvas(sheetRef.current, {
        backgroundColor: '#ffffff',
        scale: 2,
        useCORS: true,
      });
      const imageData = canvas.toDataURL('image/png');
      const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
      doc.addImage(imageData, 'PNG', 0, 0, 612, 792, undefined, 'FAST');
      const blobUrl = doc.output('bloburl');
      const win = window.open(blobUrl, '_blank');
      if (win) {
        const trigger = () => {
          try {
            win.focus();
            win.print();
          } catch (e) {
            console.warn('Print trigger failed:', e);
          }
        };
        win.onload = trigger;
        setTimeout(trigger, 700);
      }
      toast.success('Print view opened');
    } catch (error) {
      console.error('Error creating printable PDF:', error);
      toast.error('Failed to open print view');
    } finally {
      setIsExportMode(false);
    }
  };

  return (
    <Container maxWidth="xl" sx={{ py: 2 }}>
      <Box sx={{ mb: 2 }}>
        <Typography variant="h1" sx={{ mb: 1 }}>
          Take Off Sheet
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Select a job at the top—sold-to, phone, and name & address come from that job’s customer (read-only). You can edit date, notes, bay, and the line items.
        </Typography>
      </Box>

      <Card>
        <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
          <Autocomplete
            sx={{ mb: 2 }}
            options={jobs}
            loading={loadingJobs}
            value={jobId ? jobs.find((j) => String(j._id) === String(jobId)) || null : null}
            onChange={(_, j) => {
              if (j) setSearchParams({ jobId: String(j._id) });
              else setSearchParams({});
            }}
            isOptionEqualToValue={(a, b) => String(a?._id) === String(b?._id)}
            getOptionLabel={(j) => {
              const custName =
                j?.customerId && typeof j.customerId === 'object' ? j.customerId.name : '';
              return `${j?.title || 'Job'}${custName ? ` — ${custName}` : ''}`;
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Job"
                placeholder="Search jobs to link…"
                helperText="Required to save. You can also open this page from a job card."
              />
            )}
          />

          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
            <Button
              size="small"
              startIcon={<SettingsIcon />}
              onClick={() => setTakeoffAutocompleteOpen(true)}
            >
              Autocomplete lists
            </Button>
          </Box>

          <Box sx={{ overflowX: 'auto' }}>
            <Box
              ref={sheetRef}
              sx={{
                width: 816,
                minHeight: 1056,
                mx: 'auto',
                bgcolor: '#fff',
                color: '#000',
                p: 5,
                border: '1px solid #d9d9d9',
                fontFamily: 'Times New Roman, Georgia, serif',
                // Always print-like black type; dark theme would otherwise make inputs white.
                '& .MuiTypography-root': { color: '#000' },
                '& .MuiInputBase-root': { color: '#000' },
                '& .MuiInputBase-input': {
                  color: '#000',
                  WebkitTextFillColor: '#000',
                },
                '& .MuiInputBase-input::placeholder': {
                  color: 'rgba(0,0,0,0.42)',
                  opacity: 1,
                },
              }}
            >
              <Box sx={{ position: 'relative', mb: 2 }}>
                <Typography
                  sx={{
                    textAlign: 'center',
                    fontSize: 44,
                    fontWeight: 400,
                    lineHeight: 1,
                    mt: 2,
                    mb: 2,
                  }}
                >
                  Take Off Sheet
                </Typography>
                <BrandLogo
                  themeMode="light"
                  alt="Logo"
                  sx={{
                    position: 'absolute',
                    top: 0,
                    right: 6,
                    width: 54,
                    height: 54,
                    objectFit: 'contain',
                  }}
                />
              </Box>

              <Box sx={{ border: '1px solid #000' }}>
                {/* Row: SOLD TO / PHONE NUMBER / DATE */}
                <Box sx={{ display: 'grid', gridTemplateColumns: '37% 25% 38%' }}>
                  <Box sx={{ borderRight: '1px solid #000' }}>
                    <Box sx={{ bgcolor: '#c2dff6', borderBottom: '1px solid #000', textAlign: 'center', py: 0.4, fontSize: 19 }}>
                      SOLD TO
                    </Box>
                    {loadingJobSheet && jobId ? (
                      <Box sx={{ px: 1, py: 0.7, fontSize: 16, color: 'rgba(0,0,0,0.45)' }}>Loading…</Box>
                    ) : (
                      <TextField
                        variant="standard"
                        value={form.soldTo}
                        placeholder={jobId ? '—' : 'Select a job above'}
                        InputProps={{
                          readOnly: true,
                          disableUnderline: true,
                          sx: { fontSize: 16, px: 1, py: 0.7 },
                        }}
                        fullWidth
                      />
                    )}
                  </Box>
                  <Box sx={{ borderRight: '1px solid #000' }}>
                    <Box sx={{ bgcolor: '#c2dff6', borderBottom: '1px solid #000', textAlign: 'center', py: 0.4, fontSize: 19 }}>
                      PHONE NUMBER
                    </Box>
                    <TextField
                      variant="standard"
                      value={form.phoneNumber}
                      InputProps={{
                        readOnly: true,
                        disableUnderline: true,
                        sx: { fontSize: 16, px: 1, py: 0.7 },
                      }}
                      fullWidth
                    />
                  </Box>
                  <Box>
                    <Box sx={{ bgcolor: '#c2dff6', borderBottom: '1px solid #000', textAlign: 'center', py: 0.4, fontSize: 19 }}>
                      DATE
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 0.6 }}>
                      <TextField
                        variant="standard"
                        value={form.date}
                        onChange={(e) => setField('date', e.target.value)}
                        placeholder="MM/DD/YYYY"
                        InputProps={{
                          disableUnderline: true,
                          sx: { fontSize: 16 },
                          inputProps: { inputMode: 'numeric' },
                        }}
                      />
                    </Box>
                  </Box>
                </Box>

                {/* Row: NAME & ADDRESS / NOTES / Bay */}
                <Box sx={{ display: 'grid', gridTemplateColumns: '37% 51% 12%', borderTop: '1px solid #000' }}>
                  <Box sx={{ borderRight: '1px solid #000' }}>
                    <Box sx={{ bgcolor: '#c2dff6', borderBottom: '1px solid #000', textAlign: 'center', py: 0.4, fontSize: 19 }}>
                      NAME & ADDRESS
                    </Box>
                    {isExportMode ? (
                      <Box
                        sx={{
                          px: 1,
                          py: 0.7,
                          minHeight: 104,
                          fontSize: 15,
                          whiteSpace: 'pre-line',
                          lineHeight: 1.35,
                          wordBreak: 'break-word',
                        }}
                      >
                        {form.nameAddress}
                      </Box>
                    ) : (
                      <TextField
                        variant="standard"
                        value={form.nameAddress}
                        multiline
                        minRows={4}
                        InputProps={{
                          readOnly: true,
                          disableUnderline: true,
                          sx: { fontSize: 15, px: 1, py: 0.7 },
                        }}
                        inputProps={{
                          style: {
                            whiteSpace: 'pre-wrap',
                            overflowWrap: 'break-word',
                          },
                        }}
                        fullWidth
                      />
                    )}
                  </Box>
                  <Box sx={{ borderRight: '1px solid #000' }}>
                    <Box sx={{ bgcolor: '#c2dff6', borderBottom: '1px solid #000', textAlign: 'center', py: 0.4, fontSize: 19 }}>
                      NOTES
                    </Box>
                    <TextField
                      variant="standard"
                      value={form.notes}
                      onChange={(e) => setField('notes', e.target.value)}
                      multiline
                      minRows={4}
                      InputProps={{ disableUnderline: true, sx: { fontSize: 15, px: 1, py: 0.7 } }}
                      fullWidth
                    />
                  </Box>
                  <Box>
                    <Box sx={{ bgcolor: '#c2dff6', borderBottom: '1px solid #000', textAlign: 'center', py: 0.4, fontSize: 19 }}>
                      Bay
                    </Box>
                    <TextField
                      variant="standard"
                      value={form.bay}
                      onChange={(e) => setField('bay', e.target.value)}
                      InputProps={{ disableUnderline: true, sx: { fontSize: 15, px: 1, py: 0.7 } }}
                      fullWidth
                    />
                  </Box>
                </Box>

                {/* Header row: ITEM / QTY / MATERIAL / DESCRIPTION */}
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: '37% 12% 12% 39%',
                    borderTop: '1px solid #000',
                    bgcolor: '#c2dff6',
                  }}
                >
                  <Box
                    sx={{
                      borderRight: '1px solid #000',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      minHeight: 48,
                      fontSize: 24,
                    }}
                  >
                    ITEM
                  </Box>
                  <Box
                    sx={{
                      borderRight: '1px solid #000',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      minHeight: 48,
                      fontSize: 24,
                    }}
                  >
                    QTY
                  </Box>
                  <Box
                    sx={{
                      borderRight: '1px solid #000',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      minHeight: 48,
                      fontSize: 15,
                      lineHeight: 1.2,
                    }}
                  >
                    MATERIALS
                  </Box>
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      minHeight: 48,
                      fontSize: 24,
                    }}
                  >
                    DESCRIPTION
                  </Box>
                </Box>

                {/* Body rows */}
                {form.rows.map((row, index) => {
                  const tall = row.doubleHeight === true;
                  const rowMinH = tall ? 104 : 52;
                  const cellPy = tall ? 1.75 : 0.95;

                  const rowGridSx = {
                    display: 'grid',
                    gridTemplateColumns: '37% 12% 12% 39%',
                    borderTop: '1px solid #000',
                    minHeight: rowMinH,
                    alignItems: 'stretch',
                  };

                  const cellFieldSx = {
                    disableUnderline: true,
                    sx: {
                      fontSize: 14,
                      px: 1,
                      py: cellPy,
                      lineHeight: 1.35,
                    },
                  };

                  const cellInputProps = {
                    style: {
                      lineHeight: 1.35,
                      paddingBottom: tall ? 8 : 4,
                    },
                  };

                  return (
                    <Box key={`takeoff-row-${index}`} sx={rowGridSx}>
                      <Box sx={{ borderRight: '1px solid #000', display: 'flex', alignItems: tall ? 'center' : 'stretch' }}>
                        {!isExportMode ? (
                          <Button
                            size="small"
                            onClick={() => toggleDoubleRow(index)}
                            aria-label={tall ? 'Make row single height' : 'Make row double height'}
                            sx={{
                              minWidth: 34,
                              px: 0.5,
                              alignSelf: 'stretch',
                              borderRadius: 0,
                              borderRight: '1px solid #000',
                              fontSize: 11,
                              fontWeight: 800,
                              lineHeight: 1,
                              color: '#111',
                            }}
                          >
                            {tall ? '1×' : '2×'}
                          </Button>
                        ) : null}
                        <Autocomplete
                          freeSolo
                          options={takeoffAutocompleteLists.items}
                          inputValue={row.item}
                          onInputChange={(e, newValue, reason) => {
                            if (reason === 'reset') return;
                            setRowField(index, 'item', newValue ?? '');
                          }}
                          blurOnSelect
                          sx={{ width: '100%' }}
                          renderInput={(params) => (
                            <TextField
                              {...params}
                              variant="standard"
                              onBlur={(e) => {
                                params.onBlur?.(e);
                                normalizeFractionField(index, 'item');
                              }}
                              onKeyDownCapture={(e) =>
                                lineAutocompleteKeyDown(e, index, 0, 'item', takeoffAutocompleteLists.items)
                              }
                              inputRef={mergeRefs(params.inputRef, (el) => {
                                if (!cellRefs.current[index]) cellRefs.current[index] = [];
                                cellRefs.current[index][0] = el;
                              })}
                              InputProps={{
                                ...params.InputProps,
                                disableUnderline: true,
                                sx: {
                                  fontSize: 14,
                                  px: 1,
                                  py: cellPy,
                                  lineHeight: 1.35,
                                },
                              }}
                              inputProps={{
                                ...params.inputProps,
                                style: {
                                  lineHeight: 1.35,
                                  paddingBottom: tall ? 8 : 4,
                                },
                              }}
                              fullWidth
                            />
                          )}
                        />
                      </Box>
                      <Box sx={{ borderRight: '1px solid #000', display: 'flex', alignItems: tall ? 'center' : 'stretch' }}>
                        <TextField
                          variant="standard"
                          value={row.qty}
                          onChange={(e) => setRowField(index, 'qty', e.target.value)}
                          onBlur={() => normalizeFractionField(index, 'qty')}
                          onKeyDown={(e) => handleGridKeyDown(e, index, 1)}
                          inputRef={(el) => {
                            if (!cellRefs.current[index]) cellRefs.current[index] = [];
                            cellRefs.current[index][1] = el;
                          }}
                          InputProps={cellFieldSx}
                          inputProps={cellInputProps}
                          fullWidth
                        />
                      </Box>
                      <Box sx={{ borderRight: '1px solid #000', display: 'flex', alignItems: tall ? 'center' : 'stretch' }}>
                        <Autocomplete
                          freeSolo
                          options={takeoffAutocompleteLists.materials}
                          inputValue={row.material}
                          onInputChange={(e, newValue, reason) => {
                            if (reason === 'reset') return;
                            setRowField(index, 'material', newValue ?? '');
                          }}
                          blurOnSelect
                          sx={{ width: '100%' }}
                          renderInput={(params) => (
                            <TextField
                              {...params}
                              variant="standard"
                              onBlur={(e) => {
                                params.onBlur?.(e);
                                normalizeFractionField(index, 'material');
                              }}
                              onKeyDownCapture={(e) =>
                                lineAutocompleteKeyDown(e, index, 2, 'material', takeoffAutocompleteLists.materials)
                              }
                              inputRef={mergeRefs(params.inputRef, (el) => {
                                if (!cellRefs.current[index]) cellRefs.current[index] = [];
                                cellRefs.current[index][2] = el;
                              })}
                              InputProps={{
                                ...params.InputProps,
                                disableUnderline: true,
                                sx: {
                                  fontSize: 14,
                                  px: 1,
                                  py: cellPy,
                                  lineHeight: 1.35,
                                  textAlign: 'center',
                                },
                              }}
                              inputProps={{
                                ...params.inputProps,
                                style: {
                                  lineHeight: 1.35,
                                  paddingBottom: tall ? 8 : 4,
                                  textAlign: 'center',
                                },
                              }}
                              fullWidth
                            />
                          )}
                        />
                      </Box>
                      <Box sx={{ display: 'flex', alignItems: 'flex-start' }}>
                        <Autocomplete
                          freeSolo
                          options={takeoffAutocompleteLists.descriptions}
                          inputValue={row.description}
                          onInputChange={(e, newValue, reason) => {
                            if (reason === 'reset') return;
                            setRowField(index, 'description', newValue ?? '');
                          }}
                          blurOnSelect
                          sx={{ width: '100%' }}
                          renderInput={(params) => (
                            <TextField
                              {...params}
                              variant="standard"
                              onBlur={(e) => {
                                params.onBlur?.(e);
                                normalizeFractionField(index, 'description');
                              }}
                              onKeyDownCapture={(e) =>
                                lineAutocompleteKeyDown(
                                  e,
                                  index,
                                  3,
                                  'description',
                                  takeoffAutocompleteLists.descriptions
                                )
                              }
                              inputRef={mergeRefs(params.inputRef, (el) => {
                                if (!cellRefs.current[index]) cellRefs.current[index] = [];
                                cellRefs.current[index][3] = el;
                              })}
                              InputProps={{
                                ...params.InputProps,
                                disableUnderline: true,
                                sx: {
                                  fontSize: 14,
                                  px: 1,
                                  py: cellPy,
                                  lineHeight: 1.35,
                                },
                              }}
                              inputProps={{
                                ...params.inputProps,
                                style: {
                                  lineHeight: 1.35,
                                  paddingBottom: tall ? 8 : 4,
                                },
                              }}
                              fullWidth
                            />
                          )}
                        />
                      </Box>
                    </Box>
                  );
                })}
              </Box>
            </Box>
          </Box>

          <Box
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              mt: 2,
              flexWrap: 'wrap',
              gap: 1,
            }}
          >
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Button startIcon={<AddIcon />} onClick={addRow}>
                Add row
              </Button>
              <Button startIcon={<AddIcon />} onClick={addDoubleRow}>
                Add double row
              </Button>
              <Button variant="outlined" color="error" onClick={removeLastRow} disabled={form.rows.length <= 1}>
                Delete row
              </Button>
            </Box>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <Button variant="outlined" startIcon={<PictureAsPdfIcon />} onClick={downloadPdf}>
                Download PDF
              </Button>
              <Button variant="outlined" onClick={printPdf}>
                Print PDF
              </Button>
              <Button
                variant="contained"
                startIcon={<SaveIcon />}
                onClick={saveTakeoff}
                disabled={savingTakeoff || loadingJobSheet || !jobId}
              >
                {savingTakeoff ? 'Saving…' : 'Save takeoff'}
              </Button>
            </Box>
          </Box>

          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
            Use 2× on any row, including the first, to make it double height. Add double row converts the first empty single row. Export uses the on-screen layout.
          </Typography>

          <TakeoffAutocompleteSettingsDialog
            open={takeoffAutocompleteOpen}
            onClose={() => setTakeoffAutocompleteOpen(false)}
            lists={takeoffAutocompleteLists}
            onListsSaved={setTakeoffAutocompleteLists}
          />
        </CardContent>
      </Card>
    </Container>
  );
}

export default TakeoffSheetPage;
