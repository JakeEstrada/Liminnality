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
    left: '-20000px',
    top: '0',
    width: `${width}px`,
    height: `${height}px`,
    overflow: 'visible',
    background: '#ffffff',
    zIndex: '0',
    pointerEvents: 'none',
  });

  const clone = el.cloneNode(true) as HTMLElement;
  clone.style.width = `${width}px`;
  clone.style.height = `${height}px`;
  clone.style.maxWidth = `${width}px`;
  clone.style.margin = '0';
  clone.style.transform = 'none';
  clone.style.position = 'relative';
  host.appendChild(clone);
  document.body.appendChild(host);

  try {
    await waitForImages(clone);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const canvas = await html2canvas(clone, {
      backgroundColor: '#ffffff',
      scale,
      useCORS: true,
      allowTaint: true,
      logging: false,
      scrollX: 0,
      scrollY: 0,
      windowWidth: width,
      windowHeight: height,
      width,
      height,
      x: 0,
      y: 0,
      onclone: (doc, cloned) => {
        if (cloned instanceof HTMLElement) sanitizeCloneForCanvas(doc, cloned);
      },
    });
    if (canvasLooksBlank(canvas)) {
      throw new Error('Cover page rendered blank. Try again, or use Chrome if another browser is open.');
    }
    return canvas.toDataURL('image/png');
  } finally {
    host.remove();
  }
}
