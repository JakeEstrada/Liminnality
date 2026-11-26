import { getPayPeriodForDate } from './payPeriod';
import {
  buildTimesheetRowsFromScans,
  defaultShiftProfile,
  listRosterDirectory,
  mergeRfidRegistries,
  parseRosterNames,
  preferHourlyRate,
} from './rfidTimesheetScans';

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

describe('payroll roster', () => {
  const blaineTag = [{ _id: '1', uid: '51-71-34-152-206', displayName: 'Blaine' }];

  it('keeps a saved tag number when someone is taken off payroll', () => {
    const roster = [{ employeeKey: 'blaine', displayName: 'Blaine', onRoster: false }];
    expect(mergeRfidRegistries(blaineTag, [], [], roster)).toEqual([]);
    expect(listRosterDirectory(blaineTag, [], [], roster)).toEqual([
      expect.objectContaining({
        id: 'blaine',
        name: 'Blaine',
        onPayroll: false,
        uids: ['51-71-34-152-206'],
      }),
    ]);
  });

  it('adds a name to payroll before a tag is registered', () => {
    const people = mergeRfidRegistries(
      [],
      [],
      [],
      [{ employeeKey: 'carlos', displayName: 'Carlos', onRoster: true }],
    );
    expect(people).toEqual([{ id: 'carlos', name: 'Carlos', uids: [], pins: [] }]);
  });

  it('reads names from a list or a name column and skips duplicates', () => {
    expect(parseRosterNames('Ryan\nBlaine\nryan\n')).toEqual(['Ryan', 'Blaine']);
    expect(parseRosterNames('Name,Phone\nShawn,(714) 555-0100\n')).toEqual(['Shawn']);
    expect(parseRosterNames('Felix, Daniel, Jake')).toEqual(['Felix', 'Daniel', 'Jake']);
  });
});

describe('hourly rate', () => {
  it('keeps a week rate and falls back to the employee rate when the week is blank or zero', () => {
    expect(preferHourlyRate('22', '30')).toBe('22');
    expect(preferHourlyRate('', '22.50')).toBe('22.50');
    expect(preferHourlyRate('0', '22')).toBe('22');
    expect(preferHourlyRate('0.00', '')).toBe('');
    expect(preferHourlyRate('  ', '18')).toBe('18');
    expect(preferHourlyRate('22.', '')).toBe('22');
  });
});
