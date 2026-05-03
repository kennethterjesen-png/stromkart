const elvia = require('./elvia');
const glitre = require('./glitre');
const tensio = require('./tensio');
const bkk = require('./bkk');
const linja = require('./linja');
const lnett = require('./lnett');
const arva = require('./arva');
const fagne = require('./fagne');
const norgesnett = require('./norgesnett');
const vestmar = require('./vestmar');
const eidefoss = require('./eidefoss');

const providers = [
  elvia,
  glitre,
  tensio,
  bkk,
  linja,
  lnett,
  norgesnett,
  arva,
  fagne,
  vestmar, 
  eidefoss,
];

function isValidCoordinate(value) {
  return Number.isFinite(Number(value));
}

function normalizeString(value, fallback = '') {
  if (value == null) return fallback;
  return String(value).trim();
}

function normalizeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeDateValue(value) {
  if (value == null || value === '') {
    return null;
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toLocaleString('no-NO');
  }

  if (typeof value === 'number') {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleString('no-NO');
  }

  const str = String(value).trim();
  if (!str) return null;

  // ISO/UTC og andre gyldige datoformater
  const parsed = new Date(str);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toLocaleString('no-NO');
  }

  return null;
}

function normalizeType(value) {
  const raw = normalizeString(value, 'outage').toLowerCase();

  if (
    raw === 'planned' ||
    raw.includes('plan') ||
    raw.includes('utkobling')
  ) {
    return 'planned';
  }

  if (
    raw === 'outage' ||
    raw.includes('driftsforstyrrelse') ||
    raw.includes('feil') ||
    raw.includes('avbrudd')
  ) {
    return 'outage';
  }

  return 'outage';
}

function isValidOutage(outage) {
  return (
    outage &&
    typeof outage.id === 'string' &&
    outage.id.length > 0 &&
    typeof outage.company === 'string' &&
    outage.company.length > 0 &&
    isValidCoordinate(outage.lat) &&
    isValidCoordinate(outage.lng)
  );
}

function normalizeOutage(outage) {
  if (!outage || typeof outage !== 'object') {
    return null;
  }

  const raw = outage.raw && typeof outage.raw === 'object' ? outage.raw : {};

  const areaName =
    normalizeString(outage.areaName) ||
    normalizeString(raw.MUNICIPAL_TXT) ||
    normalizeString(raw.municipal) ||
    normalizeString(raw.PURCHAREA_TXT) ||
    normalizeString(raw.purcharea) ||
    normalizeString(raw.NAME) ||
    normalizeString(raw.name) ||
    'Ukjent område';

  const normalized = {
    id: normalizeString(outage.id),
    company: normalizeString(outage.company),
    type: normalizeType(outage.type),
    customers: normalizeNumber(outage.customers, 0),
    lat: Number(outage.lat),
    lng: Number(outage.lng),
    start: normalizeDateValue(outage.start),
    end: normalizeDateValue(outage.end),
    areaName,
    sourceUrl: normalizeString(outage.sourceUrl),
    raw
  };

  if (!isValidOutage(normalized)) {
    return null;
  }

  return normalized;
}

function roundCoord(value, decimals = 3) {
  const factor = Math.pow(10, decimals);
  return Math.round(Number(value) * factor) / factor;
}

function buildOutageKey(outage) {
  const company = normalizeString(outage.company, 'unknown-company');
  const type = normalizeString(outage.type, 'outage');
  const lat = roundCoord(outage.lat, 3);
  const lng = roundCoord(outage.lng, 3);
  const start = normalizeString(outage.start, 'no-start');

  return [company, type, lat, lng, start].join('|');
}

function dedupeOutages(outages) {
  const seenIds = new Set();
  const seenKeys = new Set();
  const unique = [];

  for (const outage of outages) {
    if (!isValidOutage(outage)) continue;

    const outageId = normalizeString(outage.id);
    const outageKey = buildOutageKey(outage);

    if (seenIds.has(outageId)) continue;
    if (seenKeys.has(outageKey)) continue;

    seenIds.add(outageId);
    seenKeys.add(outageKey);
    unique.push(outage);
  }

  return unique;
}

function getProviderDisplayName(provider, index) {
  if (provider && typeof provider.name === 'string' && provider.name.trim()) {
    return provider.name.trim();
  }

  return `Provider ${index + 1}`;
}

async function fetchProviderOutages(provider) {
  if (!provider || typeof provider.fetchOutages !== 'function') {
    throw new Error('Provider mangler fetchOutages()');
  }

  const result = await provider.fetchOutages();

  if (!Array.isArray(result)) {
    return [];
  }

  return result
    .map(normalizeOutage)
    .filter(Boolean);
}

async function fetchAllOutages() {
  const results = await Promise.allSettled(
    providers.map((provider) => fetchProviderOutages(provider))
  );

  const allOutages = [];
  const providerStatus = [];

  results.forEach((result, index) => {
    const provider = providers[index];
    const providerName = getProviderDisplayName(provider, index);

    if (result.status === 'fulfilled') {
      const rawItems = Array.isArray(result.value) ? result.value : [];
      const dedupedItems = dedupeOutages(rawItems);

      console.log(
        `${providerName}: ${dedupedItems.length} beholdt av ${rawItems.length} hentet`
      );

      allOutages.push(...dedupedItems);

      providerStatus.push({
        name: providerName,
        ok: true,
        count: dedupedItems.length,
        rawCount: rawItems.length,
        filteredOut: rawItems.length - dedupedItems.length,
        warning: rawItems.length > 0 && dedupedItems.length === 0,
        error: null
      });
    } else {
      const errorMessage =
        result.reason && result.reason.message
          ? result.reason.message
          : 'Ukjent feil';

      console.error(`${providerName}: FEIL - ${errorMessage}`);

      providerStatus.push({
        name: providerName,
        ok: false,
        count: 0,
        rawCount: 0,
        filteredOut: 0,
        warning: false,
        error: errorMessage
      });
    }
  });

  return {
    outages: dedupeOutages(allOutages),
    providerStatus
  };
}

module.exports = { fetchAllOutages };