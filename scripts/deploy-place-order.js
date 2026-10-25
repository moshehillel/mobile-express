'use strict';
/**
 * Deploy twilio_place_order to the Twilio Functions service at /place_order.
 * Usage: node scripts/deploy-place-order.js
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CONFIG_FILE = path.join(ROOT, 'twilio-local.json');
const FUNC_FILE = path.join(ROOT, 'twilio_place_order');
const FUNC_PATH = '/place_order';
const FUNC_SID = 'ZH93a9646828eddc63f2d0e86f20aebb64';

function loadConfig() {
  const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  const missing = ['accountSid', 'authToken', 'serviceSid'].filter((key) => !cfg[key]);
  if (missing.length) throw new Error('twilio-local.json is missing: ' + missing.join(', '));
  return cfg;
}

function req(options, body) {
  return new Promise((resolve, reject) => {
    const r = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json;
        try { json = JSON.parse(text); } catch { json = text; }
        resolve({ status: res.statusCode, body: json });
      });
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

function authHeader(accountSid, authToken) {
  return 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64');
}

async function get(accountSid, authToken, url) {
  const u = new URL(url);
  const r = await req({
    hostname: u.hostname,
    path: u.pathname + u.search,
    method: 'GET',
    headers: { Authorization: authHeader(accountSid, authToken) },
  });
  if (r.status >= 400) throw new Error(`GET ${url} (${r.status}): ${JSON.stringify(r.body)}`);
  return r.body;
}

async function post(accountSid, authToken, url, params) {
  const u = new URL(url);
  const body = Buffer.from(params.toString(), 'utf8');
  const r = await req({
    hostname: u.hostname,
    path: u.pathname,
    method: 'POST',
    headers: {
      Authorization: authHeader(accountSid, authToken),
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': body.length,
    },
  }, body);
  if (r.status >= 400) throw new Error(`POST ${url} (${r.status}): ${JSON.stringify(r.body)}`);
  return r.body;
}

async function postMultipart(accountSid, authToken, url, fields, filename, fileContent) {
  const boundary = 'TwilioBoundary' + Date.now();
  const CRLF = '\r\n';
  const parts = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}${CRLF}Content-Disposition: form-data; name="${name}"${CRLF}${CRLF}${value}${CRLF}`, 'utf8'));
  }
  parts.push(Buffer.from(`--${boundary}${CRLF}Content-Disposition: form-data; name="Content"; filename="${filename}"${CRLF}Content-Type: application/javascript${CRLF}${CRLF}`, 'utf8'));
  parts.push(Buffer.from(fileContent, 'utf8'));
  parts.push(Buffer.from(`${CRLF}--${boundary}--${CRLF}`, 'utf8'));
  const body = Buffer.concat(parts);
  const u = new URL(url);
  const r = await req({
    hostname: u.hostname,
    path: u.pathname,
    method: 'POST',
    headers: {
      Authorization: authHeader(accountSid, authToken),
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': body.length,
    },
  }, body);
  if (r.status >= 400) throw new Error(`POST multipart ${url} (${r.status}): ${JSON.stringify(r.body)}`);
  return r.body;
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function main() {
  const { accountSid, authToken, serviceSid } = loadConfig();
  const base = `https://serverless.twilio.com/v1/Services/${serviceSid}`;
  const uploadBase = `https://serverless-upload.twilio.com/v1/Services/${serviceSid}`;
  const funcCode = fs.readFileSync(FUNC_FILE, 'utf8');

  const { environments } = await get(accountSid, authToken, `${base}/Environments`);
  const env = environments.find((item) => item.unique_name === 'ui')
    || environments.find((item) => item.domain_name && item.domain_name.includes('chatgpt-7837'))
    || environments[0];
  if (!env) throw new Error('No Twilio environment found.');
  console.log(`Environment: ${env.unique_name} (${env.sid})`);

  const { deployments } = await get(accountSid, authToken, `${base}/Environments/${env.sid}/Deployments`);
  const current = deployments && deployments[0];
  if (!current || !current.build_sid) throw new Error('No current deployment.');
  const buildInfo = await get(accountSid, authToken, `${base}/Builds/${current.build_sid}`);
  const existingFuncVersions = (buildInfo.function_versions || [])
    .filter((version) => version.path !== FUNC_PATH)
    .map((version) => version.sid);
  const existingAssetVersions = (buildInfo.asset_versions || []).map((version) => version.sid);

  console.log('Uploading /place_order...');
  const newVersion = await postMultipart(
    accountSid,
    authToken,
    `${uploadBase}/Functions/${FUNC_SID}/Versions`,
    { Path: FUNC_PATH, Visibility: 'public' },
    'place_order.js',
    funcCode
  );
  console.log(`Version: ${newVersion.sid}`);

  const buildParams = new URLSearchParams();
  [...existingFuncVersions, newVersion.sid].forEach((sid) => buildParams.append('FunctionVersions', sid));
  existingAssetVersions.forEach((sid) => buildParams.append('AssetVersions', sid));
  if (buildInfo.dependencies) buildParams.set('Dependencies', JSON.stringify(buildInfo.dependencies));

  console.log('Building...');
  const build = await post(accountSid, authToken, `${base}/Builds`, buildParams);
  let status = build.status;
  for (let i = 0; status === 'building' && i < 40; i++) {
    await sleep(3000);
    status = (await get(accountSid, authToken, `${base}/Builds/${build.sid}`)).status;
    process.stdout.write('.');
  }
  console.log(`\nBuild status: ${status}`);
  if (status !== 'completed') throw new Error('Build failed: ' + status);

  await post(accountSid, authToken, `${base}/Environments/${env.sid}/Deployments`, new URLSearchParams({ BuildSid: build.sid }));
  console.log('Deployed /place_order to Airtable.');
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
