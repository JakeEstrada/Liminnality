import { nanpDigitsOnly } from './phoneFormat';

export const SMS_CONVERSATION_ALIASES_KEY = 'paarth.sms.conversation-aliases';

export function conversationPhoneKey(phone: string) {
  const digits = nanpDigitsOnly(phone);
  if (digits.length === 10) return digits;
  return String(phone || '').trim().toLowerCase() || 'unknown';
}

function storageKey(tenantId?: string | null) {
  const tenant = String(tenantId || '').trim() || 'default';
  return `${SMS_CONVERSATION_ALIASES_KEY}.${tenant}`;
}

export function loadConversationAliases(tenantId?: string | null): Record<string, string> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(storageKey(tenantId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const name = String(value || '').trim();
      if (key && name) out[key] = name;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveConversationAliases(tenantId: string | null | undefined, aliases: Record<string, string>) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(storageKey(tenantId), JSON.stringify(aliases));
}

export function setConversationAlias(
  tenantId: string | null | undefined,
  phoneKey: string,
  name: string,
): Record<string, string> {
  const aliases = loadConversationAliases(tenantId);
  const trimmed = String(name || '').trim();
  if (!phoneKey || phoneKey === 'unknown') return aliases;
  if (!trimmed) delete aliases[phoneKey];
  else aliases[phoneKey] = trimmed;
  saveConversationAliases(tenantId, aliases);
  return aliases;
}

export function addPhoneName(map: Record<string, string>, phone: unknown, name: unknown) {
  const key = conversationPhoneKey(String(phone || ''));
  const label = String(name || '').trim();
  if (!key || key === 'unknown' || !label) return;
  if (!map[key]) map[key] = label;
}

export function namesFromCustomers(
  customers: Array<{
    name?: string;
    primaryPhone?: string;
    phones?: string[];
    contactPhones?: Array<{ value?: string }>;
  }>,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const customer of customers || []) {
    const name = String(customer?.name || '').trim();
    if (!name) continue;
    addPhoneName(map, customer.primaryPhone, name);
    for (const phone of customer.phones || []) addPhoneName(map, phone, name);
    for (const row of customer.contactPhones || []) addPhoneName(map, row?.value, name);
  }
  return map;
}

export function namesFromEmployees(
  employees: Array<{ name?: string; mobile?: string }>,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const employee of employees || []) {
    addPhoneName(map, employee?.mobile, employee?.name);
  }
  return map;
}

export function mergeConversationNames(
  live: Record<string, string>,
  aliases: Record<string, string>,
): Record<string, string> {
  return { ...live, ...aliases };
}
