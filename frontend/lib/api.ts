import axios, { AxiosInstance, AxiosResponse, AxiosError } from 'axios';
import { ApiResponse } from '../../shared/types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'https://symptobridge-ai.onrender.com/api';
const REQUEST_TIMEOUT = 30000;

interface TokenRefreshResponse {
  accessToken: string;
}

/**
 * API client configuration and interceptors
 */
class ApiClient {
  private axiosInstance: AxiosInstance;
  private isRefreshing = false;
  private failedQueue: Array<{
    resolve: (value: any) => void;
    reject: (error: any) => void;
  }> = [];

  constructor() {
    this.axiosInstance = axios.create({
      baseURL: API_BASE_URL,
      timeout: REQUEST_TIMEOUT,
      withCredentials: true,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.setupInterceptors();
  }

  /**
   * Setup request and response interceptors
   */
  private setupInterceptors(): void {
    this.axiosInstance.interceptors.request.use(
      (config) => {
        const token = this.getAccessToken();
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    this.axiosInstance.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        const originalRequest = error.config as any;

        // The refresh call must never be intercepted: while a refresh is in
        // flight isRefreshing is true, so its own 401 would be queued behind
        // itself — a deadlock that hangs the app instead of logging out.
        if (originalRequest?.url?.includes('/auth/refresh')) {
          return Promise.reject(error);
        }

        if (error.response?.status === 401 && !originalRequest._retry) {
          if (this.isRefreshing) {
            return new Promise((resolve, reject) => {
              this.failedQueue.push({ resolve, reject });
            }).then((token) => {
              originalRequest.headers.Authorization = `Bearer ${token}`;
              return this.axiosInstance(originalRequest);
            }).catch((err) => {
              return Promise.reject(err);
            });
          }

          originalRequest._retry = true;
          this.isRefreshing = true;

          try {
            const response = await this.refreshToken();
            const { accessToken } = response.data.data!;
            this.setAccessToken(accessToken);
            this.processQueue(null, accessToken);
            originalRequest.headers.Authorization = `Bearer ${accessToken}`;
            return this.axiosInstance(originalRequest);
          } catch (refreshError) {
            this.processQueue(refreshError, null);
            this.clearTokens();
            if (typeof window !== 'undefined') {
              window.location.href = '/auth/login';
            }
            return Promise.reject(refreshError);
          } finally {
            this.isRefreshing = false;
          }
        }

        return Promise.reject(error);
      }
    );
  }

  /**
   * Process queued requests after token refresh
   */
  private processQueue(error: any, token: string | null): void {
    this.failedQueue.forEach(({ resolve, reject }) => {
      if (error) {
        reject(error);
      } else {
        resolve(token);
      }
    });
    
    this.failedQueue = [];
  }

  /**
   * Get access token from localStorage
   */
  private getAccessToken(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('accessToken');
  }

  /**
   * Set access token in localStorage
   */
  private setAccessToken(token: string): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem('accessToken', token);
  }

  /**
   * Clear all tokens from localStorage
   */
  private clearTokens(): void {
    if (typeof window === 'undefined') return;
    localStorage.removeItem('accessToken');
  }

  /**
   * Refresh access token
   */
  private async refreshToken(): Promise<AxiosResponse<ApiResponse<TokenRefreshResponse>>> {
    return this.axiosInstance.post('/auth/refresh');
  }

  /**
   * GET request
   */
  async get<T = any>(url: string, config?: any): Promise<AxiosResponse<ApiResponse<T>>> {
    return this.axiosInstance.get(url, config);
  }

  /**
   * POST request
   */
  async post<T = any>(url: string, data?: any, config?: any): Promise<AxiosResponse<ApiResponse<T>>> {
    return this.axiosInstance.post(url, data, config);
  }

  /**
   * PUT request
   */
  async put<T = any>(url: string, data?: any, config?: any): Promise<AxiosResponse<ApiResponse<T>>> {
    return this.axiosInstance.put(url, data, config);
  }

  /**
   * PATCH request
   */
  async patch<T = any>(url: string, data?: any, config?: any): Promise<AxiosResponse<ApiResponse<T>>> {
    return this.axiosInstance.patch(url, data, config);
  }

  /**
   * DELETE request
   */
  async delete<T = any>(url: string, config?: any): Promise<AxiosResponse<ApiResponse<T>>> {
    return this.axiosInstance.delete(url, config);
  }

  /**
   * Set authorization token manually
   */
  setAuthToken(token: string): void {
    this.setAccessToken(token);
  }

  /**
   * Clear authorization token manually
   */
  clearAuthToken(): void {
    this.clearTokens();
  }

  /**
   * Get axios instance for custom configurations
   */
  getInstance(): AxiosInstance {
    return this.axiosInstance;
  }
}

export const apiClient = new ApiClient();
export default apiClient; 