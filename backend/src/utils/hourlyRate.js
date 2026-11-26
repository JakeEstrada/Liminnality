function shouldStoreHourlyRate(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return false;
  const amount = Number(raw);
  return Number.isFinite(amount) && amount > 0;
}

module.exports = { shouldStoreHourlyRate };
