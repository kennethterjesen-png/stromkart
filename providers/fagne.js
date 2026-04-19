const QUERY_URL =
  'https://kart.fagne.no/arcgis/rest/services/ADMS/StromstansPublic/FeatureServer/0/query?where=1%3D1&outFields=*&returnGeometry=true&f=json';

const SOURCE_URL = 'https://fagne.no/stromstans-og-feil/stromstans/';

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function safeString(value, fallback = '') {
  if (value === null || value === undefined || value === '') return fallback;
  return String(value).trim();
}

function formatDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('no-NO');
}

// UTM zone 32N (EPSG:32632) -> WGS84
function utm32ToLatLng(x, y) {
  const a = 6378137.0;
  const e = 0.081819191;
  const e1sq = 0.006739497;
  const k0 = 0.9996;

  const arc = y / k0;
  const mu =
    arc /
    (a *
      (1 -
        Math.pow(e, 2) / 4 -
        (3 * Math.pow(e, 4)) / 64 -
        (5 * Math.pow(e, 6)) / 256));

  const ei =
    (1 - Math.sqrt(1 - e * e)) / (1 + Math.sqrt(1 - e * e));

  const ca = (3 * ei) / 2 - (27 * Math.pow(ei, 3)) / 32;
  const cb = (21 * Math.pow(ei, 2)) / 16 - (55 * Math.pow(ei, 4)) / 32;
  const cc = (151 * Math.pow(ei, 3)) / 96;
  const cd = (1097 * Math.pow(ei, 4)) / 512;

  const phi1 =
    mu +
    ca * Math.sin(2 * mu) +
    cb * Math.sin(4 * mu) +
    cc * Math.sin(6 * mu) +
    cd * Math.sin(8 * mu);

  const n0 = a / Math.sqrt(1 - Math.pow(e * Math.sin(phi1), 2));
  const r0 =
    (a * (1 - e * e)) /
    Math.pow(1 - Math.pow(e * Math.sin(phi1), 2), 1.5);
  const fact1 = (n0 * Math.tan(phi1)) / r0;

  const a1 = 500000 - x;
  const dd0 = a1 / (n0 * k0);
  const fact2 = (dd0 * dd0) / 2;

  const t0 = Math.pow(Math.tan(phi1), 2);
  const Q0 = e1sq * Math.pow(Math.cos(phi1), 2);
  const fact3 =
    ((5 + 3 * t0 + 10 * Q0 - 4 * Q0 * Q0 - 9 * e1sq) *
      Math.pow(dd0, 4)) /
    24;
  const fact4 =
    ((61 +
      90 * t0 +
      298 * Q0 +
      45 * t0 * t0 -
      252 * e1sq -
      3 * Q0 * Q0) *
      Math.pow(dd0, 6)) /
    720;

  const lof1 = a1 / (n0 * k0);
  const lof2 =
    ((1 + 2 * t0 + Q0) * Math.pow(dd0, 3)) / 6;
  const lof3 =
    ((5 -
      2 * Q0 +
      28 * t0 -
      3 * Math.pow(Q0, 2) +
      8 * e1sq +
      24 * Math.pow(t0, 2)) *
      Math.pow(dd0, 5)) /
    120;
  const a2 = (lof1 - lof2 + lof3) / Math.cos(phi1);

  let latitude = phi1 - fact1 * (fact2 + fact3 + fact4);
  latitude = (latitude * 180) / Math.PI;

  let longitude = 9 - (a2 * 180) / Math.PI;

  return {
    lat: latitude,
    lng: longitude
  };
}

function normalizeType(typeTxt) {
  const raw = safeString(typeTxt, '').toLowerCase();

  if (raw.includes('utkobling')) return 'planned';
  if (raw.includes('driftsforstyrrelse')) return 'outage';

  return 'outage';
}

function normalizeFeature(feature) {
  const attr = feature?.attributes || {};
  const geom = feature?.geometry || {};

  const x = safeNumber(geom.x, NaN);
  const y = safeNumber(geom.y, NaN);

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  const { lat, lng } = utm32ToLatLng(x, y);

  const type = normalizeType(attr.TYPE_TXT);
  const areaName = safeString(attr.MUNICIPAL_TXT, 'Ukjent område');

  return {
    id: `fagne-${safeString(attr.EVENTID, 'unknown')}`,
    company: 'Fagne',
    type,
    customers: safeNumber(attr.NUM_AB, 0),
    lat,
    lng,
    start: formatDate(attr.STARTTIME),
    end: formatDate(attr.TIMELIMIT),
    areaName,
    sourceUrl: SOURCE_URL,
    raw: {
      description: safeString(attr.CUSTOMER_WEB_TEXT, ''),
      state: safeString(attr.STATE_TXT, ''),
      municipal: safeString(attr.MUNICIPAL_TXT, ''),
      typeTxt: safeString(attr.TYPE_TXT, ''),
      issueStateChangeEmail: safeString(attr.ISSUESTATECHANGEEMAIL, '')
    }
  };
}

async function fetchOutages() {
  try {
    const response = await fetch(QUERY_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    const features = Array.isArray(data?.features) ? data.features : [];

    const outages = features
      .map(normalizeFeature)
      .filter(Boolean);

    console.log(`Fagne provider: ${outages.length} hendelser etter provider-filter`);

    return outages;
  } catch (error) {
    console.error(`Fagne provider feil: ${error.message}`);
    return [];
  }
}

module.exports = {
  name: 'Fagne',
  fetchOutages
};