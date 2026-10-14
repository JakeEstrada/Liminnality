import { useEffect, useRef } from 'react';
import { Box, useTheme } from '@mui/material';
import { readMicWaveform, startMicWaveform, stopMicWaveform } from '../../voice/micWaveform';

const SAMPLES = 120;

export default function LiveMicWaveform({ color, height = 44 }: { color?: string; height?: number }) {
  const theme = useTheme();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const valuesRef = useRef<number[]>(Array.from({ length: SAMPLES }, () => 0));
  const stroke = color || theme.palette.primary.main;

  useEffect(() => {
    let frame = 0;
    let running = true;
    void startMicWaveform();
    const draw = () => {
      if (!running) return;
      frame = window.requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const ratio = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (canvas.width !== Math.floor(width * ratio) || canvas.height !== Math.floor(height * ratio)) {
        canvas.width = Math.floor(width * ratio);
        canvas.height = Math.floor(height * ratio);
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const values = valuesRef.current;
      readMicWaveform(values);
      ctx.beginPath();
      ctx.lineWidth = 2;
      ctx.strokeStyle = stroke;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      const mid = height / 2;
      values.forEach((value, index) => {
        const x = (index / Math.max(1, values.length - 1)) * width;
        const y = mid + value * (mid - 3);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    };
    frame = window.requestAnimationFrame(draw);
    return () => {
      running = false;
      window.cancelAnimationFrame(frame);
      stopMicWaveform();
    };
  }, [stroke]);

  return (
    <Box sx={{ width: '100%', height, mt: 0.5 }}>
      <canvas
        ref={canvasRef}
        style={{ display: 'block', width: '100%', height: '100%' }}
      />
    </Box>
  );
}
