'use strict';
const https = require('https');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CONFIG_FILE = path.join(ROOT, 'twilio-local.json');
const FLOW_JSON = path.join(ROOT, 'twilio.json');
const FALLBACK_FLOW_SID = 'FW748c0932d55305009290fbda91c01651';

function flowSidFromConfig(cfg) {
  if (cfg.flowSid) return cfg.flowSid;
  return FALLBACK_FLOW_SID;
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    console.error('\nERROR: twilio-local.json not found.\n');
    process.exit(1);
  }
  const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  const missing = ['accountSid', 'authToken'].filter(k => !cfg[k]);
  if (missing.length) {
    console.error(`\nERROR: twilio-local.json is missing: ${missing.join(', ')}\n`);
    process.exit(1);
  }
  return cfg;
}

function auth(accountSid, authToken) {
  return 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64');
}

function post(accountSid, authToken, url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname,
      method: 'POST',
      headers: {
        Authorization: auth(accountSid, authToken),
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': body.length,
      },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json; try { json = JSON.parse(text); } catch { json = text; }
        if (res.statusCode >= 400) {
          reject(new Error(`POST ${url} (${res.statusCode}): ${JSON.stringify(json)}`));
        } else {
          resolve(json);
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  const cfg = loadConfig();
  const { accountSid, authToken } = cfg;
  const flowSid = flowSidFromConfig(cfg);

  console.log('Reading twilio.json...');
  const definition = JSON.parse(fs.readFileSync(FLOW_JSON, 'utf8'));

  console.log(`Updating Studio Flow ${flowSid}...`);
  const params = new URLSearchParams({
    Definition: JSON.stringify(definition),
    Status: 'published',
  });
  const body = Buffer.from(params.toString(), 'utf8');

  const result = await post(
    accountSid, authToken,
    `https://studio.twilio.com/v2/Flows/${flowSid}`,
    body
  );

  if (result.sid) {
    console.log(`  Flow updated: ${result.sid} (revision ${result.revision})`);
  } else {
    console.log('  Response:', JSON.stringify(result, null, 2));
  }
}

main().catch(err => {
  console.error('\nERROR:', err.message);
  process.exit(1);
});
