export function isBarcodeScanSupported() {
  return 'BarcodeDetector' in window;
}

/**
 * Opens the back camera into the given <video> element and resolves with the
 * first recognized barcode's raw value. Call the returned `stop()` to cancel
 * (e.g. the user closing the scanner) without waiting for a detection.
 */
export function scanBarcodeFromCamera(videoElement) {
  let stopped = false;
  let stream = null;

  const promise = (async () => {
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
