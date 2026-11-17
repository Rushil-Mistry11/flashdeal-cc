const mongoose = require('mongoose');

// Mirrors db/migrations/001_create_claims.js (the migration owns the collection, validator and indexes).
const claimSchema = new mongoose.Schema(
  {
    claimId: { type: String, required: true },
    requestId: { type: String, required: true },
    userId: { type: String, required: true },
    dealId: { type: String, required: true },
    status: { type: String, enum: ['CONFIRMED', 'SOLD_OUT', 'REJECTED'], required: true },
    reason: { type: String, enum: ['ALREADY_CLAIMED', 'DEAL_ENDED', 'NOT_STARTED', 'UNKNOWN_DEAL'] },
    dealName: { type: String },
    price: { type: Number },
    orderNo: { type: String },
    attempts: { type: Number, default: 1 },
    processedBy: { type: String },
    createdAt: { type: Date, required: true },
    processedAt: { type: Date, required: true },
  },
  { versionKey: false, autoIndex: false, autoCreate: false }
);

module.exports = mongoose.model('Claim', claimSchema, 'claims');
