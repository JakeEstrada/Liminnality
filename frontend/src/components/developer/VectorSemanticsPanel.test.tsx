import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import api from '../../utils/axios';
import VectorSemanticsPanel from './VectorSemanticsPanel';

vi.mock('../../utils/axios', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

vi.mock('../../voice/browserSpeech', () => ({
  cancelSpeech: vi.fn(),
  collectTranscript: vi.fn(() => ({ finalText: '', interimText: '' })),
  createSpeechRecognition: vi.fn(),
  isSpeechRecognitionSupported: () => false,
  speakText: vi.fn(),
}));

vi.mock('../../voice/neuralSpeech', () => ({
  unlockNeuralAudio: vi.fn(),
}));

vi.mock('../../voice/micClaim', () => ({
  claimMicrophone: vi.fn(),
  releaseMicrophone: vi.fn(),
}));

const page = {
  empty: false,
  model: 'text-embedding-3-small',
  storedLines: 4,
  jobCount: 3,
  jobs: [
    { jobId: 'job-a', memoryId: 'line-a', jobTitle: 'North stair rail', customerName: 'North', lineCount: 2 },
    { jobId: 'job-b', memoryId: 'line-c', jobTitle: 'Scott Lester', customerName: 'Scott Lester', lineCount: 1 },
    { jobId: 'job-c', memoryId: 'line-d', jobTitle: 'Paint landing', customerName: null, lineCount: 1 },
  ],
  example: {
    memoryId: 'line-a',
    jobId: 'job-a',
    jobTitle: 'North stair rail',
    customerName: 'North',
    kindLabel: 'worksheet line',
    excerpt: 'Scope: Install iron balusters on the stair',
    text: 'Scope: Install iron balusters on the stair',
    dimensions: 1536,
    preview: [0.15, -0.22, 0.31],
    previewText: '<0.15, -0.22, 0.31, ……>',
  },
  neighbors: [
    {
      memoryId: 'line-c',
      jobId: 'job-b',
      jobTitle: 'Scott Lester',
      kindLabel: 'note',
      excerpt: 'Order iron balusters from HOF',
      score: 0.62,
    },
  ],
  sameJob: [],
  detail: [
    'North stair rail is on the page as <0.15, -0.22, 0.31, ……>. A number in that list is not a word.',
  ],
};

describe('Vector semantics', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
  });

  it('shows a job vector and answers a question about it', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: page });
    vi.mocked(api.post).mockResolvedValue({
      data: { reply: 'Scott Lester scores 0.62 because both lines carry iron balusters.' },
    });

    render(<VectorSemanticsPanel />);

    expect(await screen.findByText('3 of 3 jobs')).toBeInTheDocument();
    expect(screen.getAllByText('North stair rail').length).toBeGreaterThan(0);
    expect(screen.getByText('Paint landing')).toBeInTheDocument();
    expect(screen.getByText('<0.15, -0.22, 0.31, ……>')).toBeInTheDocument();
    expect(screen.getByText(/not a word/)).toBeInTheDocument();
    expect(screen.getAllByText('Scott Lester').length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText('Ask about this vector'), {
      target: { value: 'Why is the closest job similar?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send vector question' }));

    expect(await screen.findByText(/Scott Lester scores 0.62/)).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith(
      '/developer-tasks/vectors/ask',
      expect.objectContaining({
        memoryId: 'line-a',
        question: 'Why is the closest job similar?',
      }),
    );
  });
});
