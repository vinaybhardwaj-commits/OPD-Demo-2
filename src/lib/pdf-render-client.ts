'use client';

/**
 * Client-side PDF → PNG rendering for the lab upload flow.
 *
 * Why client-side: Vercel functions don't get @napi-rs/canvas /
 * pdf-to-image native deps without a heavy bundle. Browsers already
 * have a 2D canvas, and pdfjs-dist's legacy build is pure JS, so we
 * render in the tech's browser and ship just the PNG payloads to the
 * server. The original file is also forwarded for archival.
 *
 * Worker setup:
 *   pdfjs-dist 4.x ships an ESM build that wants a separate worker
 *   bundle. We point GlobalWorkerOptions.workerSrc at the same CDN
 *   build to keep our bundle small. cdnjs hosts the matching version.
 *
 * Resolution:
 *   We render at 2x device scale so Qwen-VL gets sharp text — most
 *   lab reports are dense tables and we want every digit legible.
 *
 * Returns:
 *   { pages: string[] — base64 PNGs, no data: prefix; original: File }
 */

const PDFJS_VERSION = '4.10.38';
const WORKER_CDN_URL = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.mjs`;

const RENDER_SCALE = 2.0;
const MAX_PAGES = 10; // safety bound — V says reports rarely exceed this

export type RenderedUpload = {
  /** base64 PNG content (no data: URL prefix) */
  pages: string[];
  original: File;
  page_count: number;
};

/**
 * Render any uploaded report file into one or more PNGs for Qwen-VL.
 *
 * - PDF → one PNG per page (capped at MAX_PAGES)
 * - PNG/JPEG/WebP image → single-page pass-through (re-encoded as PNG
 *   so the server's mime expectation is uniform)
 * - anything else → throws Error('unsupported_file_type')
 */
export async function renderReportToPngs(file: File): Promise<RenderedUpload> {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    const pages = await renderPdfPages(file);
    return { pages, original: file, page_count: pages.length };
  }
  if (file.type.startsWith('image/')) {
    const png = await imageFileToPng(file);
    return { pages: [png], original: file, page_count: 1 };
  }
  throw new Error('unsupported_file_type');
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

async function renderPdfPages(file: File): Promise<string[]> {
  // Dynamic import — keeps pdfjs-dist out of the initial client bundle
  // (it's ~600kB). Only loads when a tech actually uploads a PDF.
  // The 'legacy' subpath is what works in worker-less / older
  // bundlers. The modern build uses native module workers which Next
  // 15 supports but we use legacy here to dodge worker-loader config.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (pdfjs as any).GlobalWorkerOptions.workerSrc = WORKER_CDN_URL;

  const bytes = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjs.getDocument({ data: bytes });
  const doc = await loadingTask.promise;

  const pageCount = Math.min(doc.numPages, MAX_PAGES);
  const out: string[] = [];

  for (let i = 1; i <= pageCount; i += 1) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: RENDER_SCALE });

    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas_unavailable');

    // White background so transparent areas render correctly.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({
      canvasContext: ctx,
      viewport,
      // 4.x optional fields; pass-through for compatibility.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).promise;

    out.push(canvasToPngBase64(canvas));
    canvas.width = 0;
    canvas.height = 0;
    page.cleanup();
  }

  await doc.destroy();
  return out;
}

// ---------------------------------------------------------------------------
// Image
// ---------------------------------------------------------------------------

async function imageFileToPng(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas_unavailable');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    return canvasToPngBase64(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image_load_failed'));
    img.src = src;
  });
}

function canvasToPngBase64(canvas: HTMLCanvasElement): string {
  const dataUrl = canvas.toDataURL('image/png');
  // dataUrl is 'data:image/png;base64,XXXX' — strip the prefix.
  const i = dataUrl.indexOf(',');
  return i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
}
