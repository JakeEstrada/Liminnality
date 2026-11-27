import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import axios from 'axios';
import AddJobModal from './AddJobModal';
import { useWorksheetReading } from '../../hooks/useWorksheetReading';

vi.mock('axios');
vi.mock('../../hooks/useWorksheetReading', () => ({ useWorksheetReading: vi.fn() }));

const worksheetFile = new File(['%PDF-1.3'], 'SCWW_New_era_const_worksheet__Bradford.pdf', {
  type: 'application/pdf',
});

const bradfordReading = {
  draft: {
    title: '4632 E Bradford · White oak rail system',
    customerName: 'Celso Montillo',
    customerPhone: '7143911828',
    customerEmail: 'celso.montillo@aol',
    street: '4632 E Bradford',
    city: 'Orange',
    state: '',
    zip: '',
    valueEstimated: '11900',
    source: 'referral',
    referralCompany: 'Daniel',
  },
  verify: {
    customerName: 'Last name taken from the email',
    customerPhone: 'Could also read as "714-361-1828"',
    customerEmail: 'Email looks incomplete',
  },
  suggestions: { customerEmail: 'celso.montillo@aol.com' },
  review: {
    scopeLines: ['Install 30 Ft white oak rail system w/ Iron balusters As described'],
    options: ['Post To Post'],
    materials: ['Handrail: White Oak, qty 30, 6084', 'Balusters: White Oak, Blk, qty 75, Jvon Alto'],
    materialsVerify: 'Balusters quantity could be 75 or 25',
    otherContacts: [{ name: 'Joseph', phone: '909-846-8804', email: '', note: 'H.', verify: 'Phone could also read as 909-846-8864' }],
    referral: 'Daniel',
    worksheetDate: '11-2-26',
    customerType: 'customer',
    notes: [],
  },
  pageTurn: 0,
  isScwwWorksheet: true,
};

const savedCelso = {
  _id: 'cust-1',
  name: 'Celso Montillo',
  primaryPhone: '(714)555-0100',
  primaryEmail: 'celso.montillo@aol.com',
  address: { street: '100 Old St', city: 'Orange', state: 'CA', zip: '92867' },
};

function mockReading(overrides = {}) {
  vi.mocked(useWorksheetReading).mockReturnValue({
    file: worksheetFile,
    status: 'done',
    previewUrl: 'blob:preview',
    reading: bradfordReading,
    error: '',
    skip: vi.fn(),
    ...overrides,
  });
}

function mockApi(customers = [], duplicates = []) {
  vi.mocked(axios.get).mockImplementation((url) => {
    if (String(url).includes('/customers')) return Promise.resolve({ data: { customers } });
    if (String(url).includes('/possible-duplicates')) return Promise.resolve({ data: { matches: duplicates } });
    return Promise.resolve({ data: [] });
  });
  vi.mocked(axios.post).mockImplementation((url) => {
    const path = String(url);
    if (path.endsWith('/customers')) return Promise.resolve({ data: { _id: 'cust-new' } });
    if (path.endsWith('/jobs')) {
      return Promise.resolve({ data: { _id: 'job-1', geo: { status: 'ok', lat: 33.8, lng: -117.8 } } });
    }
    return Promise.resolve({ data: {} });
  });
  vi.mocked(axios.patch).mockResolvedValue({ data: {} });
}

function renderModal() {
  const onJobCreated = vi.fn();
  render(<AddJobModal open onClose={vi.fn()} onJobCreated={onJobCreated} worksheetFile={worksheetFile} />);
  return { onJobCreated };
}

function postedTo(suffix) {
  return vi.mocked(axios.post).mock.calls.filter(([url]) => String(url).endsWith(suffix));
}

