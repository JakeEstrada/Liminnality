import { useEffect, useState } from 'react';
import JobDetailModal from '../jobs/JobDetailModal';
import { useFinancialPinLockContext } from '../../context/FinancialPinLockContext';
import api from '../../utils/axios';
import { subscribeJobOverlay, type JobOverlayCommand } from '../../voice/jobOverlayBus';

export default function JobOverlayHost() {
  const [overlay, setOverlay] = useState<JobOverlayCommand | null>(null);
  const financialPin = useFinancialPinLockContext();

  useEffect(() => subscribeJobOverlay(setOverlay), []);

  if (!overlay?.jobId) return null;

  return (
    <JobDetailModal
      key={overlay.jobId}
      jobId={overlay.jobId}
      open
      initialTab={overlay.tab || 'files'}
      onClose={() => setOverlay(null)}
      onJobUpdate={async (id, updates) => {
        await api.patch(`/jobs/${id}`, updates);
      }}
      onJobDelete={() => setOverlay(null)}
      onJobArchive={() => setOverlay(null)}
      hideSensitive={financialPin.hideFinancials}
      onRequestSensitiveUnlock={financialPin.openUnlockDialog}
    />
  );
}
