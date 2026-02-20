import jwt from 'jsonwebtoken';

const unauthorized = (res, message = 'Unauthorized') => {
    return res.status(401).json({ success: false, error: message });
};

const getJwtSecret = () => {
    return process.env.JWT_SECRET || 'dev-jwt-secret-change-this';
};

export const requireAuth = (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
        return unauthorized(res, 'Missing bearer token');
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
        return unauthorized(res, 'Missing bearer token');
    }

    try {
        const payload = jwt.verify(token, getJwtSecret());
        req.user = {
            id: payload.sub,
            email: payload.email,
            role: payload.role || 'user',
        };
        return next();
    } catch (error) {
        return unauthorized(res, 'Invalid or expired token');
    }
};
