import { useState, useEffect, useCallback } from 'react';
import { User, ApiResponse } from '../../shared/types';
import apiClient from '../lib/api';
import { disconnectSocket } from '../lib/socket';
import { clearQueryCache } from '../lib/queryClient';
import toast from 'react-hot-toast';

interface AuthTokens {
  accessToken: string;
}

interface AuthResponse {
  user: User;
  accessToken: string;
}

interface RegisterData {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;
  role: 'patient' | 'doctor' | 'admin';
  dateOfBirth?: Date;
  gender?: 'male' | 'female' | 'other';
  specialization?: string;
  licenseNumber?: string;
  experience?: number;
  qualifications?: string[];
  consultationFee?: number;
  permissions?: string[];
}

interface LoginData {
  email: string;
  password: string;
}

interface ChangePasswordData {
  currentPassword: string;
  newPassword: string;
}

interface UseAuthReturn {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (data: LoginData) => Promise<boolean>;
  register: (data: RegisterData) => Promise<boolean>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  changePassword: (data: ChangePasswordData) => Promise<boolean>;
  verifyEmail: (token: string) => Promise<boolean>;
  requestPasswordReset: (email: string) => Promise<boolean>;
  resetPassword: (token: string, password: string) => Promise<boolean>;
}

const AUTH_STORAGE_KEY = 'accessToken';

/**
 * Authentication hook for managing user authentication state
 */
export const useAuth = (): UseAuthReturn => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  /**
   * Check if user is authenticated
   */
  const isAuthenticated = !!user;

  /**
   * Get stored access token
   */
  const getStoredToken = useCallback((): string | null => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(AUTH_STORAGE_KEY);
  }, []);

  /**
   * Set access token in storage and API client
   */
  const setAccessToken = useCallback((token: string): void => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(AUTH_STORAGE_KEY, token);
    apiClient.setAuthToken(token);
  }, []);

  /**
   * Clear access token from storage and API client
   */
  const clearAccessToken = useCallback((): void => {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(AUTH_STORAGE_KEY);
    apiClient.clearAuthToken();
  }, []);

  /**
   * Fetch current user profile
   */
  const fetchUserProfile = useCallback(async (): Promise<User | null> => {
    try {
      const response = await apiClient.get<User>('/auth/me');
      if (response.data.success && response.data.data) {
        return response.data.data;
      }
      return null;
    } catch (error) {
      console.error('Failed to fetch user profile:', error);
      return null;
    }
  }, []);

  /**
   * Initialize authentication state
   */
  const initializeAuth = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    
    try {
      const token = getStoredToken();
      if (token) {
        apiClient.setAuthToken(token);
        const userProfile = await fetchUserProfile();
        if (userProfile) {
          setUser(userProfile);
        } else {
          clearAccessToken();
        }
      }
    } catch (error) {
      console.error('Auth initialization failed:', error);
      clearAccessToken();
    } finally {
      setIsLoading(false);
    }
  }, [getStoredToken, fetchUserProfile, clearAccessToken]);

  /**
   * Login user
   */
  const login = useCallback(async (data: LoginData): Promise<boolean> => {
    try {
      setIsLoading(true);
      const response = await apiClient.post<AuthResponse>('/auth/login', data);
      
      if (response.data.success && response.data.data) {
        const { user: userData, accessToken } = response.data.data;
        setAccessToken(accessToken);
        // Drop any cache from a previous session before the new user's
        // queries run, so accounts never share persisted data.
        await clearQueryCache();
        setUser(userData);
        toast.success('Login successful!');
        return true;
      } else {
        toast.error(response.data.error || 'Login failed');
        return false;
      }
    } catch (error: any) {
      const message = error.response?.data?.error || 'Login failed. Please try again.';
      toast.error(message);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [setAccessToken]);

  /**
   * Register new user
   */
  const register = useCallback(async (data: RegisterData): Promise<boolean> => {
    try {
      setIsLoading(true);
      const response = await apiClient.post<AuthResponse>('/auth/register', data);
      
      if (response.data.success && response.data.data) {
        const { user: userData, accessToken } = response.data.data;
        setAccessToken(accessToken);
        setUser(userData);
        toast.success('Registration successful! Please verify your email.');
        return true;
      } else {
        toast.error(response.data.error || 'Registration failed');
        return false;
      }
    } catch (error: any) {
      const message = error.response?.data?.error || 'Registration failed. Please try again.';
      toast.error(message);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [setAccessToken]);

  /**
   * Logout user
   */
  const logout = useCallback(async (): Promise<void> => {
    try {
      await apiClient.post('/auth/logout');
    } catch (error) {
      console.error('Logout request failed:', error);
    } finally {
      clearAccessToken();
      disconnectSocket();
      setUser(null);
      void clearQueryCache();
      toast.success('Logged out successfully');
    }
  }, [clearAccessToken]);

  /**
   * Refresh user profile
   */
  const refreshUser = useCallback(async (): Promise<void> => {
    try {
      const userProfile = await fetchUserProfile();
      if (userProfile) {
        setUser(userProfile);
      }
    } catch (error) {
      console.error('Failed to refresh user profile:', error);
    }
  }, [fetchUserProfile]);

  /**
   * Change user password
   */
  const changePassword = useCallback(async (data: ChangePasswordData): Promise<boolean> => {
    try {
      const response = await apiClient.post('/auth/change-password', data);
      
      if (response.data.success) {
        toast.success('Password changed successfully');
        return true;
      } else {
        toast.error(response.data.error || 'Password change failed');
        return false;
      }
    } catch (error: any) {
      const message = error.response?.data?.error || 'Password change failed. Please try again.';
      toast.error(message);
      return false;
    }
  }, []);

  /**
   * Verify email address
   */
  const verifyEmail = useCallback(async (token: string): Promise<boolean> => {
    try {
      const response = await apiClient.post(`/auth/verify-email/${token}`);
      
      if (response.data.success) {
        toast.success('Email verified successfully');
        await refreshUser();
        return true;
      } else {
        toast.error(response.data.error || 'Email verification failed');
        return false;
      }
    } catch (error: any) {
      const message = error.response?.data?.error || 'Email verification failed. Please try again.';
      toast.error(message);
      return false;
    }
  }, [refreshUser]);

  /**
   * Request password reset
   */
  const requestPasswordReset = useCallback(async (email: string): Promise<boolean> => {
    try {
      const response = await apiClient.post('/auth/forgot-password', { email });
      
      if (response.data.success) {
        toast.success('Password reset link sent to your email');
        return true;
      } else {
        toast.error(response.data.error || 'Password reset request failed');
        return false;
      }
    } catch (error: any) {
      const message = error.response?.data?.error || 'Password reset request failed. Please try again.';
      toast.error(message);
      return false;
    }
  }, []);

  /**
   * Reset password with token
   */
  const resetPassword = useCallback(async (token: string, password: string): Promise<boolean> => {
    try {
      const response = await apiClient.post('/auth/reset-password', { token, password });
      
      if (response.data.success) {
        toast.success('Password reset successfully');
        return true;
      } else {
        toast.error(response.data.error || 'Password reset failed');
        return false;
      }
    } catch (error: any) {
      const message = error.response?.data?.error || 'Password reset failed. Please try again.';
      toast.error(message);
      return false;
    }
  }, []);

  useEffect(() => {
    initializeAuth();
  }, [initializeAuth]);

  return {
    user,
    isLoading,
    isAuthenticated,
    login,
    register,
    logout,
    refreshUser,
    changePassword,
    verifyEmail,
    requestPasswordReset,
    resetPassword,
  };
}; 