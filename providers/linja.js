// Ekte provider
// Kilde: Linja sine offentlige ArcGIS/MapServer-endepunkt
// Kartside: https://www.linja.no/straumbrot

const axios = require('axios');
const proj4 = require('proj4');

const ACTIVE_URL =
  'https://map.linja.no/public/rest/services/Ekstern/Stromstans/MapServer/0/query';

const PLANNED_URL =
  'https://map.linja.no/public/rest/services/Ekstern/PlanlagtUtkobling/MapServer/0/query';

const SOURCE_PAGE = 'https://www.linja.no/straumbrot';

// EPSG:32632 -> WGS84
proj4.defs(
  'EPSG:32632',
  '+proj=utm +zone=32 +datum=WGS84 +units=m +no_defs'
);

function toLatLng32632(x, y) {
  const [lng, lat] = proj4('EPSG:32632', 'WGS84', [x, y]);
  return { lat, lng };
}

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function toText(value, fallback = '') {
  if (value == null) return fallback;
  return String(value).trim();
}

function isValidCoordinate(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng);
}

function getAreaName(attr) {
  return [attr.MUNICIPAL_TXT, attr.PURCHAREA_TXT]
    .map((value) => toText(value))
    .filter(Boolean)
    .join(' / ');
}

function mapFeatureToOutage(feature, type, index) {
  const attr = feature?.attributes || {};
  const geom = feature?.geometry || {};

  if (typeof geom.x !== 'number' || typeof geom.y !== 'number') {
    return null;
  }

  const { lat, lng } = toLatLng32632(geom.x, geom.y);

  if (!isValidCoordinate(lat, lng)) {
    return null;
  }

  const eventId = attr.EVENTID ?? index;

  return {
    id: `linja-${type}-${eventId}`,
    company: 'Linja',
    type,
    customers: toNumber(attr.NUM_AB, 0),
    lat,
    lng,
    start: attr.STARTTIME || null,
    end: null,
    areaName: getAreaName(attr),
    sourceUrl: SOURCE_PAGE,
    raw: attr
  };
}

async function fetchLayer(url, type) {
  const response = await axios.get(url, {
    params: {
      f: 'json',
      where: '1=1',
      returnGeometry: true,
      outFields: '*',
      outSR: 32632
    },
    timeout: 15000
  });

  const features = Array.isArray(response.data?.features)
    ? response.data.features
    : [];

  return features
    .map((feature, index) => mapFeatureToOutage(feature, type, index))
    .filter(Boolean);
}

module.exports = {
  name: 'Linja',

  async fetchOutages() {
    try {
      const [activeOutages, plannedOutages] = await Promise.all([
        fetchLayer(ACTIVE_URL, 'outage'),
        fetchLayer(PLANNED_URL, 'planned')
      ]);

      const outages = [...activeOutages, ...plannedOutages];

      console.log(`Linja provider: ${outages.length} hendelser totalt`);

      return outages;
    } catch (error) {
      console.error('Linja fetch feilet:', error.message);
      return [];
    }
  }
};