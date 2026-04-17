// Ekte provider
// Kilde: ArcGIS MapServer - DRS / Stromstans_public
// Lag 0 = Planlagt
// Lag 1 = Påbegynt

const axios = require('axios');

const PLANNED_URL =
  'https://utility.arcgis.com/usrsvcs/servers/d76865927ade4b598be0004b14c5bc93/rest/services/DRS/Stromstans_public/MapServer/0/query';

const ACTIVE_URL =
  'https://utility.arcgis.com/usrsvcs/servers/d76865927ade4b598be0004b14c5bc93/rest/services/DRS/Stromstans_public/MapServer/1/query';

const SOURCE_PAGE =
  'https://utility.arcgis.com/usrsvcs/servers/d76865927ade4b598be0004b14c5bc93/rest/services/DRS/Stromstans_public/MapServer';

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

function formatArcgisDate(value) {
  if (!value) return null;

  if (typeof value === 'number' || /^\d+$/.test(String(value))) {
    const date = new Date(Number(value));
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) {
    return date.toISOString();
  }

  return String(value);
}

function getAreaName(attr) {
  return (
    toText(attr.SEKUNDÆRSTASJON) ||
    toText(attr.AVGANG) ||
    toText(attr.STATUS) ||
    toText(attr.REFNR) ||
    'Ukjent område'
  );
}

function getDescription(attr) {
  return toText(attr.BESKRIVELSE);
}

function getId(attr, type, index) {
  return (
    `norgesnett-${type}-` +
    (
      toText(attr.STROMSTANSID) ||
      toText(attr.REFNR) ||
      toText(attr.OBJECTID) ||
      index
    )
  );
}

function mapFeatureToOutage(feature, type, index) {
  const attr = feature?.attributes || {};
  const geom = feature?.geometry || {};

  const lat = Number(geom.y);
  const lng = Number(geom.x);

  if (!isValidCoordinate(lat, lng)) {
    return null;
  }

  return {
    id: getId(attr, type, index),
    company: 'Norgesnett',
    type,
    customers: toNumber(attr.CNT, 0),
    lat,
    lng,
    start: formatArcgisDate(attr.FRA_DATO),
    end: formatArcgisDate(attr.TIL_DATO),
    areaName: getAreaName(attr),
    sourceUrl: SOURCE_PAGE,
    raw: {
      ...attr,
      description: getDescription(attr)
    }
  };
}

async function fetchLayer(url, type) {
  const response = await axios.get(url, {
    params: {
      f: 'json',
      where: '1=1',
      outFields: '*',
      returnGeometry: true,
      outSR: 4326
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
  name: 'Norgesnett',

  async fetchOutages() {
    try {
      const [plannedOutages, activeOutages] = await Promise.all([
        fetchLayer(PLANNED_URL, 'planned'),
        fetchLayer(ACTIVE_URL, 'outage')
      ]);

      const outages = [...plannedOutages, ...activeOutages];

      console.log(`Norgesnett provider: ${outages.length} hendelser etter provider-filter`);

      return outages;
    } catch (error) {
      console.error('Norgesnett fetch feilet:', error.message);
      return [];
    }
  }
};