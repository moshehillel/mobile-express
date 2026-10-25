'use strict';
/**
 * Adds a "Serialized Count" number field to the Orders table in Airtable.
 * Run once:  node scripts/add-serialized-field.js
 *
 * Reads credentials from airtable-local.json in the project root:
 *   { "token": "your_airtable_token", "baseId": "appTpfiIE7HJNTVEx" }
 * (The token needs schema/edit permission on the base — same one used for the repairs table.)
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const CONFIG = path.join(__dirname, '..', 'airtable-local.json');
const ORDERS_TABLE_ID = 'tblWYJmi6rf9olmdj';

if (!fs.existsSync(CONFIG)) {
  console.error('\nERROR: airtable-local.json not found in project root. Create it:');
  console.error(JSON.stringify({ token: 'your_airtable_token', baseId: 'appTpfiIE7HJNTVEx' }, null, 2));
  process.exit(1);
}
const { token, baseId } = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
if (!token || !baseId) { console.error('ERROR: token and baseId required in airtable-local.json'); process.exit(1); }

const body = Buffer.from(JSON.stringify({
  name: 'Serialized Count',
  type: 'number',
  options: { precision: 0 },
}), 'utf8');

const req = https.request({
  hostname: 'api.airtable.com',
  path: `/v0/meta/bases/${baseId}/tables/${ORDERS_TABLE_ID}/fields`,
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': body.length },
}, res => {
  const chunks = [];
  res.on('data', c => chunks.push(c));
  res.on('end', () => {
    const text = Buffer.concat(chunks).toString('utf8');
    if (res.statusCode === 200 || res.statusCode === 201) {
      console.log('\n✓ Added "Serialized Count" field to the Orders table.');
    } else if (/DUPLICATE|already exists/i.test(text)) {
      console.log('\n✓ "Serialized Count" already exists — nothing to do.');
    } else {
      console.error('\nERROR creating field:\n' + text);
      process.exit(1);
    }
  });
});
req.on('error', e => { console.error('Request error:', e.message); process.exit(1); });
req.write(body);
req.end();
