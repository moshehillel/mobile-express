'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'setup-local.json');

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error('Missing setup-local.json.');
    console.error('Copy setup-local.example.json to setup-local.json and fill in the new account values.');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
}

function request(method, url, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body == null ? null : Buffer.isBuffer(body) ? body : Buffer.from(body);
    const req = https.request({
      method,
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: {
        ...headers,
        ...(data ? { 'Content-Length': data.length } : {}),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = text;
        try { json = text ? JSON.parse(text) : {}; } catch { /* keep text */ }
        if (res.statusCode >= 400) {
          const err = new Error(`${method} ${url} (${res.statusCode}): ${typeof json === 'string' ? json.slice(0, 500) : JSON.stringify(json).slice(0, 500)}`);
          err.status = res.statusCode;
          err.body = json;
          reject(err);
          return;
        }
        resolve(json);
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function basicAuth(accountSid, authToken) {
  return 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64');
}

module.exports = { ROOT, CONFIG_PATH, loadConfig, saveConfig, request, basicAuth };
