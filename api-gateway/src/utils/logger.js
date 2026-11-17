// Structured JSON logs: one line per event, so a request can be traced with `grep <requestId>`.
const SERVICE = process.env.SERVICE_NAME || 'api-gateway';

function log(level, msg, fields = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), service: SERVICE, level, msg, ...fields }));
}

module.exports = {
  info: (m, f) => log('info', m, f),
  warn: (m, f) => log('warn', m, f),
  error: (m, f) => log('error', m, f),
};
