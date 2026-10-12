import api from '../utils/axios';

export type AssistantVoiceResult = {
  reply: string;
  path?: string;
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
  return { reply, path: typeof path === 'string' ? path : undefined };
}
