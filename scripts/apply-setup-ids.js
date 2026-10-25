'use strict';
/**
 * Write the IDs saved in setup-local.json into the project files that use them,
 * then publish the phone flow again so it calls the new site.
 * Run: node scripts/apply-setup-ids.js
 */
const fs = require('fs');
const path = require('path');
const { ROOT, loadConfig, request, basicAuth } = require('./setup-common');

const CODE_FILES = [
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
  'scripts/deploy-place-order.js',
];

function replaceAssigned(text, name, value) {
  const re = new RegExp(`(const ${name}\\s*=\\s*)(['"])[^'"]+\\2`, 'g');
  return text.replace(re, `$1$2${value}$2`);
}

function writeCodeIds(baseId, ordersTableId, placeOrderFunctionSid) {
  for (const rel of CODE_FILES) {
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) continue;
    let text = fs.readFileSync(file, 'utf8');
    if (baseId) text = replaceAssigned(text, 'AIRTABLE_BASE_ID', baseId);
    if (ordersTableId) {
      text = replaceAssigned(text, 'AIRTABLE_TABLE_ID', ordersTableId);
      text = replaceAssigned(text, 'ORDERS_TABLE_ID', ordersTableId);
    }
    if (placeOrderFunctionSid && rel === 'scripts/deploy-place-order.js') {
      text = replaceAssigned(text, 'FUNC_SID', placeOrderFunctionSid);
    }
    fs.writeFileSync(file, text, 'utf8');
  }
}

function writeFlowIds(cfg) {
  const twilio = cfg.twilio || {};
  const functions = twilio.functions || {};
  const flowPath = path.join(ROOT, 'twilio.json');
  const flow = JSON.parse(fs.readFileSync(flowPath, 'utf8'));
  const paths = {
    calculate: '/phones_total',
    place_order: '/place_order',
    transcribe_address: '/transcribe_address',
  };
  for (const [widget, funcSid] of Object.entries(functions)) {
    const state = (flow.states || []).find((entry) => entry.name === widget);
    if (!state || !state.properties) continue;
    if (twilio.serviceSid) state.properties.service_sid = twilio.serviceSid;
    if (twilio.environmentSid) state.properties.environment_sid = twilio.environmentSid;
    if (funcSid) state.properties.function_sid = funcSid;
    if (twilio.domain && paths[widget]) state.properties.url = `https://${twilio.domain}${paths[widget]}`;
  }
  const siteUrl = (cfg.netlify && cfg.netlify.siteUrl || '').replace(/\/$/, '');
  if (siteUrl) {
    const next = `${siteUrl}/.netlify/functions/order_status`;
    for (const state of flow.states || []) {
      const props = state.properties || {};
      if (typeof props.url === 'string' && props.url.includes('/.netlify/functions/order_status')) {
        props.url = next;
      }
    }
  }
  fs.writeFileSync(flowPath, JSON.stringify(flow, null, 2) + '\n', 'utf8');
  return flow;
}

async function publishFlow(cfg, flow) {
  const twilio = cfg.twilio || {};
  if (!twilio.accountSid || !twilio.authToken || !twilio.flowSid) return;
  await request('POST', `https://studio.twilio.com/v2/Flows/${twilio.flowSid}`, {
    headers: {
      Authorization: basicAuth(twilio.accountSid, twilio.authToken),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      Definition: JSON.stringify(flow),
      Status: 'published',
      CommitMessage: 'Fill in new account ids',
    }).toString(),
  });
  console.log(`Updated phone flow ${twilio.flowSid}`);
}

async function main() {
  const cfg = loadConfig();
  const airtable = cfg.airtable || {};
  const twilio = cfg.twilio || {};
  writeCodeIds(airtable.baseId, airtable.ordersTableId, twilio.functions && twilio.functions.place_order);
  const flow = writeFlowIds(cfg);
  await publishFlow(cfg, flow);
  console.log('Saved the new Airtable, Twilio, and Netlify details into the project.');
  if (airtable.baseId) console.log(`  Airtable base ${airtable.baseId}`);
  if (airtable.ordersTableId) console.log(`  Orders table ${airtable.ordersTableId}`);
  if (airtable.repairsTableId) console.log(`  Repairs table ${airtable.repairsTableId}`);
  if (twilio.domain) console.log(`  Twilio https://${twilio.domain}`);
  if (cfg.netlify && cfg.netlify.siteUrl) console.log(`  Site ${cfg.netlify.siteUrl}`);
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
