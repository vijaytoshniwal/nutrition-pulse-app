let tesseractLoading = null;

/** Loads Tesseract.js (in-browser OCR) on demand — it's several MB, so only when first used. */
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve();
  if (tesseractLoading) return tesseractLoading;
  tesseractLoading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    script.onload = resolve;
    script.onerror = () => reject(new Error('Could not load the photo reader. Check your connection.'));
    document.head.appendChild(script);
  });
  return tesseractLoading;
}

export async function recognizeTextInImage(imageSource, onProgress) {
  await loadTesseract();
  const worker = await window.Tesseract.createWorker('eng', 1, {
    logger: info => {
      if (info.status === 'recognizing text' && onProgress) onProgress(Math.round(info.progress * 100));
    },
  });
  try {
    const { data } = await worker.recognize(imageSource);
    return data.text || '';
  } finally {
    worker.terminate();
  }
}

const cleanNumber = raw => Number(String(raw).replace(/[,\s]/g, ''));

/**
 * Pulls steps / active calories / exercise minutes out of OCR text from a
 * fitness-app screenshot. Only returns values it can confidently associate
 * with a keyword — anything ambiguous stays null for the user to fill in.
 */
export function parseActivityFromText(text) {
  const lower = text.toLowerCase();
  const result = { steps: null, burnKcal: null, exMin: null };

  const stepsMatch = lower.match(/([\d,]{2,7})\s*(?:steps?\b)/) || lower.match(/steps?\D{0,12}?([\d,]{2,7})/);
  if (stepsMatch) {
    const value = cleanNumber(stepsMatch[1]);
    if (value > 0 && value < 200000) result.steps = value;
  }

  // "480/500 KCAL" style rings show achieved/goal — the achieved value is the
  // first number of the pair, so capture the pair and keep the left side.
  const kcalMatches = [...lower.matchAll(/([\d,]{2,5})(?:\s*\/\s*[\d,]{2,5})?\s*(?:kcal|calories|cal\b)/g)]
    .map(m => ({ value: cleanNumber(m[1]), index: m.index }));
  if (kcalMatches.length) {
    // Prefer a number whose surrounding text mentions burning/moving, else take the first.
    const preferred = kcalMatches.find(m => /move|active|burn/.test(lower.slice(Math.max(0, m.index - 30), m.index)));
    const chosen = preferred || kcalMatches[0];
    if (chosen.value > 0 && chosen.value < 20000) result.burnKcal = chosen.value;
  }

  const minMatches = [...lower.matchAll(/(\d{1,3})(?:\s*\/\s*\d{1,3})?\s*(?:min\b|minutes?\b)/g)]
    .map(m => ({ value: cleanNumber(m[1]), index: m.index }));
  if (minMatches.length) {
    const preferred = minMatches.find(m => /exercise|workout|activity/.test(lower.slice(Math.max(0, m.index - 30), m.index)));
    const chosen = preferred || minMatches[0];
    if (chosen.value > 0 && chosen.value < 1000) result.exMin = chosen.value;
  }

  return result;
}
