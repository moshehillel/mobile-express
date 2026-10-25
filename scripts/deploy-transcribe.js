'use strict';
/**
 * Deploy twilio_transcribe_address to the Twilio Functions service.
 * After a successful deploy it automatically patches twilio.json with the
 * real function_sid and prints a reminder to run publish-flow.js.
 *
 * Usage:
 *   node scripts/deploy-transcribe.js
 *
 * Requires twilio-local.json in the project root with:
 *   { "accountSid": "AC...", "authToken": "...", "serviceSid": "ZS..." }
 *
 * Also requires OPENAI_API_KEY to be set as an environment variable in the
 * Twilio Functions service (console.twilio.com > Functions > your service >
 * Environment Variables > add OPENAI_API_KEY).
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const ROOT        = path.join(__dirname, '..');
const CONFIG_FILE = path.join(ROOT, 'twilio-local.json');
const FUNC_FILE   = path.join(ROOT, 'twilio_transcribe_address');
const TWILIO_JSON = path.join(ROOT, 'twilio.json');
const FUNC_PATH   = '/transcribe_address';
const FUNC_NAME   = 'transcribe_address';

// ── Config ────────────────────────────────────────────────────────────────────

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    console.error('\nERROR: twilio-local.json not found.\n');
    console.error('Create twilio-local.json in the project root:');
    console.error(JSON.stringify({ accountSid: 'ACxxx', authToken: 'xxx', serviceSid: 'ZSxxx' }, null, 2));
    process.exit(1);
  }
  const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  const missing = ['accountSid', 'authToken', 'serviceSid'].filter(k => !cfg[k]);
  if (missing.length) { console.error(`Missing in twilio-local.json: ${missing.join(', ')}`); process.exit(1); }
  return cfg;
}

// ── HTTP helpers (same pattern as deploy-function.js) ────────────────────────

function req(options, body) {
  return new Promise((resolve, reject) => {
    const r = https.request(options, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json; try { json = JSON.parse(text); } catch { json = text; }
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
  const r = await req({ hostname: u.hostname, path: u.pathname + u.search, method: 'GET',
    headers: { Authorization: authHeader(accountSid, authToken) } });
  if (r.status >= 400) throw new Error(`GET ${url} (${r.status}): ${JSON.stringify(r.body)}`);
  return r.body;
}

async function post(accountSid, authToken, url, params) {
  const u = new URL(url);
  const body = Buffer.from(params.toString(), 'utf8');
  const r = await req({ hostname: u.hostname, path: u.pathname, method: 'POST',
    headers: { Authorization: authHeader(accountSid, authToken),
      'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': body.length } }, body);
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
  const r = await req({ hostname: u.hostname, path: u.pathname, method: 'POST',
    headers: { Authorization: authHeader(accountSid, authToken),
      'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length } }, body);
  if (r.status >= 400) throw new Error(`POST multipart ${url} (${r.status}): ${JSON.stringify(r.body)}`);
  return r.body;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const cfg = loadConfig();
  const { accountSid, authToken, serviceSid } = cfg;
  const base       = `https://serverless.twilio.com/v1/Services/${serviceSid}`;
  const uploadBase = `https://serverless-upload.twilio.com/v1/Services/${serviceSid}`;

  console.log('Reading twilio_transcribe_address...');
  const funcCode = fs.readFileSync(FUNC_FILE, 'utf8');

  // ── Environment ────────────────────────────────────────────────────────────
  console.log('Finding production environment...');
  const { environments } = await get(accountSid, authToken, `${base}/Environments`);
  if (!environments.length) throw new Error('No environments found in service.');
  const env = environments.find(e => e.unique_name === 'production') || environments[0];
  console.log(`  Environment: ${env.unique_name} (${env.sid})`);

  // ── Find or create function ────────────────────────────────────────────────
  console.log('Looking for existing transcribe_address function...');
  const { functions: existingFunctions } = await get(accountSid, authToken, `${base}/Functions`);
  let funcSid = null;

  const existing = existingFunctions.find(f =>
    f.friendly_name === FUNC_NAME || f.friendly_name === FUNC_PATH
  );
  if (existing) {
    funcSid = existing.sid;
    console.log(`  Found existing function: ${funcSid}`);
  } else {
    console.log('  Not found — creating new function...');
    const created = await post(accountSid, authToken, `${base}/Functions`,
      new URLSearchParams({ FriendlyName: FUNC_NAME }));
    funcSid = created.sid;
    console.log(`  Created function: ${funcSid}`);
  }

  // ── Existing build info (to preserve other functions/assets) ──────────────
  let existingFuncVersions = [];
  let existingAssetVersions = [];
  let existingDeps = null;
  try {
    const { deployments } = await get(accountSid, authToken, `${base}/Environments/${env.sid}/Deployments`);
    if (deployments && deployments.length && deployments[0].build_sid) {
      const build = await get(accountSid, authToken, `${base}/Builds/${deployments[0].build_sid}`);
      existingFuncVersions = (build.function_versions || [])
        .filter(fv => fv.path !== FUNC_PATH)
        .map(fv => fv.sid);
      existingAssetVersions = (build.asset_versions || []).map(av => av.sid);
      if (build.dependencies) existingDeps = build.dependencies;
      console.log(`  Preserved ${existingFuncVersions.length} other function version(s).`);
    }
  } catch {
    console.log('  (No existing deployment — starting fresh.)');
  }

  // ── Upload new version ─────────────────────────────────────────────────────
  console.log('Uploading new function version...');
  const newVersion = await postMultipart(
    accountSid, authToken,
    `${uploadBase}/Functions/${funcSid}/Versions`,
    { Path: FUNC_PATH, Visibility: 'public' },
    'transcribe_address.js',
    funcCode
  );
  console.log(`  Version SID: ${newVersion.sid}`);

  // ── Build ──────────────────────────────────────────────────────────────────
  console.log('Creating new build...');
  const buildParams = new URLSearchParams();
  [...existingFuncVersions, newVersion.sid].forEach(v => buildParams.append('FunctionVersions', v));
  existingAssetVersions.forEach(v => buildParams.append('AssetVersions', v));
  if (existingDeps) buildParams.set('Dependencies', JSON.stringify(existingDeps));
  const build = await post(accountSid, authToken, `${base}/Builds`, buildParams);
  console.log(`  Build SID: ${build.sid}`);

  console.log('Waiting for build...');
  let status = build.status;
  for (let i = 0; status === 'building' && i < 30; i++) {
    await sleep(3000);
    const b = await get(accountSid, authToken, `${base}/Builds/${build.sid}`);
    status = b.status;
    process.stdout.write('.');
  }
  console.log(`\n  Build status: ${status}`);
  if (status !== 'completed') throw new Error(`Build failed. Final status: ${status}`);

  // ── Deploy ─────────────────────────────────────────────────────────────────
  console.log('Deploying...');
  await post(accountSid, authToken, `${base}/Environments/${env.sid}/Deployments`,
    new URLSearchParams({ BuildSid: build.sid }));
  console.log('  Deployed successfully!');

  // ── Patch twilio.json with the real function_sid ───────────────────────────
  console.log('Patching twilio.json with function_sid...');
  const flow = JSON.parse(fs.readFileSync(TWILIO_JSON, 'utf8'));
  const state = flow.states.find(s => s.name === 'transcribe_address');
  if (state) {
    state.properties.function_sid   = funcSid;
    state.properties.environment_sid = env.sid;
    fs.writeFileSync(TWILIO_JSON, JSON.stringify(flow, null, 2), 'utf8');
    console.log(`  function_sid set to: ${funcSid}`);
    console.log(`  environment_sid set to: ${env.sid}`);
  } else {
    console.warn('  WARNING: transcribe_address state not found in twilio.json — patch skipped.');
  }

  console.log('\n✓ Done! Next step:');
  console.log('  1. In the Twilio console, go to Functions > your service > Environment Variables');
  console.log('     and add:  OPENAI_API_KEY = sk-...');
  console.log('  2. Run:  node scripts/publish-flow.js');
  console.log('     to push the updated Studio flow to Twilio.\n');
}

main().catch(err => {
  console.error('\nERROR:', err.message);
  process.exit(1);
});
