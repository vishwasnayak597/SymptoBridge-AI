import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { EyeIcon, EyeSlashIcon, ExclamationCircleIcon } from '@heroicons/react/24/outline';
import { useAuthContext } from '../../components/AuthProvider';
// Same runtime schema the API validates against (shared/schemas.ts): the form
// can never accept input the server would reject. The TS type is declared
// explicitly because zod's z.infer needs strict mode, which this codebase
// doesn't enable yet.
import { loginSchema } from '../../../shared/schemas';

interface LoginFormData {
  email: string;
  password: string;
}

/**
 * Login page component with beautiful UI
 */
const LoginPage: React.FC = () => {
  const router = useRouter();
  const { login, isAuthenticated, user, isLoading } = useAuthContext();
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });

  useEffect(() => {
    if (isAuthenticated && user && !router.asPath.includes('/video-call/')) {
      const redirectPath = router.query.redirect as string;
      if (redirectPath) {
        router.push(redirectPath);
      } else {
        switch (user.role) {
          case 'patient':
            router.push('/patient/dashboard');
            break;
          case 'doctor':
            router.push('/doctor/dashboard');
            break;
          case 'admin':
            router.push('/admin/dashboard');
            break;
          default:
            router.push('/');
        }
      }
    }
  }, [isAuthenticated, user, router]);

  const onSubmit = async (data: LoginFormData): Promise<void> => {
    try {
      setIsSubmitting(true);
      await login(data);
    } finally {
      setIsSubmitting(false);
    }
  };


  // Test user login function
  const handleTestLogin = async (userType: 'doctor' | 'patient'): Promise<void> => {
    const testCredentials = {
      doctor: {
        email: 'newtestdoctor@demo.com',
        password: 'TestDoc123!'
      },
      patient: {
        email: 'testpatient@demo.com', 
        password: 'TestPatient123!'
      }
    };

    try {
      setIsSubmitting(true);
      await login(testCredentials[userType]);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-white to-indigo-50">
        <div className="text-center">
          <div className="spinner-lg text-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (isAuthenticated) {
    return null;
  }

  return (
    <>
      <Head>
        <title>Sign In - SymptoBridge AI</title>
        <meta name="description" content="Sign in to your SymptoBridge AI account" />
      </Head>

      <div className="auth-container animate-fade-in">
        <div className="auth-card hover-lift">
          {/* Header */}
          <div className="auth-header">
            <div className="auth-logo">
              <div className="flex items-center space-x-2">
                <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-xl flex items-center justify-center">
                  <span className="text-white font-bold text-xl">S</span>
                </div>
                <span className="text-2xl font-bold gradient-text">SymptoBridge</span>
              </div>
            </div>
            <h2 className="auth-title">Welcome back</h2>
            <p className="auth-subtitle">
              Sign in to your account to continue
            </p>
          </div>

          {/* Form */}
          <form className="auth-form" onSubmit={handleSubmit(onSubmit)}>
            <div className="auth-fields">
              {/* Email Field */}
              <div className="form-group">
                <label htmlFor="email" className="form-label">
                  Email address
                </label>
                <input
                  {...register('email')}
                  type="email"
                  autoComplete="email"
                  className={errors.email ? 'form-input-error' : 'form-input'}
                  placeholder="Enter your email address"
                />
                {errors.email && (
                  <div className="form-error">
                    <ExclamationCircleIcon className="w-4 h-4 mr-1" />
                    {errors.email.message}
                  </div>
                )}
              </div>

              {/* Password Field */}
              <div className="form-group">
                <label htmlFor="password" className="form-label">
                  Password
                </label>
                <div className="relative">
                  <input
                    {...register('password')}
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    className={`${errors.password ? 'form-input-error' : 'form-input'} pr-10`}
                    placeholder="Enter your password"
                  />
                  <button
                    type="button"
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600 transition-colors"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? (
                      <EyeSlashIcon className="h-5 w-5" />
                    ) : (
                      <EyeIcon className="h-5 w-5" />
                    )}
                  </button>
                </div>
                {errors.password && (
                  <div className="form-error">
                    <ExclamationCircleIcon className="w-4 h-4 mr-1" />
                    {errors.password.message}
                  </div>
                )}
              </div>
            </div>

            {/* Forgot Password Link */}
            <div className="flex items-center justify-end">
              <Link
                href="/auth/forgot-password"
                className="text-sm text-blue-600 hover:text-blue-800 font-medium transition-colors"
              >
                Forgot your password?
              </Link>
            </div>

            {/* Submit Button */}
            <div>
              <button
                type="submit"
                disabled={isSubmitting}
                className="btn-primary btn-lg w-full relative"
              >
                {isSubmitting ? (
                  <>
                    <div className="spinner mr-2"></div>
                    Signing in...
                  </>
                ) : (
                  'Sign in'
                )}
              </button>
            </div>

            {/* Divider */}
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white text-gray-500">New to SymptoBridge?</span>
              </div>
            </div>

            {/* Register Link */}
            <div className="text-center">
              <Link
                href="/auth/register"
                className="btn-outline btn-lg w-full"
              >
                Create an account
              </Link>
            </div>
          </form>

          {/* Test User Buttons */}
          <div className="mt-6 p-4 bg-gray-50 rounded-lg border">
            <h3 className="text-sm font-medium text-gray-700 mb-3 text-center">
              Quick Test Login
            </h3>
            <div className="space-y-2">
              <button
                onClick={() => handleTestLogin('doctor')}
                disabled={isSubmitting}
                className="w-full px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 transition-colors"
              >
                👨‍⚕️ Login as Test Doctor
              </button>
              <button
                onClick={() => handleTestLogin('patient')}
                disabled={isSubmitting}
                className="w-full px-4 py-2 text-sm bg-green-600 text-white rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-50 transition-colors"
              >
                🤒 Login as Test Patient
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-2 text-center">
              Use these for quick testing and demo purposes
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center mt-8 text-sm text-white/90">
          <p>
            By signing in, you agree to our{' '}
            <Link href="/terms" className="font-semibold text-white underline underline-offset-2 hover:text-white/80">
              Terms of Service
            </Link>{' '}
            and{' '}
            <Link href="/privacy" className="font-semibold text-white underline underline-offset-2 hover:text-white/80">
              Privacy Policy
            </Link>
          </p>
        </div>
      </div>
    </>
  );
};

export default LoginPage; 