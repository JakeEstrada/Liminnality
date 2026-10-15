/**
 * ContractCoverPrintPage — Printable two-page contract cover.
 * Route: /print/contract-cover
 * Docs: ../../../docs/PAGES.md#contractcoverprintpagetsx
 */
import { Box, Button, Stack, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import PrintIcon from '@mui/icons-material/Print';
import { useNavigate } from 'react-router-dom';
import ContractCoverSheets, { readContractCoverPrintData } from '../components/jobs/ContractCoverSheets';

export default function ContractCoverPrintPage() {
  const navigate = useNavigate();
  const data = readContractCoverPrintData();

  const handleClose = () => {
    window.close();
    window.setTimeout(() => {
      if (!window.closed) navigate(-1);
    }, 150);
  };

  if (!data) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography color="error">Cover page is not available in this tab. Open it again from the job.</Typography>
        <Button sx={{ mt: 2 }} onClick={handleClose}>
          Close
        </Button>
      </Box>
    );
  }

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
          Contract cover
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
          py: 3,
          '@media print': {
            py: 0,
            bgcolor: '#fff',
          },
        }}
      >
        <style>
          {`@media print {
            @page { size: letter portrait; margin: 0; }
            html, body { background: #fff !important; }
          }`}
        </style>
        <ContractCoverSheets data={data} />
      </Box>
    </Box>
  );
}
