import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import axios from 'axios';
import SimilarJobsDialog from './SimilarJobsDialog';

vi.mock('axios');

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

describe('SimilarJobsDialog', () => {
  it('lists a match and opens that job on the pipeline', async () => {
    vi.mocked(axios.post).mockResolvedValue({
      data: {
        compared: true,
        matches: [
          {
            jobId: 'job-2',
            title: 'Oak rail',
            customerName: 'Celso',
            stageLabel: 'Estimate Sent',
            snippet: 'Scope: white oak',
            score: 0.82,
          },
        ],
      },
    });

    render(
      <MemoryRouter initialEntries={['/pipeline']}>
        <Routes>
          <Route
            path="/pipeline"
            element={
              <>
                <SimilarJobsDialog open onClose={() => {}} text="Scope: white oak rail" />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Oak rail · Celso')).toBeInTheDocument();
    expect(screen.getByText(/82% similar/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Oak rail/ }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/pipeline?jobId=job-2'));
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringMatching(/\/jobs\/similar$/),
      { text: 'Scope: white oak rail' },
    );
  });
});
