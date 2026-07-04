import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { 
  CheckCircleIcon,
  ExclamationTriangleIcon,
  EnvelopeIcon,
  ArrowPathIcon 
} from '@heroicons/react/24/outline';
import { useAuthContext } from '../../components/AuthProvider';
import { apiClient } from '../../lib/api';

const VerifyEmailPage: React.FC = () => {
  const router = useRouter();
  const { user, isAuthenticated, isLoading } = useAuthContext();
  const [isResending, setIsResending] = useState(false);
  const [resendMessage, setResendMessage] = useState('');
  const [resendCount, setResendCount] = useState(0);

  useEffect(() => {
    // If user is authenticated and email is verified, redirect to dashboard
    if (isAuthenticated && user?.isEmailVerified && !router.asPath.includes('/video-call/')) {
      const dashboardRoutes = {
        patient: '/patient/dashboard',
        doctor: '/doctor/dashboard',
        admin: '/admin/dashboard'
      };
      
      const targetRoute = dashboardRoutes[user.role as keyof typeof dashboardRoutes] || '/';
      router.push(targetRoute);
    }
  }, [isAuthenticated, user, router]);

  const handleResendVerification = async () => {
    if (!user?.email || resendCount >= 3) return;
    
    setIsResending(true);
    setResendMessage('');
    
    try {
      const response = await apiClient.post('/auth/resend-verification', { email: user.email });

      if (response.data.success) {
        setResendMessage('Verification email sent successfully! Please check your inbox.');
        setResendCount(prev => prev + 1);
      } else {
        setResendMessage(response.data.error || 'Failed to resend verification email. Please try again.');
      }
    } catch (error: any) {
      setResendMessage(
        error.response?.data?.error || 'Network error. Please check your connection and try again.'
      );
    } finally {
      setIsResending(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    router.push('/auth/login');
    return null;
  }

  if (user.isEmailVerified) {
    return null; // Will redirect via useEffect
  }

  return (
    <>
      <Head>
        <title>Verify Your Email - SymptoBridge AI</title>
        <meta name="description" content="Please verify your email address to complete your registration" />
      </Head>
      
      <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full space-y-8">
          <div className="text-center">
            <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-yellow-100 mb-4">
              <EnvelopeIcon className="h-8 w-8 text-yellow-600" />
            </div>
            <h2 className="text-3xl font-extrabold text-gray-900">
              Check Your Email
            </h2>
            <p className="mt-2 text-sm text-gray-600">
              We've sent a verification link to{' '}
              <span className="font-medium text-gray-900">{user.email}</span>
            </p>
          </div>

          <div className="space-y-6">
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
              <div className="flex items-start space-x-3">
                <ExclamationTriangleIcon className="h-5 w-5 text-amber-500 mt-0.5 flex-shrink-0" />
                <div>
                  <h3 className="text-sm font-medium text-gray-900">
                    Email Verification Required
                  </h3>
                  <p className="mt-1 text-sm text-gray-600">
                    Please click the verification link in your email to activate your account and access all features.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-medium text-gray-900">
                Next Steps:
              </h3>
              <ul className="space-y-2 text-sm text-gray-600">
                <li className="flex items-start space-x-2">
                  <CheckCircleIcon className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                  <span>Check your email inbox (and spam folder)</span>
                </li>
                <li className="flex items-start space-x-2">
                  <CheckCircleIcon className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                  <span>Click the verification link in the email</span>
                </li>
                <li className="flex items-start space-x-2">
                  <CheckCircleIcon className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                  <span>You'll be automatically redirected to your dashboard</span>
                </li>
              </ul>
            </div>

            <div className="space-y-4">
              <div className="bg-blue-50 p-4 rounded-md">
                <div className="text-sm text-blue-700">
                  <strong>Didn't receive the email?</strong>
                  <ul className="mt-2 space-y-1">
                    <li>• Check your spam/junk folder</li>
                    <li>• Make sure {user.email} is correct</li>
                    <li>• Wait a few minutes for delivery</li>
                  </ul>
                </div>
              </div>

              <button
                onClick={handleResendVerification}
                disabled={isResending || resendCount >= 3}
                className={`w-full flex justify-center items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white transition-colors ${
                  isResending || resendCount >= 3
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500'
                }`}
              >
                {isResending ? (
                  <>
                    <ArrowPathIcon className="animate-spin -ml-1 mr-2 h-4 w-4" />
                    Sending...
                  </>
                ) : resendCount >= 3 ? (
                  'Maximum attempts reached'
                ) : (
                  `Resend Verification Email${resendCount > 0 ? ` (${resendCount}/3)` : ''}`
                )}
              </button>

              {resendMessage && (
                <div className={`p-3 rounded-md text-sm ${
                  resendMessage.includes('successfully') 
                    ? 'bg-green-50 text-green-800' 
                    : 'bg-red-50 text-red-800'
                }`}>
                  {resendMessage}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-gray-200">
              <Link
                href="/auth/login"
                className="text-sm text-blue-600 hover:text-blue-500 font-medium"
              >
                ← Back to Login
              </Link>
              
              <Link
                href="/auth/register"
                className="text-sm text-blue-600 hover:text-blue-500 font-medium"
              >
                Use Different Email →
              </Link>
            </div>
          </div>

          <div className="text-center">
            <p className="text-xs text-gray-500">
              This verification step helps keep your account secure
            </p>
          </div>
        </div>
      </div>
    </>
  );
};

export default VerifyEmailPage; 