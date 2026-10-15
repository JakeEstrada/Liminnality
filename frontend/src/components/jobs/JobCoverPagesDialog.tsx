import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
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
import { jsPDF } from 'jspdf';
import toast from 'react-hot-toast';
import { captureHtmlToPng } from '../../utils/captureHtmlToPng';
import {
  formatMoney,
  getContractBase,
  getJobTotalWithChangeOrders,
  getScheduleItemTotal,
  inferDueTypeFromLabel,
  matchesStandard4060Template,
  resolvePaymentSchedule,
  roundMoney,
  sumChangeOrdersForFinal,
} from '../../utils/paymentSchedule';
import { invalidateJobFilesCache } from '../../utils/fileListCache';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

const COVER_LOGO = '/scww.png';
const ZELLE_QR = '/contract-zelle-qr.png?v=3';

const OWNER_NAME = 'Edward T. Estrada';
const OWNER_PHONE = '949-498-4397';
const LICENSE_NUMBER = '# C-6 753246';
const CSLB_ADDRESS = '9835 Goethe Road';
const STAINER_REFERRALS = '*Jesus (949)616-2038 | *Carlos Jimenez (714)678-7072';
const SHOP_ADDRESS_1 = '1030 Calle Sombra, F';
const SHOP_ADDRESS_2 = 'San Clemente, CA 92673';

const PAGE_SX = {
  width: 816,
  height: 1056,
  mx: 'auto',
  bgcolor: '#fff',
  color: '#000',
  boxSizing: 'border-box',
  fontFamily: 'Arial, Helvetica, sans-serif',
  '& .MuiTypography-root': { color: '#000' },
};

const NOTICE_TEXT =
  'Under the Mechanics’ Lien law, any contractor, subcontractor, laborer, material man or other person who helps to improve your property and is not paid for his labor, services or materials has a right to enforce his claim against your property. Under the law you may protect yourself against such claims by filing, before commencing such work of improvement, an original contract for the work of improvement or a modification thereof, in the office of the county recorder of the county where the property is situated and requiring that a contractor’s payment bond be recorded in such office. Said bond shall be in an amount not less than fifty percent (50%) of the contract price and shall, in addition to any conditions for the performance of the contract, be conditioned for the payment in full of the claims of all persons furnishing labor, services, equipment or materials for the work described in said contract. Owner has a 3 day right of rescission to cancel contract after date of signing.';

function jobCardNumber(job) {
  return job?._id ? String(job._id).slice(-6).toUpperCase() : '';
}

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

function ContractSection({ number, title, children }) {
  return (
    <Box sx={{ mt: 2.15 }}>
      <Typography
        sx={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          mb: 0.55,
        }}
      >
        {number}. {title}
      </Typography>
      {children}
    </Box>
  );
}

function buildInspectionParagraph(estimateNumber, total) {
  const num = String(estimateNumber || '').trim() || '______';
  const words = amountToContractWords(total);
  return `Estimate No. ${num} is based on a visual inspection only. It does not include any unseen issues that may arise during demolition and require a change order and or additional fees and costs. All of the above work is to be completed in a substantial and workmanlike manner according to standard practices for the sum of ${words}.`;
}

