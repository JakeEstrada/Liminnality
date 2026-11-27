import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import api from '../../utils/axios';
import { createSpeechRecognition, speakText } from '../../voice/browserSpeech';
import { applyJobOverlayActions } from '../../voice/jobOverlayBus';
import SiteAssistantChat from './SiteAssistantChat';

vi.mock('../../utils/axios', () => ({
  default: { post: vi.fn() },
}));

vi.mock('../../voice/browserSpeech', () => ({
  cancelSpeech: vi.fn(),
  collectTranscript: (event) => ({
    finalText: event?.finalText || '',
    interimText: event?.interimText || '',
  }),
  createSpeechRecognition: vi.fn(),
  isSpeechRecognitionSupported: () => true,
  speakText: vi.fn(async () => {}),
}));

vi.mock('../../voice/neuralSpeech', () => ({
  unlockNeuralAudio: vi.fn(),
}));

vi.mock('../../voice/mapCommandBus', () => ({
  applyMapShow: vi.fn(),
  parseMapShowAction: () => null,
  startMapTour: vi.fn(),
}));

vi.mock('../../voice/jobOverlayBus', () => ({
  applyJobOverlayActions: vi.fn(),
  parseJobOverlayPath: () => null,
}));

describe('Liminality help voice', () => {
  beforeEach(() => {
    vi.mocked(api.post).mockReset();
    vi.mocked(speakText).mockClear();
    vi.mocked(createSpeechRecognition).mockReset();
    vi.mocked(applyJobOverlayActions).mockClear();
  });

  it('listens, asks in voice, and speaks the answer', async () => {
    let recognition;
    vi.mocked(createSpeechRecognition).mockImplementation(() => {
      recognition = {
        start: vi.fn(),
        stop: vi.fn(),
        onresult: null,
        onerror: null,
        onend: null,
      };
      return recognition;
    });
    vi.mocked(api.post).mockResolvedValue({
      data: { reply: 'A vector is 1536 numbers for one whole line.', actions: [] },
    });

    render(
      <MemoryRouter>
        <SiteAssistantChat />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open help assistant' }));
    fireEvent.click(screen.getByRole('button', { name: 'Talk with Liminality' }));
    expect(recognition.start).toHaveBeenCalled();

    await act(async () => {
      recognition.onresult({ finalText: 'What is a vector?' });
    });

    expect(await screen.findByText('What is a vector?')).toBeInTheDocument();
    expect(await screen.findByText('A vector is 1536 numbers for one whole line.')).toBeInTheDocument();
    await waitFor(() => expect(speakText).toHaveBeenCalledWith('A vector is 1536 numbers for one whole line.'));
    expect(api.post).toHaveBeenCalledWith(
      '/assistant/chat',
      expect.objectContaining({
        voice: true,
        messages: [expect.objectContaining({ role: 'user', content: 'What is a vector?' })],
      }),
    );
  });

  it('answers a typed question without opening the job', async () => {
    vi.mocked(api.post).mockResolvedValue({
      data: {
        reply: 'Hendrickson is a white oak rail with iron balusters.',
        actions: [{ type: 'open_job', jobId: 'abc123', tab: 'files' }],
      },
    });

    render(
      <MemoryRouter>
        <SiteAssistantChat />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open help assistant' }));
    fireEvent.change(screen.getByPlaceholderText('Ask about payments, jobs, or how search works'), {
      target: { value: 'Tell me about the Hendrickson job' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('Hendrickson is a white oak rail with iron balusters.')).toBeInTheDocument();
    expect(applyJobOverlayActions).toHaveBeenCalledWith([]);
    expect(api.post).toHaveBeenCalledWith(
      '/assistant/chat',
      expect.objectContaining({ voice: false }),
    );
  });
});
