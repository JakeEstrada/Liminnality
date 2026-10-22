import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import CalendarMonthsPrintPage from '../pages/CalendarMonthsPrintPage';
import {
  CALENDAR_MONTHS_PRINT_STORAGE_KEY,
  buildCalendarMonthsPrintData,
  writeCalendarMonthsPrintData,
} from './calendarMonthsPrint';

describe('calendar months print', () => {
  it('builds this month and next month with jobs on the right days', () => {
    const data = buildCalendarMonthsPrintData({
      currentDate: new Date('2026-10-15T12:00:00'),
      events: [
        {
          title: 'Kitchen remodel',
          color: '#1976D2',
          job: { title: 'Kitchen remodel', customerId: { name: 'Ada West' } },
          schedule: {
            startDate: '2026-10-16T12:00:00',
            endDate: '2026-10-17T12:00:00',
            installer: 'Nick',
          },
        },
        {
          title: 'Bath',
          job: { title: 'Bath', customerId: { name: 'Lee' } },
          schedule: {
            startDate: '2026-11-02T12:00:00',
            endDate: '2026-11-02T12:00:00',
            installer: 'Ed',
          },
        },
      ],
      holidayMap: { '2026-10-12': 'Columbus Day' },
    });

    expect(data.months).toHaveLength(2);
    expect(data.months[0].title).toBe('October 2026');
    expect(data.months[1].title).toBe('November 2026');
    expect(data.rangeLabel).toBe('October 2026 – November 2026');

    const oct16 = data.months[0].days.find((day) => day.iso === '2026-10-16');
    const oct17 = data.months[0].days.find((day) => day.iso === '2026-10-17');
    const oct18 = data.months[0].days.find((day) => day.iso === '2026-10-18');
    const nov2 = data.months[1].days.find((day) => day.iso === '2026-11-02');
    const holiday = data.months[0].days.find((day) => day.iso === '2026-10-12');

    expect(oct16?.events[0]).toMatchObject({ label: 'Ada West', installer: 'Nick' });
    expect(oct17?.events).toHaveLength(1);
    expect(oct18?.events).toHaveLength(0);
    expect(nov2?.events[0]).toMatchObject({ label: 'Lee', installer: 'Ed' });
    expect(holiday?.holiday).toBe('Columbus Day');
  });

  it('drops hidden weekdays from both months', () => {
    const data = buildCalendarMonthsPrintData({
      currentDate: new Date('2026-10-15T12:00:00'),
      events: [],
      hiddenWeekdays: [0, 6],
    });

    expect(data.months[0].weekdayLabels).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
    expect(data.months[0].columnCount).toBe(5);
    expect(data.months[0].days.some((day) => day.iso === '2026-10-03')).toBe(false);
    expect(data.months[0].days.some((day) => day.iso === '2026-10-04')).toBe(false);
    expect(data.months[0].days.some((day) => day.iso === '2026-10-05')).toBe(true);
  });

  it('renders each month on its own sheet', () => {
    writeCalendarMonthsPrintData(
      buildCalendarMonthsPrintData({
        currentDate: new Date('2026-10-15T12:00:00'),
        events: [
          {
            title: 'Kitchen remodel',
            job: { title: 'Kitchen remodel', customerId: { name: 'Ada West' } },
            schedule: {
              startDate: '2026-10-16T12:00:00',
              endDate: '2026-10-16T12:00:00',
              installer: 'Nick',
            },
          },
        ],
        holidayMap: { '2026-10-12': 'Columbus Day' },
      }),
    );

    const { container } = render(
      <MemoryRouter>
        <CalendarMonthsPrintPage />
      </MemoryRouter>,
    );

    expect(container.querySelectorAll('.cal-print-sheet')).toHaveLength(2);
    expect(screen.getByRole('heading', { name: 'October 2026' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'November 2026' })).toBeInTheDocument();
    expect(screen.getByText('Ada West · Nick')).toBeInTheDocument();
    expect(screen.getByText('Columbus Day')).toBeInTheDocument();

    sessionStorage.removeItem(CALENDAR_MONTHS_PRINT_STORAGE_KEY);
    localStorage.removeItem(CALENDAR_MONTHS_PRINT_STORAGE_KEY);
  });
});
