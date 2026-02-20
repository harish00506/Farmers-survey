#!/usr/bin/env node

/**
 * One-off repair script: find questions with nextId === id and fix them
 * - If a next question by sequence exists, set nextId to that
 * - Otherwise remove nextId
 */

import { initializeMongo } from '../src/config/mongoConfig.js';
import { updateQuestion } from '../src/services/surveyEngine.js';

const repair = async () => {
    const { client, db } = await initializeMongo();
    try {
        const questions = db.collection('questions');
        const docs = await questions.find({ $expr: { $eq: ['$id', '$nextId'] } }).toArray();
        if (!docs.length) {
            console.log('No self-referential nextId found.');
            return;
        }

        for (const q of docs) {
            console.log('Repairing', q.id);
            const seq = q.sequence;
            const nextDoc = await questions.findOne({ sequence: seq + 1 });
            const newNext = nextDoc ? nextDoc.id : null;
            try {
                await updateQuestion(db, q.id, { nextId: newNext });
                console.log(' → fixed:', q.id, 'nextId ->', newNext || '(removed)');
            } catch (err) {
                console.error('Failed to repair', q.id, err.message || err);
            }
        }
    } finally {
        await client.close();
    }
};

repair().catch((err) => {
    console.error('Repair failed:', err.message || err);
    process.exit(1);
});
