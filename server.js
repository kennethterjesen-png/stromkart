const express = require('express');
const cors = require('cors');
const path = require('path');
const { fetchAllOutages } = require('./providers/registry');

const app = express();
console.log('SERVER FILE:', __filename);
console.log('SERVER DIR:', __dirname);
console.log('STATIC PATH:', path.join(__dirname, 'public'));

const PORT = process.env.PORT || 3000;
const REFRESH_INTERVAL_MS = 60000;

app.use(cors({ origin: '*' }));
app.use(express.static(path.join(__dirname, 'public')));

let outagesCache = [];
let lastUpdated = null;
let lastRefreshOk = false;
let providerStatus = [];

function sortOutages(outages) {
  return [...outages].sort((a, b) => {
    const companyA = String(a.company || '');
    const companyB = String(b.company || '');
    return companyA.localeCompare(companyB, 'no');
  });
}

function normalizeOutages(data) {
  if (!Array.isArray(data)) {
    return [];
  }

  return data.filter((item) => {
    return item && typeof item === 'object';
  });
}

async function refreshOutages() {
  try {
    console.log('Henter data fra alle leverandører...');

    const result = await fetchAllOutages();

    const outages = normalizeOutages(result?.outages);
    const providers = Array.isArray(result?.providerStatus) ? result.providerStatus : [];

    outagesCache = sortOutages(outages);
    providerStatus = providers;
    lastUpdated = new Date().toISOString();
    lastRefreshOk = true;

    console.log(`Oppdatert totalt: ${outagesCache.length} hendelser`);

    return outagesCache;
  } catch (error) {
    lastRefreshOk = false;
    console.error('Feil i refreshOutages:', error.message);

    return [];
  }
}

app.get('/api/outages', (req, res) => {
  res.json({
    count: outagesCache.length,
    updatedAt: lastUpdated,
    outages: outagesCache
  });
});

app.get('/api/status', (req, res) => {
  res.json({
    count: outagesCache.length,
    lastUpdated,
    lastRefreshOk,
    providers: providerStatus
  });
});

app.get('/ping', (req, res) => {
  res.send('PING OK');
});

async function main() {
  console.log("Henter strømbrudd-data...");

  const data = await refreshOutages();

  const fs = require("fs");
  const path = require("path");

  const filePath = path.join(__dirname, "public", "data", "outages.json");

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

const statusPath = path.join(__dirname, "public", "data", "status.json");

const status = {
  ok: true,
  updatedAt: new Date().toISOString(),
  count: Array.isArray(data) ? data.length : 0
};

fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));

console.log("Lagret til public/data/outages.json");
console.log("Lagret til public/data/status.json");
}

if (require.main === module) {
  main();
}