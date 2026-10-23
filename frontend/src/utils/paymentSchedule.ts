export function roundMoney(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

/** Always show amounts to the penny — never round to whole dollars for display. */
export function formatMoney(value) {
  const n = Number(value);
  const safe = Number.isFinite(n) ? n : 0;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(safe);
}

/** Format a numeric value for editable money fields (no currency symbol). */
export function formatMoneyInput(value) {
  if (value === '' || value === null || value === undefined) return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return n.toFixed(2);
}

export const STANDARD_4060_TEMPLATE = [
  {
    label: 'Deposit',
    amountType: 'percentage',
    percentage: 40,
    dueType: 'deposit',
    dueNote: '',
    status: 'pending',
    paidAmount: 0,
    sortOrder: 0,
  },
  {
    label: 'Final Balance',
    amountType: 'percentage',
    percentage: 60,
    dueType: 'final',
    dueNote: '',
    status: 'pending',
    paidAmount: 0,
    sortOrder: 1,
  },
];

export function getContractBase(job) {
  const contracted = Number(job?.valueContracted);
  const estimated = Number(job?.valueEstimated);
  if (Number.isFinite(contracted) && contracted > 0) return contracted;
  if (Number.isFinite(estimated) && estimated > 0) return estimated;
  return 0;
}

export function sumChangeOrders(job) {
  const rows = Array.isArray(job?.changeOrders) ? job.changeOrders : [];
  return roundMoney(rows.reduce((sum, row) => sum + (Number(row?.amount) || 0), 0));
}

export function sumChangeOrdersForFinal(job) {
  const rows = Array.isArray(job?.changeOrders) ? job.changeOrders : [];
  return roundMoney(
    rows
      .filter((row) => String(row?.billing || 'separate') === 'final')
      .reduce((sum, row) => sum + (Number(row?.amount) || 0), 0),
  );
}

export function inferDueTypeFromLabel(label) {
  const text = String(label || '').trim().toLowerCase();
  if (/\bdeposit\b/.test(text)) return 'deposit';
  if (/\bfinal\b/.test(text) || /\bbalance\b/.test(text)) return 'final';
  return 'milestone';
}

export function isFinalScheduleItem(item) {
  return item?.dueType === 'final' || inferDueTypeFromLabel(item?.label) === 'final';
}

function getScheduleItemBaseAmount(item, contractBase) {
  if (item?.amountType === 'percentage') {
    const pct = Number(item.percentage);
    if (Number.isFinite(pct)) return roundMoney(contractBase * (pct / 100));
  }
  return roundMoney(Number(item?.amount) || computeItemAmount(item, contractBase));
}

/** Scheduled total for a row, including change orders rolled into final balance. */
export function getScheduleItemTotal(item, contractBase, coAddedToFinal = 0) {
  const stored = roundMoney(Number(item?.amount) || computeItemAmount(item, contractBase));
  if (!isFinalScheduleItem(item) || coAddedToFinal <= 0) return stored;
  const baseFinal = getScheduleItemBaseAmount(item, contractBase);
  if (stored > baseFinal + 0.01) return stored;
  return roundMoney(stored + coAddedToFinal);
}

/** Resolve how much counts toward paid-to-date for a paid milestone. */
export function resolveItemPaidAmount(item, scheduledTotal) {
  if (item?.status !== 'paid') return 0;
  const scheduled = roundMoney(scheduledTotal);
  const rawPaid = roundMoney(Number(item?.paidAmount) || scheduled);
  if (rawPaid > scheduled + 0.01) return scheduled;
  return rawPaid;
}

/** Keep paid amounts in sync when schedule rows are edited or re-saved. */
export function sanitizeScheduleItem(item, contractBase, coAddedToFinal = 0) {
  if (!item) return item;
  const scheduledTotal = getScheduleItemTotal(item, contractBase, coAddedToFinal);
  if (item.status !== 'paid') {
    return { ...item, paidAmount: 0, paidAt: item.paidAt || null };
  }
  return {
    ...item,
    paidAmount: resolveItemPaidAmount({ ...item, amount: scheduledTotal }, scheduledTotal),
  };
}

export function sanitizeScheduleItems(items, contractBase, coAddedToFinal = 0) {
  return (items || []).map((item) => sanitizeScheduleItem(item, contractBase, coAddedToFinal));
}

export function getJobPaymentSummary(job) {
  const base = getContractBase(job);
  const coTotal = sumChangeOrders(job);
  const jobTotal = roundMoney(base + coTotal);
  const coAddedToFinal = sumChangeOrdersForFinal(job);
  const contractBase = base;
  const schedule = resolvePaymentSchedule(job);
  const items = schedule.items || [];

  let paidToDate = 0;
  let hasStalePaidAmounts = false;
  for (const item of items) {
    if (item.status !== 'paid') continue;
    const scheduledTotal = getScheduleItemTotal(item, contractBase, coAddedToFinal);
    const rawPaid = roundMoney(Number(item.paidAmount) || scheduledTotal);
    if (rawPaid > scheduledTotal + 0.01) hasStalePaidAmounts = true;
    paidToDate += resolveItemPaidAmount(item, scheduledTotal);
  }
  paidToDate = roundMoney(paidToDate);

  const balanceRaw = roundMoney(jobTotal - paidToDate);
  const balanceDue = roundMoney(Math.max(0, balanceRaw));
  const overpaidAmount = balanceRaw < -0.01 ? roundMoney(Math.abs(balanceRaw)) : 0;

  return {
    base,
    coTotal,
    coAddedToFinal,
    jobTotal,
    paidToDate,
    balanceDue,
    balanceRaw,
    overpaidAmount,
    hasStalePaidAmounts,
  };
}

export function getJobTotalWithChangeOrders(job) {
  return roundMoney(getContractBase(job) + sumChangeOrders(job));
}

export function hasStoredPaymentSchedule(job) {
  return Array.isArray(job?.paymentSchedule?.items) && job.paymentSchedule.items.length > 0;
}

export function computeItemAmount(item, contractBase) {
  if (!item) return 0;
  if (item.amountType === 'fixed') {
    return roundMoney(Number(item.amount) || 0);
  }
  if (item.amountType === 'percentage') {
    const pct = Number(item.percentage);
    if (!Number.isFinite(pct)) return roundMoney(Number(item.amount) || 0);
    return roundMoney(contractBase * (pct / 100));
  }
  return roundMoney(Number(item.amount) || 0);
}

export function resolvePaymentSchedule(job) {
  const contractBase = getContractBase(job);
  if (!hasStoredPaymentSchedule(job)) {
    return {
      type: 'standard_40_60',
      items: STANDARD_4060_TEMPLATE.map((template, idx) => ({
        ...template,
        amount: computeItemAmount(template, contractBase),
        sortOrder: idx,
      })),
      isFallback: true,
    };
  }

  const items = [...job.paymentSchedule.items]
    .sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0))
    .map((item, idx) => ({
      ...item,
      amount: computeItemAmount(item, contractBase),
      sortOrder: Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : idx,
    }));

  return {
    type: job.paymentSchedule.type || 'custom',
    items,
    isFallback: false,
  };
}

