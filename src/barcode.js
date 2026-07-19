/**
 * Barcode scanning with two engines: the browser's native BarcodeDetector
 * where it exists (Chrome/Android — fast, nothing to download), and a
 * lazily-loaded html5-qrcode (ZXing-based) fallback everywhere else,
 * including iOS Safari which has no BarcodeDetector at all.
 */

let scannerLibLoading = null;

function loadScannerLibrary() {
  if (window.Html5Qrcode) return Promise.resolve();
  if (scannerLibLoading) return scannerLibLoading;
  scannerLibLoading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js';
    script.onload = resolve;
    script.onerror = () => reject(new Error('Could not load the barcode scanner. Check your connection.'));
    document.head.appendChild(script);
  });
  return scannerLibLoading;
}

/** Scanning works anywhere a camera is reachable — the engine is chosen at scan time. */
export function isBarcodeScanSupported() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

/**
 * Opens the back camera and resolves with the first recognized barcode's
 * value. `videoElement` is used by the native engine; `fallbackContainer`
 * (a div) hosts the fallback engine's own camera view. Call the returned
 * `stop()` to cancel — the promise then rejects with message 'cancelled'.
 */
export function scanBarcodeFromCamera(videoElement, fallbackContainer, onStatus) {
  if ('BarcodeDetector' in window) return scanWithNativeDetector(videoElement, fallbackContainer, onStatus);
  return scanWithLibrary(videoElement, fallbackContainer, onStatus);
}

function scanWithNativeDetector(videoElement, fallbackContainer, onStatus) {
  let stopped = false;
  let stream = null;

  const promise = (async () => {
    fallbackContainer.hidden = true;
    videoElement.hidden = false;
    if (onStatus) onStatus('Point the camera at a barcode…');
    const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    videoElement.srcObject = stream;
    await videoElement.play();

    return new Promise((resolve, reject) => {
      async function tick() {
        if (stopped) { reject(new Error('cancelled')); return; }
        try {
          const codes = await detector.detect(videoElement);
          if (codes.length) {
            resolve(codes[0].rawValue);
            return;
          }
        } catch { /* keep trying on transient detection errors */ }
        requestAnimationFrame(tick);
      }
      tick();
    });
  })();

  const stop = () => {
    stopped = true;
    if (stream) stream.getTracks().forEach(track => track.stop());
  };

  return { promise, stop };
}

function scanWithLibrary(videoElement, fallbackContainer, onStatus) {
  let stopped = false;
  let scanner = null;
  let rejectActive = null;

  const promise = (async () => {
    if (onStatus) onStatus('Loading the scanner… the first time can take a few seconds.');
    await loadScannerLibrary();
    if (stopped) throw new Error('cancelled');

    videoElement.hidden = true;
    fallbackContainer.hidden = false;
    const F = window.Html5QrcodeSupportedFormats;
    scanner = new window.Html5Qrcode(fallbackContainer.id, {
      formatsToSupport: [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E],
      verbose: false,
    });
    if (onStatus) onStatus('Point the camera at a barcode…');

    return new Promise((resolve, reject) => {
      rejectActive = reject;
      scanner.start(
        { facingMode: 'environment' },
        { fps: 10 },
        decodedText => resolve(decodedText),
        () => { /* per-frame misses are normal — keep scanning */ }
      ).catch(reject);
    });
  })();

  const stop = () => {
    stopped = true;
    if (rejectActive) rejectActive(new Error('cancelled'));
    if (scanner) {
      // html5-qrcode throws synchronously if the camera never finished
      // starting (e.g. cancel while the permission prompt is open) — cleanup
      // must never propagate an exception into the caller's UI handling.
      try {
        const stopping = scanner.stop();
        if (stopping && stopping.then) stopping.then(() => scanner.clear()).catch(() => {});
      } catch {
        try { scanner.clear(); } catch { /* nothing to clear */ }
      }
    }
    fallbackContainer.hidden = true;
    videoElement.hidden = false;
  };

  return { promise, stop };
}

/** Looks up a scanned barcode on OpenFoodFacts, returning per-100g nutrition or null if unknown. */
export async function lookupBarcode(code) {
  const response = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json`);
  if (!response.ok) return null;
  const data = await response.json();
  if (data.status !== 1 || !data.product) return null;

  const product = data.product;
  const n = product.nutriments || {};
  const per100 = (...keys) => keys.map(k => Number(n[k])).find(Number.isFinite) || 0;

  return {
    name: product.product_name || 'Scanned product',
    servingG: Number(product.serving_quantity) || null,
    per100: {
      calories: per100('energy-kcal_100g', 'energy-kcal'),
      protein: per100('proteins_100g', 'proteins'),
      carbs: per100('carbohydrates_100g', 'carbohydrates'),
      fat: per100('fat_100g', 'fat'),
      fibre: per100('fiber_100g', 'fiber'),
      sugar: per100('sugars_100g', 'sugars'),
    },
  };
}
