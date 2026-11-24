import axios from 'axios';
import * as pdfjs from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { headerRotation, WORKSHEET_ZOOMS } from './worksheetOrient';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';
const RENDER_EDGE = 2600;
const PAGE_EDGE = 2000;
const ZOOM_EDGE = 1600;
const PREVIEW_EDGE = 1600;

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
};

export type WorksheetContact = {
  name: string;
  phone: string;
  email: string;
  note: string;
  verify: string;
};

export type WorksheetReading = {
  draft: WorksheetDraft;
  verify: Record<string, string>;
  suggestions: Record<string, string>;
  review: {
    scopeLines: string[];
    options: string[];
    materials: string[];
    materialsVerify: string;
    otherContacts: WorksheetContact[];
    referral: string;
    worksheetDate: string;
    customerType: string;
    notes: string[];
  };
  pageTurn: number;
  isScwwWorksheet: boolean;
};

function canvasToJpeg(canvas: HTMLCanvasElement, quality = 0.85) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not prepare the worksheet image'))),
      'image/jpeg',
      quality,
    );
  });
}

function scaledCanvas(source: HTMLCanvasElement, sx: number, sy: number, sw: number, sh: number, maxEdge: number) {
  const scale = Math.min(1, maxEdge / Math.max(sw, sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not prepare the worksheet image');
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
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

/** The printed SCWW header bar is blue. Turn the page so that bar is on top. */
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

export function rotateCanvas(source: HTMLCanvasElement, degrees: number) {
  const turn = ((degrees % 360) + 360) % 360;
  if (turn === 0) return source;
  const canvas = document.createElement('canvas');
  const swap = turn % 180 !== 0;
  canvas.width = swap ? source.height : source.width;
  canvas.height = swap ? source.width : source.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return source;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((turn * Math.PI) / 180);
  ctx.drawImage(source, -source.width / 2, -source.height / 2);
  return canvas;
}

async function renderPdf(file: File) {
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;
  const page = await pdf.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(4, RENDER_EDGE / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not prepare the worksheet image');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  await pdf.destroy();
  return canvas;
}

async function renderImage(file: File) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, RENDER_EDGE / Math.max(bitmap.width, bitmap.height));
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

/** First page of the worksheet, turned upright when the SCWW header shows which way is up. */
export async function renderWorksheet(file: File) {
  const name = file.name.toLowerCase();
  const rendered =
    file.type === 'application/pdf' || name.endsWith('.pdf') ? await renderPdf(file) : await renderImage(file);
  return rotateCanvas(rendered, headerTurn(rendered));
}

export async function worksheetPreviewUrl(canvas: HTMLCanvasElement) {
  const preview = scaledCanvas(canvas, 0, 0, canvas.width, canvas.height, PREVIEW_EDGE);
  return URL.createObjectURL(await canvasToJpeg(preview, 0.8));
}

async function postWorksheet(canvas: HTMLCanvasElement, filename: string, signal?: AbortSignal) {
  const body = new FormData();
  const page = scaledCanvas(canvas, 0, 0, canvas.width, canvas.height, PAGE_EDGE);
  body.append('page', await canvasToJpeg(page), 'page.jpg');
  for (const [index, zoom] of WORKSHEET_ZOOMS.entries()) {
    const sx = Math.round(canvas.width * zoom.x);
    const sy = Math.round(canvas.height * zoom.y);
    const sw = Math.round(canvas.width * zoom.w);
    const sh = Math.round(canvas.height * zoom.h);
    body.append('zoom', await canvasToJpeg(scaledCanvas(canvas, sx, sy, sw, sh, ZOOM_EDGE)), `zoom-${index + 1}.jpg`);
  }
  body.append('filename', filename);
  const response = await axios.post(`${API_URL}/jobs/worksheet-preview`, body, {
    headers: { 'Content-Type': 'multipart/form-data' },
    signal,
    timeout: 120000,
  });
  return response.data as WorksheetReading;
}

/**
 * Sends the page to the backend reader. When the reader says the page is still sideways
 * (a photo without the SCWW header), it turns the page once and reads it again.
 */
export async function extractWorksheet(canvas: HTMLCanvasElement, filename: string, signal?: AbortSignal) {
  const first = await postWorksheet(canvas, filename, signal);
  if (!first?.pageTurn) return { reading: first, canvas };
  const turned = rotateCanvas(canvas, first.pageTurn);
  const second = await postWorksheet(turned, filename, signal);
  return { reading: second, canvas: turned };
}
