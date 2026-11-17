// The product catalogue for the flash sale. `stock` can never go below zero (validator),
// and the worker only decrements it with an atomic conditional update.
const HOUR = 3600 * 1000;

const SEED = [
  { dealId: 'deal-001', name: 'Noise-cancelling headphones', description: 'Over-ear, 30 hour battery, travel case included.', category: 'Audio', art: 'headphones', originalPrice: 129, salePrice: 49, totalStock: 120, saleHours: 72 },
  { dealId: 'deal-002', name: 'Mechanical keyboard', description: 'Hot-swappable switches, aluminium frame, USB-C.', category: 'Accessories', art: 'keyboard', originalPrice: 89, salePrice: 39, totalStock: 80, saleHours: 120 },
  { dealId: 'deal-003', name: '4K webcam', description: 'Autofocus, built-in privacy shutter, dual microphones.', category: 'Video', art: 'webcam', originalPrice: 119, salePrice: 59, totalStock: 45, saleHours: 168 },
  { dealId: 'deal-004', name: 'USB-C dock', description: '7-in-1 hub: HDMI, Ethernet, SD card and 100W pass-through.', category: 'Accessories', art: 'dock', originalPrice: 69, salePrice: 29, totalStock: 200, saleHours: 96 },
  { dealId: 'deal-005', name: 'Portable Bluetooth speaker', description: 'Water resistant, 12 hour playtime, stereo pairing.', category: 'Audio', art: 'speaker', originalPrice: 79, salePrice: 35, totalStock: 150, saleHours: 144 },
  { dealId: 'deal-006', name: 'Fitness smartwatch', description: 'Heart-rate and sleep tracking. Limited drop: only 6 units.', category: 'Wearables', art: 'watch', originalPrice: 149, salePrice: 69, totalStock: 6, saleHours: 48 },
];

module.exports = {
  id: '002_create_deals',
  async up(db) {
    const exists = (await db.listCollections({ name: 'deals' }).toArray()).length > 0;
    if (!exists) {
      await db.createCollection('deals', {
        validator: {
          $jsonSchema: {
            bsonType: 'object',
            required: ['dealId', 'name', 'originalPrice', 'salePrice', 'totalStock', 'stock', 'sold', 'startsAt', 'endsAt', 'saleHours'],
            properties: {
              dealId: { bsonType: 'string' },
              name: { bsonType: 'string' },
              description: { bsonType: 'string' },
              category: { bsonType: 'string' },
              art: { bsonType: 'string', description: 'which illustration the UI draws' },
              originalPrice: { bsonType: 'number', minimum: 0 },
              salePrice: { bsonType: 'number', minimum: 0 },
              totalStock: { bsonType: 'number', minimum: 0 },
              stock: { bsonType: 'number', minimum: 0, description: 'units left; the database refuses negative values' },
              sold: { bsonType: 'number', minimum: 0 },
              saleHours: { bsonType: 'number', description: 'used by "Reset sale" to restart the countdown' },
              startsAt: { bsonType: 'date' },
              endsAt: { bsonType: 'date' },
            },
          },
        },
      });
    }
    const deals = db.collection('deals');
    await deals.createIndex({ dealId: 1 }, { name: 'dealId_unique', unique: true });

    if ((await deals.countDocuments()) === 0) {
      const now = Date.now();
      await deals.insertMany(
        SEED.map((d) => ({ ...d, stock: d.totalStock, sold: 0, startsAt: new Date(now - HOUR), endsAt: new Date(now + d.saleHours * HOUR) }))
      );
    }
  },
};
