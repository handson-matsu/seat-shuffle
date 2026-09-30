const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

async function startApp() {
  const root = path.resolve(__dirname, '..');
  const server = http.createServer((request, response) => {
    const name = request.url === '/' ? 'index.html' : request.url.slice(1);
    if (!['index.html', 'app.js', 'roster-file.js', 'style.css'].includes(name)) { response.writeHead(404).end(); return; }
    response.setHeader('Content-Type', name.endsWith('.js') ? 'application/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8');
    response.end(fs.readFileSync(path.join(root, name)));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  try {
    const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'chrome' });
    return { browser, url: `http://127.0.0.1:${server.address().port}/`, close: async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); } };
  } catch (error) { server.close(); throw error; }
}
module.exports = { startApp };
