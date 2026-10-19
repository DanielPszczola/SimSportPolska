// Gotowe grafiki dostarczone razem ze stroną (folder assets/teams) — opcjonalna podpowiedź.
// Podstawowy sposób to wgranie własnego pliku w formularzu zespołu (Start sezonu → Zespoły).

const t = (slug) => `assets/teams/${slug}`;

/** Zespoły F1 2026: oficjalna nazwa, kolor, logo i bolid — szablon do szybkiego startu sezonu. */
export const F1_TEAMS_2026 = [
  { slug: 'mclaren', short: 'McLaren', name: 'McLaren Formula 1 Team', color: '#FF8000' },
  { slug: 'ferrari', short: 'Ferrari', name: 'Scuderia Ferrari HP', color: '#E8002D' },
  { slug: 'red-bull', short: 'Red Bull', name: 'Oracle Red Bull Racing', color: '#3671C6' },
  { slug: 'mercedes', short: 'Mercedes', name: 'Mercedes-AMG Petronas F1 Team', color: '#27F4D2' },
  { slug: 'aston-martin', short: 'Aston Martin', name: 'Aston Martin Aramco F1 Team', color: '#229971' },
  { slug: 'alpine', short: 'Alpine', name: 'BWT Alpine F1 Team', color: '#0093CC' },
  { slug: 'williams', short: 'Williams', name: 'Atlassian Williams Racing', color: '#1868DB' },
  { slug: 'racing-bulls', short: 'Racing Bulls', name: 'Visa Cash App Racing Bulls', color: '#6692FF' },
  { slug: 'haas', short: 'Haas', name: 'TGR Haas F1 Team', color: '#B6BABD' },
  { slug: 'audi', short: 'Audi', name: 'Audi Revolut F1 Team', color: '#FF2D1A' },
  { slug: 'cadillac', short: 'Cadillac', name: 'Cadillac Formula 1 Team', color: '#D4AF37' },
].map((x) => ({ ...x, logo_url: `${t(x.slug)}/logo.png`, car_url: `${t(x.slug)}/car-2026.png` }));

/** Zespół w barwach ligi (sezony Endurance w LMU). */
export const LEAGUE_TEAM = { name: 'Sim Sport Polska', color: '#C6F432', logo_url: 'assets/logo.png' };

export const LOGO_PRESETS = [
  ...F1_TEAMS_2026.map((x) => ({ label: x.short, url: x.logo_url })),
  { label: LEAGUE_TEAM.name, url: LEAGUE_TEAM.logo_url },
];

export const CAR_PRESETS = F1_TEAMS_2026.map((x) => ({ label: `${x.short} 2026`, url: x.car_url }));

/**
 * Samochody dostępne w Le Mans Ultimate (podpowiedź przy dodawaniu aut do sezonu ligi LMU).
 * Kolor = kolor marki na stronie. Listę można dowolnie uzupełniać.
 */
export const LMU_CARS = [
  // Hypercar
  { name: 'Toyota GR010 Hybrid', car_class: 'HY', color: '#EB0A1E' },
  { name: 'Ferrari 499P', car_class: 'HY', color: '#DC0000' },
  { name: 'Porsche 963', car_class: 'HY', color: '#D5001C' },
  { name: 'Cadillac V-Series.R', car_class: 'HY', color: '#C9A227' },
  { name: 'BMW M Hybrid V8', car_class: 'HY', color: '#1C69D4' },
  { name: 'Peugeot 9X8', car_class: 'HY', color: '#6EC1E4' },
  { name: 'Alpine A424', car_class: 'HY', color: '#0093CC' },
  { name: 'Lamborghini SC63', car_class: 'HY', color: '#9ACD32' },
  { name: 'Aston Martin Valkyrie AMR-LMH', car_class: 'HY', color: '#229971' },
  { name: 'Isotta Fraschini Tipo6-C', car_class: 'HY', color: '#8B0000' },
  { name: 'Glickenhaus SCG 007', car_class: 'HY', color: '#B22222' },
  { name: 'Vanwall Vandervell 680', car_class: 'HY', color: '#2E8B57' },
  // LMP
  { name: 'Oreca 07 Gibson (LMP2)', car_class: 'LMP', color: '#3B82F6' },
  { name: 'Ligier JS P325 (LMP3)', car_class: 'LMP', color: '#1E40AF' },
  { name: 'Ginetta G61-LT-P3 Evo (LMP3)', car_class: 'LMP', color: '#60A5FA' },
  { name: 'Duqueine D09 (LMP3)', car_class: 'LMP', color: '#93C5FD' },
  // GT3
  { name: 'Aston Martin Vantage AMR LMGT3', car_class: 'GT3', color: '#229971' },
  { name: 'BMW M4 LMGT3', car_class: 'GT3', color: '#1C69D4' },
  { name: 'Corvette Z06 LMGT3.R', car_class: 'GT3', color: '#F2C200' },
  { name: 'Ferrari 296 LMGT3', car_class: 'GT3', color: '#DC0000' },
  { name: 'Ford Mustang LMGT3', car_class: 'GT3', color: '#2F6FD6' },
  { name: 'Lamborghini Huracán LMGT3 Evo2', car_class: 'GT3', color: '#9ACD32' },
  { name: 'Lexus RC F LMGT3', car_class: 'GT3', color: '#9CA3AF' },
  { name: 'McLaren 720S LMGT3 Evo', car_class: 'GT3', color: '#FF8000' },
  { name: 'Mercedes-AMG LMGT3', car_class: 'GT3', color: '#27F4D2' },
  { name: 'Porsche 911 GT3 R LMGT3', car_class: 'GT3', color: '#D5001C' },
];
