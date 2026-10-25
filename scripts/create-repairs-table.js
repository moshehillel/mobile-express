'use strict';
/**
 * Creates the Repairs table in Airtable with all required columns.
 * Run once: node scripts/create-repairs-table.js
 *
 * Requires twilio-local.json to NOT be used here — reads from airtable-local.json instead.
 * Create airtable-local.json in the project root:
 * { "token": "your_airtable_token", "baseId": "appTpfiIE7HJNTVEx" }
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const CONFIG_FILE = path.join(__dirname, '..', 'airtable-local.json');

if (!fs.existsSync(CONFIG_FILE)) {
  console.error('\nERROR: airtable-local.json not found.');
  console.error('Create it in the project root:');
  console.error(JSON.stringify({ token: 'your_airtable_token', baseId: 'appTpfiIE7HJNTVEx' }, null, 2));
  process.exit(1);
}

const { token, baseId } = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));

if (!token || !baseId) {
  console.error('ERROR: token and baseId are required in airtable-local.json');
  process.exit(1);
}

const table = {
  name: 'Repairs',
  fields: [
    { name: 'Name',             type: 'singleLineText' },
    { name: 'Phone',            type: 'singleLineText' },
    { name: 'Email',            type: 'email' },
    { name: 'Shipping Address', type: 'singleLineText' },
    { name: 'Street',           type: 'singleLineText' },
    { name: 'City',             type: 'singleLineText' },
    { name: 'State',            type: 'singleLineText' },
    { name: 'ZIP',              type: 'singleLineText' },
    { name: 'Device Make',      type: 'singleLineText' },
    { name: 'Device Model',     type: 'singleLineText' },
    { name: 'Repairs',          type: 'multilineText' },
    {
      name: 'Estimated Total',
      type: 'currency',
      options: { precision: 2, symbol: '$' },
    },
    { name: 'Notes',    type: 'multilineText' },
    {
      name: 'Status',
      type: 'singleSelect',
      options: {
        choices: [
          { name: 'New',          color: 'yellowLight2' },
          { name: 'In Progress',  color: 'blueLight2'   },
          { name: 'Repaired',     color: 'purpleLight2' },
          { name: 'Shipped Back', color: 'greenLight2'  },
        ],
      },
    },
    { name: 'Submitted',        type: 'singleLineText' },
    { name: 'Tracking Number',  type: 'singleLineText' },
    { name: 'Label URL',        type: 'url' },
  ],
};

const body = Buffer.from(JSON.stringify(table), 'utf8');

const options = {
  hostname: 'api.airtable.com',
  path:     `/v0/meta/bases/${baseId}/tables`,
  method:   'POST',
  headers: {
    Authorization:   `Bearer ${token}`,
    'Content-Type':  'application/json',
    'Content-Length': body.length,
  },
};

console.log('Creating Repairs table in Airtable...');

const req = https.request(options, res => {
  const chunks = [];
  res.on('data', c => chunks.push(c));
  res.on('end', () => {
    const text = Buffer.concat(chunks).toString('utf8');
    let data;
    try { data = JSON.parse(text); } catch { data = text; }

    if (res.statusCode === 200 || res.statusCode === 201) {
      console.log('\n✓ Repairs table created successfully!');
      console.log(`  Table ID: ${data.id}`);
      console.log('\nNext step:');
      console.log(`  Add this to your Netlify env vars:`);
      console.log(`  AIRTABLE_REPAIRS_TABLE_ID=${data.id}\n`);
    } else {
      console.error('\nERROR creating table:');
      console.error(JSON.stringify(data, null, 2));
      process.exit(1);
    }
  });
});

req.on('error', err => { console.error('Request error:', err.message); process.exit(1); });
req.write(body);
req.end();
