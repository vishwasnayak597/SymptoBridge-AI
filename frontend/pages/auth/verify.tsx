import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { 
  CheckCircleIcon,
  XCircleIcon,
  ArrowPathIcon 
} from '@heroicons/react/24/outline';
import { useAuthContext } from '../../components/AuthProvider';

type VerificationStatus = 'loading' | 'success' | 'error' | 'already-verified';

const VerifyPage: React.FC = () => {
  const router = useRouter();
  const { token } = router.query;
  const { user, isAuthenticated, verifyEmail } = useAuthContext();
  const [status, setStatus] = useState<VerificationStatus>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (token && typeof token === 'string') {
      handleVerification(token);
    }
  }, [token]);

  const handleVerification = async (verificationToken: string): Promise<void> => {
    try {
      setStatus('loading');
      const success = await verifyEmail(verificationToken);
      
      if (success) {
        setStatus('success');
        setMessage('Your email has been verified successfully! You can now access all features.');
        
        // Redirect to dashboard after 2 seconds (except video calls)
        setTimeout(() => {
          if (user?.role && !router.asPath.includes('/video-call/')) {
            const dashboardRoutes = {
              patient: '/patient/dashboard',
              doctor: '/doctor/dashboard',
              admin: '/admin/dashboard',
            };
            router.push(dashboardRoutes[user.role] || '/');
          }
        }, 2000);
      } else {
        setStatus('error');
        setMessage('Email verification failed. The link may be expired or invalid.');
      }
    } catch (error: any) {
      setStatus('error');
      setMessage(error.message || 'Email verification failed. Please try again.');
    }
  };

  const getStatusIcon = () => {
    switch (status) {
      case 'loading':
        return <ArrowPathIcon className="h-12 w-12 text-blue-600 animate-spin" />;
      case 'success':
      case 'already-verified':
        return <CheckCircleIcon className="h-12 w-12 text-green-600" />;
      case 'error':
        return <XCircleIcon className="h-12 w-12 text-red-600" />;
      default:
        return <ArrowPathIcon className="h-12 w-12 text-blue-600 animate-spin" />;
    }
  };

  const getStatusColor = () => {
    switch (status) {
      case 'success':
      case 'already-verified':
        return 'text-green-800';
      case 'error':
        return 'text-red-800';
      default:
        return 'text-gray-800';
    }
  };

  const getBackgroundColor = () => {
    switch (status) {
      case 'success':
      case 'already-verified':
        return 'bg-green-50 border-green-200';
      case 'error':
        return 'bg-red-50 border-red-200';
      default:
        return 'bg-blue-50 border-blue-200';
    }
  };

  return (
    <>
      <Head>
        <title>Email Verification - SymptoBridge AI</title>
        <meta name="description" content="Verifying your email address" />
      </Head>

      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-white to-indigo-50 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full space-y-8">
          <div className="text-center">
            <h1 className="text-3xl font-bold text-gray-900 mb-8">
              Email Verification
            </h1>
          </div>

          <div className="bg-white rounded-2xl shadow-2xl border border-gray-100 p-8">
            <div className="text-center space-y-6">
              <div className="mx-auto flex items-center justify-center h-20 w-20 rounded-full bg-gray-100">
                {getStatusIcon()}
              </div>

              {status === 'loading' && (
                <div>
                  <h2 className="text-xl font-semibold text-gray-900 mb-2">
                    Verifying your email...
                  </h2>
                  <p className="text-gray-600">
                    Please wait while we verify your email address.
                  </p>
                </div>
              )}

              {status === 'success' && (
                <div>
                  <h2 className="text-xl font-semibold text-green-900 mb-2">
                    Email Verified Successfully!
                  </h2>
                  <p className="text-green-800 mb-4">
                    {message}
                  </p>
                  <div className={`p-4 rounded-lg border ${getBackgroundColor()}`}>
                    <p className={`text-sm ${getStatusColor()}`}>
                      🎉 You will be redirected to your dashboard in a few seconds...
                    </p>
                  </div>
                </div>
              )}

              {status === 'already-verified' && (
                <div>
                  <h2 className="text-xl font-semibold text-green-900 mb-2">
                    Already Verified
                  </h2>
                  <p className="text-green-800 mb-4">
                    Your email address is already verified. You can access all features.
                  </p>
                </div>
              )}

              {status === 'error' && (
                <div>
                  <h2 className="text-xl font-semibold text-red-900 mb-2">
                    Verification Failed
                  </h2>
                  <p className="text-red-800 mb-4">
                    {message}
                  </p>
                  <div className={`p-4 rounded-lg border ${getBackgroundColor()}`}>
                    <p className={`text-sm ${getStatusColor()}`}>
                      💡 Try requesting a new verification email or contact support if the problem persists.
                    </p>
                  </div>
                </div>
              )}

              {status !== 'loading' && (
                <div className="space-y-3 pt-4">
                  {status === 'success' || status === 'already-verified' ? (
                    <Link
                      href={
                        user?.role === 'patient' ? '/patient/dashboard' :
                        user?.role === 'doctor' ? '/doctor/dashboard' :
                        user?.role === 'admin' ? '/admin/dashboard' : '/'
                      }
                      className="w-full btn-primary btn-lg block text-center"
                    >
                      Go to Dashboard
                    </Link>
                  ) : (
                    <Link
                      href="/auth/verify-email"
                      className="w-full btn-primary btn-lg block text-center"
                    >
                      Request New Verification Email
                    </Link>
                  )}
                  
                  <Link
                    href="/auth/login"
                    className="w-full btn-secondary btn-lg block text-center"
                  >
                    Back to Login
                  </Link>
                </div>
              )}
            </div>
          </div>

          <div className="text-center">
            <p className="text-xs text-gray-500">
              Having trouble? Contact our support team for assistance.
            </p>
          </div>
        </div>
      </div>
    </>
  );
};

export default VerifyPage; 
