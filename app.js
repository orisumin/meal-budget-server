import express from 'express';
import { ObjectId } from 'mongodb';
import { randomBytes, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { HttpError, validate } from './validation.js';

const scryptAsync = promisify(scrypt);

function parseId(value) {
  if (!/^[a-f\d]{24}$/i.test(value)) {
    throw new HttpError(400, 'Invalid ID: expected a 24-character MongoDB ObjectId.');
  }
  return new ObjectId(value);
}

function positiveInteger(value, fallback, maximum) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new HttpError(400, 'page and limit must be positive integers.');
  }
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result > maximum) {
    throw new HttpError(400, `Pagination value exceeds ${maximum}.`);
  }
  return result;
}

async function prepare(data) {
  if (Object.hasOwn(data, 'password')) {
    const salt = randomBytes(16).toString('hex');
    const hash = await scryptAsync(data.password, salt, 64);
    data.passwordHash = `scrypt:${salt}:${hash.toString('hex')}`;
    delete data.password;
  }
  return data;
}

function present(resource, document) {
  if (resource !== 'users') return document;
  return {
    _id: document._id,
    username: document.username ?? document.userName,
    email: document.email,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt
  };
}

export function createApp(db) {
  const app = express();
  app.disable('x-powered-by');

  const allowedHosts = (process.env.ALLOWED_HOSTS ?? '')
    .split(',').map(value => value.trim()).filter(Boolean);
  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
    .split(',').map(value => value.trim()).filter(Boolean);

  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'same-origin');

    const hostname = (req.get('host') ?? '').split(':')[0];
    const origin = req.get('origin');

    if (allowedHosts.length > 0 && !allowedHosts.includes(hostname)) {
      return next(new HttpError(403, 'Host is not allowed.'));
    }
    if (origin && allowedOrigins.length > 0 && !allowedOrigins.includes(origin)) {
      return next(new HttpError(403, 'Origin is not allowed.'));
    }
    if (origin && allowedOrigins.includes(origin)) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      return res.sendStatus(204);
    }
    if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
    if (req.path.startsWith('/api/') && ['POST', 'PUT', 'PATCH'].includes(req.method)
      && !req.is('application/json')) {
      return next(new HttpError(415, 'Use Content-Type: application/json.'));
    }
    next();
  });

  app.use(express.json({ limit: '256kb' }));

  app.get('/api/health', async (req, res) => {
    await db.command({ ping: 1 });
    res.json({ status: 'ok' });
  });

  for (const resource of ['users', 'weeks', 'recipes']) {
    const collection = db.collection(resource);
    const base = `/api/${resource}`;

    app.get(base, async (req, res) => {
      for (const key of Object.keys(req.query)) {
        if (!['page', 'limit', 'userId'].includes(key)) {
          throw new HttpError(400, `Unknown query parameter: ${key}.`);
        }
      }
      const page = positiveInteger(req.query.page, 1, 1000000);
      const limit = positiveInteger(req.query.limit, 20, 100);
      const filter = {};
      if (req.query.userId !== undefined) {
        if (resource === 'users') throw new HttpError(400, 'userId is not supported for users.');
        filter.userId = parseId(req.query.userId).toHexString();
      }
      const data = await collection.find(filter).sort({ _id: 1 })
        .skip((page - 1) * limit).limit(limit).toArray();
      res.json({ data: data.map(document => present(resource, document)), page, limit });
    });

    app.get(`${base}/:id`, async (req, res) => {
      const document = await collection.findOne({ _id: parseId(req.params.id) });
      if (!document) throw new HttpError(404, `${resource} document not found.`);
      res.json(present(resource, document));
    });

    app.post(base, async (req, res) => {
      const data = await prepare(validate(resource, req.body));
      const now = new Date();
      const document = { ...data, createdAt: now, updatedAt: now };
      const result = await collection.insertOne(document);
      document._id = result.insertedId;
      res.status(201).location(`${base}/${result.insertedId}`).json(present(resource, document));
    });

    app.put(`${base}/:id`, async (req, res) => {
      const _id = parseId(req.params.id);
      const data = await prepare(validate(resource, req.body));
      const existing = await collection.findOne({ _id });
      if (!existing) throw new HttpError(404, `${resource} document not found.`);
      const document = {
        ...data,
        createdAt: existing.createdAt ?? new Date(),
        updatedAt: new Date()
      };
      await collection.replaceOne({ _id }, document);
      res.json(present(resource, { ...document, _id }));
    });

    app.patch(`${base}/:id`, async (req, res) => {
      const _id = parseId(req.params.id);
      const data = await prepare(validate(resource, req.body, true));
      const update = { $set: { ...data, updatedAt: new Date() } };
      if (Object.hasOwn(data, 'passwordHash')) update.$unset = { password: '' };
      const document = await collection.findOneAndUpdate({ _id }, update, {
        returnDocument: 'after', includeResultMetadata: false
      });
      if (!document) throw new HttpError(404, `${resource} document not found.`);
      res.json(present(resource, document));
    });

    app.delete(`${base}/:id`, async (req, res) => {
      const result = await collection.deleteOne({ _id: parseId(req.params.id) });
      if (result.deletedCount === 0) throw new HttpError(404, `${resource} document not found.`);
      res.status(204).end();
    });
  }

  app.use((req, res) => res.status(404).json({ error: 'Route not found.' }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error.code === 11000) return res.status(409).json({ error: 'Username or email is already in use.' });
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
    if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });
    console.error('Request failed:', error.name ?? 'Error');
    res.status(500).json({ error: 'Server could not complete the request.' });
  });

  return app;
}
