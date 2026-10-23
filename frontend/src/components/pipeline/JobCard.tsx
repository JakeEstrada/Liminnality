import { useState, useRef } from 'react';
import { Card, CardContent, Typography, Box, Tooltip, IconButton, useTheme, alpha } from '@mui/material';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import { DEFAULT_JOB_CARD_MIN_HEIGHT_PX } from '../../utils/pipelineViewSettings';
import { getJobCardAccent } from '../../utils/taskDisplay';
import { jobMapFixLabel, jobNeedsMapFix } from '../../utils/jobGeo';
import { paymentSquaresForJob } from '../../utils/paymentSchedule';

function JobCard(props: Record<string, unknown>) {
  const {
    job,
    onClick,
    onContextMenu,
    onMapErrorClick,
    canModify = true,
    minHeightPx = DEFAULT_JOB_CARD_MIN_HEIGHT_PX,
    narrow = false,
  } = props as {
    job: Record<string, unknown> & {
      schedule?: { startDate?: string; entries?: Array<{ startDate?: string }> };
      stage?: string;
      color?: string;
      title?: string;
      customerId?: { name?: string };
      description?: string;
      _id?: string;
      isArchived?: boolean;
      isDeadEstimate?: boolean;
      unreadCustomerSmsCount?: number;
    };
    onClick?: () => void;
    onContextMenu?: (e: unknown, job: Record<string, unknown>) => void;
    onMapErrorClick?: (job: Record<string, unknown>) => void;
    canModify?: boolean;
    minHeightPx?: number;
    /** Phone columns are ~80px wide: one truncated line, no description. */
    narrow?: boolean;
    onUpdate?: unknown;
    onStageChange?: unknown;
  };
  const theme = useTheme();
  const [isDragging, setIsDragging] = useState(false);
  const cardRef = useRef(null);

  // Truncate long job titles
  const truncateTitle = (title, maxLength = 40) => {
    if (!title) return 'Untitled Job';
    if (title.length <= maxLength) return title;
    return title.substring(0, maxLength) + '...';
  };

  const handleContextMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (onContextMenu) {
      // Create a new event-like object with the card element as currentTarget
      const eventWithAnchor = Object.create(e);
      eventWithAnchor.currentTarget = cardRef.current;
      eventWithAnchor.target = cardRef.current;
      onContextMenu(eventWithAnchor, job);
    }
  };

  const handleDragStart = (e) => {
    setIsDragging(true);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/json', JSON.stringify({
      jobId: job._id,
      currentStage: job.stage,
    }));
    // Add a visual effect
    e.dataTransfer.setDragImage(e.currentTarget, 0, 0);
  };

  const handleDragEnd = () => {
    setIsDragging(false);
  };

  const { color: statusColor } = getJobCardAccent(job, theme);
  const paymentSquares = paymentSquaresForJob(job);
  const paymentTooltip = paymentSquares
    .map((row) => `${row.label}: ${row.paid ? 'paid' : 'not paid'}`)
    .join('\n');

  const needsMapFix = jobNeedsMapFix(job);
  const mapFixLabel = jobMapFixLabel(job);
  const compactCard = narrow || minHeightPx <= 56;
  const ultraCompact = narrow || minHeightPx <= 48;
  const contentPy = narrow ? 0.5 : compactCard ? 0.75 : 1.5;
  const titleFontRem = narrow ? '0.6875rem' : ultraCompact ? '0.75rem' : compactCard ? '0.8125rem' : '0.875rem';
  const descFontRem = ultraCompact ? '0.6875rem' : '0.75rem';
  const squareSize = narrow ? 7 : ultraCompact ? 8 : 9;
  const cardMinHeight = narrow ? 32 : minHeightPx;
  const unreadSms = Math.max(0, Number(job.unreadCustomerSmsCount) || 0);

  return (
    <Card
      ref={cardRef}
      draggable={canModify}
      onDragStart={canModify ? handleDragStart : undefined}
      onDragEnd={canModify ? handleDragEnd : undefined}
      onClick={onClick}
      onContextMenu={handleContextMenu}
      sx={{
        // Narrow columns read cleaner as square tiles with a hairline edge than as
        // rounded cards with a blurred shadow.
        borderRadius: narrow ? 0 : '8px',
        minHeight: cardMinHeight,
        display: 'flex',
        flexDirection: 'column',
        boxShadow: narrow
          ? 'none'
          : theme.palette.mode === 'dark'
            ? '0 1px 4px rgba(0, 0, 0, 0.3)'
            : '0 1px 4px rgba(0, 0, 0, 0.06)',
        border: narrow ? `1px solid ${theme.palette.divider}` : undefined,
        cursor: canModify ? (isDragging ? 'grabbing' : 'grab') : 'pointer',
        transition: 'all 0.2s ease',
        borderLeft: `3px solid ${statusColor}`,
        opacity: isDragging ? 0.5 : 1,
        '&:hover': {
          boxShadow: theme.palette.mode === 'dark'
            ? `0 4px 12px ${alpha(statusColor, 0.45)}`
            : `0 4px 12px ${alpha(statusColor, 0.28)}`,
          transform: isDragging ? 'none' : 'translateY(-2px)',
        },
      }}
    >
      <CardContent
        sx={{
          py: contentPy,
          px: narrow ? 0.5 : compactCard ? 1 : 1.5,
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          '&:last-child': { pb: contentPy },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography
            variant="body2"
            sx={{
              fontSize: titleFontRem,
              fontWeight: 500,
              color: theme.palette.text.primary,
              lineHeight: 1.35,
              display: narrow ? 'block' : 'inline',
              ...(narrow
                ? { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
                : null),
            }}
            title={job.title}
          >
            {narrow ? job.title || 'Untitled Job' : truncateTitle(job.title, ultraCompact ? 36 : 50)}
            {unreadSms > 0 ? (
              <Box
                component="span"
                sx={{
                  ml: 0.5,
                  fontWeight: 800,
                  color: 'primary.main',
                  whiteSpace: 'nowrap',
                }}
              >
                (+{unreadSms})
              </Box>
            ) : null}
          </Typography>
          {job.description && !narrow && (
            <>
              <Typography
                component="span"
                aria-hidden
                sx={{
                  mx: compactCard ? 0.5 : 0.75,
                  color: theme.palette.text.disabled,
                  fontSize: descFontRem,
                }}
              >
                ·
              </Typography>
              <Typography
                component="span"
                variant="body2"
                sx={{
                  fontSize: descFontRem,
                  color: theme.palette.text.secondary,
                  fontStyle: 'italic',
                  fontWeight: 300,
                  lineHeight: 1.35,
                }}
                title={job.description ?? ''}
              >
                {truncateTitle(job.description, ultraCompact ? 18 : 30)}
              </Typography>
            </>
          )}
          </Box>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.4, flexShrink: 0 }}>
          {needsMapFix ? (
            <Tooltip title={mapFixLabel}>
              <IconButton
                size="small"
                aria-label={mapFixLabel}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (onMapErrorClick) onMapErrorClick(job);
                  else onClick?.();
                }}
                sx={{
                  p: 0.15,
                  mt: ultraCompact ? -0.15 : 0,
                  color: 'error.main',
                }}
              >
                <ErrorOutlineIcon sx={{ fontSize: narrow ? 14 : ultraCompact ? 16 : 18 }} />
              </IconButton>
            </Tooltip>
          ) : null}
          {paymentSquares.length ? (
            <Tooltip
              title={
                <Box sx={{ whiteSpace: 'pre-line' }}>
                  {paymentTooltip}
                </Box>
              }
            >
              <Box
                aria-label={paymentTooltip.replace(/\n/g, ', ')}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '3px',
                  mt: ultraCompact ? 0.2 : 0.35,
                }}
              >
                {paymentSquares.map((row, index) => (
                  <Box
                    key={`${row.label}-${index}`}
                    sx={{
                      width: squareSize,
                      height: squareSize,
                      borderRadius: '2px',
                      boxSizing: 'border-box',
                      backgroundColor: row.paid ? 'success.main' : 'transparent',
                      border: row.paid
                        ? '1px solid'
                        : `1.5px solid ${theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.35)'}`,
                      borderColor: row.paid ? 'success.main' : undefined,
                    }}
                  />
                ))}
              </Box>
            </Tooltip>
          ) : null}
        </Box>
      </Box>
      </CardContent>
    </Card>
  );
}

export default JobCard;
