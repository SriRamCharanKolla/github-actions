const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017';
const DB_NAME = process.env.DB_NAME || 'fieldsync';

const app = express();
app.use(cors());
app.use(express.json());

let dbClient;
let activitiesCollection;

async function initDb() {
  dbClient = new MongoClient(MONGO_URI);
  await dbClient.connect();
  const db = dbClient.db(DB_NAME);
  activitiesCollection = db.collection('site_activities');
  // Ensure unique index on clientActivityId for idempotency
  await activitiesCollection.createIndex({ clientActivityId: 1 }, { unique: true });
  console.log(`[MongoDB] Connected successfully to ${MONGO_URI}/${DB_NAME}`);
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    database: activitiesCollection ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString(),
  });
});

// Sync endpoint called by FieldSync app
app.post('/v1/construction/site-activities', async (req, res) => {
  const idempotencyKey = req.header('Idempotency-Key');
  const clientRequestId = req.header('X-Client-Request-Id');
  const { clientActivityId, siteName, notes, occurredAt } = req.body;

  if (!siteName || !clientActivityId) {
    return res.status(400).json({ error: 'siteName and clientActivityId are required.' });
  }

  const document = {
    clientActivityId,
    siteName: siteName.trim(),
    notes: (notes || '').trim(),
    occurredAt: occurredAt || new Date().toISOString(),
    idempotencyKey,
    clientRequestId,
    syncedAt: new Date().toISOString(),
  };

  try {
    const result = await activitiesCollection.updateOne(
      { clientActivityId },
      { $set: document },
      { upsert: true }
    );

    console.log(`[Sync] Saved activity: "${document.siteName}" (${clientActivityId})`);
    return res.status(200).json({
      status: 'synced',
      activity: document,
      upserted: result.upsertedCount > 0,
    });
  } catch (error) {
    console.error('[Sync Error]', error);
    return res.status(500).json({ error: error.message });
  }
});

// Query all synced activities from MongoDB
app.get('/v1/construction/site-activities', async (req, res) => {
  try {
    const activities = await activitiesCollection.find().sort({ occurredAt: -1 }).toArray();
    res.json({ count: activities.length, activities });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Clear activities (useful for test reset)
app.delete('/v1/construction/site-activities', async (req, res) => {
  try {
    const result = await activitiesCollection.deleteMany({});
    res.json({ deletedCount: result.deletedCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

initDb()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`[FieldSync Server] Running on http://0.0.0.0:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('[DB Connect Error]', err);
    process.exit(1);
  });
