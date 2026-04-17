// Ekte provider
// Kilde: Lnett/Lyse sitt KML-baserte driftskart
// Kartside: https://www.lysenett.no/map/fullscreen-map.html
// Datakilde: https://kart.lyse.no/gisadapter/rest/directories/arcgisoutput/DriftsmeldingKML/geoms.xml

const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');

const SOURCE_URL =
  'https://kart.lyse.no/gisadapter/rest/directories/arcgisoutput/DriftsmeldingKML/geoms.xml';

const SOURCE_PAGE = 'https://www.lysenett.no/map/fullscreen-map.html';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
  parseTagValue: false
});

function toText(value, fallback = '') {
  if (value == null) return fallback;
  return String(value).trim();
}

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function isValidCoordinate(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng);
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function stripHtml(value) {
  return toText(value)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+\n/g, '\n')
    .replace(/\n\s+/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function parseCoordinates(coordText) {
  const text = toText(coordText);
  if (!text) return null;

  const first = text.split(/\s+/)[0];
  const parts = first.split(',');

  if (parts.length < 2) return null;

  const lng = Number(parts[0]);
  const lat = Number(parts[1]);

  if (!isValidCoordinate(lat, lng)) {
    return null;
  }

  return { lat, lng };
}

function detectTypeFromStyle(styleUrl, name, description) {
  const style = toText(styleUrl).toLowerCase();
  const text = `${toText(name)} ${toText(description)}`.toLowerCase();

  if (style === '#yellow' || text.includes('planlagt')) {
    return 'planned';
  }

  if (style === '#green' || text.includes('feil rettet')) {
    return 'resolved';
  }

  if (style === '#red' || text.includes('strømbrudd') || text.includes('strombrudd')) {
    return 'outage';
  }

  return 'outage';
}

function extractCustomers(name, description) {
  const text = `${stripHtml(name)}\n${stripHtml(description)}`;

  const patterns = [
    /berørte\s*kunder\s*:\s*([0-9]+)/i,
    /berorte\s*kunder\s*:\s*([0-9]+)/i,
    /antall\s*kunder\s*:\s*([0-9]+)/i,
    /kunder\s*:\s*([0-9]+)/i,
    /kunder[^0-9]*([0-9]+)/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return toNumber(match[1], 0);
    }
  }

  return 0;
}

function extractStart(description) {
  const clean = stripHtml(description);

  const patterns = [
    /startet\s*:\s*([0-9]{4}-[0-9]{2}-[0-9]{2}\s+[0-9]{2}:[0-9]{2})/i,
    /(start|fra|oppdaget)\s*:\s*([0-9]{4}-[0-9]{2}-[0-9]{2}\s+[0-9]{2}:[0-9]{2})/i,
    /([0-9]{4}-[0-9]{2}-[0-9]{2}\s+[0-9]{2}:[0-9]{2})/
  ];

  for (const pattern of patterns) {
    const match = clean.match(pattern);
    if (match) {
      return match[2] || match[1] || null;
    }
  }

  return null;
}

function extractAreaName(name, description, type) {
  const cleanName = stripHtml(name);
  const cleanDescription = stripHtml(description);

  // Hvis name bare er "Berørte kunder: X", er det ikke et områdenavn.
  const isCustomerOnlyTitle = /^berørte\s*kunder\s*:\s*\d+$/i.test(cleanName);

  if (!isCustomerOnlyTitle && cleanName) {
    return cleanName;
  }

  // Prøv å finne et kort område fra teksten hvis mulig.
  const patterns = [
    /område\s*:\s*([^\n.]+)/i,
    /sted\s*:\s*([^\n.]+)/i,
    /poststed\s*:\s*([^\n.]+)/i
  ];

  for (const pattern of patterns) {
    const match = cleanDescription.match(pattern);
    if (match && match[1]) {
      return toText(match[1]);
    }
  }

  // Hvis vi ikke finner område, bruk en kort og ryddig fallback
  return type === 'planned' ? 'Planlagt vedlikehold' : 'Driftsforstyrrelse';
}

function getPlacemarks(parsed) {
  const kml = parsed?.kml || parsed?.xml || parsed;
  const documentNode = kml?.Document || kml?.document || null;
  if (!documentNode) return [];

  const folders = asArray(documentNode.Folder);
  const directPlacemarks = asArray(documentNode.Placemark);
  const folderPlacemarks = folders.flatMap((folder) => asArray(folder?.Placemark));

  return [...directPlacemarks, ...folderPlacemarks];
}

function mapPlacemarkToOutage(placemark, index) {
  const name = placemark?.name || '';
  const description = placemark?.description || '';
  const styleUrl = placemark?.styleUrl || '';

  const pointCoords =
    placemark?.Point?.coordinates ||
    placemark?.MultiGeometry?.Point?.coordinates ||
    null;

  const coords = parseCoordinates(pointCoords);
  if (!coords) {
    return null;
  }

  const type = detectTypeFromStyle(styleUrl, name, description);

  // Ikke vis "feil rettet" som aktiv hendelse
  if (type === 'resolved') {
    return null;
  }

  const cleanName = stripHtml(name);
  const cleanDescription = stripHtml(description);

  return {
    id: `lnett-${type}-${index}`,
    company: 'Lnett',
    type,
    customers: extractCustomers(cleanName, cleanDescription),
    lat: coords.lat,
    lng: coords.lng,
    start: extractStart(cleanDescription),
    end: null,
    areaName: extractAreaName(cleanName, cleanDescription, type),
    sourceUrl: SOURCE_PAGE,
    raw: {
      name: cleanName,
      description: cleanDescription,
      styleUrl
    }
  };
}

module.exports = {
  name: 'Lnett',

  async fetchOutages() {
    try {
      const response = await axios.get(SOURCE_URL, {
        params: {
          ms: Date.now()
        },
        timeout: 15000,
        responseType: 'text'
      });

      const parsed = parser.parse(response.data);
      const placemarks = getPlacemarks(parsed);

      const outages = placemarks
        .map((placemark, index) => mapPlacemarkToOutage(placemark, index))
        .filter(Boolean);

      console.log(`Lnett provider: ${outages.length} hendelser etter provider-filter`);

      return outages;
    } catch (error) {
      console.error('Lnett fetch feilet:', error.message);
      return [];
    }
  }
};