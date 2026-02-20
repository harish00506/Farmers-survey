import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';

dotenv.config();

const emailArg = process.argv[2];
const targetEmail = String(emailArg || '').trim().toLowerCase();

if (!targetEmail) {
    console.error('Usage: node scripts/assignLegacyDataOwner.js <user-email>');
    process.exit(1);
}

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB_NAME || 'farmer_survey';

if (!uri) {
    console.error('MONGODB_URI is not configured.');
    process.exit(1);
}

const collectionsToAssign = [
    'questions',
    'questionTransitions',
    'farmers',
    'surveySessions',
    'answers',
    'audio',
];

const legacyFilter = {
    $or: [{ ownerUserId: { $exists: false } }, { ownerUserId: null }],
};

const run = async () => {
    const client = new MongoClient(uri);
    try {
        await client.connect();
        const db = client.db(dbName);

        const users = db.collection('users');
        const user = await users.findOne({ email: targetEmail });
        if (!user) {
            throw new Error(`User not found: ${targetEmail}`);
        }

        const ownerUserId = String(user._id);
        console.log(`Assigning legacy data to ${targetEmail} (ownerUserId=${ownerUserId})`);

        for (const collectionName of collectionsToAssign) {
            const coll = db.collection(collectionName);
            const result = await coll.updateMany(legacyFilter, {
                $set: {
                    ownerUserId,
                    updatedAt: new Date(),
                },
            });
            console.log(`${collectionName}: matched=${result.matchedCount}, modified=${result.modifiedCount}`);
        }

        console.log('Done.');
    } finally {
        await client.close();
    }
};

run().catch((error) => {
    console.error('Failed:', error.message);
    process.exit(1);
});
