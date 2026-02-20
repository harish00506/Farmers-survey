import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { UserModel, getModelByCollection } from '../models/index.js';

const getJwtSecret = () => {
    return process.env.JWT_SECRET || 'dev-jwt-secret-change-this';
};

const getJwtExpiry = () => {
    return process.env.JWT_EXPIRES_IN || '7d';
};

export const normalizeEmail = (value = '') => String(value).trim().toLowerCase();

export const sanitizeUser = (user) => {
    if (!user) return null;
    return {
        id: String(user._id || user.id),
        email: user.email,
        role: user.role || 'user',
        surveyName: user.surveyName || '',
        createdAt: user.createdAt,
    };
};

export const signJwt = (user) => {
    return jwt.sign(
        {
            email: user.email,
            role: user.role || 'user',
        },
        getJwtSecret(),
        {
            subject: String(user._id || user.id),
            expiresIn: getJwtExpiry(),
        },
    );
};

export const createUser = async (db, { email, password }) => {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail || !password) {
        throw new Error('Email and password are required');
    }

    const existing = await UserModel.findOne({ email: normalizedEmail }).lean();
    if (existing) {
        throw new Error('User already exists');
    }

    const now = new Date();
    const passwordHash = await bcrypt.hash(String(password), 10);
    const doc = {
        email: normalizedEmail,
        passwordHash,
        role: 'user',
        isActive: true,
        createdAt: now,
        updatedAt: now,
    };

    const created = await UserModel.create(doc);
    return created.toObject();
};

export const verifyCredentials = async (db, { email, password }) => {
    const normalizedEmail = normalizeEmail(email);
    const user = await UserModel.findOne({ email: normalizedEmail, isActive: { $ne: false } }).lean();
    if (!user) return null;

    const valid = await bcrypt.compare(String(password || ''), user.passwordHash || '');
    if (!valid) return null;

    await UserModel.updateOne(
        { _id: user._id },
        { $set: { lastLoginAt: new Date(), updatedAt: new Date() } },
    );

    return user;
};

export const getUserById = async (db, userId) => {
    if (!userId) return null;
    const _id = mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : userId;
    return UserModel.findOne({ _id, isActive: { $ne: false } }).lean();
};

export const ensureUsersIndexes = async (db) => {
    await UserModel.syncIndexes();
};

export const updateUserSurveyName = async (db, userId, surveyName) => {
    const normalizedSurveyName = String(surveyName || '').trim();
    if (!normalizedSurveyName) {
        throw new Error('Survey name is required');
    }

    if (!userId) {
        throw new Error('User not found');
    }

    const _id = mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : userId;
    const now = new Date();

    const result = await UserModel.updateOne(
        { _id, isActive: { $ne: false } },
        { $set: { surveyName: normalizedSurveyName, updatedAt: now } },
    );

    if (!result.matchedCount) {
        throw new Error('User not found');
    }

    return UserModel.findOne({ _id, isActive: { $ne: false } }).lean();
};

export const deleteUserAccount = async (db, userId) => {
    if (!userId) {
        throw new Error('User not found');
    }

    const _id = mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : userId;
    const user = await UserModel.findOne({ _id, isActive: { $ne: false } }).lean();
    if (!user) {
        throw new Error('User not found');
    }

    const ownerUserId = String(user._id);

    const ownerScopedCollections = [
        'surveys',
        'questions',
        'questionTransitions',
        'answers',
        'farmers',
        'surveySessions',
        'audio',
        'regions',
        'inviteJobs',
    ];

    await Promise.all(
        ownerScopedCollections.map(async (collectionName) => {
            const collection = getModelByCollection(collectionName).collection;
            await collection.deleteMany({ ownerUserId });
        }),
    );

    await UserModel.deleteOne({ _id });

    return { deletedUserId: ownerUserId };
};
