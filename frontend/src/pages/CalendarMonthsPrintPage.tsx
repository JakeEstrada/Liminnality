/**
 * CalendarMonthsPrintPage — This month + next month on one landscape letter page.
 * Route: /print/calendar-months
 * Docs: ../../../docs/PAGES.md#calendarmonthsprintpagetsx
 */
import { Box, Button, Stack, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import PrintIcon from '@mui/icons-material/Print';
import { useNavigate } from 'react-router-dom';
import {
  readCalendarMonthsPrintData,
  type CalendarMonthsPrintEvent,
} from '../utils/calendarMonthsPrint';

const MAX_EVENTS = 5;

function contrastText(hex: string) {
  const raw = String(hex || '').replace('#', '');
  if (raw.length < 6) return '#111';
  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return '#111';
  return (r * 299 + g * 587 + b * 114) / 1000 >= 160 ? '#111' : '#fff';
}

function EventChip({ event }: { event: CalendarMonthsPrintEvent }) {
  const color = event.color || '#1976D2';
  const text = [event.label, event.installer].filter(Boolean).join(' · ');
  return (
    <div
      className="cal-print-event"
      title={text}
      style={{ backgroundColor: color, color: contrastText(color), borderLeftColor: color }}
    >
      {text}
    </div>
  );
}

export default function CalendarMonthsPrintPage() {
  const navigate = useNavigate();
  const data = readCalendarMonthsPrintData();

  const handleClose = () => {
    window.close();
    window.setTimeout(() => {
      if (!window.closed) navigate('/calendar');
    }, 150);
  };

  if (!data) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography color="error">
          Calendar print is not available in this tab. Open it again from the calendar.
        </Typography>
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
          Calendar · {data.rangeLabel}
        </Typography>
        <Stack direction="row" gap={1}>
          <Button startIcon={<PrintIcon />} variant="contained" onClick={() => window.print()}>
            Print
          </Button>
          <Button startIcon={<CloseIcon />} onClick={handleClose}>
            Close
          </Button>
        </Stack>
      </Stack>

      <style>{`
        @page { size: letter landscape; margin: 0.32in; }
        @media print {
          html, body { background: #fff !important; }
          .cal-print-sheet { box-shadow: none !important; margin: 0 !important; }
        }
        .cal-print-sheet {
          width: 10.36in;
          height: 7.86in;
          margin: 16px auto;
          background: #fff;
          color: #111;
          box-shadow: 0 2px 10px rgba(0,0,0,0.18);
          padding: 0.12in 0.16in 0.1in;
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        .cal-print-header {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 0.08in;
          flex-shrink: 0;
        }
        .cal-print-header h1 {
          font-size: 13px;
          font-weight: 800;
          letter-spacing: 0.02em;
          margin: 0;
          text-transform: uppercase;
        }
        .cal-print-header span {
          font-size: 10px;
          color: #444;
        }
        .cal-print-months {
          flex: 1;
          min-height: 0;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0.22in;
        }
        .cal-print-month {
          min-width: 0;
          min-height: 0;
          display: flex;
          flex-direction: column;
        }
        .cal-print-month h2 {
          margin: 0 0 0.05in;
          font-size: 14px;
          font-weight: 800;
          text-align: center;
        }
        .cal-print-grid {
          flex: 1;
          min-height: 0;
          display: grid;
          grid-template-rows: 16px;
          grid-auto-rows: minmax(0, 1fr);
          border-top: 1px solid #222;
          border-left: 1px solid #222;
        }
        .cal-print-dow, .cal-print-day {
          border-right: 1px solid #222;
          border-bottom: 1px solid #222;
          min-width: 0;
          min-height: 0;
        }
        .cal-print-dow {
          font-size: 8px;
          font-weight: 800;
          text-align: center;
          padding: 2px 0;
          background: #f2f2f2;
          letter-spacing: 0.02em;
          text-transform: uppercase;
        }
        .cal-print-day {
          padding: 2px 3px 3px;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }
        .cal-print-day.pad {
          background: #f7f7f7;
          color: #888;
        }
        .cal-print-day.today .cal-print-num {
          background: #111;
          color: #fff;
          border-radius: 8px;
          padding: 0 4px;
        }
        .cal-print-day-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 3px;
          flex-shrink: 0;
        }
        .cal-print-num {
          font-size: 9px;
          font-weight: 800;
          line-height: 1.2;
        }
        .cal-print-hol {
          font-size: 6.5px;
          font-weight: 700;
          color: #6a4700;
          background: #ffe08a;
          border-radius: 6px;
          padding: 0 3px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 72%;
        }
        .cal-print-event {
          margin-top: 1px;
          font-size: 7px;
          font-weight: 700;
          line-height: 1.15;
          padding: 1px 3px;
          border-radius: 2px;
          border-left: 2px solid #111;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .cal-print-more {
          font-size: 6.5px;
          font-weight: 700;
          color: #444;
          text-align: right;
          margin-top: 1px;
        }
      `}</style>

      <div className="cal-print-sheet">
        <header className="cal-print-header">
          <h1>Install calendar</h1>
          <span>
            {data.rangeLabel} · Printed {data.printedAt}
          </span>
        </header>
        <div className="cal-print-months">
          {data.months.map((month) => (
            <section key={month.title} className="cal-print-month">
              <h2>{month.title}</h2>
              <div
                className="cal-print-grid"
                style={{ gridTemplateColumns: `repeat(${month.columnCount}, minmax(0, 1fr))` }}
              >
                {month.weekdayLabels.map((label) => (
                  <div key={`${month.title}-${label}`} className="cal-print-dow">
                    {label}
                  </div>
                ))}
                {month.days.map((day) => {
                  const extra = Math.max(0, day.events.length - MAX_EVENTS);
                  return (
                    <div
                      key={day.iso}
                      className={`cal-print-day${day.inMonth ? '' : ' pad'}${day.isToday ? ' today' : ''}`}
                    >
                      <div className="cal-print-day-head">
                        <span className="cal-print-num">{day.day}</span>
                        {day.holiday ? <span className="cal-print-hol">{day.holiday}</span> : null}
                      </div>
                      {day.events.slice(0, MAX_EVENTS).map((event, index) => (
                        <EventChip key={`${day.iso}-${index}`} event={event} />
                      ))}
                      {extra > 0 ? <div className="cal-print-more">+{extra} more</div> : null}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>
    </Box>
  );
}
