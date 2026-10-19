// Startowa baza torów. Ta sama lista jest w supabase/schema.sql (seed).
//
// Każdy tor należy do DOKŁADNIE JEDNEJ kategorii samochodu (F1, GT3, LMP, HY): ten sam obiekt
// (np. Spa) występuje osobno dla F1 i dla każdej klasy LMU, z własną nitką toru i filmem z przejazdu.

export const TRACK_CATEGORIES = [
  { id: 'F1', label: 'Formuła 1', series: 'f1' },
  { id: 'HY', label: 'Hypercar', series: 'lmu' },
  { id: 'LMP', label: 'LMP', series: 'lmu' },
  { id: 'GT3', label: 'GT3', series: 'lmu' },
];

/** Kategorie torów dostępne w danej serii (F1 -> F1, LMU -> HY/LMP/GT3). */
export const categoriesForSeries = (series) => TRACK_CATEGORIES.filter((c) => c.series === series);

// [nazwa, kraj, kod ISO, długość km, jest w F1 25, jest w Le Mans Ultimate]
const BASE = [
  ['Bahrain International Circuit', 'Bahrajn', 'BH', 5.412, true, true],
  ['Jeddah Corniche Circuit', 'Arabia Saudyjska', 'SA', 6.174, true, false],
  ['Albert Park', 'Australia', 'AU', 5.278, true, false],
  ['Suzuka', 'Japonia', 'JP', 5.807, true, false],
  ['Shanghai International Circuit', 'Chiny', 'CN', 5.451, true, false],
  ['Miami International Autodrome', 'USA', 'US', 5.412, true, false],
  ['Imola', 'Włochy', 'IT', 4.909, true, true],
  ['Monaco', 'Monako', 'MC', 3.337, true, false],
  ['Circuit Gilles Villeneuve', 'Kanada', 'CA', 4.361, true, false],
  ['Circuit de Barcelona-Catalunya', 'Hiszpania', 'ES', 4.657, true, true],
  ['Red Bull Ring', 'Austria', 'AT', 4.318, true, false],
  ['Silverstone', 'Wielka Brytania', 'GB', 5.891, true, true],
  ['Hungaroring', 'Węgry', 'HU', 4.381, true, false],
  ['Spa-Francorchamps', 'Belgia', 'BE', 7.004, true, true],
  ['Zandvoort', 'Holandia', 'NL', 4.259, true, false],
  ['Monza', 'Włochy', 'IT', 5.793, true, true],
  ['Baku City Circuit', 'Azerbejdżan', 'AZ', 6.003, true, false],
  ['Marina Bay', 'Singapur', 'SG', 4.940, true, false],
  ['Circuit of the Americas', 'USA', 'US', 5.513, true, true],
  ['Autódromo Hermanos Rodríguez', 'Meksyk', 'MX', 4.304, true, false],
  ['Interlagos', 'Brazylia', 'BR', 4.309, true, true],
  ['Las Vegas Strip Circuit', 'USA', 'US', 6.201, true, false],
  ['Lusail International Circuit', 'Katar', 'QA', 5.419, true, true],
  ['Yas Marina', 'ZEA', 'AE', 5.281, true, false],
  ['Madring', 'Hiszpania', 'ES', 5.474, true, false],
  ['Circuit de la Sarthe (Le Mans)', 'Francja', 'FR', 13.626, false, true],
  ['Fuji Speedway', 'Japonia', 'JP', 4.563, false, true],
  ['Sebring International Raceway', 'USA', 'US', 6.019, false, true],
  ['Autódromo Internacional do Algarve (Portimão)', 'Portugalia', 'PT', 4.653, false, true],
  ['Circuit Paul Ricard', 'Francja', 'FR', 5.842, false, true],
];

export const TRACKS_SEED = TRACK_CATEGORIES.flatMap(({ id }) => BASE
  .filter(([, , , , f1, lmu]) => (id === 'F1' ? f1 : lmu))
  .map(([name, country, country_code, length_km]) => ({ name, country, country_code, length_km, category: id, layout_url: null, video_url: null })));
