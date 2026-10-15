import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  TextField,
  Typography,
} from '@mui/material';
import { Close as CloseIcon } from '@mui/icons-material';
import axios from 'axios';
import ContractCoverSheets, { writeContractCoverPrintData } from './ContractCoverSheets';
import {
  formatMoney,
  getContractBase,
  getJobTotalWithChangeOrders,
  getScheduleItemTotal,
  inferDueTypeFromLabel,
  matchesStandard4060Template,
  resolvePaymentSchedule,
  sumChangeOrdersForFinal,
} from '../../utils/paymentSchedule';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

function customerDisplayName(job) {
  const cust = job?.customerId && typeof job.customerId === 'object' ? job.customerId : null;
  return String(cust?.name || '').trim();
}

function customerAddressParts(job) {
  const ja = job?.jobAddress;
  if (ja && (ja.street || ja.city || ja.state || ja.zip)) {
    return {
      street: String(ja.street || '').trim(),
      city: String(ja.city || '').trim(),
      state: String(ja.state || '').trim(),
      zip: String(ja.zip || '').trim(),
    };
  }
  const c = job?.customerId?.address || {};
  return {
    street: String(c.street || '').trim(),
    city: String(c.city || '').trim(),
    state: String(c.state || '').trim(),
    zip: String(c.zip || '').trim(),
  };
}

function cityLine(city, state) {
  const place = String(city || '').trim();
  if (!place) return '';
  const st = String(state || 'CA').trim();
  const stateLabel = st.toUpperCase() === 'CA' ? 'CA' : st;
  return `City of ${place}, ${stateLabel}`;
}

