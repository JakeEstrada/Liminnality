function contactLine(contact) {
  return [contact?.name, contact?.phone, contact?.email, contact?.note].filter(Boolean).join(' · ');
}

/** The worksheet details that have no field of their own, saved as one job note. */
function worksheetJobNote(review, gateCode = '') {
  const lines = [];
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

module.exports = { worksheetJobNote };
