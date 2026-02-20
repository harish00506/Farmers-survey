import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';

dotenv.config();

const emailArg = process.argv[2];
const targetEmail = String(emailArg || '').trim().toLowerCase();

if (!targetEmail) {
    console.error('Usage: node scripts/checkOwnerData.js <user-email>');
    process.exit(1);
}

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB_NAME || 'farmer_survey';

if (!uri) {
    console.error('MONGODB_URI is not configured.');
    process.exit(1);
}

const run = async () => {
    const client = new MongoClient(uri);
    try {
        await client.connect();
        const db = client.db(dbName);

        const user = await db.collection('users').findOne({ email: targetEmail });
        if (!user) {
            throw new Error(`User not found: ${targetEmail}`);
        }

        const ownerUserId = String(user._id);
        const [questions, farmers, sessions, answers, audio] = await Promise.all([
            db.collection('questions').countDocuments({ ownerUserId }),
            db.collection('farmers').countDocuments({ ownerUserId }),
            db.collection('surveySessions').countDocuments({ ownerUserId }),
            db.collection('answers').countDocuments({ ownerUserId }),
            db.collection('audio').countDocuments({ ownerUserId }),
        ]);

        console.log(`ownerUserId=${ownerUserId}`);
        console.log(`questions=${questions}`);
        console.log(`farmers=${farmers}`);
        console.log(`surveySessions=${sessions}`);
        console.log(`answers=${answers}`);
        console.log(`audio=${audio}`);
    } finally {
        await client.close();
    }
};

run().catch((error) => {
    console.error('Failed:', error.message);
    process.exit(1);
});
