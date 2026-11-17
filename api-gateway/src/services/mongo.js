const { MongoClient } = require('mongodb');
const config = require('../config');

// The worker does the writes; the gateway only reads (health check, counter, "my orders").
const client = new MongoClient(config.mongoUrl, { serverSelectionTimeoutMS: 2000 });
const db = () => client.db(config.mongoDb);

module.exports = {
  ping: () => db().command({ ping: 1 }),
  countClaims: () => db().collection('claims').estimatedDocumentCount(),
  ordersFor: (userId, limit = 30) =>
    db()
      .collection('claims')
      .find({ userId })                                  // served by the (userId, createdAt) index
      .sort({ createdAt: -1 })
      .limit(limit)
      .project({
        _id: 0, claimId: 1, requestId: 1, dealId: 1, dealName: 1, status: 1, reason: 1,
        price: 1, orderNo: 1, attempts: 1, processedBy: 1, createdAt: 1, processedAt: 1,
      })
      .toArray(),
};
