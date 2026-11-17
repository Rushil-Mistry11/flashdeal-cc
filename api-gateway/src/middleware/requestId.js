const { randomUUID } = require('crypto');

// Correlation ID: reused if the caller sent one, otherwise generated. Echoed back and logged everywhere.
module.exports = function requestId(req, res, next) {
  req.id = req.get('x-request-id') || randomUUID();
  res.set('X-Request-Id', req.id);
  next();
};
