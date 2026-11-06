// Isolated HTTPS Microsoft Graph double. The Docker network has no external route.
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const root = '/data/review';
const events = path.join(root, 'graph-events.jsonl');
let nextId = 0;
const drafts = new Map();
const record = event => fs.appendFileSync(events, JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n');

https.createServer({ key: fs.readFileSync(`${root}/key.pem`), cert: fs.readFileSync(`${root}/cert.pem`) }, async (req, res) => {
  let body = ''; for await (const bytes of req) body += bytes;
  const url = new URL(req.url, 'https://graph.microsoft.com');
  const route = decodeURIComponent(url.pathname);
  const scenario = JSON.parse(fs.readFileSync(`${root}/scenario.json`, 'utf8'));
  const reply = (status, payload) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(payload === undefined ? '' : JSON.stringify(payload)); };
  record({ method: req.method, route });
  const message = scenario.messages.find(m => route.includes(`/${m.id}/`));
  if (message && scenario.blockMessage === message.id && route.includes('/attachments')) {
    record({ blocked: message.id });
    while (JSON.parse(fs.readFileSync(`${root}/scenario.json`, 'utf8')).blockMessage === message.id) await new Promise(r => setTimeout(r, 100));
  }
  if (message && scenario.failMessage === message.id && route.includes('/attachments')) return reply(500, { error: { code: 'SyntheticChildFailure', message: 'Injected Graph double failure' } });
  if (scenario.downloadDelayMs && route.includes('/attachments')) await new Promise(r => setTimeout(r, scenario.downloadDelayMs));
  if (req.method === 'GET' && /\/messages$/.test(route)) return reply(200, { value: scenario.messages.filter(m => m.visible).map(m => ({
    id: m.id, subject: m.subject, from: { emailAddress: { address: scenario.sender } }, sender: { emailAddress: { address: scenario.sender } },
    hasAttachments: true, receivedDateTime: '2026-10-23T16:00:00Z', isRead: false, body: { content: '', contentType: 'text' },
    toRecipients: [{ emailAddress: { address: 'review@example.test' } }], ccRecipients: [], bccRecipients: [], categories: [], bodyPreview: 'Synthetic review', conversationId: m.id
  })) });
  if (req.method === 'GET' && message && route.includes('/attachments')) {
    const zip = fs.readFileSync(`${root}/zips/${message.id}.zip`);
    if (route.endsWith('/$value')) { res.writeHead(200, { 'content-type': 'application/zip', 'content-disposition': 'attachment; filename="synthetic.zip"' }); return res.end(zip); }
    const attachment = { '@odata.type': '#microsoft.graph.fileAttachment', id: `ATT-${message.id}`, name: 'synthetic.zip', contentType: 'application/zip', size: zip.length, isInline: false, contentBytes: zip.toString('base64') };
    return reply(200, route.endsWith('/attachments') ? { value: [attachment] } : attachment);
  }
  if (req.method === 'POST' && /\/messages$/.test(route)) {
    const data = JSON.parse(body); const id = `REVIEW-DRAFT-${++nextId}`; drafts.set(id, data);
    record({ effect: 'draft_created', id, subject: data.subject });
    return reply(201, { ...data, id, isDraft: true });
  }
  if (req.method === 'POST' && route.endsWith('/attachments')) {
    const data = JSON.parse(body); record({ effect: 'attachment_added', draft: route.split('/')[4], name: data.name, inline: data.isInline === true });
    return reply(201, { id: `REVIEW-ATT-${++nextId}`, ...data });
  }
  if (req.method === 'PATCH' && route.includes('/messages/')) { record({ effect: 'draft_updated' }); return reply(200, { id: route.split('/').at(-1), ...JSON.parse(body) }); }
  if (req.method === 'DELETE' && route.includes('/messages/')) { record({ effect: 'draft_deleted' }); return reply(204); }
  if (req.method === 'POST' && route.endsWith('/sendMail')) { record({ effect: 'summary_sent', synthetic: true }); return reply(202); }
  record({ unexpected: true }); return reply(400, { error: { code: 'UnimplementedSyntheticRoute', message: route } });
}).listen(443, '0.0.0.0', () => console.log('Synthetic Graph ready; no real delivery implementation'));
