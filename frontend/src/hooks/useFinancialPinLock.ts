import { useCallback, useEffect, useState } from 'react';
import { useIsMobile } from './useIsMobile';

export const FINANCIAL_AMOUNTS_PIN = '7212';
const FINANCIAL_AMOUNTS_UNLOCK_KEY = 'financialAmountsUnlockedV1';
const PROTECT_SENSITIVE_KEY = 'protectSensitiveDataV1';
export const FINANCIAL_UNLOCK_CHANGED_EVENT = 'financial-unlock-changed';

function readFinancialUnlockFlag() {
  try {
    return sessionStorage.getItem(FINANCIAL_AMOUNTS_UNLOCK_KEY) === '1';
  } catch {
    return false;
  }
}

function writeFinancialUnlockFlag(unlocked: boolean) {
  try {
    sessionStorage.setItem(FINANCIAL_AMOUNTS_UNLOCK_KEY, unlocked ? '1' : '0');
  } catch {
    // Ignore browser storage failures.
  }
}

function readProtectFlag() {
  try {
    return localStorage.getItem(PROTECT_SENSITIVE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeProtectFlag(enabled: boolean) {
  try {
    localStorage.setItem(PROTECT_SENSITIVE_KEY, enabled ? '1' : '0');
  } catch {
    // Ignore browser storage failures.
  }
}

function notifyFinancialUnlockChanged() {
  window.dispatchEvent(new Event(FINANCIAL_UNLOCK_CHANGED_EVENT));
}

export function useFinancialPinLock() {
  const isMobile = useIsMobile();
  const [protectEnabled, setProtectEnabledState] = useState(() => readProtectFlag());
  const [unlocked, setUnlocked] = useState(() => readFinancialUnlockFlag());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');

  const syncFromStorage = useCallback(() => {
    setProtectEnabledState(readProtectFlag());
    setUnlocked(readFinancialUnlockFlag());
  }, []);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === FINANCIAL_AMOUNTS_UNLOCK_KEY || event.key === PROTECT_SENSITIVE_KEY) {
        syncFromStorage();
      }
    };
    const onUnlockChanged = () => syncFromStorage();
    window.addEventListener('storage', onStorage);
    window.addEventListener(FINANCIAL_UNLOCK_CHANGED_EVENT, onUnlockChanged);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(FINANCIAL_UNLOCK_CHANGED_EVENT, onUnlockChanged);
    };
  }, [syncFromStorage]);

  const openUnlockDialog = useCallback(() => {
    setPinInput('');
    setPinError('');
    setDialogOpen(true);
  }, []);

  const submitPin = useCallback((pinOverride?: string) => {
    const entered = String(pinOverride ?? pinInput ?? '').trim();
    if (entered === FINANCIAL_AMOUNTS_PIN) {
      writeFinancialUnlockFlag(true);
      setUnlocked(true);
      notifyFinancialUnlockChanged();
      setDialogOpen(false);
      setPinInput('');
      setPinError('');
      return true;
    }
    setPinError('Incorrect PIN');
    return false;
  }, [pinInput]);

  const lockFinancials = useCallback(() => {
    writeFinancialUnlockFlag(false);
    setUnlocked(false);
    notifyFinancialUnlockChanged();
  }, []);

  const setProtectEnabled = useCallback((enabled: boolean) => {
    writeProtectFlag(enabled);
    setProtectEnabledState(enabled);
    if (enabled) {
      writeFinancialUnlockFlag(false);
      setUnlocked(false);
    } else {
      writeFinancialUnlockFlag(true);
      setUnlocked(true);
    }
    notifyFinancialUnlockChanged();
  }, []);

  const closeDialog = useCallback(() => {
    setDialogOpen(false);
    setPinInput('');
    setPinError('');
  }, []);

  // Phones skip the PIN gate entirely: amounts are always visible and the dialog never opens.
  const effectiveUnlocked = isMobile || !protectEnabled || unlocked;

  return {
    protectEnabled,
    setProtectEnabled,
    hideFinancials: !effectiveUnlocked,
    unlocked: effectiveUnlocked,
    dialogOpen: isMobile ? false : dialogOpen,
    pinInput,
    pinError,
    setPinInput,
    openUnlockDialog: isMobile || !protectEnabled ? () => {} : openUnlockDialog,
    submitPin,
    lockFinancials: isMobile || !protectEnabled ? () => {} : lockFinancials,
    closeDialog,
  };
}
