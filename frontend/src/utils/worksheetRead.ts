import axios from 'axios';
import * as pdfjs from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { headerRotation } from './worksheetOrient';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';
const MAX_EDGE = 1800;

export type WorksheetDraft = {
  title: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  valueEstimated: string;
  source: string;
  referralCompany: string;
  extraNote: string;
};

function canvasToJpeg(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not prepare the worksheet image'))),
      'image/jpeg',
      0.85,
    );
  });
}

function blueRatio(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const width = Math.max(1, Math.floor(w));
  const height = Math.max(1, Math.floor(h));
  const data = ctx.getImageData(Math.floor(x), Math.floor(y), width, height).data;
  let blue = 0;
  let count = 0;
  for (let i = 0; i < data.length; i += 16) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    count += 1;
    if (b > 140 && b > r + 30 && g > 80) blue += 1;
  }
  return count ? blue / count : 0;
}

/** The printed shop bar is blue. Turn the page so that bar is on top. */
function headerTurn(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return 0;
  const { width, height } = canvas;
  const band = Math.max(8, Math.round(Math.min(width, height) * 0.12));
  return headerRotation({
    top: blueRatio(ctx, 0, 0, width, band),
    bottom: blueRatio(ctx, 0, height - band, width, band),
    left: blueRatio(ctx, 0, 0, band, height),
    right: blueRatio(ctx, width - band, 0, band, height),
  });
}

function rotateCanvas(source: HTMLCanvasElement, degrees: number) {
  const canvas = document.createElement('canvas');
  const swap = degrees % 180 !== 0;
  canvas.width = swap ? source.height : source.width;
  canvas.height = swap ? source.width : source.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return source;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((degrees * Math.PI) / 180);
  ctx.drawImage(source, -source.width / 2, -source.height / 2);
  return canvas;
}

function uprightCanvas(source: HTMLCanvasElement) {
  const degrees = headerTurn(source);
  return degrees === 0 ? source : rotateCanvas(source, degrees);
}

async function renderPdf(file: File) {
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;
  const page = await pdf.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(2.2, MAX_EDGE / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not prepare the worksheet image');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

async function renderImage(file: File) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not prepare the worksheet image');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}

async function pageJpeg(file: File) {
  const name = file.name.toLowerCase();
  const rendered =
    file.type === 'application/pdf' || name.endsWith('.pdf') ? await renderPdf(file) : await renderImage(file);
  return canvasToJpeg(uprightCanvas(rendered));
}

export async function readWorksheetDraft(file: File) {
  const image = await pageJpeg(file);
  const body = new FormData();
  body.append('file', image, 'worksheet.jpg');
  body.append('filename', file.name);
  const response = await axios.post(`${API_URL}/jobs/worksheet-preview`, body, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data?.draft as WorksheetDraft;
}
