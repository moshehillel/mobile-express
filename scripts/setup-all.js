'use strict';
/**
 * One run for a new shop: ask for the new account values, then create
 * Airtable, Twilio, and Netlify. Already-filled values are kept.
 * Run: node scripts/setup-all.js
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawnSync } = require('child_process');
const { ROOT, CONFIG_PATH, loadConfig, saveConfig } = require('./setup-common');

function ask(rl, label, current) {
  if (current) return Promise.resolve(current);
  return new Promise((resolve) => {
    rl.question(label, (answer) => resolve(String(answer || '').trim()));
  });
}

async function requireValue(rl, label, current) {
  let value = current || '';
  while (!value) value = await ask(rl, label, '');
  return value;
}

function runNode(script) {
  const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts', script)], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

function runNetlify(args, inherit) {
  return spawnSync('netlify', args, {
    cwd: ROOT,
    stdio: inherit ? 'inherit' : 'pipe',
    shell: true,
    encoding: 'utf8',
  });
}

function ensureNetlifyLogin() {
  const status = runNetlify(['status'], false);
  const text = `${status.stdout || ''}\n${status.stderr || ''}`;
  if (status.status === 0 && !/not logged in/i.test(text)) return;
  console.log('\nA browser window will open so this PC can log into the new Netlify account.');
  const login = runNetlify(['login'], true);
  if (login.status !== 0) {
    console.error('Netlify login did not finish.');
    process.exit(login.status || 1);
  }
}

async function main() {
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.copyFileSync(path.join(ROOT, 'setup-local.example.json'), CONFIG_PATH);
  }
  const cfg = loadConfig();
  cfg.airtable = cfg.airtable || {};
  cfg.twilio = cfg.twilio || {};
  cfg.netlify = cfg.netlify || {};
  cfg.env = cfg.env || {};

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log('Press Enter to accept a value that is already saved.\n');

  cfg.airtable.token = await requireValue(rl, 'Airtable token: ', cfg.airtable.token);
  cfg.twilio.accountSid = await requireValue(rl, 'Twilio account SID (AC...): ', cfg.twilio.accountSid);
  cfg.twilio.authToken = await requireValue(rl, 'Twilio auth token: ', cfg.twilio.authToken);
  cfg.env.STRIPE_SECRET_KEY = await requireValue(rl, 'Stripe secret key: ', cfg.env.STRIPE_SECRET_KEY);
  cfg.env.STRIPE_PUBLISHABLE_KEY = await requireValue(rl, 'Stripe publishable key: ', cfg.env.STRIPE_PUBLISHABLE_KEY);
  cfg.env.GMAIL_USER = await requireValue(rl, 'Gmail address: ', cfg.env.GMAIL_USER);
  cfg.env.GMAIL_APP_PASS = await requireValue(rl, 'Gmail app password: ', cfg.env.GMAIL_APP_PASS);
  cfg.env.SELLER_EMAIL = await requireValue(rl, `Shop email [${cfg.env.SELLER_EMAIL || cfg.env.GMAIL_USER}]: `, cfg.env.SELLER_EMAIL || cfg.env.GMAIL_USER);
  cfg.env.SHIPPO_API_KEY = await requireValue(rl, 'Shippo API key: ', cfg.env.SHIPPO_API_KEY);
  cfg.env.SENDER_NAME = await requireValue(rl, `Sender name [${cfg.env.SENDER_NAME || 'Mobile Express NY'}]: `, cfg.env.SENDER_NAME || 'Mobile Express NY');
  cfg.env.SENDER_STREET = await requireValue(rl, 'Sender street: ', cfg.env.SENDER_STREET);
  cfg.env.SENDER_CITY = await requireValue(rl, 'Sender city: ', cfg.env.SENDER_CITY);
  cfg.env.SENDER_STATE = await requireValue(rl, `Sender state [${cfg.env.SENDER_STATE || 'NY'}]: `, cfg.env.SENDER_STATE || 'NY');
  cfg.env.SENDER_ZIP = await requireValue(rl, 'Sender ZIP: ', cfg.env.SENDER_ZIP);
  cfg.env.SENDER_PHONE = await requireValue(rl, 'Sender phone: ', cfg.env.SENDER_PHONE);
  cfg.env.SENDER_EMAIL = await requireValue(rl, `Sender email [${cfg.env.SENDER_EMAIL || cfg.env.GMAIL_USER}]: `, cfg.env.SENDER_EMAIL || cfg.env.GMAIL_USER);
  cfg.env.ADMIN_PASSWORD = await requireValue(rl, 'Admin password for order tools: ', cfg.env.ADMIN_PASSWORD);
  cfg.env.OPENAI_API_KEY = await requireValue(rl, 'OpenAI API key: ', cfg.env.OPENAI_API_KEY);
  cfg.netlify.siteName = await requireValue(rl, `Netlify site name [${cfg.netlify.siteName || 'mobile-express'}]: `, cfg.netlify.siteName || 'mobile-express');
  rl.close();

  saveConfig(cfg);
  console.log('\n[1/3] Airtable');
  runNode('setup-airtable.js');
  console.log('\n[2/3] Twilio');
  runNode('setup-twilio.js');
  console.log('\n[3/3] Netlify');
  ensureNetlifyLogin();
  runNode('setup-netlify.js');
  console.log('\nSaving the new IDs into the project...');
  runNode('apply-setup-ids.js');
  console.log('\nSetup finished.');
  console.log('The phone number was not moved.');
  console.log('Audio prompts and the assistance step still use the old Twilio domain.');
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
