const express = require('express');
const logger = require('./utils/logger');
const config = require('./config');
const requestId = require('./middleware/requestId');
const requestLogger = require('./middleware/requestLogger');
const rateLimiter = require('./middleware/rateLimiter');
const claimsRouter = require('./routes/claims');
const { router: dealsRouter } = require('./routes/deals');
const healthRouter = require('./routes/health');
const adminRouter = require('./routes/admin');
const ordersRouter = require('./routes/orders');
const { connectLoop } = require('./services/queuePublisher');

const app = express();
app.set('trust proxy', true);          // behind nginx: use X-Forwarded-For as the client IP
app.use(express.json({ limit: '10kb' }));
app.use(requestId);
app.use(requestLogger);

app.get('/live', (_req, res) => res.send('ok'));   // container liveness, no dependencies

// ---- routing table (the "gateway" part) ----
app.use('/api/health', healthRouter);                          // not rate limited
app.use('/api/admin', adminRouter);                            // demo controls, not rate limited
app.use('/api/orders', ordersRouter);                           // read-only, MongoDB, polled by the app
app.use('/api/claim', rateLimiter, claimsRouter);              // -> AWS SQS -> worker -> MongoDB (stock + claims)
app.use('/api/deals', rateLimiter, dealsRouter);               // -> cache -> circuit breaker -> catalog-service

app.use((req, res) => res.status(404).json({ error: 'Not found', requestId: req.id }));

app.listen(config.port, () => {
  logger.info('gateway_listening', { port: config.port, rateLimit: config.rateLimit });
  connectLoop();
});
