// Every claim request ends up as exactly one document here, whatever the outcome.
module.exports = {
  id: '001_create_claims',
  async up(db) {
    const exists = (await db.listCollections({ name: 'claims' }).toArray()).length > 0;
    if (!exists) {
      await db.createCollection('claims', {
        validator: {
          $jsonSchema: {
            bsonType: 'object',
            required: ['claimId', 'requestId', 'userId', 'dealId', 'status', 'createdAt', 'processedAt'],
            properties: {
              claimId: { bsonType: 'string', description: 'UUID from the gateway (idempotency key)' },
              requestId: { bsonType: 'string', description: 'correlation id used in every log line' },
              userId: { bsonType: 'string' },
              dealId: { bsonType: 'string' },
              status: { enum: ['CONFIRMED', 'SOLD_OUT', 'REJECTED'] },
              reason: { enum: ['ALREADY_CLAIMED', 'DEAL_ENDED', 'NOT_STARTED', 'UNKNOWN_DEAL'] },
              dealName: { bsonType: 'string', description: 'snapshot at processing time' },
              price: { bsonType: 'number', minimum: 0, description: 'price paid (snapshot)' },
              orderNo: { bsonType: 'string' },
              attempts: { bsonType: 'number' },
              processedBy: { bsonType: 'string' },
              createdAt: { bsonType: 'date', description: 'gateway accepted the request' },
              processedAt: { bsonType: 'date', description: 'worker finished the claim' },
            },
          },
        },
      });
    }
    await db.collection('claims').createIndexes([
      { key: { claimId: 1 }, name: 'claimId_unique', unique: true },
      {
        // business rule: a user can hold only ONE confirmed claim per deal (enforced by the database)
        key: { userId: 1, dealId: 1 },
        name: 'one_confirmed_claim_per_user_per_deal',
        unique: true,
        partialFilterExpression: { status: 'CONFIRMED' },
      },
      { key: { userId: 1, createdAt: -1 }, name: 'user_orders' },
      { key: { createdAt: -1 }, name: 'createdAt_desc' },
    ]);
  },
};
