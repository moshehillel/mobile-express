'use strict';
/**
 * Create the Twilio Functions service, upload the three phone scripts,
 * and create a new Studio flow from twilio.json.
 * Run: node scripts/setup-twilio.js
 *
 * Audio prompts and the /assistance function are not in this folder.
 * Those widgets keep the old chatgpt-7837.twil.io address until those files are copied.
 */
const fs = require('fs');
const path = require('path');
const { ROOT, loadConfig, saveConfig, request, basicAuth } = require('./setup-common');

const FUNCTIONS = [
  { widget: 'calculate', path: '/phones_total', file: 'twilio_phones_total', name: 'phones_total' },
  { widget: 'place_order', path: '/place_order', file: 'twilio_place_order', name: 'place_order' },
  { widget: 'transcribe_address', path: '/transcribe_address', file: 'twilio_transcribe_address', name: 'transcribe_address' },
];

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function multipart(fields, filename, fileContent) {
  const boundary = 'TwilioBoundary' + Date.now();
  const CRLF = '\r\n';
  const parts = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}${CRLF}Content-Disposition: form-data; name="${name}"${CRLF}${CRLF}${value}${CRLF}`, 'utf8'));
  }
  parts.push(Buffer.from(`--${boundary}${CRLF}Content-Disposition: form-data; name="Content"; filename="${filename}"${CRLF}Content-Type: application/javascript${CRLF}${CRLF}`, 'utf8'));
  parts.push(Buffer.from(fileContent, 'utf8'));
  parts.push(Buffer.from(`${CRLF}--${boundary}--${CRLF}`, 'utf8'));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

async function main() {
  const cfg = loadConfig();
  const twilio = cfg.twilio || {};
  const { accountSid, authToken } = twilio;
  if (!accountSid || !authToken) {
    console.error('Set twilio.accountSid and twilio.authToken in setup-local.json');
    process.exit(1);
  }
  const auth = basicAuth(accountSid, authToken);
  const headers = { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' };

  let serviceSid = twilio.serviceSid;
  if (!serviceSid) {
    console.log('Creating Twilio service...');
    const service = await request('POST', 'https://serverless.twilio.com/v1/Services', {
      headers,
      body: new URLSearchParams({
        FriendlyName: 'mobile-express',
        UniqueName: 'mobile-express',
        IncludeCredentials: 'true',
      }).toString(),
    });
    serviceSid = service.sid;
  }

  const base = `https://serverless.twilio.com/v1/Services/${serviceSid}`;
  let environmentSid = twilio.environmentSid;
  let domain = twilio.domain;
  if (!environmentSid) {
    console.log('Creating Twilio environment...');
    const env = await request('POST', `${base}/Environments`, {
      headers,
      body: new URLSearchParams({ UniqueName: 'ui' }).toString(),
    });
    environmentSid = env.sid;
    domain = env.domain_name;
  }
  if (!domain) {
    const env = await request('GET', `${base}/Environments/${environmentSid}`, { headers: { Authorization: auth } });
    domain = env.domain_name;
  }

  const envKeys = {
    AIRTABLE_TOKEN: cfg.airtable && cfg.airtable.token,
    GMAIL_USER: cfg.env && cfg.env.GMAIL_USER,
    GMAIL_APP_PASS: cfg.env && cfg.env.GMAIL_APP_PASS,
    OPENAI_API_KEY: cfg.env && cfg.env.OPENAI_API_KEY,
  };
  console.log('Setting Twilio environment variables...');
  const existingVars = await request('GET', `${base}/Environments/${environmentSid}/Variables?PageSize=100`, {
    headers: { Authorization: auth },
  });
  const have = new Set((existingVars.variables || []).map((item) => item.key));
  for (const [key, value] of Object.entries(envKeys)) {
    if (!value || have.has(key)) continue;
    await request('POST', `${base}/Environments/${environmentSid}/Variables`, {
      headers,
      body: new URLSearchParams({ Key: key, Value: value }).toString(),
    });
  }

  const uploadBase = `https://serverless-upload.twilio.com/v1/Services/${serviceSid}`;
  const functionList = await request('GET', `${base}/Functions?PageSize=100`, { headers: { Authorization: auth } });
  const byName = Object.fromEntries((functionList.functions || []).map((fn) => [fn.friendly_name, fn.sid]));
  const uploaded = [];

  for (const fn of FUNCTIONS) {
    let funcSid = byName[fn.name];
    if (!funcSid) {
      console.log(`Creating function ${fn.name}...`);
      const created = await request('POST', `${base}/Functions`, {
        headers,
        body: new URLSearchParams({ FriendlyName: fn.name }).toString(),
      });
      funcSid = created.sid;
    }
    console.log(`Uploading ${fn.path}...`);
    const fileContent = fs.readFileSync(path.join(ROOT, fn.file), 'utf8');
    const form = multipart({ Path: fn.path, Visibility: 'public' }, `${fn.name}.js`, fileContent);
    const version = await request('POST', `${uploadBase}/Functions/${funcSid}/Versions`, {
      headers: { Authorization: auth, 'Content-Type': form.contentType },
      body: form.body,
    });
    uploaded.push({ ...fn, funcSid, versionSid: version.sid });
  }

  console.log('Building...');
  const buildParams = new URLSearchParams();
  for (const item of uploaded) buildParams.append('FunctionVersions', item.versionSid);
  buildParams.set('Dependencies', JSON.stringify([{ name: 'nodemailer', version: '^6.9.11' }]));
  const build = await request('POST', `${base}/Builds`, { headers, body: buildParams.toString() });
  let status = build.status;
  for (let i = 0; status === 'building' && i < 40; i++) {
    await sleep(3000);
    status = (await request('GET', `${base}/Builds/${build.sid}`, { headers: { Authorization: auth } })).status;
    process.stdout.write('.');
  }
  console.log(`\nBuild status: ${status}`);
  if (status !== 'completed') throw new Error('Twilio build failed: ' + status);

  await request('POST', `${base}/Environments/${environmentSid}/Deployments`, {
    headers,
    body: new URLSearchParams({ BuildSid: build.sid }).toString(),
  });

  const flow = JSON.parse(fs.readFileSync(path.join(ROOT, 'twilio.json'), 'utf8'));
  for (const item of uploaded) {
    const state = flow.states.find((entry) => entry.name === item.widget);
    if (!state) continue;
    state.properties.service_sid = serviceSid;
    state.properties.environment_sid = environmentSid;
    state.properties.function_sid = item.funcSid;
    state.properties.url = `https://${domain}${item.path}`;
  }
  fs.writeFileSync(path.join(ROOT, 'twilio.json'), JSON.stringify(flow, null, 2) + '\n', 'utf8');

  let flowSid = twilio.flowSid;
  const definition = JSON.stringify(flow);
  if (!flowSid) {
    console.log('Creating Studio flow...');
    const created = await request('POST', 'https://studio.twilio.com/v2/Flows', {
      headers,
      body: new URLSearchParams({
        FriendlyName: 'Mobile Express',
        Status: 'published',
        Definition: definition,
        CommitMessage: 'Initial Mobile Express flow',
      }).toString(),
    });
    flowSid = created.sid;
  } else {
    console.log(`Updating Studio flow ${flowSid}...`);
    await request('POST', `https://studio.twilio.com/v2/Flows/${flowSid}`, {
      headers,
      body: new URLSearchParams({
        Definition: definition,
        Status: 'published',
        CommitMessage: 'Update Mobile Express flow',
      }).toString(),
    });
  }

  cfg.twilio.serviceSid = serviceSid;
  cfg.twilio.environmentSid = environmentSid;
  cfg.twilio.flowSid = flowSid;
  cfg.twilio.domain = domain;
  cfg.twilio.functions = Object.fromEntries(uploaded.map((item) => [item.widget, item.funcSid]));
  saveConfig(cfg);
  fs.writeFileSync(path.join(ROOT, 'twilio-local.json'), JSON.stringify({
    accountSid,
    authToken,
    serviceSid,
    environmentSid,
    flowSid,
    domain,
    phonesTotalFunctionSid: cfg.twilio.functions.calculate,
    placeOrderFunctionSid: cfg.twilio.functions.place_order,
    transcribeFunctionSid: cfg.twilio.functions.transcribe_address,
  }, null, 2) + '\n', 'utf8');

  console.log('Twilio is ready.');
  console.log(`  Service: ${serviceSid}`);
  console.log(`  Domain:  https://${domain}`);
  console.log(`  Flow:    ${flowSid}`);
  console.log('Audio prompts and /assistance still point at the old Twilio domain.');
  console.log('The phone number is not moved. Attach it to this flow only when you cut over.');
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
