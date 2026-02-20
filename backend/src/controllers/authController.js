import {
    createUser,
    deleteUserAccount,
    getUserById,
    sanitizeUser,
    signJwt,
    updateUserSurveyName,
    verifyCredentials,
} from '../services/authService.js';

export const signup = async (req, res, next) => {
    try {
        const db = req.app.locals.mongoDb;
        const { email, password } = req.body || {};

        if (!email || !password) {
            return res.status(400).json({ success: false, error: 'Email and password are required' });
        }

        let user;
        try {
            user = await createUser(db, { email, password });
        } catch (error) {
            if (error.message === 'User already exists') {
                return res.status(409).json({ success: false, error: 'User already exists' });
            }
            throw error;
        }

        const token = signJwt(user);
        return res.status(201).json({
            success: true,
            token,
            user: sanitizeUser(user),
        });
    } catch (error) {
        return next(error);
    }
};

export const login = async (req, res, next) => {
    try {
        const db = req.app.locals.mongoDb;
        const { email, password } = req.body || {};

        if (!email || !password) {
            return res.status(400).json({ success: false, error: 'Email and password are required' });
        }

        const user = await verifyCredentials(db, { email, password });
        if (!user) {
            return res.status(401).json({ success: false, error: 'Invalid email or password' });
        }

        const token = signJwt(user);
        return res.json({
            success: true,
            token,
            user: sanitizeUser(user),
        });
    } catch (error) {
        return next(error);
    }
};

export const me = async (req, res, next) => {
    try {
        const db = req.app.locals.mongoDb;
        const user = await getUserById(db, req.user?.id);
        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }
        return res.json({ success: true, user: sanitizeUser(user) });
    } catch (error) {
        return next(error);
    }
};

export const updateSurveyName = async (req, res, next) => {
    try {
        const db = req.app.locals.mongoDb;
        const userId = req.user?.id;
        const { surveyName } = req.body || {};

        let user;
        try {
            user = await updateUserSurveyName(db, userId, surveyName);
        } catch (error) {
            if (error.message === 'Survey name is required') {
                return res.status(400).json({ success: false, error: 'Survey name is required' });
            }
            if (error.message === 'User not found') {
                return res.status(404).json({ success: false, error: 'User not found' });
            }
            throw error;
        }

        return res.json({ success: true, user: sanitizeUser(user) });
    } catch (error) {
        return next(error);
    }
};

export const deleteAccount = async (req, res, next) => {
    try {
        const db = req.app.locals.mongoDb;
        const userId = req.user?.id;

        let result;
        try {
            result = await deleteUserAccount(db, userId);
        } catch (error) {
            if (error.message === 'User not found') {
                return res.status(404).json({ success: false, error: 'User not found' });
            }
            throw error;
        }

        return res.json({
            success: true,
            message: 'Account deleted successfully',
            deletedUserId: result.deletedUserId,
        });
    } catch (error) {
        return next(error);
    }
};