export default function JobCoverPagesDialog({ open, onClose, job, onSaved }) {
  const page1Ref = useRef(null);
  const page2Ref = useRef(null);
  const estimateInputRef = useRef(null);
  const [step, setStep] = useState('details');
  const [exporting, setExporting] = useState(false);

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

  const capturePage = async (el) => {
    if (!el) throw new Error('Cover page not ready');
    return captureHtmlToPng(el, { width: PAGE_SX.width, height: PAGE_SX.height, scale: 2 });
  };

  const renderPdf = async () => {
    flushSync(() => {});
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (!page1Ref.current || !page2Ref.current) {
      throw new Error('Cover page not ready');
    }
    const page1 = await capturePage(page1Ref.current);
    const page2 = await capturePage(page2Ref.current);
    const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
    doc.addImage(page1.dataUrl, page1.format, 0, 0, 612, 792, undefined, 'FAST');
    doc.addPage();
    doc.addImage(page2.dataUrl, page2.format, 0, 0, 612, 792, undefined, 'FAST');
    return doc;
  };

  const persistPdf = async (doc, filename) => {
    if (!job?._id) return;
    const blob = doc.output('blob');
    const formData = new FormData();
    formData.append('file', new File([blob], filename, { type: 'application/pdf' }));
    formData.append('jobId', String(job._id));
    formData.append('fileType', 'contract');
    formData.append('description', `Contract packet cover pages for ${job.title || 'job'}`);
    await axios.post(`${API_URL}/files/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    invalidateJobFilesCache(job._id);
    onSaved?.();
  };

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

  const handleDownload = async () => {
    try {
      setExporting(true);
      const doc = await renderPdf();
      const stamp = new Date().toISOString().slice(0, 10);
      const filename = `Contract-Packet-${jobCardNumber(job) || 'job'}-${stamp}.pdf`;
      const blob = doc.output('blob');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 2000);
      try {
        await persistPdf(doc, filename);
        toast.success('Contract cover saved to this job');
      } catch (persistError) {
        console.error('Contract cover save to job failed:', persistError);
        toast.error('PDF downloaded, but saving to the job failed');
      }
    } catch (error) {
      console.error('Contract cover PDF failed:', error);
      toast.error(error?.message || 'Failed to create contract cover');
    } finally {
      setExporting(false);
    }
  };

  const handleClose = () => {
    if (exporting) return;
    onClose();
  };

  const fieldSx = { '& .MuiOutlinedInput-root': { bgcolor: 'background.paper' } };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth={false}
      fullWidth
      scroll="paper"
      PaperProps={{ sx: { maxWidth: step === 'details' ? 560 : 920, width: '100%' } }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        {step === 'details' ? 'Contract details' : 'Cover page'}
        <IconButton size="small" onClick={handleClose} disabled={exporting} aria-label="Close">
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
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'center', py: 1 }}>
            <Box ref={page1Ref} sx={{ ...PAGE_SX, p: '32px' }}>
              <Box
                sx={{
                  height: '100%',
                  border: '4px solid #000',
                  boxSizing: 'border-box',
                  textAlign: 'center',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  px: '48px',
                  py: '40px',
                }}
              >
                <Box sx={{ width: '100%' }}>
                  <Typography sx={{ fontWeight: 800, fontSize: 34, letterSpacing: '-0.02em', lineHeight: 1.1 }}>
                    Contract. Packet
                  </Typography>
                  <Typography sx={{ fontWeight: 700, fontSize: 18, mt: 2.25, letterSpacing: '0.1em' }}>
                    CUSTOMER
                  </Typography>
                  <Typography sx={{ fontWeight: 700, fontSize: 24, mt: 0.85, lineHeight: 1.25 }}>
                    {customerName}
                  </Typography>
                  {street ? (
                    <Typography sx={{ fontWeight: 700, fontSize: 20, mt: 0.25, lineHeight: 1.25 }}>
                      {street}
                    </Typography>
                  ) : null}
                  {cityStateDisplay ? (
                    <Typography sx={{ fontWeight: 700, fontSize: 20, mt: 0.25, lineHeight: 1.25 }}>
                      {cityStateDisplay}
                    </Typography>
                  ) : null}
                </Box>

                <Box sx={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <Box
                    component="img"
                    src={COVER_LOGO}
                    alt="San Clemente Woodworking"
                    sx={{ width: 156, height: 156, objectFit: 'contain', display: 'block' }}
                  />
                  <Box
                    sx={{
                      mt: 2.5,
                      border: '1.5px solid #000',
                      px: 4,
                      py: 1.25,
                      minWidth: 300,
                      textAlign: 'center',
                    }}
                  >
                    <Typography sx={{ fontWeight: 700, fontSize: 16, textDecoration: 'underline' }}>
                      San Clemente Woodworking
                    </Typography>
                    <Typography sx={{ fontSize: 14.5, mt: 0.4 }}>{SHOP_ADDRESS_1}</Typography>
                    <Typography sx={{ fontSize: 14.5 }}>{SHOP_ADDRESS_2}</Typography>
                  </Box>
                </Box>

                <Box sx={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <Typography sx={{ fontStyle: 'italic', fontSize: 14, maxWidth: 460, lineHeight: 1.45 }}>
                    We appreciate the opportunity to work with you and look forward to completing your
                    project.
                  </Typography>
                  <Typography sx={{ fontStyle: 'italic', fontWeight: 600, fontSize: 13.5, mt: 2.25 }}>
                    Stainer Referrals:
                  </Typography>
                  <Typography sx={{ fontSize: 13, mt: 0.3, maxWidth: 480 }}>
                    {STAINER_REFERRALS}
                  </Typography>
                  <Box
                    component="img"
                    src={ZELLE_QR}
                    alt="Pay with Zelle"
                    sx={{
                      width: 240,
                      height: 'auto',
                      display: 'block',
                      mt: 2,
                    }}
                  />
                </Box>
              </Box>
            </Box>

            <Box
              ref={page2Ref}
              sx={{
                ...PAGE_SX,
                px: '56px',
                py: '44px',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <Typography sx={{ fontWeight: 700, fontSize: 20, textAlign: 'center', letterSpacing: '0.06em' }}>
                Contract
              </Typography>

              <ContractSection number="1" title="Agreement">
                <Typography sx={{ fontSize: 13.5, lineHeight: 1.55 }}>
                  This agreement is made and entered into on {formatContractDate(docDate)}, by and between
                  owner or manager {OWNER_NAME}, phone {OWNER_PHONE}. San Clemente Woodworking proposes to
                  complete the following as per attached Estimate #{estimateNumber || '______'} with owner’s
                  signature, for a total of {formatMoney(total)}.
                </Typography>
              </ContractSection>

              <ContractSection number="2" title="Scope of work">
                <Typography sx={{ fontSize: 13.5, lineHeight: 1.55 }}>
                  {inspectionParagraph}
                </Typography>
              </ContractSection>

              <ContractSection number="3" title="Payment">
                <Typography sx={{ fontSize: 13.5, lineHeight: 1.55, mb: 0.75 }}>
                  Payments are due as follows:
                </Typography>
                <Box sx={{ pl: 1.5 }}>
                  {paymentDisplay.lines.map((line) => (
                    <Typography key={line} sx={{ fontSize: 13.5, lineHeight: 1.5, fontWeight: 600 }}>
                      {line}
                    </Typography>
                  ))}
                </Box>
                {paymentDisplay.notes.map((line) => (
                  <Typography key={line} sx={{ fontSize: 13.5, lineHeight: 1.5, mt: 0.65 }}>
                    {line}
                  </Typography>
                ))}
              </ContractSection>

              <ContractSection number="4" title="Notice to owner">
                <Box sx={{ border: '1.5px solid #000', px: 1.5, py: 1 }}>
                  <Typography sx={{ fontSize: 10.5, fontWeight: 700, mb: 0.45, letterSpacing: '0.02em' }}>
                    SECTION 7019 — CONTRACTORS LICENSE LAW
                  </Typography>
                  <Typography sx={{ fontSize: 10, lineHeight: 1.4 }}>
                    {NOTICE_TEXT}
                  </Typography>
                </Box>
              </ContractSection>

              <ContractSection number="5" title="License">
                <Typography sx={{ fontSize: 13.5, lineHeight: 1.5 }}>
                  Contractors are required by law to be licensed and regulated by the Contractors’ State
                  License Board. Any questions concerning a contractor may be referred to the registrar of
                  the board whose address is:
                </Typography>
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    mt: 1.25,
                    columnGap: 3,
                  }}
                >
                  <Box>
                    <Typography sx={{ fontWeight: 700, fontSize: 13 }}>Contractors’ State License Board</Typography>
                    <Typography sx={{ fontSize: 13, mt: 0.25 }}>{CSLB_ADDRESS}</Typography>
                  </Box>
                  <Box>
                    <Typography sx={{ fontWeight: 700, fontSize: 13 }}>State Contractors’ License</Typography>
                    <Typography sx={{ fontSize: 13, mt: 0.25 }}>{LICENSE_NUMBER}</Typography>
                  </Box>
                </Box>
              </ContractSection>

              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  columnGap: 5,
                  mt: 7,
                  pt: 2.5,
                }}
              >
                <Typography sx={{ fontSize: 14, display: 'flex', alignItems: 'flex-end', gap: 1 }}>
                  Sign here
                  <Box component="span" sx={{ flex: 1, borderBottom: '1px solid #000', height: 16 }} />
                </Typography>
                <Typography sx={{ fontSize: 14, display: 'flex', alignItems: 'flex-end', gap: 1 }}>
                  Date
                  <Box component="span" sx={{ flex: 1, borderBottom: '1px solid #000', height: 16 }} />
                </Typography>
              </Box>
            </Box>
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        {step === 'details' ? (
          <>
            <Button onClick={handleClose}>Cancel</Button>
            <Button variant="contained" onClick={handleContinue}>
              Continue
            </Button>
          </>
        ) : (
          <>
            <Button onClick={() => setStep('details')} disabled={exporting}>
              Back
            </Button>
            <Button variant="contained" onClick={handleDownload} disabled={exporting}>
              {exporting ? 'Creating…' : 'Download PDF & save to job'}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
