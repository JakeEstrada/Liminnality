import html2canvas from 'html2canvas';

const UNSUPPORTED_COLOR = /oklch|oklab|color-mix|lab\(|lch\(|display-p3/i;

function replaceModernCssColors(css: string) {
  return css
    .replace(/oklch\([^)]*\)/gi, '#111111')
    .replace(/oklab\([^)]*\)/gi, '#111111')
    .replace(/color\(display-p3[^)]*\)/gi, '#111111')
    .replace(/lab\([^)]*\)/gi, '#111111')
    .replace(/lch\([^)]*\)/gi, '#111111')
    .replace(/color-mix\([^)]*\)/gi, '#cccccc');
}

function sanitizeCloneForCanvas(clonedDoc: Document, clonedEl: HTMLElement) {
  clonedDoc.querySelectorAll('style').forEach((style) => {
    if (style.textContent) style.textContent = replaceModernCssColors(style.textContent);
  });

  const win = clonedDoc.defaultView;
  const paint = (node: Element) => {
    if (!(node instanceof HTMLElement)) return;
    node.style.transform = 'none';
    node.style.filter = 'none';
    node.style.backdropFilter = 'none';
    const cs = win?.getComputedStyle(node);
    if (cs) {
      const colorProps = [
        'color',
        'backgroundColor',
        'borderColor',
        'borderTopColor',
        'borderRightColor',
        'borderBottomColor',
        'borderLeftColor',
        'outlineColor',
        'textDecorationColor',
        'boxShadow',
      ] as const;
      for (const prop of colorProps) {
        const val = cs[prop];
        if (typeof val !== 'string' || !UNSUPPORTED_COLOR.test(val)) continue;
        if (prop === 'backgroundColor') node.style.backgroundColor = '#ffffff';
        else if (prop === 'boxShadow') node.style.boxShadow = 'none';
        else node.style[prop] = '#000000';
      }
    }
    Array.from(node.children).forEach(paint);
  };
  paint(clonedEl);
}

function canvasLooksBlank(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || canvas.width < 8 || canvas.height < 8) return true;
  const x = Math.floor(canvas.width * 0.08);
  const y = Math.floor(canvas.height * 0.08);
  const w = Math.max(8, Math.floor(canvas.width * 0.84));
  const sample = ctx.getImageData(x, y, w, 6);
  let ink = 0;
  for (let i = 0; i < sample.data.length; i += 4) {
    const r = sample.data[i];
    const g = sample.data[i + 1];
    const b = sample.data[i + 2];
    const a = sample.data[i + 3];
    if (a > 12 && (r < 246 || g < 246 || b < 246)) ink += 1;
  }
  return ink < 10;
}

async function waitForImages(root: HTMLElement) {
  const images = Array.from(root.querySelectorAll('img'));
  await Promise.all(
    images.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete && img.naturalWidth > 0) {
            resolve();
            return;
          }
          const done = () => resolve();
          img.addEventListener('load', done, { once: true });
          img.addEventListener('error', done, { once: true });
        }),
    ),
  );
}

function dataUrlLooksEmpty(dataUrl: string) {
  return !dataUrl || dataUrl === 'data:,' || dataUrl.length < 2000;
}

export async function captureHtmlToPng(
  el: HTMLElement,
  {
    width,
    height,
    scale = 2,
  }: {
    width: number;
    height: number;
    scale?: number;
  },
) {
  const host = document.createElement('div');
  host.setAttribute('data-pdf-capture-host', '1');
  Object.assign(host.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    width: `${width}px`,
    height: `${height}px`,
    overflow: 'visible',
    background: '#ffffff',
    zIndex: '2147483646',
    pointerEvents: 'none',
    opacity: '0.02',
    colorScheme: 'light',
  });

  const parent = el.parentNode;
  const nextSibling = el.nextSibling;
  const prev = {
    width: el.style.width,
    height: el.style.height,
    maxWidth: el.style.maxWidth,
    margin: el.style.margin,
    transform: el.style.transform,
    position: el.style.position,
  };
  el.style.width = `${width}px`;
  el.style.height = `${height}px`;
  el.style.maxWidth = `${width}px`;
  el.style.margin = '0';
  el.style.transform = 'none';
  el.style.position = 'relative';
  host.appendChild(el);
  document.body.appendChild(host);

  try {
    await waitForImages(el);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const canvas = await html2canvas(el, {
      backgroundColor: '#ffffff',
      scale,
      useCORS: true,
      allowTaint: true,
      logging: false,
      foreignObjectRendering: false,
      scrollX: 0,
      scrollY: 0,
      windowWidth: Math.max(width, document.documentElement.clientWidth || width),
      windowHeight: Math.max(height, document.documentElement.clientHeight || height),
      width,
      height,
      x: 0,
      y: 0,
      onclone: (doc, cloned) => {
        if (cloned instanceof HTMLElement) sanitizeCloneForCanvas(doc, cloned);
      },
    });
    if (canvasLooksBlank(canvas)) {
      throw new Error('Cover page rendered blank in this browser. Try the download again.');
    }
    const jpeg = canvas.toDataURL('image/jpeg', 0.93);
    if (dataUrlLooksEmpty(jpeg)) {
      const png = canvas.toDataURL('image/png');
      if (dataUrlLooksEmpty(png)) {
        throw new Error('Cover page rendered blank in this browser. Try the download again.');
      }
      return { dataUrl: png, format: 'PNG' as const };
    }
    return { dataUrl: jpeg, format: 'JPEG' as const };
  } finally {
    el.style.width = prev.width;
    el.style.height = prev.height;
    el.style.maxWidth = prev.maxWidth;
    el.style.margin = prev.margin;
    el.style.transform = prev.transform;
    el.style.position = prev.position;
    if (parent) parent.insertBefore(el, nextSibling);
    host.remove();
  }
}
