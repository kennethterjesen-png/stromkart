// Ekte provider
// Kilde: Tensio sitt ArcGIS/FeatureServer-endepunkt
// Kartside: https://www.tensio.no/no/kunde/strombruddskart

const axios = require('axios');

const SOURCE_URL =
  'https://kart.tensio.no/enterprise/rest/services/Hosted/StromstansHistoricalTN/FeatureServer/0/query';

const SOURCE_PAGE = 'https://www.tensio.no/no/kunde/strombruddskart';

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

function detectType(props) {
  const typeText = toText(
    props.avbruddstype ||
      props.type ||
      props.TYPE ||
      props.status ||
      props.STATUS ||
      ''
  ).toLowerCase();

  if (
    typeText.includes('plan') ||
    typeText.includes('varslet') ||
    typeText.includes('vedlikehold')
  ) {
    return 'planned';
  }

  return 'outage';
}

function getCustomers(props) {
  return toNumber(
    props.antallkunder ||
      props.kunder ||
      props.CUSTOMERS ||
      props.customer_count ||
      0
  );
}

function getStart(props) {
  return (
    props.utkoblingstart ||
    props.start ||
    props.STARTTIME ||
    props.starttime ||
    props.strombruddoppdaget ||
    null
  );
}

function getEnd(props) {
  return (
    props.utkoblingslutt ||
    props.end ||
    props.ENDTIME ||
    props.endtime ||
    null
  );
}

function getAreaName(props) {
  return toText(
    props.kommune ||
      props.KOMMUNE ||
      props.poststed ||
      props.POSTSTED ||
      props.omrade ||
      props.area ||
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

  // Tensio ser ut til å returnere mange tekniske/støy-objekter med 0 kunder.
  // Disse skjules allerede her i provideren for å redusere støy tidlig.
  if (outage.customers <= 0) {
    return false;
  }

  return true;
}

module.exports = {
  name: 'Tensio',

  async fetchOutages() {
    try {
      const response = await axios.get(SOURCE_URL, {
        params: {
          where: '1=1',
          outFields: '*',
          returnGeometry: true,
          outSR: 4326,
          f: 'geojson'
        },
        timeout: 15000
      });

      const features = Array.isArray(response.data?.features)
        ? response.data.features
        : [];

      const outages = features
        .map((feature, index) => {
          const props = feature?.properties || {};
          const geom = feature?.geometry || {};

          if (
            geom.type !== 'Point' ||
            !Array.isArray(geom.coordinates) ||
            geom.coordinates.length < 2
          ) {
            return null;
          }

          const lng = Number(geom.coordinates[0]);
          const lat = Number(geom.coordinates[1]);

          if (!isValidCoordinate(lat, lng)) {
            return null;
          }

          const outage = {
            id: `tensio-${props.OBJECTID || props.objectid || props.seq_no || index}`,
            company: 'Tensio',
            type: detectType(props),
            customers: getCustomers(props),
            lat,
            lng,
            start: getStart(props),
            end: getEnd(props),
            areaName: getAreaName(props),
            sourceUrl: SOURCE_PAGE,
            raw: props
          };

          return shouldIncludeOutage(outage) ? outage : null;
        })
        .filter(Boolean);

      console.log(`Tensio provider: ${outages.length} hendelser etter provider-filter`);

      return outages;
    } catch (error) {
      console.error('Tensio fetch feilet:', error.message);
      return [];
    }
  }
};