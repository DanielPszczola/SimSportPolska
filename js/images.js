// Przygotowanie obrazka przed wysłaniem: zmniejszenie w przeglądarce i zapis jako WebP
// (zachowuje przezroczystość). Dzięki temu wgrany plik waży kilkadziesiąt KB zamiast kilku MB.

export const IMAGE_SIZES = {
  logo: { maxW: 256, maxH: 256 },
  car: { maxW: 900, maxH: 260 },
  track: { maxW: 900, maxH: 700 },
  post: { maxW: 1200, maxH: 800 },
};

const MAX_INPUT = 15 * 1024 * 1024;

function checkImage(file) {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') {
    throw new Error('Wybierz plik graficzny PNG, JPG albo WebP');
  }
  if (file.size > MAX_INPUT) throw new Error('Plik jest za duży (maks. 15 MB)');
}

export async function prepareImage(file, kind) {
  checkImage(file);
  const { maxW, maxH } = IMAGE_SIZES[kind];
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, maxW / bmp.width, maxH / bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * s);
  canvas.height = Math.round(bmp.height * s);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  // przeglądarki bez WebP zwrócą PNG — też jest w porządku
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Nie udało się przetworzyć obrazka'))), 'image/webp', 0.88));
}

// Zdjęcie w zgłoszeniu (np. zrzut z gry): tekst na obrazie musi zostać czytelny, a baza przyjmuje najwyżej 1 MB.
// Rysowanie na nowo usuwa też metadane pliku (np. lokalizację ze zdjęcia z telefonu).
const PROOF_MAX_BYTES = 1024 * 1024;
const PROOF_MAX = { w: 2560, h: 1440 };

const encode = async (canvas, quality) => {
  const toBlob = (type) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  const webp = await toBlob('image/webp');
  return webp?.type === 'image/webp' ? webp : toBlob('image/jpeg'); // przeglądarki bez zapisu WebP
};

export async function prepareProof(file) {
  checkImage(file);
  let bmp;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    throw new Error('Nie udało się odczytać zdjęcia — zapisz je jako PNG albo JPG');
  }
  const fit = Math.min(1, PROOF_MAX.w / bmp.width, PROOF_MAX.h / bmp.height);
  try {
    for (const scale of [1, 0.75, 0.5]) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bmp.width * fit * scale);
      canvas.height = Math.round(bmp.height * fit * scale);
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.85, 0.7, 0.5]) {
        const blob = await encode(canvas, quality);
        if (blob && blob.size <= PROOF_MAX_BYTES) return blob;
      }
    }
  } finally {
    bmp.close?.();
  }
  throw new Error('Nie udało się zmniejszyć zdjęcia do 1 MB');
}

/** Zawartość pliku w base64 (bez nagłówka data:). */
export const blobToBase64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1]);
  r.onerror = () => reject(new Error('Nie udało się odczytać pliku'));
  r.readAsDataURL(blob);
});
