// Ekte provider
// Kilde: Elvia sitt ArcGIS/FeatureServer-endepunkt
// Kartside: https://www.elvia.no/strombruddskart/

const axios = require('axios');
const proj4 = require('proj4');

const SOURCE_URL =
  'https://services-eu1.arcgis.com/AcdYbPzrkOfBOQDL/arcgis/rest/services/avbrudd2_offentlig_visning/FeatureServer/1/query';

const SOURCE_PAGE = 'https://www.elvia.no/strombruddskart/';

// EPSG:25833 (UTM zone 33N) -> WGS84
proj4.defs(
  'EPSG:25833',
  '+proj=utm +zone=33 +ellps=GRS80 +units=m +no_defs'
);

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

function getPolygonCenter(geometry) {
  if (!geometry || !Array.isArray(geometry.rings) || geometry.rings.length === 0) {
    return null;
  }

  const firstRing = geometry.rings[0];
  if (!Array.isArray(firstRing) || firstRing.length === 0) {
    return null;
  }

  let minX = firstRing[0][0];
  let maxX = firstRing[0][0];
  let minY = firstRing[0][1];
  let maxY = firstRing[0][1];

  for (const point of firstRing) {
    if (!Array.isArray(point) || point.length < 2) continue;

    const x = point[0];
    const y = point[1];

    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  return {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2
  };
}

function toLatLng25833(x, y) {
  const [lng, lat] = proj4('EPSG:25833', 'WGS84', [x, y]);
  return { lat, lng };
}

function detectType(attr) {
  const typeText = toText(attr.avbruddstype).toLowerCase();

  if (
    typeText.includes('plan') ||
    typeText.includes('varslet') ||
    typeText.includes('vedlikehold')
  ) {
    return 'planned';
  }

  return 'outage';
}

function getCustomers(attr) {
  return toNumber(attr.antallkunder, 0);
}

function getStart(attr) {
  return attr.utkoblingstart || attr.strombruddoppdaget || null;
}

function getEnd(attr) {
  return attr.utkoblingslutt || null;
}

function getAreaName(attr) {
  return [attr.kommune, attr.poststed, attr.nettstasjon]
    .map((value) => toText(value))
    .filter(Boolean)
    .join(' / ');
}

function extractXY(geometry) {
  if (!geometry || typeof geometry !== 'object') {
    return null;
  }

  if (typeof geometry.x === 'number' && typeof geometry.y === 'number') {
    return { x: geometry.x, y: geometry.y };
  }

  const center = getPolygonCenter(geometry);
  if (center && typeof center.x === 'number' && typeof center.y === 'number') {
    return center;
  }

  return null;
}

function shouldIncludeOutage(outage) {
  if (!outage) return false;

  if (!outage.id || !outage.company) {
    return false;
  }

  if (!isValidCoordinate(outage.lat, outage.lng)) {
    return false;
  }

  // Foreløpig beholder vi også hendelser med 0 kunder for Elvia,
  // siden datagrunnlaget kan bruke dette annerledes enn Tensio/Glitre.
  return true;
}

module.exports = {
  name: 'Elvia',

  async fetchOutages() {
    try {
      const response = await axios.get(SOURCE_URL, {
        params: {
          f: 'json',
          where: '1=1',
          returnGeometry: true,
          outFields: [
            'OBJECTID',
            'antallkunder',
            'avbruddstype',
            'kommune',
            'nettstasjon',
            'poststed',
            'strombruddoppdaget',
            'utkoblingslutt',
            'utkoblingstart'
          ].join(','),
          outSR: 25833,
          spatialRel: 'esriSpatialRelIntersects',
          orderByFields: 'OBJECTID ASC'
        },
        timeout: 15000
      });

      const features = Array.isArray(response.data?.features)
        ? response.data.features
        : [];

      const outages = features
        .map((feature) => {
          const attr = feature?.attributes || {};
          const geom = feature?.geometry || {};

          const xy = extractXY(geom);
          if (!xy) {
            return null;
          }

          const { lat, lng } = toLatLng25833(xy.x, xy.y);

          if (!isValidCoordinate(lat, lng)) {
            return null;
          }

          const outage = {
            id: `elvia-${attr.OBJECTID}`,
            company: 'Elvia',
            type: detectType(attr),
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

      console.log(`Elvia provider: ${outages.length} hendelser etter provider-filter`);

      return outages;
    } catch (error) {
      console.error('Elvia fetch feilet:', error.message);
      return [];
    }
  }
};