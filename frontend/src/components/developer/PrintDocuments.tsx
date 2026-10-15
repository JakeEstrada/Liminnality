import { useRef, useState } from 'react';
import { Box, Button, Paper, Typography } from '@mui/material';
import PrintIcon from '@mui/icons-material/Print';

type PrintDoc = {
  id: string;
  title: string;
  description: string;
  href: string;
  paper: string;
};

const PRINT_DOCS: PrintDoc[] = [
  {
    id: 'scww-inventory',
    title: 'SCWW Inventory Sheet',
    description: 'Staircase materials · shop stock check · letter landscape',
    href: '/print/scww-inventory.html',
    paper: 'Letter landscape',
  },
];

export default function PrintDocuments() {
  const [selectedId, setSelectedId] = useState(PRINT_DOCS[0].id);
  const [ready, setReady] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const selected = PRINT_DOCS.find((row) => row.id === selectedId) || PRINT_DOCS[0];

  const printSelected = () => {
    const frame = frameRef.current;
    if (!frame?.contentWindow) return;
    frame.contentWindow.focus();
    frame.contentWindow.print();
  };

  return (
    <Box>
      <Box
        sx={{
          display: 'flex',
          alignItems: { xs: 'stretch', sm: 'center' },
          justifyContent: 'space-between',
          gap: 1.5,
          flexDirection: { xs: 'column', sm: 'row' },
          mb: 2,
        }}
      >
        <Box>
          <Typography variant="body2" color="text.secondary">
            Pick a sheet, then print. Use landscape letter for the inventory form.
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<PrintIcon />}
          onClick={printSelected}
          disabled={!ready}
          sx={{ textTransform: 'none', alignSelf: { xs: 'flex-start', sm: 'center' } }}
        >
          Print
        </Button>
      </Box>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '240px 1fr' },
          gap: 2,
          alignItems: 'start',
        }}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {PRINT_DOCS.map((doc) => {
            const active = doc.id === selected.id;
            return (
              <Paper
                key={doc.id}
                component="button"
                type="button"
                onClick={() => {
                  if (doc.id === selectedId) return;
                  setReady(false);
                  setSelectedId(doc.id);
                }}
                sx={{
                  textAlign: 'left',
                  p: 1.5,
                  borderRadius: 2,
                  border: '1px solid',
                  borderColor: active ? 'primary.main' : 'divider',
                  bgcolor: active ? 'action.selected' : 'background.paper',
                  cursor: 'pointer',
                  boxShadow: 'none',
                }}
              >
                <Typography sx={{ fontWeight: 600, fontSize: 14 }}>{doc.title}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                  {doc.description}
                </Typography>
              </Paper>
            );
          })}
        </Box>

        <Paper
          sx={{
            borderRadius: 2,
            overflow: 'hidden',
            border: '1px solid',
            borderColor: 'divider',
            bgcolor: '#eaf0f3',
          }}
        >
          <Box
            sx={{
              px: 1.5,
              py: 1,
              display: 'flex',
              justifyContent: 'space-between',
              gap: 1,
              borderBottom: '1px solid',
              borderColor: 'divider',
              bgcolor: 'background.paper',
            }}
          >
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {selected.title}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {selected.paper}
            </Typography>
          </Box>
          <Box
            component="iframe"
            ref={frameRef}
            title={selected.title}
            src={selected.href}
            onLoad={() => setReady(true)}
            sx={{
              display: 'block',
              width: '100%',
              height: { xs: 520, md: 740 },
              border: 0,
              bgcolor: '#eaf0f3',
            }}
          />
        </Paper>
      </Box>
    </Box>
  );
}