/** Merge legacy deposit/final fields when job has no stored payment schedule yet. */
export function resolvePaymentScheduleForCommission(job) {
  const resolved = resolvePaymentSchedule(job);
  if (hasStoredPaymentSchedule(job)) return resolved;

  const depositReceivedAt = job?.contract?.depositReceivedAt;
  const depositReceived = Number(job?.contract?.depositReceived);
  const finalPaidAt = job?.finalPayment?.paidAt;
  const finalPaidAmount = Number(job?.finalPayment?.amountPaid);

  const items = (resolved.items || []).map((item) => {
    if (item.dueType === 'deposit' && depositReceivedAt) {
      return {
        ...item,
        status: 'paid',
        paidAt: depositReceivedAt,
        paidAmount:
          Number.isFinite(depositReceived) && depositReceived > 0
            ? roundMoney(depositReceived)
            : item.amount,
      };
    }
    if (item.dueType === 'final' && finalPaidAt) {
      return {
        ...item,
        status: 'paid',
        paidAt: finalPaidAt,
        paidAmount:
          Number.isFinite(finalPaidAmount) && finalPaidAmount > 0
            ? roundMoney(finalPaidAmount)
            : item.amount,
      };
    }
    return item;
  });

  return { ...resolved, items };
}

export function validatePaymentSchedule(schedule, contractBase, jobTotal) {
  const items = schedule?.items || [];
  const scheduledTotal = roundMoney(
    items.reduce((sum, item) => sum + (Number(item.amount) || 0), 0)
  );
  const target = roundMoney(
    Number.isFinite(Number(jobTotal)) && Number(jobTotal) > 0 ? Number(jobTotal) : contractBase,
  );
  const remaining = roundMoney(target - scheduledTotal);
  const warnings = [];

  if (target > 0 && Math.abs(remaining) > 0.01) {
    const diffLabel = remaining > 0 ? 'under-scheduled' : 'over-scheduled';
    warnings.push(
      `Payment schedule is ${diffLabel} by ${formatMoney(Math.abs(remaining))}`
    );
  }

  return { scheduledTotal, remaining, target, warnings, isBalanced: target <= 0 || Math.abs(remaining) <= 0.01 };
}

