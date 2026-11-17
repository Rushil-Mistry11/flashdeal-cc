const logger = require('../utils/logger');

module.exports = function requestLogger(req, res, next) {
  if (req.path === '/api/health' || req.path === '/api/orders' || req.path === '/live') return next(); // polled constantly, skip noise
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    logger.info('http_request', {
      stage: 'gateway',
      requestId: req.id,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Number(process.hrtime.bigint() - start) / 1e6,
    });
  });
  next();
};
