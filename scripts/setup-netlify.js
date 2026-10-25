'use strict';
/**
 * Create a Netlify site, set its environment variables, and deploy this folder.
 * Run: node scripts/setup-netlify.js
 *
 * Requires the Netlify CLI and a completed `netlify login` on this PC.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { ROOT, loadConfig, saveConfig } = require('./setup-common');

function netlify(args) {
  return execFileSync('netlify', args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function parseCliJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error(text.trim() || 'Netlify CLI did not return JSON');
  return JSON.parse(text.slice(start, end + 1));
}

function main() {
  const cfg = loadConfig();
  const siteName = (cfg.netlify && cfg.netlify.siteName) || 'mobile-express';
  try {
    netlify(['status']);
  } catch (err) {
    const text = `${err.stdout || ''}\n${err.stderr || ''}`;
    if (/not logged in|Login/i.test(text) || err.status === 1) {
      console.error('Log in first, in this folder:');
      console.error('  netlify login');
      process.exit(1);
    }
  }

  const statePath = path.join(ROOT, '.netlify', 'state.json');
  if (!fs.existsSync(statePath)) {
    console.log(`Creating Netlify site ${siteName}...`);
    const created = netlify(['sites:create', '--name', siteName, '--json']);
    const site = parseCliJson(created);
    netlify(['link', '--id', site.id]);
    cfg.netlify = cfg.netlify || {};
    cfg.netlify.siteId = site.id;
    cfg.netlify.siteUrl = site.ssl_url || site.url;
    saveConfig(cfg);
    console.log(`  Site: ${cfg.netlify.siteUrl}`);
  }

  const env = {
    ...(cfg.env || {}),
    AIRTABLE_TOKEN: cfg.airtable && cfg.airtable.token,
    AIRTABLE_REPAIRS_TABLE_ID: cfg.airtable && cfg.airtable.repairsTableId,
  };
  console.log('Setting Netlify environment variables...');
  for (const [key, value] of Object.entries(env)) {
    if (!value) continue;
    netlify(['env:set', key, value, '--context', 'production', '--force']);
    console.log(`  ${key}`);
  }

  console.log('Deploying to production...');
  const deployed = netlify(['deploy', '--prod', '--json']);
  const result = parseCliJson(deployed);
  const liveUrl = result.url || result.ssl_url || cfg.netlify.siteUrl || '';
  cfg.netlify.siteUrl = liveUrl;
  saveConfig(cfg);
  console.log('Netlify is ready.');
  console.log(`  ${liveUrl}`);
}

try {
  main();
} catch (err) {
  console.error('ERROR:', err.stderr || err.stdout || err.message);
  process.exit(1);
}
