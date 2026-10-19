/**
 * CalendarBenchPrintPage — Printable install-bench worksheet.
 * Route: /print/calendar-bench
 * Docs: ../../../docs/PAGES.md#calendarbenchprintpagetsx
 */
import { Box, Button, Stack, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import PrintIcon from '@mui/icons-material/Print';
import { useNavigate } from 'react-router-dom';
import { readCalendarBenchPrintData } from '../utils/calendarBenchPrint';

const BLANK_ROWS = 3;

const thSx = {
  border: '1px solid #000',
  bgcolor: '#f3f3f3',
  fontWeight: 700,
  fontSize: 11,
  textAlign: 'left',
  px: 1,
  py: 0.75,
  whiteSpace: 'nowrap',
};

const tdSx = {
  border: '1px solid #000',
  fontSize: 12,
  px: 1,
  py: 1,
  verticalAlign: 'top',
  height: 42,
};

export default function CalendarBenchPrintPage() {
  const navigate = useNavigate();
  const data = readCalendarBenchPrintData();

  const handleClose = () => {
    window.close();
    window.setTimeout(() => {
      if (!window.closed) navigate('/calendar');
    }, 150);
  };

  if (!data) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography color="error">Bench print is not available in this tab. Open it again from the calendar.</Typography>
        <Button sx={{ mt: 2 }} onClick={handleClose}>
          Close
        </Button>
      </Box>
    );
  }

  const extraBlanks = Array.from({ length: data.rows.length ? BLANK_ROWS : 8 }, (_, i) => i);

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#e8e8e8' }}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{
          px: 2,
          py: 1,
          borderBottom: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
          position: 'sticky',
          top: 0,
          zIndex: 2,
          '@media print': { display: 'none' },
        }}
      >
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
          Install bench
        </Typography>
        <Stack direction="row" gap={1}>
          <Button variant="contained" size="small" startIcon={<PrintIcon />} onClick={() => window.print()}>
            Print
          </Button>
          <Button variant="outlined" color="inherit" size="small" startIcon={<CloseIcon />} onClick={handleClose}>
            Close tab
          </Button>
        </Stack>
      </Stack>

      <Box
        sx={{
          p: 2,
          '@media print': {
            p: 0,
            bgcolor: '#fff',
          },
        }}
      >
        <style>
          {`@media print {
            @page { size: letter landscape; margin: 0.4in; }
            html, body { background: #fff !important; }
          }`}
        </style>
        <Box
          sx={{
            width: 1056,
            maxWidth: '100%',
            mx: 'auto',
            bgcolor: '#fff',
            color: '#000',
            p: 2,
            boxSizing: 'border-box',
            fontFamily: 'Arial, Helvetica, sans-serif',
          }}
        >
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mb: 1.5 }}>
            <Box>
              <Typography sx={{ fontWeight: 800, fontSize: 20, letterSpacing: '-0.02em' }}>
                Install bench
              </Typography>
              <Typography sx={{ fontSize: 12, mt: 0.25 }}>
                Jobs ready to schedule. Fill in start, finish, and who is going.
              </Typography>
            </Box>
            <Typography sx={{ fontSize: 12 }}>{data.printedAt}</Typography>
          </Box>

          <Box
            component="table"
            sx={{
              width: '100%',
              borderCollapse: 'collapse',
              tableLayout: 'fixed',
            }}
          >
            <Box component="thead">
              <Box component="tr">
                <Box component="th" sx={{ ...thSx, width: '22%' }}>
                  Customer / job
                </Box>
                <Box component="th" sx={{ ...thSx, width: '10%' }}>
                  Deposit paid
                </Box>
                <Box component="th" sx={{ ...thSx, width: '22%' }}>
                  Payments
                </Box>
                <Box component="th" sx={{ ...thSx, width: '10%' }}>
                  Total
                </Box>
                <Box component="th" sx={{ ...thSx, width: '10%' }}>
                  Start
                </Box>
                <Box component="th" sx={{ ...thSx, width: '10%' }}>
                  Finish
                </Box>
                <Box component="th" sx={{ ...thSx, width: '16%' }}>
                  Who
                </Box>
              </Box>
            </Box>
            <Box component="tbody">
              {data.rows.map((row, index) => (
                <Box component="tr" key={`${row.customerName}-${row.jobTitle}-${index}`}>
                  <Box component="td" sx={tdSx}>
                    <Box sx={{ fontWeight: 700 }}>{row.customerName}</Box>
                    <Box sx={{ fontSize: 11, mt: 0.25 }}>{row.jobTitle}</Box>
                  </Box>
                  <Box component="td" sx={tdSx}>
                    {row.depositDate || '—'}
                  </Box>
                  <Box component="td" sx={tdSx}>
                    {row.payments || '—'}
                    {row.lastPaymentDate && row.payments.includes(' · ') ? (
                      <Box sx={{ fontSize: 10, mt: 0.5, color: '#333' }}>Last {row.lastPaymentDate}</Box>
                    ) : null}
                  </Box>
                  <Box component="td" sx={{ ...tdSx, fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {row.total}
                  </Box>
                  <Box component="td" sx={tdSx} />
                  <Box component="td" sx={tdSx} />
                  <Box component="td" sx={tdSx} />
                </Box>
              ))}
              {extraBlanks.map((key) => (
                <Box component="tr" key={`blank-${key}`}>
                  <Box component="td" sx={tdSx} />
                  <Box component="td" sx={tdSx} />
                  <Box component="td" sx={tdSx} />
                  <Box component="td" sx={tdSx} />
                  <Box component="td" sx={tdSx} />
                  <Box component="td" sx={tdSx} />
                  <Box component="td" sx={tdSx} />
                </Box>
              ))}
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
