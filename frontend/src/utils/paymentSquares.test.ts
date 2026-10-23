import { paymentSquaresForJob } from './paymentSchedule';

describe('pipeline payment squares', () => {
  it('shows deposit and final for the standard 40 / 60 job', () => {
    const squares = paymentSquaresForJob({
      valueContracted: 10000,
      paymentSchedule: {
        type: 'standard_40_60',
        items: [
          { label: 'Deposit', dueType: 'deposit', status: 'paid', percentage: 40 },
          { label: 'Final Balance', dueType: 'final', status: 'pending', percentage: 60 },
        ],
      },
    });
    expect(squares).toEqual([
      { label: 'Deposit', paid: true },
      { label: 'Final Balance', paid: false },
    ]);
  });

  it('shows three squares for deposit, progress, and final', () => {
    const squares = paymentSquaresForJob({
      valueContracted: 10000,
      paymentSchedule: {
        type: 'custom',
        items: [
          { label: 'Deposit', dueType: 'deposit', status: 'paid', percentage: 30 },
          { label: 'Progress', dueType: 'milestone', status: 'pending', percentage: 40 },
          { label: 'Final', dueType: 'final', status: 'pending', percentage: 30 },
        ],
      },
    });
    expect(squares.map((row) => row.label)).toEqual(['Deposit', 'Progress', 'Final']);
    expect(squares.map((row) => row.paid)).toEqual([true, false, false]);
  });
});
