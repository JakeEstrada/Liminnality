import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import axios from 'axios';
import WorksheetFileMenu from './WorksheetFileNoteButton';

vi.mock('axios');
vi.mock('react-hot-toast', () => ({
  default: { loading: () => 'toast', success: vi.fn(), error: vi.fn() },
}));
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { _id: 'user-1', name: 'Jake' } }),
}));
vi.mock('../../utils/worksheetRead', () => ({
  renderWorksheet: vi.fn(async () => ({})),
  extractWorksheet: vi.fn(async () => ({
    reading: {
      review: { scopeLines: ['Install oak rail'], options: ['Post To Post'] },
      draft: { gateCode: '' },
    },
  })),
}));

describe('WorksheetFileMenu', () => {
  beforeEach(() => {
    vi.mocked(axios.get).mockReset();
    vi.mocked(axios.patch).mockReset();
    vi.mocked(axios.isAxiosError).mockReturnValue(false);
  });

  it('saves the worksheet note and leaves the job fields alone', async () => {
    vi.mocked(axios.get).mockImplementation((url) => {
      if (String(url).includes('/files/')) return Promise.resolve({ data: new Blob(['%PDF']) });
      return Promise.resolve({
        data: {
          _id: 'job-1',
          title: 'Doug Ray',
          valueContracted: 10150,
          notes: [{ _id: 'n1', content: 'Called the customer' }],
        },
      });
    });
    vi.mocked(axios.patch).mockResolvedValue({
      data: { _id: 'job-1', title: 'Doug Ray', notes: [] },
    });
    const onSaved = vi.fn();

    render(
      <WorksheetFileMenu
        file={{ _id: 'file-1', originalName: 'SCWW Doug ray worksheet.pdf', mimetype: 'application/pdf' }}
        jobId="job-1"
        open
        top={10}
        left={10}
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    );

    fireEvent.click(screen.getByRole('menuitem', { name: 'Scrape worksheet' }));

    await waitFor(() => expect(axios.patch).toHaveBeenCalledTimes(1));
    const [url, body] = vi.mocked(axios.patch).mock.calls[0];
    expect(String(url)).toMatch(/\/jobs\/job-1$/);
    expect(body).not.toHaveProperty('title');
    expect(body).not.toHaveProperty('valueContracted');
    expect(body.notes).toEqual([
      { _id: 'n1', content: 'Called the customer' },
      { content: 'Scope: Install oak rail\nOptions: Post To Post', isWorksheet: true },
    ]);
    expect(onSaved).toHaveBeenCalledWith({ _id: 'job-1', title: 'Doug Ray', notes: [] });
  });
});
