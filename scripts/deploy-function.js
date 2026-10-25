'use strict';
const https = require('https');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CONFIG_FILE = path.join(ROOT, 'twilio-local.json');
const FUNC_FILE = path.join(ROOT, 'twilio_phones_total');

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    console.error('\nERROR: twilio-local.json not found.\n');
    console.error('Create a file called twilio-local.json in the project folder with:');
    console.error(JSON.stringify({
      accountSid: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      authToken:  'your_auth_token_here',
      serviceSid: 'ZSxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
    }, null, 2));
    console.error('\nWhere to find these values:');
    console.error('  accountSid + authToken : https://console.twilio.com/ (Dashboard)');
    console.error('  serviceSid             : console.twilio.com > Functions & Assets > Services\n');
    process.exit(1);
  }
  const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  const missing = ['accountSid','authToken','serviceSid'].filter(k => !cfg[k]);
  if (missing.length) {
    console.error(`\nERROR: twilio-local.json is missing: ${missing.join(', ')}\n`);
    process.exit(1);
  }
  return cfg;
}

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

function auth(accountSid, authToken) {
  return 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64');
}

async function get(accountSid, authToken, url) {
  const u = new URL(url);
  const r = await req({ hostname: u.hostname, path: u.pathname + u.search, method: 'GET',
    headers: { Authorization: auth(accountSid, authToken) } });
  if (r.status >= 400) throw new Error(`GET ${url} (${r.status}): ${JSON.stringify(r.body)}`);
  return r.body;
}

async function post(accountSid, authToken, url, params) {
  const u = new URL(url);
  const body = Buffer.from(params.toString(), 'utf8');
  const r = await req({ hostname: u.hostname, path: u.pathname, method: 'POST',
    headers: { Authorization: auth(accountSid, authToken),
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
    headers: { Authorization: auth(accountSid, authToken),
      'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length } }, body);
  if (r.status >= 400) throw new Error(`POST multipart ${url} (${r.status}): ${JSON.stringify(r.body)}`);
  return r.body;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const cfg = loadConfig();
  const { accountSid, authToken, serviceSid } = cfg;
  const base = `https://serverless.twilio.com/v1/Services/${serviceSid}`;

  console.log('Reading twilio_phones_total...');
  const funcCode = fs.readFileSync(FUNC_FILE, 'utf8');

  console.log('Finding production environment...');
  const { environments } = await get(accountSid, authToken, `${base}/Environments`);
  if (!environments.length) throw new Error('No environments found.');
  const env = environments.find(e => e.unique_name === 'production') || environments[0];
  console.log(`  Environment: ${env.unique_name} (${env.sid})`);

  console.log('Getting current deployment to find phones_total function...');
  let funcSid = null;
  let existingFuncVersions = [];
  let existingAssetVersions = [];
  let existingDeps = null;
  try {
    const { deployments } = await get(accountSid, authToken, `${base}/Environments/${env.sid}/Deployments`);
    if (deployments && deployments.length && deployments[0].build_sid) {
      const build = await get(accountSid, authToken, `${base}/Builds/${deployments[0].build_sid}`);
      const phonesVer = (build.function_versions || []).find(fv => fv.path === '/phones_total');
      if (phonesVer) {
        funcSid = phonesVer.function_sid;
        console.log(`  Function SID: ${funcSid}`);
      }
      existingFuncVersions = (build.function_versions || [])
        .filter(fv => fv.path !== '/phones_total')
        .map(fv => fv.sid);
      existingAssetVersions = (build.asset_versions || []).map(av => av.sid);
      if (build.dependencies) existingDeps = build.dependencies;
    }
  } catch {
    console.log('  (No existing deployment found — starting fresh build)');
  }
  if (!funcSid) throw new Error(`Function with path "/phones_total" not found in current deployment. Make sure it exists and is deployed in Twilio.`);

  console.log('Uploading new function version...');
  const uploadBase = `https://serverless-upload.twilio.com/v1/Services/${serviceSid}`;
  const newVersion = await postMultipart(
    accountSid, authToken,
    `${uploadBase}/Functions/${funcSid}/Versions`,
    { Path: '/phones_total', Visibility: 'public' },
    'phones_total.js',
    funcCode
  );
  console.log(`  Version SID: ${newVersion.sid}`);

  console.log('Creating new build...');
  const buildParams = new URLSearchParams();
  [...existingFuncVersions, newVersion.sid].forEach(v => buildParams.append('FunctionVersions', v));
  existingAssetVersions.forEach(v => buildParams.append('AssetVersions', v));
  if (existingDeps) buildParams.set('Dependencies', JSON.stringify(existingDeps));
  const build = await post(accountSid, authToken, `${base}/Builds`, buildParams);
  console.log(`  Build SID: ${build.sid}`);

  console.log('Waiting for build to complete...');
  let status = build.status;
  for (let i = 0; status === 'building' && i < 30; i++) {
    await sleep(3000);
    const b = await get(accountSid, authToken, `${base}/Builds/${build.sid}`);
    status = b.status;
    process.stdout.write('.');
  }
  console.log(`\n  Build status: ${status}`);
  if (status !== 'completed') throw new Error(`Build failed. Final status: ${status}`);

  console.log('Creating deployment...');
  const deployParams = new URLSearchParams({ BuildSid: build.sid });
  await post(accountSid, authToken, `${base}/Environments/${env.sid}/Deployments`, deployParams);
  console.log('  Deployed successfully!');
}

main().catch(err => {
  console.error('\nERROR:', err.message);
  process.exit(1);
});