describe('AddJobModal worksheet draft', () => {
  beforeEach(() => {
    vi.mocked(axios.get).mockReset();
    vi.mocked(axios.post).mockReset();
    vi.mocked(axios.patch).mockReset();
  });

  it('fills an editable draft beside the worksheet and flags what needs checking', async () => {
    mockReading();
    mockApi();
    renderModal();

    expect(await screen.findByDisplayValue('Orange')).toBeInTheDocument();
    expect(screen.getByLabelText(/Estimated Value/)).toHaveValue('11900');
    expect(screen.getByLabelText(/Job Title/)).toHaveValue('4632 E Bradford · White oak rail system');
    expect(screen.getByLabelText(/Description/)).toHaveValue('');
    expect(screen.getByLabelText(/Street Address/)).toHaveValue('4632 E Bradford');
    expect(screen.getByRole('textbox', { name: 'Email' })).toHaveValue('celso.montillo@aol');

    expect(screen.getByAltText(/Worksheet SCWW_New_era/)).toHaveAttribute('src', 'blob:preview');
    expect(screen.getByText('Also on the worksheet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Find similar jobs' })).toBeInTheDocument();
    expect(screen.getByText('Install 30 Ft white oak rail system w/ Iron balusters As described')).toBeInTheDocument();
    expect(screen.getByText('Joseph · 909-846-8804 · H.', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByLabelText('Balusters quantity could be 75 or 25')).toHaveTextContent('Verify');

    const emailField = screen.getByRole('textbox', { name: 'Email' }).closest('.MuiFormControl-root');
    expect(within(emailField).getByText('Verify')).toBeInTheDocument();
    expect(within(emailField).getByText('Email looks incomplete')).toBeInTheDocument();
    expect(within(emailField).getByRole('button', { name: 'Use celso.montillo@aol.com' })).toBeInTheDocument();

    const cityField = screen.getByLabelText(/City/).closest('.MuiFormControl-root');
    expect(within(cityField).queryByText('Verify')).not.toBeInTheDocument();
    expect(screen.getByText(/Check the 3 fields marked Verify/)).toBeInTheDocument();

    expect(axios.post).not.toHaveBeenCalled();
  });

  it('keeps the incomplete email from being saved until it is fixed', async () => {
    mockReading();
    mockApi();
    renderModal();
    await screen.findByDisplayValue('Orange');

    fireEvent.click(screen.getByRole('button', { name: 'Create Job' }));
    expect(await screen.findByText('This email looks incomplete. Fix it or clear it.')).toBeInTheDocument();
    expect(axios.post).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Use celso.montillo@aol.com' }));
    expect(screen.getByRole('textbox', { name: 'Email' })).toHaveValue('celso.montillo@aol.com');
    fireEvent.click(screen.getByRole('button', { name: 'Create Job' }));

    await waitFor(() => expect(postedTo('/jobs')).toHaveLength(1));
    expect(postedTo('/customers')[0][1]).toMatchObject({
      name: 'Celso Montillo',
      primaryEmail: 'celso.montillo@aol.com',
      address: { street: '4632 E Bradford', city: 'Orange' },
    });
    expect(postedTo('/jobs')[0][1]).toMatchObject({
      title: '4632 E Bradford · White oak rail system',
      description: '',
      customerId: 'cust-new',
      valueEstimated: 11900,
      source: 'referral',
      referralCompany: 'Daniel',
      jobAddress: { street: '4632 E Bradford', city: 'Orange' },
      notes: [
        {
          isWorksheet: true,
          content: [
            'Scope: Install 30 Ft white oak rail system w/ Iron balusters As described',
            'Options: Post To Post',
            'Handrail: White Oak, qty 30, 6084',
            'Balusters: White Oak, Blk, qty 75, Jvon Alto',
            'Balusters quantity could be 75 or 25',
            'Other contact: Joseph · 909-846-8804 · H.',
            'Ref: Daniel',
            'Worksheet date: 11-2-26',
          ].join('\n'),
        },
      ],
    });
    await waitFor(() => expect(postedTo('/files/upload')).toHaveLength(1));
    expect(postedTo('/files/upload')[0][1].get('file').name).toBe(worksheetFile.name);
  });

  it('saves the gate code on a new customer and in the job note', async () => {
    mockReading({
      reading: {
        ...bradfordReading,
        draft: { ...bradfordReading.draft, customerEmail: 'celso.montillo@aol.com', gateCode: '4455' },
        verify: { gateCode: '4 or 9' },
        suggestions: {},
        review: { ...bradfordReading.review, gateCode: '4455', notes: ['Dogs in the back'] },
      },
    });
    mockApi();
    renderModal();

    const gateField = (await screen.findByLabelText(/Gate code/)).closest('.MuiFormControl-root');
    expect(screen.getByLabelText(/Gate code/)).toHaveValue('4455');
    expect(within(gateField).getByText('Verify')).toBeInTheDocument();
    expect(screen.getByText('Saved as a note on the job.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Create Job' }));
    await waitFor(() => expect(postedTo('/customers')).toHaveLength(1));
    expect(postedTo('/customers')[0][1]).toMatchObject({ gateCode: '4455' });
    expect(postedTo('/jobs')[0][1].notes[0].content).toMatch(/^Gate code: 4455/);
    expect(postedTo('/jobs')[0][1].notes[0].content).toMatch(/Dogs in the back/);
    expect(postedTo('/jobs')[0][1].description).toBe('');
  });

  it('fills a blank saved gate code without asking', async () => {
    mockReading({
      reading: {
        ...bradfordReading,
        draft: { ...bradfordReading.draft, customerEmail: 'celso.montillo@aol.com', gateCode: '4455' },
        verify: {},
        suggestions: {},
        review: { ...bradfordReading.review, gateCode: '4455' },
      },
    });
    mockApi([savedCelso]);
    renderModal();
    await screen.findByDisplayValue('4455');

    fireEvent.click(screen.getByRole('button', { name: 'Create Job' }));
    await waitFor(() => expect(axios.patch).toHaveBeenCalledTimes(1));
    expect(vi.mocked(axios.patch).mock.calls[0][1]).toEqual({ gateCode: '4455' });
    expect(postedTo('/jobs')[0][1].notes[0].content).toMatch(/^Gate code: 4455/);
  });

  it('asks before replacing a saved gate code', async () => {
    mockReading({
      reading: {
        ...bradfordReading,
        draft: {
          ...bradfordReading.draft,
          customerEmail: 'celso.montillo@aol.com',
          customerPhone: '7145550100',
          street: '100 Old St',
          city: 'Orange',
          state: 'CA',
          zip: '92867',
          gateCode: '4455',
        },
        verify: {},
        suggestions: {},
        review: { ...bradfordReading.review, gateCode: '4455' },
      },
    });
    mockApi([{ ...savedCelso, gateCode: '9999' }]);
    renderModal();

    expect(await screen.findByText(/Gate code: saved 9999, new 4455/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create Job' }));
    await waitFor(() => expect(postedTo('/jobs')).toHaveLength(1));
    expect(axios.patch).not.toHaveBeenCalled();
    expect(postedTo('/jobs')[0][1].notes[0].content).toMatch(/^Gate code: 4455/);

    fireEvent.click(screen.getByRole('checkbox', { name: /Update Celso Montillo's saved customer details/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Create Job' }));
    await waitFor(() => expect(axios.patch).toHaveBeenCalledTimes(1));
    expect(vi.mocked(axios.patch).mock.calls[0][1]).toEqual({ gateCode: '4455' });
  });

  it('asks before changing a saved customer it matched', async () => {
    mockReading({
      reading: {
        ...bradfordReading,
        draft: { ...bradfordReading.draft, customerEmail: 'celso.montillo@aol.com' },
        verify: {},
        suggestions: {},
      },
    });
    mockApi([savedCelso]);
    renderModal();

    expect(await screen.findByText(/This differs from Celso Montillo's saved details/)).toBeInTheDocument();
    expect(screen.getByText(/Phone: saved \(714\)555-0100, new \(714\)391-1828/)).toBeInTheDocument();
    expect(screen.getByText(/Address: saved 100 Old St, Orange, CA 92867, new 4632 E Bradford, Orange, CA 92867/)).toBeInTheDocument();
    const confirm = screen.getByRole('checkbox', { name: /Update Celso Montillo's saved customer details/ });
    expect(confirm).not.toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Create Job' }));
    await waitFor(() => expect(postedTo('/jobs')).toHaveLength(1));
    expect(axios.patch).not.toHaveBeenCalled();
    expect(postedTo('/customers')).toHaveLength(0);
    expect(postedTo('/jobs')[0][1]).toMatchObject({ customerId: 'cust-1', jobContact: { phone: '(714)391-1828' } });
  });

  it('updates the saved customer only after the box is checked', async () => {
    mockReading({ reading: { ...bradfordReading, verify: {}, suggestions: {}, draft: { ...bradfordReading.draft, customerName: 'Celso', customerEmail: 'celso.montillo@aol.com' } } });
    mockApi([savedCelso]);
    renderModal();

    expect(await screen.findByText('This may be a saved customer')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Use this customer' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: /Update Celso Montillo's saved customer details/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Create Job' }));

    await waitFor(() => expect(axios.patch).toHaveBeenCalledTimes(1));
    expect(vi.mocked(axios.patch).mock.calls[0][0]).toMatch(/\/customers\/cust-1$/);
    expect(vi.mocked(axios.patch).mock.calls[0][1]).toEqual({
      primaryPhone: '(714)391-1828',
      address: { street: '4632 E Bradford', city: 'Orange', state: 'CA', zip: '92867' },
    });
    await waitFor(() => expect(postedTo('/jobs')).toHaveLength(1));
  });

  it('warns before adding a job when that customer and address already exist', async () => {
    mockReading({
      reading: {
        ...bradfordReading,
        draft: { ...bradfordReading.draft, customerEmail: 'celso.montillo@aol.com' },
        verify: {},
        suggestions: {},
      },
    });
    mockApi([], [
      {
        id: 'job-old',
        title: '4632 E Bradford · White oak rail system',
        customerName: 'Celso Montillo',
        street: '4632 E Bradford',
        city: 'Orange',
        stateLabel: 'Estimate In Progress',
      },
    ]);
    renderModal();

    expect(await screen.findByText('Celso Montillo at 4632 E Bradford, Orange already exists.')).toBeInTheDocument();
    expect(screen.getByText(/Estimate In Progress/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Create Job' }));
    expect(await screen.findByRole('heading', { name: 'This customer and address already exist' })).toBeInTheDocument();
    expect(screen.getByText(/Are you sure you want to add another job/)).toBeInTheDocument();
    expect(postedTo('/jobs')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Go back' }));
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'This customer and address already exist' })).not.toBeInTheDocument();
    });
    expect(postedTo('/jobs')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Create Job' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add anyway' }));
    await waitFor(() => expect(postedTo('/jobs')).toHaveLength(1));
  });

  it('opens the same form with the worksheet attached when reading fails', async () => {
    mockReading({ status: 'failed', reading: null, error: 'Could not read that worksheet' });
    mockApi();
    renderModal();

    expect(await screen.findByText(/Could not read that worksheet\. Enter the job by hand/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Job Title/)).toHaveValue('');
    expect(screen.getByRole('button', { name: `Remove ${worksheetFile.name}` })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Job' })).toBeEnabled();
  });

  it('shows the reading indicator and holds Create Job while the worksheet is read', () => {
    mockReading({ status: 'reading', reading: null, previewUrl: '' });
    mockApi();
    renderModal();

    expect(screen.getByText('Reading the worksheet…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Job' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Enter it by hand' })).toBeInTheDocument();
  });
});
