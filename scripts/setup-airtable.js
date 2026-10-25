'use strict';
/**
 * Create the Mobile Express Airtable base (or add the two tables to an existing base).
 * Run: node scripts/setup-airtable.js
 *
 * The token needs these scopes on the new account:
 *   data.records:read  data.records:write  schema.bases:read  schema.bases:write
 */
const fs = require('fs');
const path = require('path');
const { ROOT, loadConfig, saveConfig, request } = require('./setup-common');

const OLD_BASE = 'appTpfiIE7HJNTVEx';
const OLD_ORDERS = 'tblWYJmi6rf9olmdj';

const text = (name) => ({ name, type: 'singleLineText' });
const long = (name) => ({ name, type: 'multilineText' });
const money = (name) => ({ name, type: 'currency', options: { precision: 2, symbol: '$' } });

const ORDERS = {
  name: 'Orders',
  fields: [
    text('Order Number'),
    text('Source'),
    text('Timestamp'),
    text('Name'),
    text('Phone'),
    text('Email'),
    long('Address'),
    text('Street'),
    text('City'),
    text('State'),
    text('ZIP'),
    long('Details'),
    { name: 'Serialized Count', type: 'number', options: { precision: 0 } },
    money('Subtotal'),
    money('Tax'),
    money('Total'),
    text('Payment'),
    text('Status'),
    { name: 'Address Recording', type: 'url' },
    text('IMEI'),
    text('Tracking Number'),
    { name: 'Label URL', type: 'url' },
  ],
};

const REPAIRS = {
  name: 'Repairs',
  fields: [
    text('Name'),
    text('Phone'),
    text('Email'),
    text('Shipping Address'),
    text('Street'),
    text('City'),
    text('State'),
    text('ZIP'),
    text('Device Make'),
    text('Device Model'),
    long('Repairs'),
    money('Estimated Total'),
    long('Notes'),
    {
      name: 'Status',
      type: 'singleSelect',
      options: {
        choices: [
          { name: 'New', color: 'yellowLight2' },
          { name: 'In Progress', color: 'blueLight2' },
          { name: 'Repaired', color: 'purpleLight2' },
          { name: 'Shipped Back', color: 'greenLight2' },
        ],
      },
    },
    text('Submitted'),
    text('Tracking Number'),
    { name: 'Label URL', type: 'url' },
  ],
};

function authHeaders(token) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function listWorkspaces(token) {
  const data = await request('GET', 'https://api.airtable.com/v0/meta/workspaces', { headers: authHeaders(token) });
  return data.workspaces || [];
}

async function createBase(token, workspaceId) {
  return request('POST', 'https://api.airtable.com/v0/meta/bases', {
    headers: authHeaders(token),
    body: JSON.stringify({
      name: 'Mobile Express',
      workspaceId,
      tables: [ORDERS, REPAIRS],
    }),
  });
}

async function listTables(token, baseId) {
  const data = await request('GET', `https://api.airtable.com/v0/meta/bases/${baseId}/tables`, {
    headers: authHeaders(token),
  });
  return data.tables || [];
}

async function createTable(token, baseId, table) {
  return request('POST', `https://api.airtable.com/v0/meta/bases/${baseId}/tables`, {
    headers: authHeaders(token),
    body: JSON.stringify(table),
  });
}

function patchProjectIds(baseId, ordersTableId) {
  const files = [
    'netlify/functions/place_order.js',
    'netlify/functions/order_status.js',
    'netlify/functions/pending_orders.js',
    'netlify/functions/create_label.js',
    'netlify/functions/submit_repair.js',
    'netlify/functions/create_repair_label.js',
    'netlify/functions/update_repair.js',
    'netlify/functions/get_repairs.js',
    'netlify/functions/update_order.js',
    'twilio_place_order',
    'scripts/add-serialized-field.js',
    'scripts/create-repairs-table.js',
  ];
  for (const rel of files) {
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) continue;
    const next = fs.readFileSync(file, 'utf8')
      .split(OLD_BASE).join(baseId)
      .split(OLD_ORDERS).join(ordersTableId);
    fs.writeFileSync(file, next, 'utf8');
  }
}

async function main() {
  const cfg = loadConfig();
  const token = cfg.airtable && cfg.airtable.token;
  if (!token) {
    console.error('Set airtable.token in setup-local.json');
    process.exit(1);
  }

  let baseId = cfg.airtable.baseId;
  let ordersTableId = cfg.airtable.ordersTableId;
  let repairsTableId = cfg.airtable.repairsTableId;

  if (!baseId) {
    let workspaceId = cfg.airtable.workspaceId;
    if (!workspaceId) {
      const workspaces = await listWorkspaces(token);
      if (workspaces.length !== 1) {
        console.error('Set airtable.workspaceId in setup-local.json to one of:');
        for (const ws of workspaces) console.error(`  ${ws.id}  ${ws.name}`);
        process.exit(1);
      }
      workspaceId = workspaces[0].id;
      console.log(`Using workspace ${workspaces[0].name}`);
    }
    console.log('Creating Airtable base...');
    const base = await createBase(token, workspaceId);
    baseId = base.id;
    for (const table of base.tables || []) {
      if (table.name === 'Orders') ordersTableId = table.id;
      if (table.name === 'Repairs') repairsTableId = table.id;
    }
  } else {
    console.log(`Using existing base ${baseId}`);
    const tables = await listTables(token, baseId);
    const byName = Object.fromEntries(tables.map((table) => [table.name, table.id]));
    if (!ordersTableId) {
      if (byName.Orders) ordersTableId = byName.Orders;
      else {
        console.log('Creating Orders table...');
        ordersTableId = (await createTable(token, baseId, ORDERS)).id;
      }
    }
    if (!repairsTableId) {
      if (byName.Repairs) repairsTableId = byName.Repairs;
      else {
        console.log('Creating Repairs table...');
        repairsTableId = (await createTable(token, baseId, REPAIRS)).id;
      }
    }
  }

  cfg.airtable.baseId = baseId;
  cfg.airtable.ordersTableId = ordersTableId;
  cfg.airtable.repairsTableId = repairsTableId;
  cfg.env = cfg.env || {};
  cfg.env.AIRTABLE_TOKEN = token;
  cfg.env.AIRTABLE_REPAIRS_TABLE_ID = repairsTableId;
  saveConfig(cfg);

  fs.writeFileSync(path.join(ROOT, 'airtable-local.json'), JSON.stringify({
    token,
    baseId,
    ordersTableId,
    repairsTableId,
  }, null, 2) + '\n', 'utf8');

  patchProjectIds(baseId, ordersTableId);
  console.log('Airtable is ready.');
  console.log(`  Base:    ${baseId}`);
  console.log(`  Orders:  ${ordersTableId}`);
  console.log(`  Repairs: ${repairsTableId}`);
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
