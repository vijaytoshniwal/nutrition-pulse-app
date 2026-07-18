function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/**
 * Difference hash (dHash): resize to 9x8 grayscale and encode whether each
 * pixel is brighter than its right neighbour. Similar photos of the same
 * physical item (same packaging, roughly the same framing) produce hashes
 * a small Hamming distance apart, without needing any AI vision service.
 * dHash alone is illumination-based and color-blind (two differently-colored
 * but equally flat photos can hash identically), so this pairs it with a
 * coarse average-color fingerprint to cut down on false matches.
 */
export async function computeImageHash(dataUrl) {
  const img = await loadImage(dataUrl);
  const width = 9;
  const height = 8;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);

  const gray = [];
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < data.length; i += 4) {
    gray.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
  }
  const pixelCount = width * height;

  let bits = '';
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width - 1; x++) {
      bits += gray[y * width + x] < gray[y * width + x + 1] ? '1' : '0';
    }
  }

  return {
    dhash: BigInt('0b' + bits).toString(16).padStart(16, '0'),
    avgColor: [Math.round(r / pixelCount), Math.round(g / pixelCount), Math.round(b / pixelCount)],
  };
}

export function hashDistance(a, b) {
  let xor = BigInt('0x' + a.dhash) ^ BigInt('0x' + b.dhash);
  let structDist = 0;
  while (xor > 0n) {
    structDist += Number(xor & 1n);
    xor >>= 1n;
  }
  const colorDist = Math.sqrt(
    (a.avgColor[0] - b.avgColor[0]) ** 2 +
    (a.avgColor[1] - b.avgColor[1]) ** 2 +
    (a.avgColor[2] - b.avgColor[2]) ** 2
  );
  return { structDist, colorDist };
}

export function isSimilarPhoto(a, b, structThreshold = 10, colorThreshold = 30) {
  const { structDist, colorDist } = hashDistance(a, b);
  return structDist <= structThreshold && colorDist <= colorThreshold;
}
