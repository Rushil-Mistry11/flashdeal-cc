// Minimal migration runner. Runs every file in ./migrations (sorted by name) that has not been applied yet
// and records it in the `migrations` collection, so it is safe to run on every `docker compose up`.
// Run by hand:  MONGO_URL=mongodb://localhost:27018 node migrate.js
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const url = process.env.MONGO_URL || 'mongodb://mongo:27017';
const dbName = process.env.MONGO_DB || 'flashdeal';
const log = (msg, f = {}) => console.log(JSON.stringify({ ts: new Date().toISOString(), service: 'migrate', msg, ...f }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const client = new MongoClient(url, { serverSelectionTimeoutMS: 3000 });
    try {
      await client.connect();
      await client.db(dbName).command({ ping: 1 });
      return client;
    } catch (err) {
      log('mongodb_connect_retry', { attempt, err: err.message });
      await client.close().catch(() => {});
      await sleep(2000);
    }
  }
  throw new Error('MongoDB not reachable');
}

async function main() {
  const client = await connect();
  const db = client.db(dbName);
  const applied = new Set((await db.collection('migrations').find().toArray()).map((m) => m.id));
  const dir = path.join(__dirname, 'migrations');

  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort()) {
    const migration = require(path.join(dir, file));
    if (applied.has(migration.id)) {
      log('migration_skipped', { id: migration.id });
      continue;
    }
    log('migration_applying', { id: migration.id });
    await migration.up(db);
    await db.collection('migrations').insertOne({ id: migration.id, appliedAt: new Date() });
    log('migration_applied', { id: migration.id });
  }
  await client.close();
  log('migrations_done');
}

main().catch((err) => {
  log('migration_failed', { err: err.message });
  process.exit(1);
});
