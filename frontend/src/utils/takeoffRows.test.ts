import { applyAddDoubleRow, newTakeoffRow, toggleTakeoffRowDouble } from './takeoffRows';

describe('takeoff double-height rows', () => {
  it('converts the first empty single row instead of appending', () => {
    const rows = [newTakeoffRow(), newTakeoffRow(), { item: 'W.O', qty: '1', material: '', description: '' }];
    const next = applyAddDoubleRow(rows);
    expect(next).toHaveLength(3);
    expect(next[0].doubleHeight).toBe(true);
    expect(next[1].doubleHeight).toBeUndefined();
  });

  it('appends a double row when every row already has content or is already double', () => {
    const rows = [
      { item: 'Cabinet', qty: '2', material: 'Maple', description: '', doubleHeight: true },
      { item: 'Crown', qty: '1', material: '', description: '' },
    ];
    const next = applyAddDoubleRow(rows);
    expect(next).toHaveLength(3);
    expect(next[2]).toEqual({ item: '', qty: '', material: '', description: '', doubleHeight: true });
  });

  it('toggles the first row to double height and back', () => {
    const rows = [newTakeoffRow(), newTakeoffRow()];
    const tall = toggleTakeoffRowDouble(rows, 0);
    expect(tall[0].doubleHeight).toBe(true);
    expect(tall[1].doubleHeight).toBeUndefined();
    const single = toggleTakeoffRowDouble(tall, 0);
    expect(single[0].doubleHeight).toBeUndefined();
  });
});
