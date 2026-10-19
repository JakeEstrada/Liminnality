import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import CalendarBenchPrintPage from '../pages/CalendarBenchPrintPage';
import {
  CALENDAR_BENCH_PRINT_STORAGE_KEY,
  buildCalendarBenchPrintData,
  writeCalendarBenchPrintData,
} from './calendarBenchPrint';

function job(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Kitchen remodel',
    valueContracted: 10000,
    customerId: { name: 'Ada West', address: { street: '12 Oak St', city: 'San Clemente', state: 'CA', zip: '92672' } },
    ...overrides,
  };
}

describe('calendar bench print', () => {
  it('shows address and 40 / 60 for the standard split', () => {
    const data = buildCalendarBenchPrintData([
      job({
        paymentSchedule: {
          type: 'standard_40_60',
          items: [
            { label: 'Deposit', percentage: 40, dueType: 'deposit', status: 'paid', paidAt: '2026-10-01T12:00:00' },
            { label: 'Final Balance', percentage: 60, dueType: 'final', status: 'pending' },
          ],
        },
      }),
    ]);

    expect(data.rows[0].address).toContain('12 Oak St');
    expect(data.rows[0].scheduleShort).toBe('40 / 60');
    expect(data.rows[0].scheduleDetail).toBe('Deposit 40% · Final 60%');
    expect(data.rows[0].depositDate).toBe('10/1/2026');
  });

  it('fills address from customer extra addresses or geocoded source', () => {
    const fromExtra = buildCalendarBenchPrintData([
      job({
        customerId: {
          name: 'Ada West',
          addresses: [{ fullAddress: '88 Avenida Presidio, San Clemente, CA 92672' }],
        },
      }),
    ]);
    expect(fromExtra.rows[0].address).toContain('88 Avenida Presidio');

    const fromGeo = buildCalendarBenchPrintData([
      job({
        customerId: { name: 'Ada West' },
        geo: { sourceAddress: '200 Avenida Del Mar, San Clemente, CA 92672' },
      }),
    ]);
    expect(fromGeo.rows[0].address).toContain('200 Avenida Del Mar');
  });

  it('shows a custom multi-payment split as percents', () => {
    const data = buildCalendarBenchPrintData([
      job({
        paymentSchedule: {
          type: 'custom',
          items: [
            { label: 'Deposit', percentage: 30, dueType: 'deposit', status: 'paid', paidAt: '2026-09-02T12:00:00' },
            { label: 'Progress', percentage: 40, dueType: 'milestone', status: 'paid', paidAt: '2026-09-20T12:00:00' },
            { label: 'Final', percentage: 30, dueType: 'final', status: 'pending' },
          ],
        },
      }),
    ]);

    expect(data.rows[0].scheduleShort).toBe('30 / 40 / 30');
    expect(data.rows[0].scheduleDetail).toBe('Deposit 30% · Progress 40% · Final 30%');
    expect(data.rows[0].payments).toContain('Deposit 9/2/2026');
    expect(data.rows[0].payments).toContain('Progress 9/20/2026');
  });

  it('renders address and schedule columns on the worksheet', () => {
    writeCalendarBenchPrintData(
      buildCalendarBenchPrintData([
        job({
          paymentSchedule: {
            type: 'standard_40_60',
            items: [
              { label: 'Deposit', percentage: 40, dueType: 'deposit', status: 'paid', paidAt: '2026-10-01T12:00:00' },
              { label: 'Final Balance', percentage: 60, dueType: 'final', status: 'pending' },
            ],
          },
        }),
      ]),
    );

    render(
      <MemoryRouter>
        <CalendarBenchPrintPage />
      </MemoryRouter>,
    );

    expect(screen.getByText('Address')).toBeInTheDocument();
    expect(screen.getByText('Schedule')).toBeInTheDocument();
    expect(screen.getByText(/12 Oak St/)).toBeInTheDocument();
    expect(screen.getByText('40 / 60')).toBeInTheDocument();
    expect(screen.getByText('Deposit 40% · Final 60%')).toBeInTheDocument();

    sessionStorage.removeItem(CALENDAR_BENCH_PRINT_STORAGE_KEY);
    localStorage.removeItem(CALENDAR_BENCH_PRINT_STORAGE_KEY);
  });
});
