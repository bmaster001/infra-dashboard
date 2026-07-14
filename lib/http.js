'use strict';
const http = require('http');
const https = require('https');

function fetchJSON(targetUrl, headers = {}, reqOpts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(targetUrl);
    const mod = u.protocol === 'https:' ? https : http;
    const opts = {
      hostname: u.hostname,
      port: u.port ? Number(u.port) : undefined,
      path: u.pathname + u.search,
      method: 'GET',
      headers: { 'User-Agent': 'infra-dashboard/1.0', ...headers },
      ...reqOpts,
    };
    const req = mod.request(opts, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error(`HTTP ${res.statusCode} — geen JSON response`));
        }
      });
    });
    req.setTimeout(12000, () => req.destroy(new Error('Request timeout')));
    req.on('error', reject);
    req.end();
  });
}

function fetchText(targetUrl) {
  return new Promise((resolve, reject) => {
    const u = new URL(targetUrl);
    const opts = {
      hostname: u.hostname,
      port: u.port ? Number(u.port) : undefined,
      path: u.pathname + u.search,
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; infra-dashboard/1.0)' },
    };
    const req = https.request(opts, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve(body));
    });
    req.setTimeout(15000, () => req.destroy(new Error('Request timeout')));
    req.on('error', reject);
    req.end();
  });
}

module.exports = { fetchJSON, fetchText };
