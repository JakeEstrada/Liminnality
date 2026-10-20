import { getPayPeriodForDate } from './payPeriod';
import { buildTimesheetRowsFromScans, defaultShiftProfile } from './rfidTimesheetScans';

const ryan = { id: 'ryan', name: 'Ryan', uids: ['u1'], pins: [] };

describe('manual payroll edits', () => {
  it('keeps a shorter manual clock-out after a later RFID punch', () => {
    const period = getPayPeriodForDate(new Date('2026-10-20T12:00:00'));
    const { rows } = buildTimesheetRowsFromScans(
      period,
      [
        { uid: 'u1', scannedAt: '2026-10-16T13:00:00' },
        { uid: 'u1', scannedAt: '2026-10-16T19:42:00' },
      ],
      ryan,
      defaultShiftProfile(),
      { Friday: { in: true, out: true } },
      [{ day: 'Friday', in: '600', out: '1145', breaks: '0', note: '' }],
    );

    const friday = rows.find((row) => row.day === 'Friday');
    expect(friday?.in).toBe('600');
    expect(friday?.out).toBe('1145');
  });

  it('keeps a manual zero day instead of filling RFID back in', () => {
    const period = getPayPeriodForDate(new Date('2026-10-20T12:00:00'));
    const { rows } = buildTimesheetRowsFromScans(
      period,
      [
        { uid: 'u1', scannedAt: '2026-10-19T13:00:00' },
        { uid: 'u1', scannedAt: '2026-10-19T20:00:00' },
      ],
      ryan,
      defaultShiftProfile(),
      { Monday: { in: true, out: true, breaks: true } },
      [{ day: 'Monday', in: '0', out: '0', breaks: '0', note: '' }],
    );

    const monday = rows.find((row) => row.day === 'Monday');
    expect(monday?.in).toBe('0');
    expect(monday?.out).toBe('0');
  });
});
