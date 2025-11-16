// API Configuration
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://api.haacas.com/newapi';

export const API_ENDPOINTS = {
  AUTH: {
    LOGIN: `${API_BASE_URL}/api/auth/login`,
    SIGNUP: `${API_BASE_URL}/api/auth/signup`,
  },
  COMPARISON: {
    GET_PAGE_COUNT: `${API_BASE_URL}/api/comparison/get-page-count`,
    COMPARE: `${API_BASE_URL}/api/comparison/compare`,
    DOWNLOAD: (type) => `${API_BASE_URL}/api/comparison/download/${type}`,
  },
};

export default API_BASE_URL;
