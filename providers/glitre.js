// Ekte provider
// Kilde: Glitre Nett sitt ArcGIS/MapServer-endepunkt
// Nettside: https://www.glitrenett.no/

const axios = require('axios');
const proj4 = require('proj4');

const SOURCE_URL =
  'https://gis-dms.glitrenett.no/server/rest/services/Public/SpontanousOutagesPublic_South_2/MapServer/3/query';

const SOURCE_PAGE = 'https://www.glitrenett.no/';

// EPSG:3857 / 102100 -> WGS84
function toLatLng3857(x, y) {
  const [lng, lat] = proj4('EPSG:3857', 'WGS84', [x, y]);
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

function getCustomers(attr) {
  return toNumber(
    attr.antallkunder ||
      attr.CUSTOMERS ||
      attr.customer_count ||
      attr.kunder ||
      0
  );
}

function getStart(attr) {
  return attr.STARTTIME || attr.start || attr.starttime || null;
}

function getEnd(attr) {
  return attr.ENDTIME || attr.end || attr.endtime || null;
}

function getAreaName(attr) {
  return toText(
    attr.kommune ||
      attr.KOMMUNE ||
      attr.poststed ||
      attr.POSTSTED ||
      attr.omrade ||
      attr.area ||
      ''
  );
}

function shouldIncludeOutage(outage) {
  if (!outage) return false;

  if (!isValidCoordinate(outage.lat, outage.lng)) {
    return false;
  }

  if (!outage.id || !outage.company) {
    return false;
  }

  // Glitre ser også ut til å levere støyobjekter med 0 kunder.
  // Disse skjules her i provideren.
  if (outage.customers <= 0) {
    return false;
  }

  return true;
}

module.exports = {
  name: 'Glitre Nett',

  async fetchOutages() {
    try {
      const response = await axios.get(SOURCE_URL, {
        params: {
          f: 'json',
          where: '1=1',
          returnGeometry: true,
          outFields: '*',
          outSR: 102100
        },
        timeout: 15000
      });

      const features = Array.isArray(response.data?.features)
        ? response.data.features
        : [];

      const outages = features
        .map((feature, index) => {
          const attr = feature?.attributes || {};
          const geom = feature?.geometry || {};

          if (typeof geom.x !== 'number' || typeof geom.y !== 'number') {
            return null;
          }

          const { lat, lng } = toLatLng3857(geom.x, geom.y);

          if (!isValidCoordinate(lat, lng)) {
            return null;
          }

          const outage = {
            id: `glitre-${attr.OBJECTID || index}`,
            company: 'Glitre Nett',
            type: 'outage',
            customers: getCustomers(attr),
            lat,
            lng,
            start: getStart(attr),
            end: getEnd(attr),
            areaName: getAreaName(attr),
            sourceUrl: SOURCE_PAGE,
            raw: attr
          };

          return shouldIncludeOutage(outage) ? outage : null;
        })
        .filter(Boolean);

      console.log(`Glitre provider: ${outages.length} hendelser etter provider-filter`);

      return outages;
    } catch (error) {
      console.error('Glitre fetch feilet:', error.message);
      return [];
    }
  }
};