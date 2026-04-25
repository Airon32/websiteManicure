import axios from 'axios';

// Detecta se estamos rodando no Vercel (Produção) ou localmente
const isProd = import.meta.env.PROD;

const api = axios.create({
  baseURL: isProd ? '/_/_backend' : 'http://localhost:3001'
});

// Adicionamos um interceptor para logs básicos de erro (opcional, mas ajuda a debugar)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error('API Error:', error.response?.data || error.message);
    return Promise.reject(error);
  }
);

export default api;
