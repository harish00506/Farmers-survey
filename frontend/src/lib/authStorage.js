const TOKEN_KEY = 'fs_auth_token';
const USER_KEY = 'fs_auth_user';

export const getAuthToken = () => localStorage.getItem(TOKEN_KEY);

export const setAuthToken = (token) => {
    if (!token) return;
    localStorage.setItem(TOKEN_KEY, token);
};

export const getAuthUser = () => {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
};

export const setAuthUser = (user) => {
    if (!user) return;
    localStorage.setItem(USER_KEY, JSON.stringify(user));
};

export const clearAuthSession = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
};
