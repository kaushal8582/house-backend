import { MongoClient } from 'mongodb';

let client = null;
let db = null;

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/collabspace';

function resolveDatabaseName(uri) {
  if (process.env.MONGODB_DB_NAME) return process.env.MONGODB_DB_NAME;

  try {
    const match = uri.match(/\/([^/?]+)(\?|$)/);
    const name = match?.[1];
    if (!name || name.includes('.') || name.includes('/')) {
      return 'collabspace';
    }
    return name;
  } catch {
    return 'collabspace';
  }
}

const options = {
  maxPoolSize: 10,
  minPoolSize: 2,
  maxIdleTimeMS: 30000,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
};

export async function connectDatabase() {
  if (db) return db;

  try {
    client = new MongoClient(MONGODB_URI, options);
    await client.connect();
    const dbName = resolveDatabaseName(MONGODB_URI);
    db = client.db(dbName);

    await Promise.all([
      db.collection('users').createIndex({ email: 1 }, { unique: true }),
      db.collection('users').createIndex({ 'workspaces.workspaceId': 1 }),
      db.collection('workspaces').createIndex({ slug: 1 }, { unique: true }),
      db.collection('workspaces').createIndex({ 'members.userId': 1 }),
      db.collection('projects').createIndex({ workspaceId: 1, isDeleted: 1 }),
      db.collection('projects').createIndex({ workspaceId: 1, isArchived: 1 }),
      db.collection('projects').createIndex({ 'tasks._id': 1 }),
      db.collection('projects').createIndex({ name: 'text', description: 'text' }),
      db.collection('documents').createIndex({ projectId: 1 }),
      db.collection('documents').createIndex({ workspaceId: 1 }),
      db.collection('documents').createIndex({ 'collaborators.userId': 1 }),
      db.collection('documents').createIndex({ title: 'text', content: 'text' }),
      db.collection('audit_logs').createIndex({ entityType: 1, entityId: 1 }),
      db.collection('audit_logs').createIndex({ workspaceId: 1, createdAt: -1 }),
      db.collection('audit_logs').createIndex({ projectId: 1, createdAt: -1 }),
      db.collection('audit_logs').createIndex({ userId: 1, createdAt: -1 }),
      db.collection('notifications').createIndex({ userId: 1, read: 1 }),
      db.collection('notifications').createIndex({ createdAt: -1 }),
      db.collection('passwordResetTokens').createIndex({ token: 1 }, { unique: true }),
      db.collection('passwordResetTokens').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    ]);

    console.log(`MongoDB connected successfully (database: ${dbName})`);
    return db;
  } catch (error) {
    console.error('MongoDB connection error:', error.message);
    throw error;
  }
}

export function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call connectDatabase() first.');
  }
  return db;
}

export async function closeDatabase() {
  if (client) {
    await client.close();
    client = null;
    db = null;
    console.log('MongoDB connection closed');
  }
}

export function getClient() {
  if (!client) {
    throw new Error('Database not initialized. Call connectDatabase() first.');
  }
  return client;
}
