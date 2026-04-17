// Ekte provider
// Kilde: BKK sitt ArcGIS/FeatureServer-endepunkt
// Kartside: https://geonis.bkk.no/

const axios = require('axios');
const proj4 = require('proj4');

const SOURCE_URL =
  'https://geonis.bkk.no/arcgiscustom/rest/services/DMSEkstern/StromstansEkstern/FeatureServer/0/query';

const SOURCE_PAGE = 'https://geonis.bkk.no/';

// EPSG:25832 -> WGS84
proj4.defs(
  'EPSG:25832',
  '+proj=utm +zone=32 +ellps=GRS80 +units=m +no_defs'
);

function toLatLng25832(x, y) {
  const [lng, lat] = proj4('EPSG:25832', 'WGS84', [x, y]);
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
      attr.KUNDER ||
      attr.kunder ||
      attr.CUSTOMERS ||
      0
  );
}

function getStart(attr) {
  return attr.START || attr.start || attr.starttime || null;
}

function getEnd(attr) {
  return attr.END || attr.end || attr.endtime || null;
}

function getAreaName(attr) {
  return toText(
    attr.KOMMUNE ||
      attr.kommune ||
      attr.POSTSTED ||
      attr.poststed ||
      attr.omrade ||
      attr.area ||
      ''
  );
}

function shouldIncludeOutage(outage) {
  if (!outage) return false;

  if (!outage.id || !outage.company) {
    return false;
  }

  if (!isValidCoordinate(outage.lat, outage.lng)) {
    return false;
  }

  // Foreløpig beholder vi også hendelser med 0 kunder for BKK.
  // Endres senere hvis BKK viser samme støyprofil som Tensio/Glitre.
  return true;
}

module.exports = {
  name: 'BKK',

  async fetchOutages() {
    try {
      const response = await axios.get(SOURCE_URL, {
        params: {
          where: '1=1',
          outFields: '*',
          returnGeometry: true,
          outSR: 25832,
          f: 'json'
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

          const { lat, lng } = toLatLng25832(geom.x, geom.y);

          if (!isValidCoordinate(lat, lng)) {
            return null;
          }

          const outage = {
            id: `bkk-${attr.OBJECTID || index}`,
            company: 'BKK',
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

      console.log(`BKK provider: ${outages.length} hendelser etter provider-filter`);

      return outages;
    } catch (error) {
      console.error('BKK fetch feilet:', error.message);
      return [];
    }
  }
};