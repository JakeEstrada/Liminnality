import api from '../utils/axios';
import { parseJobOverlayPath, parseOpenJobAction, type JobOverlayCommand } from './jobOverlayBus';
import { parseMapShowAction, type MapShowCommand } from './mapCommandBus';

export type AssistantVoiceResult = {
  reply: string;
  path?: string;
  mapShow?: MapShowCommand;
  openJob?: JobOverlayCommand;
};

export function spokenAssistantReply(raw: string) {
  const text = String(raw || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_#`]/g, '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  if (text.length <= 800) return text;
  return `${text.slice(0, 797).replace(/\s+\S*$/, '')}.`;
}

export async function askLiminalityAssistant(
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  spoken: string,
): Promise<AssistantVoiceResult> {
  const messages = [...history, { role: 'user' as const, content: spoken }].slice(-8);
  const pagePath = typeof window !== 'undefined' ? `${window.location.pathname}${window.location.search}` : '';
  const { data } = await api.post('/assistant/chat', { messages, voice: true, pagePath });
  const reply = spokenAssistantReply(typeof data?.reply === 'string' ? data.reply : '');
  const actions = Array.isArray(data?.actions) ? data.actions : [];
  const path = actions.find((row: { type?: string; path?: string }) => row?.type === 'navigate' && row.path)?.path;
  const mapShow = parseMapShowAction(actions.find((row: { type?: string }) => row?.type === 'map_show'));
  const openJob =
    parseOpenJobAction(actions.find((row: { type?: string }) => row?.type === 'open_job')) ||
    parseJobOverlayPath(typeof path === 'string' ? path : undefined);
  const nextPath = mapShow?.path || (typeof path === 'string' ? path : undefined);
  return {
    reply,
    path: openJob ? undefined : nextPath,
    mapShow,
    openJob: openJob || undefined,
  };
}