export function formatScheduleItemLabel(item) {
  if (!item) return '';
  const amount = roundMoney(item.amount);
  if (item.amountType === 'percentage' && Number.isFinite(Number(item.percentage))) {
    return `${item.label} (${item.percentage}%): ${formatMoney(amount)}`;
  }
  return `${item.label}: ${formatMoney(amount)}`;
}

/** Label + amount for a paid row — uses paidAmount when set. */
export function formatPaidScheduleItemLabel(item) {
  if (!item) return '';
  const amount = roundMoney(Number(item.paidAmount ?? item.amount) || 0);
  if (item.amountType === 'percentage' && Number.isFinite(Number(item.percentage))) {
    return `${item.label} (${item.percentage}%): ${formatMoney(amount)}`;
  }
  return `${item.label}: ${formatMoney(amount)}`;
}

export function buildCustomScheduleFromItems(items, contractBase) {
  return {
    type: 'custom',
    items: items.map((item, idx) => ({
      ...item,
      sortOrder: idx,
      amount:
        item.amountType === 'percentage'
          ? computeItemAmount(item, contractBase)
          : roundMoney(Number(item.amount) || 0),
    })),
  };
}

export function buildStandardSchedule(contractBase) {
  return {
    type: 'standard_40_60',
    items: STANDARD_4060_TEMPLATE.map((template, idx) => ({
      ...template,
      amount: computeItemAmount(template, contractBase),
      sortOrder: idx,
    })),
  };
}

export function matchesStandard4060Template(items) {
  if (!Array.isArray(items) || items.length !== 2) return false;
  return STANDARD_4060_TEMPLATE.every((template, idx) => {
    const item = items[idx];
    if (!item) return false;
    return (
      item.amountType === template.amountType &&
      Number(item.percentage) === template.percentage &&
      item.dueType === template.dueType &&
      String(item.label || '').trim() === template.label
    );
  });
}

export function buildSchedulePayloadFromItems(items, contractBase, job = null) {
  const coAddedToFinal = job ? sumChangeOrdersForFinal(job) : 0;
  const sanitized = sanitizeScheduleItems(items, contractBase, coAddedToFinal);
  const itemsForSave = sanitized.map(({ localId, ...item }) => item);
  const payload = buildCustomScheduleFromItems(itemsForSave, contractBase);
  payload.type = matchesStandard4060Template(itemsForSave) ? 'standard_40_60' : 'custom';
  return payload;
}

