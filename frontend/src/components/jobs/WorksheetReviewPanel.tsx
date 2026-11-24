import { useState } from 'react';
import { Box, Button, Chip, CircularProgress, IconButton, Tooltip, Typography } from '@mui/material';
import {
  OpenInNew as OpenInNewIcon,
  PictureAsPdf as PdfIcon,
  RotateRight as RotateRightIcon,
} from '@mui/icons-material';
import type { WorksheetStatus } from '../../hooks/useWorksheetReading';
import type { WorksheetReading } from '../../utils/worksheetRead';

type Props = {
  file: File;
  status: WorksheetStatus;
  previewUrl: string;
  reading: WorksheetReading | null;
};

function ReviewRow({ label, children }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: '112px minmax(0, 1fr)', gap: 1, py: 0.5 }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Box sx={{ minWidth: 0 }}>{children}</Box>
    </Box>
  );
}

export function VerifyChip({ reason, onClick }: { reason: string; onClick?: () => void }) {
  return (
    <Tooltip title={onClick ? `${reason}. Click once you've checked it.` : reason}>
      <Chip
        label="Verify"
        size="small"
        color="warning"
        variant="outlined"
        onClick={onClick}
        sx={{ height: 22, fontWeight: 700, cursor: onClick ? 'pointer' : 'default' }}
      />
    </Tooltip>
  );
}

/** The dropped worksheet beside the Create New Job fields, plus details that have no form field. */
export default function WorksheetReviewPanel({ file, status, previewUrl, reading }: Props) {
  const [turn, setTurn] = useState(0);

  const openOriginal = () => {
    const url = URL.createObjectURL(file);
    window.open(url, '_blank', 'noopener');
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  const review = reading?.review;
  const contacts = review?.otherContacts || [];
  const hasDetails = Boolean(
    review &&
      (contacts.length ||
        review.referral ||
        review.worksheetDate ||
        review.options.length ||
        review.materials.length ||
        review.notes.length ||
        review.customerType === 'contractor'),
  );

  return (
    <Box
      sx={{
        position: { md: 'sticky' },
        top: { md: 0 },
        alignSelf: 'start',
        pt: 2,
        display: 'flex',
        flexDirection: 'column',
        gap: 1.5,
        minWidth: 0,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, flex: 1, minWidth: 0 }} noWrap title={file.name}>
          {file.name}
        </Typography>
        <Tooltip title="Rotate preview">
          <span>
            <IconButton size="small" onClick={() => setTurn((value) => (value + 90) % 360)} disabled={!previewUrl}>
              <RotateRightIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Button
          size="small"
          onClick={openOriginal}
          endIcon={<OpenInNewIcon fontSize="small" />}
          sx={{ textTransform: 'none', flexShrink: 0 }}
        >
          Open original
        </Button>
      </Box>

      <Box
        sx={{
          position: 'relative',
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 1,
          bgcolor: 'grey.100',
          minHeight: 280,
          maxHeight: { md: '62vh' },
          overflow: 'auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {previewUrl ? (
          <Box
            component="img"
            src={previewUrl}
            alt={`Worksheet ${file.name}`}
            sx={{
              display: 'block',
              maxWidth: turn % 180 === 0 ? '100%' : 'none',
              width: turn % 180 === 0 ? '100%' : 'auto',
              maxHeight: turn % 180 === 0 ? 'none' : '100%',
              transform: `rotate(${turn}deg)`,
              transition: 'transform 0.2s ease',
            }}
          />
        ) : status === 'reading' ? (
          <CircularProgress size={28} />
        ) : (
          <Box sx={{ textAlign: 'center', p: 3, color: 'text.secondary' }}>
            <PdfIcon sx={{ fontSize: 40 }} />
            <Typography variant="body2">No preview for this file. Use Open original to view it.</Typography>
          </Box>
        )}
      </Box>

      {hasDetails ? (
        <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, px: 1.5, py: 1 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
            Also on the worksheet
          </Typography>
          {contacts.map((contact, index) => (
            <ReviewRow key={`${contact.name}-${contact.phone}-${index}`} label="Other contact">
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Typography variant="body2">
                  {[contact.name, contact.phone, contact.email, contact.note].filter(Boolean).join(' · ')}
                </Typography>
                {contact.verify ? <VerifyChip reason={contact.verify} /> : null}
              </Box>
            </ReviewRow>
          ))}
          {review.referral ? (
            <ReviewRow label="Ref">
              <Typography variant="body2">{review.referral}</Typography>
            </ReviewRow>
          ) : null}
          {review.worksheetDate ? (
            <ReviewRow label="Worksheet date">
              <Typography variant="body2">{review.worksheetDate}</Typography>
            </ReviewRow>
          ) : null}
          {review.customerType === 'contractor' ? (
            <ReviewRow label="Marked">
              <Typography variant="body2">Contractor</Typography>
            </ReviewRow>
          ) : null}
          {review.options.length ? (
            <ReviewRow label="Checked">
              <Typography variant="body2">{review.options.join(', ')}</Typography>
            </ReviewRow>
          ) : null}
          {review.materials.length ? (
            <ReviewRow label="Materials">
              {review.materials.map((line) => (
                <Typography key={line} variant="body2">
                  {line}
                </Typography>
              ))}
            </ReviewRow>
          ) : null}
          {review.notes.length ? (
            <ReviewRow label="Other writing">
              {review.notes.map((line) => (
                <Typography key={line} variant="body2">
                  {line}
                </Typography>
              ))}
            </ReviewRow>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
}
