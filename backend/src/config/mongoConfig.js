import mongoose from 'mongoose';

const DEFAULT_DB_NAME = 'farmer_survey';
let cachedClient = null;
let cachedDb = null;

const resolveMongoConfig = () => {
    const uri = process.env.MONGODB_URI || '';
    const dbName = process.env.MONGODB_DB_NAME || DEFAULT_DB_NAME;

    if (!uri) {
        throw new Error('MONGODB_URI is not configured. Set it in your .env.');
    }

    return { uri, dbName };
};

export const initializeMongo = async () => {
    if (cachedClient && cachedDb) {
        return { client: cachedClient, db: cachedDb };
    }

    const { uri, dbName } = resolveMongoConfig();
    await mongoose.connect(uri, {
        dbName,
        maxPoolSize: 50,
    });

    const db = mongoose.connection.db;
    await db.command({ ping: 1 });
    const client = mongoose.connection.getClient();

    cachedClient = client;
    cachedDb = db;

    return { client, db };
};

export const getMongoDb = () => cachedDb;

export const closeMongo = async () => {
    if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
    }
    cachedClient = null;
    cachedDb = null;
};