export function getCommissionPaymentSplits(job, contractBase, commissionDue) {
  const base = roundMoney(contractBase);
  const due = roundMoney(commissionDue);
  const resolved = resolvePaymentScheduleForCommission({
    ...(job || {}),
    valueEstimated: base,
    valueContracted: base,
  });
  const items = resolved.items || [];
  const scheduledTotal = roundMoney(items.reduce((sum, item) => sum + (Number(item.amount) || 0), 0));

  if (!items.length) {
    return [
      {
        label: 'Commission',
        dueType: 'milestone',
        share: 1,
        scheduledAmount: base,
        amount: due,
        status: 'pending',
        paidAt: null,
      },
    ];
  }

  if (scheduledTotal <= 0) {
    const evenShare = 1 / items.length;
    let running = 0;
    return items.map((item, idx) => {
      const amount =
        idx === items.length - 1 ? roundMoney(due - running) : roundMoney(due * evenShare);
      running += amount;
      return {
        label: item.label || `Payment ${idx + 1}`,
        dueType: item.dueType,
        share: evenShare,
        scheduledAmount: 0,
        amount,
        status: item.status || 'pending',
        paidAt: item.paidAt || null,
      };
    });
  }

  let running = 0;
  return items.map((item, idx) => {
    const scheduledAmount = roundMoney(item.amount);
    const share = scheduledAmount / scheduledTotal;
    const amount =
      idx === items.length - 1 ? roundMoney(due - running) : roundMoney(due * share);
    running += amount;
    return {
      label: item.label || `Payment ${idx + 1}`,
      dueType: item.dueType,
      share,
      scheduledAmount,
      amount,
      status: item.status || 'pending',
      paidAt: item.paidAt || null,
    };
  });
}

export function getCommissionPaymentSplitShares(job, contractBase) {
  const base = roundMoney(contractBase);
  const resolved = resolvePaymentSchedule({
    ...(job || {}),
    valueEstimated: base,
    valueContracted: base,
  });
  const items = resolved.items || [];
  const scheduledTotal = roundMoney(items.reduce((sum, item) => sum + (Number(item.amount) || 0), 0));
  const denominator = base > 0 ? base : scheduledTotal;
  if (!denominator) {
    return { payment1Share: 0.4, payment2Share: 0.6 };
  }

  let payment1Amount = 0;
  let payment2Amount = 0;
  for (const item of items) {
    const amt = roundMoney(item.amount);
    if (item.dueType === 'final') payment2Amount += amt;
    else payment1Amount += amt;
  }

  if (payment1Amount <= 0 && payment2Amount <= 0) {
    return { payment1Share: 0.4, payment2Share: 0.6 };
  }
  if (payment2Amount <= 0) {
    payment2Amount = Math.max(0, denominator - payment1Amount);
  }
  if (payment1Amount <= 0) {
    payment1Amount = Math.max(0, denominator - payment2Amount);
  }

  const splitTotal = payment1Amount + payment2Amount;
  if (splitTotal <= 0) {
    return { payment1Share: 0.4, payment2Share: 0.6 };
  }

  return {
    payment1Share: payment1Amount / splitTotal,
    payment2Share: payment2Amount / splitTotal,
  };
}

export function createEmptyScheduleItem(sortOrder = 0) {
  return {
    localId: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    label: '',
    amountType: 'fixed',
    percentage: undefined,
    amount: 0,
    dueType: 'milestone',
    dueNote: '',
    dueDate: null,
    status: 'pending',
    paidAmount: 0,
    paidAt: null,
    sortOrder,
  };
}

function paymentSquareLabel(item, index) {
  const named = String(item?.label || '').trim();
  if (named) return named;
  const due = item?.dueType || inferDueTypeFromLabel(item?.label);
  if (due === 'deposit') return 'Deposit';
  if (due === 'final') return 'Final';
  if (due === 'progress') return 'Progress';
  return `Payment ${index + 1}`;
}

/** One square per schedule line for pipeline cards: deposit / progress / final, etc. */
export function paymentSquaresForJob(job) {
  const items = resolvePaymentScheduleForCommission(job).items || [];
  return items.map((item, index) => ({
    label: paymentSquareLabel(item, index),
    paid: item?.status === 'paid',
  }));
}
