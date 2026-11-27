import type { WorksheetContact } from './worksheetRead';

type Review = {
  scopeLines?: string[];
  options?: string[];
  materials?: string[];
  materialsVerify?: string;
  otherContacts?: WorksheetContact[];
  referral?: string;
  worksheetDate?: string;
  customerType?: string;
  notes?: string[];
};

function contactLine(contact: WorksheetContact) {
  return [contact?.name, contact?.phone, contact?.email, contact?.note].filter(Boolean).join(' · ');
}

/** The worksheet details that have no field of their own, saved as one job note. */
export function worksheetJobNote(review: Review | null | undefined, gateCode = '') {
  const lines: string[] = [];
  const code = String(gateCode || '').trim();
  if (code) lines.push(`Gate code: ${code}`);
  if (review?.scopeLines?.length) lines.push(`Scope: ${review.scopeLines.join(' ')}`);
  if (review?.options?.length) lines.push(`Options: ${review.options.join(', ')}`);
  (review?.materials || []).forEach((line) => {
    if (line) lines.push(line);
  });
  if (review?.materialsVerify) lines.push(review.materialsVerify);
  (review?.otherContacts || []).forEach((contact) => {
    const text = contactLine(contact);
    if (text) lines.push(`Other contact: ${text}`);
  });
  if (review?.referral) lines.push(`Ref: ${review.referral}`);
  if (review?.worksheetDate) lines.push(`Worksheet date: ${review.worksheetDate}`);
  if (review?.customerType === 'contractor') lines.push('Marked Contractor on the worksheet');
  (review?.notes || []).forEach((note) => {
    if (note) lines.push(note);
  });
  return lines.join('\n').slice(0, 2000);
}

const WORKSHEET_LINE =
  /^(?:Gate code:|Scope:|Options:|Other contact:|Ref:|Worksheet date:|Marked Contractor on the worksheet)/m;

type SavedNote = {
  content?: string;
  isWorksheet?: boolean;
  isSms?: boolean;
  isStageChange?: boolean;
  isAppointment?: boolean;
};

/** The worksheet note already stored on a job, if one has been saved. */
export function savedWorksheetNote(notes: SavedNote[] | null | undefined) {
  const parts: string[] = [];
  for (const note of notes || []) {
    if (!note || note.isSms || note.isStageChange || note.isAppointment) continue;
    const content = String(note.content || '').trim();
    if (!content) continue;
    if (!note.isWorksheet && !WORKSHEET_LINE.test(content)) continue;
    parts.push(content);
  }
  return parts.join('\n\n');
}
