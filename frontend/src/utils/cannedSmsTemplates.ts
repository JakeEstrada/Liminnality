import api from './axios';
import {
  firstNameFromCustomer,
  formatPromptPhone,
  resolveCustomerPhone,
} from './pipelineSmsTemplates';

export type CannedSmsTemplate = {
  id?: string;
  name: string;
  body: string;
  enabled: boolean;
};

export type JobCardSmsContext = {
  customerName: string;
  firstName: string;
  email: string;
  emails: string;
  phone: string;
  address: string;
  job: string;
  gateCode: string;
  sender: string;
  company: string;
};

type AddressLike = { street?: string; city?: string; state?: string; zip?: string };
type EmailRow = { value?: string };
type PhoneRow = { value?: string };

export type JobCardSmsSource = {
  _id?: string;
  title?: string;
  jobAddress?: AddressLike;
  jobContact?: { email?: string; phone?: string };
  customerId?: {
    _id?: string;
    name?: string;
    primaryEmail?: string;
    emails?: string[];
    contactEmails?: EmailRow[];
    primaryPhone?: string;
    phones?: string[];
    contactPhones?: PhoneRow[];
    address?: AddressLike;
    gateCode?: string;
  } | string | null;
};

function uniqueTrimmed(values: Array<string | undefined | null>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = String(raw || '').trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function formatAddress(address?: AddressLike | null): string {
  if (!address) return '';
  return [address.street, address.city, address.state, address.zip].filter(Boolean).join(', ');
}

export function collectJobCardEmails(job?: JobCardSmsSource | null): string[] {
  const customer = job?.customerId && typeof job.customerId === 'object' ? job.customerId : null;
  const contactEmails = Array.isArray(customer?.contactEmails)
    ? customer.contactEmails.map((row) => row?.value)
    : [];
  const customerEmails = contactEmails.some((value) => String(value || '').trim())
    ? contactEmails
    : [customer?.primaryEmail, ...(Array.isArray(customer?.emails) ? customer.emails : [])];
  const live = uniqueTrimmed(customerEmails);
  if (live.length) return live;
  return uniqueTrimmed([job?.jobContact?.email]);
}

export function buildJobCardSmsContext(
  job: JobCardSmsSource | null | undefined,
  { senderName = '', companyName = '' }: { senderName?: string; companyName?: string } = {},
): JobCardSmsContext {
  const customer = job?.customerId && typeof job.customerId === 'object' ? job.customerId : null;
  const customerName = String(customer?.name || '').trim();
  const emails = collectJobCardEmails(job);
  const jobAddress = formatAddress(job?.jobAddress);
  const customerAddress = formatAddress(customer?.address);
  const rawPhone = resolveCustomerPhone(job);
  return {
    customerName,
    firstName: firstNameFromCustomer(customerName),
    email: emails[0] || '',
    emails: emails.join(', '),
    phone: formatPromptPhone(rawPhone) || rawPhone,
    address: jobAddress || customerAddress,
    job: String(job?.title || '').trim(),
    gateCode: String(customer?.gateCode || '').trim(),
    sender: senderName || '',
    company: companyName || 'San Clemente Woodworking',
  };
}

export function fillCannedSmsTemplate(body: string, context: JobCardSmsContext): string {
  const replacements: Record<string, string> = {
    customer: context.customerName || 'there',
    name: context.customerName || 'there',
    firstname: context.firstName || context.customerName || 'there',
    email: context.email || context.emails,
    emails: context.emails || context.email,
    phone: context.phone,
    address: context.address,
    job: context.job || context.customerName,
    jobtitle: context.job || context.customerName,
    title: context.job || context.customerName,
    gatecode: context.gateCode,
    gate: context.gateCode,
    sender: context.sender,
    company: context.company || 'San Clemente Woodworking',
  };
  return String(body || '').replace(/\{\{\s*([a-zA-Z]+)\s*\}\}|\{\s*([a-zA-Z]+)\s*\}/g, (match, a, b) => {
    const key = String(a || b || '').toLowerCase();
    if (Object.prototype.hasOwnProperty.call(replacements, key)) return replacements[key];
    return match;
  });
}

export async function fetchCannedSmsTemplates(): Promise<CannedSmsTemplate[]> {
  const { data } = await api.get('/tenants/canned-sms-templates');
  return Array.isArray(data?.templates) ? data.templates : [];
}

export async function saveCannedSmsTemplates(templates: CannedSmsTemplate[]): Promise<CannedSmsTemplate[]> {
  const { data } = await api.put('/tenants/canned-sms-templates', { templates });
  return Array.isArray(data?.templates) ? data.templates : [];
}