function formatContractDate(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso || '';
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function under1000(n) {
  const below20 = [
    '',
    'One',
    'Two',
    'Three',
    'Four',
    'Five',
    'Six',
    'Seven',
    'Eight',
    'Nine',
    'Ten',
    'Eleven',
    'Twelve',
    'Thirteen',
    'Fourteen',
    'Fifteen',
    'Sixteen',
    'Seventeen',
    'Eighteen',
    'Nineteen',
  ];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const parts = [];
  if (n >= 100) {
    parts.push(below20[Math.floor(n / 100)], 'Hundred');
    n %= 100;
  }
  if (n >= 20) {
    parts.push(tens[Math.floor(n / 10)]);
    if (n % 10) parts.push(below20[n % 10]);
  } else if (n > 0) {
    parts.push(below20[n]);
  }
  return parts.join(' ');
}

function numberToWords(n) {
  const num = Math.floor(Math.abs(Number(n) || 0));
  if (num === 0) return 'Zero';
  const billions = Math.floor(num / 1_000_000_000);
  const millions = Math.floor((num % 1_000_000_000) / 1_000_000);
  const thousands = Math.floor((num % 1_000_000) / 1000);
  const rest = num % 1000;
  const out = [];
  if (billions) out.push(under1000(billions), 'Billion');
  if (millions) out.push(under1000(millions), 'Million');
  if (thousands) out.push(under1000(thousands), 'Thousand');
  if (rest) out.push(under1000(rest));
  return out.join(' ');
}

function amountToContractWords(value) {
  const cents = Math.round(Math.abs(Number(value) || 0) * 100);
  const dollars = Math.floor(cents / 100);
  const rem = cents % 100;
  return `${numberToWords(dollars)} Dollars and ${String(rem).padStart(2, '0')}/100 $`;
}

function coverScheduleRows(job) {
  const contractBase = getContractBase(job);
  const coAddedToFinal = sumChangeOrdersForFinal(job);
  const resolved = resolvePaymentSchedule(job);
  return (resolved.items || []).map((item, idx) => ({
    ...item,
    key: `sched-${idx}`,
    label: item.label || `Payment ${idx + 1}`,
    amount: getScheduleItemTotal(item, contractBase, coAddedToFinal),
  }));
}

function isStandard4060(rows) {
  return (
    matchesStandard4060Template(rows) ||
    (rows.length === 2 && Number(rows[0]?.percentage) === 40 && Number(rows[1]?.percentage) === 60)
  );
}

function buildPaymentDisplay(rows, cityStateLine, trackNo) {
  const track = String(trackNo || '').trim();
  const closing = [
    'The total contract amount must be paid in full upon completion of the contracted work.',
    'All agreements must be made in writing.',
    track
      ? `The above work is to be performed in Track No. ${track}.`
      : isStandard4060(rows)
        ? 'The above work is to be performed in Track No.'
        : '',
    cityStateLine || '',
  ].filter(Boolean);

  if (isStandard4060(rows)) {
    return {
      lines: [
        '40% — Material and labor deposit.',
        '60% — Upon completion of the contracted project.',
      ],
      notes: closing,
    };
  }

  return {
    lines: rows.map((row) => {
      const pct = Number.isFinite(Number(row.percentage)) ? `${row.percentage}%` : formatMoney(row.amount);
      const due = row.dueType || inferDueTypeFromLabel(row.label);
      if (due === 'deposit') return `${pct} — Material and labor deposit.`;
      if (due === 'final') return `${pct} — Final payment upon completion of the contracted project.`;
      const note = String(row.dueNote || row.label || '').trim().replace(/\.+$/, '');
      return `${pct} — ${note}.`;
    }),
    notes: closing.filter((line, idx) => idx === 0 || line !== 'The above work is to be performed in Track No.'),
  };
}

function buildInspectionParagraph(estimateNumber, total) {
  const num = String(estimateNumber || '').trim() || '______';
  const words = amountToContractWords(total);
  return `Estimate No. ${num} is based on a visual inspection only. It does not include any unseen issues that may arise during demolition and require a change order and or additional fees and costs. All of the above work is to be completed in a substantial and workmanlike manner according to standard practices for the sum of ${words}.`;
}

export default function JobCoverPagesDialog({ open, onClose, job }) {
  const estimateInputRef = useRef(null);
  const [step, setStep] = useState('details');

  const [docDate, setDocDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [customerName, setCustomerName] = useState('');
  const [street, setStreet] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('CA');
  const [zip, setZip] = useState('');
  const [estimateNumber, setEstimateNumber] = useState('');
  const [trackNo, setTrackNo] = useState('');
  const [formError, setFormError] = useState('');

  const total = useMemo(() => getJobTotalWithChangeOrders(job), [job]);
  const rows = useMemo(() => coverScheduleRows(job), [job]);
  const paymentDisplay = useMemo(
    () => buildPaymentDisplay(rows, cityLine(city, state), trackNo),
    [rows, city, state, trackNo],
  );
  const inspectionParagraph = useMemo(
    () => buildInspectionParagraph(estimateNumber, total),
    [estimateNumber, total],
  );
  const cityStateDisplay = [city, state, zip].filter(Boolean).join(', ');
  const showTrackField = isStandard4060(rows);
  const coverData = useMemo(
    () => ({
      customerName: customerName.trim(),
      street: street.trim(),
      cityStateDisplay,
      contractDate: formatContractDate(docDate),
      estimateNumber: estimateNumber.trim(),
      totalLabel: formatMoney(total),
      inspectionParagraph,
      paymentLines: paymentDisplay.lines,
      paymentNotes: paymentDisplay.notes,
    }),
    [
      customerName,
      street,
      cityStateDisplay,
      docDate,
      estimateNumber,
      total,
      inspectionParagraph,
      paymentDisplay.lines,
      paymentDisplay.notes,
    ],
  );

  useEffect(() => {
    if (!open) return;
    const addr = customerAddressParts(job);
    setStep('details');
    setFormError('');
    setDocDate(new Date().toISOString().slice(0, 10));
    setCustomerName(customerDisplayName(job));
    setStreet(addr.street);
    setCity(addr.city);
    setState(addr.state || 'CA');
    setZip(addr.zip);
    setEstimateNumber('');
    setTrackNo('');

    let cancelled = false;
    (async () => {
      if (!job?._id) return;
      try {
        const { data } = await axios.get(`${API_URL}/estimates`, { params: { jobId: job._id } });
        const list = Array.isArray(data) ? data : data?.estimates || [];
        if (!cancelled && list[0]?.estimateNumber) {
          setEstimateNumber(String(list[0].estimateNumber));
        }
      } catch {
        /* User enters the QuickBooks estimate number. */
      }
    })();

    const t = window.setTimeout(() => estimateInputRef.current?.focus(), 120);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [open, job?._id]);

  const handleContinue = () => {
    if (!String(estimateNumber || '').trim()) {
      setFormError('Enter the estimate number from QuickBooks.');
      estimateInputRef.current?.focus();
      return;
    }
    if (!String(customerName || '').trim()) {
      setFormError('Enter the customer name.');
      return;
    }
    setFormError('');
    setStep('preview');
  };

  const handleOpen = () => {
    writeContractCoverPrintData(coverData);
    window.open('/print/contract-cover', '_blank', 'noopener,noreferrer');
    onClose();
  };

  const fieldSx = { '& .MuiOutlinedInput-root': { bgcolor: 'background.paper' } };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={false}
      fullWidth
      scroll="paper"
      PaperProps={{ sx: { maxWidth: step === 'details' ? 560 : 920, width: '100%' } }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        {step === 'details' ? 'Contract details' : 'Cover page'}
        <IconButton size="small" onClick={onClose} aria-label="Close">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {step === 'details' ? (
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
              Enter the QuickBooks estimate number and confirm the customer details. Payment terms come from
              this job&apos;s total and schedule.
            </Typography>
            {total <= 0 ? (
              <Alert severity="warning" sx={{ mb: 2 }}>
                This job has no contract amount yet. Add a job total so the contract total fills in.
              </Alert>
            ) : null}
            {formError ? (
              <Alert severity="error" sx={{ mb: 2 }}>
                {formError}
              </Alert>
            ) : null}

            <Box sx={{ display: 'grid', gap: 2 }}>
              <TextField
                inputRef={estimateInputRef}
                label="Estimate number"
                value={estimateNumber}
                onChange={(e) => setEstimateNumber(e.target.value)}
                required
                autoComplete="off"
                helperText="From QuickBooks — prints on the contract as Estimate #"
                sx={fieldSx}
              />
              <TextField
                label="Contract date"
                type="date"
                value={docDate}
                onChange={(e) => setDocDate(e.target.value)}
                InputLabelProps={{ shrink: true }}
                sx={fieldSx}
              />
              <TextField
                label="Customer name"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                required
                sx={fieldSx}
              />
              <TextField
                label="Street"
                value={street}
                onChange={(e) => setStreet(e.target.value)}
                sx={fieldSx}
              />
              <Box sx={{ display: 'grid', gridTemplateColumns: '1.4fr 0.7fr 0.8fr', gap: 1.5 }}>
                <TextField
                  label="City"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  sx={fieldSx}
                />
                <TextField
                  label="State"
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  sx={fieldSx}
                />
                <TextField
                  label="ZIP"
                  value={zip}
                  onChange={(e) => setZip(e.target.value)}
                  sx={fieldSx}
                />
              </Box>
              {showTrackField ? (
                <TextField
                  label="Track number (optional)"
                  value={trackNo}
                  onChange={(e) => setTrackNo(e.target.value)}
                  helperText="Used on 40/60 contracts in the “Track No.” line"
                  sx={fieldSx}
                />
              ) : null}
            </Box>

            <Box sx={{ mt: 2.5, p: 1.75, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
                Prints on the contract
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                Total {formatMoney(total)}
              </Typography>
              {rows.map((row) => (
                <Typography key={row.key} variant="body2" color="text.secondary">
                  {Number.isFinite(Number(row.percentage))
                    ? `${row.label} (${row.percentage}%) · ${formatMoney(row.amount)}`
                    : `${row.label} · ${formatMoney(row.amount)}`}
                </Typography>
              ))}
            </Box>
          </Box>
        ) : (
          <Box sx={{ py: 1 }}>
            <ContractCoverSheets data={coverData} />
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        {step === 'details' ? (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="contained" onClick={handleContinue}>
              Continue
            </Button>
          </>
        ) : (
          <>
            <Button onClick={() => setStep('details')}>Back</Button>
            <Button variant="contained" onClick={handleOpen}>
              Open
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
