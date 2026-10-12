const CITY_ALIASES: Record<string, string> = {
  'dana pt': 'dana point',
  'sj clemente': 'san clemente',
  's clemente': 'san clemente',
  newport: 'newport beach',
  hb: 'huntington beach',
};

export const OC_CITY_CENTERS: Record<string, { lat: number; lng: number }> = {
  'aliso viejo': { lat: 33.5767, lng: -117.7256 },
  anaheim: { lat: 33.8366, lng: -117.9143 },
  brea: { lat: 33.9167, lng: -117.9001 },
  'buena park': { lat: 33.8675, lng: -117.9981 },
  'costa mesa': { lat: 33.6411, lng: -117.9187 },
  'coto de caza': { lat: 33.5961, lng: -117.5862 },
  cypress: { lat: 33.8169, lng: -118.0373 },
  'dana point': { lat: 33.4669, lng: -117.6981 },
  'fountain valley': { lat: 33.7092, lng: -117.9537 },
  fullerton: { lat: 33.8704, lng: -117.9243 },
  'garden grove': { lat: 33.7739, lng: -117.9414 },
  'huntington beach': { lat: 33.6595, lng: -117.9988 },
  irvine: { lat: 33.6846, lng: -117.8265 },
  'la habra': { lat: 33.9319, lng: -117.9461 },
  'laguna beach': { lat: 33.5427, lng: -117.7854 },
  'laguna hills': { lat: 33.6125, lng: -117.7128 },
  'laguna niguel': { lat: 33.5225, lng: -117.7076 },
  'laguna woods': { lat: 33.6103, lng: -117.7253 },
  'lake forest': { lat: 33.6469, lng: -117.6892 },
  'ladera ranch': { lat: 33.5706, lng: -117.635 },
  'los alamitos': { lat: 33.8031, lng: -118.0717 },
  'mission viejo': { lat: 33.6006, lng: -117.672 },
  'newport beach': { lat: 33.6189, lng: -117.9298 },
  orange: { lat: 33.7879, lng: -117.8531 },
  placentia: { lat: 33.8722, lng: -117.8703 },
  'rancho santa margarita': { lat: 33.6409, lng: -117.6031 },
  'san clemente': { lat: 33.427, lng: -117.612 },
  'san juan capistrano': { lat: 33.5017, lng: -117.6626 },
  'santa ana': { lat: 33.7455, lng: -117.8677 },
  'seal beach': { lat: 33.7414, lng: -118.1048 },
  stanton: { lat: 33.8025, lng: -117.9931 },
  tustin: { lat: 33.7458, lng: -117.8264 },
  'villa park': { lat: 33.8145, lng: -117.8131 },
  westminster: { lat: 33.7513, lng: -117.9939 },
  'yorba linda': { lat: 33.8886, lng: -117.8131 },
};

export function normalizeCityName(value: string) {
  const cleaned = String(value || '')
    .toLowerCase()
    .replace(/\bcalifornia\b|\bca\b/g, ' ')
    .replace(/\bpt\.?\b/g, 'point')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return CITY_ALIASES[cleaned] || cleaned;
}

export function lookupCityCenter(name: string) {
  return OC_CITY_CENTERS[normalizeCityName(name)] || null;
}

export function milesBetween(aLat: number, aLng: number, bLat: number, bLng: number) {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * 3958.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}
