// Przygotowanie obrazka przed wysłaniem: zmniejszenie w przeglądarce i zapis jako WebP
// (zachowuje przezroczystość). Dzięki temu wgrany plik waży kilkadziesiąt KB zamiast kilku MB.

export const IMAGE_SIZES = {
  logo: { maxW: 256, maxH: 256 },
  car: { maxW: 900, maxH: 260 },
  track: { maxW: 900, maxH: 700 },
};

const MAX_INPUT = 15 * 1024 * 1024;

export async function prepareImage(file, kind) {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') {
    throw new Error('Wybierz plik graficzny PNG, JPG albo WebP');
  }
  if (file.size > MAX_INPUT) throw new Error('Plik jest za duży (maks. 15 MB)');
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
