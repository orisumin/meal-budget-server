import { MongoClient } from 'mongodb';
import { createApp } from './app.js';

const {
  MONGODB_URI,
  MONGODB_DB = 'mealPrep',
  PORT = '3000'
} = process.env;

if (!MONGODB_URI) {
  console.error('MONGODB_URI is missing. Configure it in .env locally or in the deployment provider.');
  process.exit(1);
}

if (!/^\d+$/.test(PORT) || Number(PORT) < 1 || Number(PORT) > 65535) {
  console.error('PORT must be an integer between 1 and 65535.');
  process.exit(1);
}

const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
let server;

async function stop() {
  const timeout = setTimeout(() => process.exit(1), 10000);
  timeout.unref();
  if (server) await new Promise(resolve => server.close(resolve));
  await client.close();
  clearTimeout(timeout);
}

try {
  await client.connect();
  const db = client.db(MONGODB_DB);
  await db.command({ ping: 1 });

  await db.collection('users').createIndex({ username: 1 }, { unique: true, sparse: true });
  await db.collection('users').createIndex({ email: 1 }, { unique: true, sparse: true });
  await db.collection('weeks').createIndex({ userId: 1, _id: 1 });
  await db.collection('recipes').createIndex({ userId: 1, _id: 1 });

  const app = createApp(db);
  server = app.listen(Number(PORT), '0.0.0.0');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });

  console.log(`Connected to MongoDB. Server listening on port ${PORT}.`);
  process.once('SIGINT', () => stop().catch(() => process.exit(1)));
  process.once('SIGTERM', () => stop().catch(() => process.exit(1)));
} catch (error) {
  console.error('Startup failed. Check MongoDB credentials, Atlas network access, and indexes.');
  console.error('Error type:', error.name);
  await stop();
  process.exitCode = 1;
}
