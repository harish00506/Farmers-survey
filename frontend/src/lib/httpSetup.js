import axios from 'axios';
import { clearAuthSession, getAuthToken } from './authStorage';

const API_ROOT = import.meta.env.VITE_API_ROOT || import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

axios.defaults.baseURL = API_ROOT;

axios.interceptors.request.use((config) => {
    const token = getAuthToken();
    if (token) {
        config.headers = config.headers || {};
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

axios.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error?.response?.status === 401) {
            clearAuthSession();
            window.dispatchEvent(new CustomEvent('auth:unauthorized'));
        }
        return Promise.reject(error);
    },
);
