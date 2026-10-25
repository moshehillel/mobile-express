const path = require('path');
const fs   = require('fs');

const CATALOG_PATH = path.join(__dirname, '..', '..', 'data', 'repairs-catalog.json');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

exports.handler = async () => {
  try {
    const raw = fs.readFileSync(CATALOG_PATH, 'utf8');
    return { statusCode: 200, headers, body: raw };
  } catch {
    return { statusCode: 200, headers, body: JSON.stringify({ makes: [] }) };
  }
};
