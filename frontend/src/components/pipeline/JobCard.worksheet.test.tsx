import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import JobCard from './JobCard';

function renderCard(job: Record<string, unknown>) {
  return render(
    <ThemeProvider theme={createTheme({ palette: { mode: 'dark' } })}>
      <JobCard job={job} />
    </ThemeProvider>,
  );
}

describe('JobCard worksheet note', () => {
  it('draws a name in a light font when the worksheet note is not saved yet', () => {
    renderCard({ title: 'Darvin Medley', notes: [{ content: 'Called the customer' }] });
    const name = screen.getByText('Darvin Medley');
    expect(name).toHaveStyle({ fontWeight: '300', color: 'rgba(255, 255, 255, 0.42)' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('shows the saved worksheet note when the name is hovered', async () => {
    renderCard({
      title: 'Luci Vees',
      notes: [{ content: 'Scope: Install maple rail\nOptions: Post To Post', isWorksheet: true }],
    });
    const name = screen.getByText('Luci Vees');
    expect(name).toHaveStyle({ fontWeight: '500' });
    fireEvent.mouseOver(name);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Install maple rail');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Post To Post');
  });
});
