import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { extractWorksheet, renderWorksheet, worksheetPreviewUrl, type WorksheetReading } from '../utils/worksheetRead';

export type WorksheetStatus = 'idle' | 'reading' | 'done' | 'failed' | 'skipped';

type State = {
  file: File | null;
  status: WorksheetStatus;
  previewUrl: string;
  reading: WorksheetReading | null;
  error: string;
};

const IDLE: State = { file: null, status: 'idle', previewUrl: '', reading: null, error: '' };

function readError(error) {
  const message = error?.response?.data?.error;
  if (message) return String(message);
  if (error?.code === 'ECONNABORTED') return 'Reading the worksheet took too long';
  return 'Could not read the worksheet';
}

export function useWorksheetReading(file: File | null, active: boolean) {
  const [state, setState] = useState<State>(IDLE);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!active || !file) return undefined;
    const controller = new AbortController();
    controllerRef.current = controller;
    let cancelled = false;
    let previewUrl = '';

    (async () => {
      let canvas: HTMLCanvasElement;
      try {
        canvas = await renderWorksheet(file);
        previewUrl = await worksheetPreviewUrl(canvas);
        if (cancelled) return;
        setState({ file, status: 'reading', previewUrl, reading: null, error: '' });
      } catch (error) {
        if (import.meta.env.DEV) console.warn('Worksheet render failed', error);
        if (!cancelled) {
          setState({ file, status: 'failed', previewUrl: '', reading: null, error: 'Could not open this file to read it' });
        }
        return;
      }

      try {
        const { reading, canvas: used } = await extractWorksheet(canvas, file.name, controller.signal);
        if (cancelled) return;
        if (used !== canvas) {
          URL.revokeObjectURL(previewUrl);
          previewUrl = await worksheetPreviewUrl(used);
          if (cancelled) return;
        }
        setState({ file, status: 'done', previewUrl, reading, error: '' });
      } catch (error) {
        if (cancelled) return;
        if (axios.isCancel(error) || controller.signal.aborted) {
          setState({ file, status: 'skipped', previewUrl, reading: null, error: '' });
          return;
        }
        setState({ file, status: 'failed', previewUrl, reading: null, error: readError(error) });
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [file, active]);

  const skip = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  if (!active || !file) return { ...IDLE, skip };
  if (state.file !== file) return { file, status: 'reading' as const, previewUrl: '', reading: null, error: '', skip };
  return { ...state, skip };
}
