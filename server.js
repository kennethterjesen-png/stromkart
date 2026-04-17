const express = require('express');
const cors = require('cors');
const path = require('path');
const { fetchAllOutages } = require('./providers/registry');

const app = express();
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
  } catch (error) {
    lastRefreshOk = false;
    console.error('Feil i refreshOutages:', error.message);
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

app.listen(PORT, async () => {
  console.log(`Server kjører på http://localhost:${PORT}`);

  await refreshOutages();

  setInterval(() => {
    refreshOutages();
  }, REFRESH_INTERVAL_MS);
});