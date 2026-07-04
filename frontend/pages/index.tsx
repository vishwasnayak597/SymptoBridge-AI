import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';
import { 
  ArrowRightIcon, 
  UserGroupIcon, 
  HeartIcon, 
  ClockIcon,
  CheckCircleIcon,
  StarIcon,
  ShieldCheckIcon,
  DevicePhoneMobileIcon,
  EyeIcon,
  EyeSlashIcon,
  AcademicCapIcon
} from '@heroicons/react/24/outline';
import { useAuthContext } from '../components/AuthProvider';

interface LoginFormData {
  email: string;
  password: string;
}

interface RegisterFormData {
  email: string;
  password: string;
  confirmPassword: string;
  firstName: string;
  lastName: string;
  phone?: string;
  role: 'patient' | 'doctor';
  specialization?: string;
  licenseNumber?: string;
  experience?: number;
  consultationFee?: number;
}

const loginSchema = yup.object({
  email: yup.string().email('Please enter a valid email address').required('Email is required'),
  password: yup.string().required('Password is required'),
}).required();

const registerSchema = yup.object({
  email: yup.string().email('Please enter a valid email address').required('Email is required'),
  password: yup.string()
    .min(7, 'Password must be at least 7 characters')
    .required('Password is required'),
  confirmPassword: yup.string()
    .oneOf([yup.ref('password')], 'Passwords must match')
    .required('Please confirm your password'),
  firstName: yup.string().required('First name is required').max(50, 'Must be less than 50 characters'),
  lastName: yup.string().required('Last name is required').max(50, 'Must be less than 50 characters'),
  phone: yup.string().optional(),
  role: yup.string().oneOf(['patient', 'doctor'], 'Please select a valid role').required('Role is required'),
  specialization: yup.string().optional(),
  licenseNumber: yup.string().optional(),
  experience: yup.number().optional(),
  consultationFee: yup.number().optional(),
}).required();

const SPECIALIZATIONS = [
  'General Practice', 'Internal Medicine', 'Pediatrics', 'Cardiology', 'Dermatology',
  'Orthopedics', 'Psychiatry', 'Neurology', 'Oncology', 'Gastroenterology',
  'Pulmonology', 'Endocrinology', 'Gynecology', 'Urology', 'Ophthalmology',
  'Anesthesiology', 'Radiology', 'Pathology', 'Emergency Medicine', 'Family Medicine', 'Other'
];

/**
 * Enhanced home page with integrated authentication and role-based navigation
 */
const HomePage: React.FC = () => {
  const router = useRouter();
  const { user, isAuthenticated, isLoading, login, register: registerUser } = useAuthContext();
  const [authMode, setAuthMode] = useState<'login' | 'register' | 'home'>('home');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loginForm = useForm({
    resolver: yupResolver(loginSchema),
  });

  const registerForm = useForm({
    resolver: yupResolver(registerSchema),
    defaultValues: { role: 'patient' },
  });

  const selectedRole = registerForm.watch('role') as 'patient' | 'doctor';

  // Redirect authenticated users to their dashboard (except for video calls)
  useEffect(() => {
    if (isAuthenticated && user && !router.asPath.includes('/video-call/')) {
      const dashboardRoutes = {
        patient: '/patient/dashboard',
        doctor: '/doctor/dashboard',
        admin: '/admin/dashboard',
      };
      router.push(dashboardRoutes[user.role] || '/');
    }
  }, [isAuthenticated, user, router]);

  const handleLogin = async (data: any) => {
    try {
      setIsSubmitting(true);
      await login(data);
      // Redirect will happen via useEffect when user state updates
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRegister = async (data: any) => {
    try {
      setIsSubmitting(true);
      await registerUser(data);
      // Redirect will happen via useEffect when user state updates
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
    return null; // Will redirect via useEffect
  }

  // Authentication Forms Modal
  const renderAuthModal = () => {
    if (authMode === 'home') return null;

    return (
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
        <div className="auth-card hover-lift max-w-lg w-full max-h-[90vh] overflow-y-auto">
          {/* Header */}
          <div className="auth-header">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center space-x-2">
                <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-xl flex items-center justify-center">
                  <span className="text-white font-bold text-xl">S</span>
                </div>
                <span className="text-2xl font-bold gradient-text">SymptoBridge</span>
              </div>
              <button
                onClick={() => setAuthMode('home')}
                className="text-gray-400 hover:text-gray-600 transition-colors p-1"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            {/* Mode Toggle */}
            <div className="flex bg-gray-100 rounded-lg p-1 mb-6">
              <button
                onClick={() => setAuthMode('login')}
                className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all ${
                  authMode === 'login' 
                    ? 'bg-white shadow-sm text-blue-600' 
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Sign In
              </button>
              <button
                onClick={() => setAuthMode('register')}
                className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all ${
                  authMode === 'register' 
                    ? 'bg-white shadow-sm text-blue-600' 
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Sign Up
              </button>
            </div>

            <h2 className="auth-title">
              {authMode === 'login' ? 'Welcome back' : 'Create your account'}
            </h2>
            <p className="auth-subtitle">
              {authMode === 'login' 
                ? 'Sign in to access your healthcare dashboard' 
                : 'Join thousands transforming healthcare'
              }
            </p>
          </div>

          {/* Login Form */}
          {authMode === 'login' && (
            <form className="auth-form" onSubmit={loginForm.handleSubmit(handleLogin)}>
              <div className="auth-fields">
                <div className="form-group">
                  <label className="form-label">Email address</label>
                  <input
                    {...loginForm.register('email')}
                    type="email"
                    className={loginForm.formState.errors.email ? 'form-input-error' : 'form-input'}
                    placeholder="Enter your email address"
                  />
                  {loginForm.formState.errors.email && (
                    <div className="form-error">
                      <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                      {loginForm.formState.errors.email.message}
                    </div>
                  )}
                </div>

                <div className="form-group">
                  <label className="form-label">Password</label>
                  <div className="relative">
                    <input
                      {...loginForm.register('password')}
                      type={showPassword ? 'text' : 'password'}
                      className={`${loginForm.formState.errors.password ? 'form-input-error' : 'form-input'} pr-10`}
                      placeholder="Enter your password"
                    />
                    <button
                      type="button"
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? <EyeSlashIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
                    </button>
                  </div>
                  {loginForm.formState.errors.password && (
                    <div className="form-error">
                      <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                      {loginForm.formState.errors.password.message}
                    </div>
                  )}
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="btn-primary btn-lg w-full"
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
            </form>
          )}

          {/* Register Form */}
          {authMode === 'register' && (
            <form className="auth-form" onSubmit={registerForm.handleSubmit(handleRegister)}>
              <div className="auth-fields">
                {/* Role Selection */}
                <div className="form-group">
                  <label className="form-label">I am a</label>
                  <div className="grid grid-cols-2 gap-4">
                    <label className={`relative flex cursor-pointer rounded-lg border p-4 hover:bg-gray-50 transition-colors ${
                      selectedRole === 'patient' ? 'border-blue-500 ring-2 ring-blue-500 bg-blue-50' : 'border-gray-300'
                    }`}>
                      <input
                        {...registerForm.register('role')}
                        type="radio"
                        value="patient"
                        className="sr-only"
                      />
                      <div className="flex items-center space-x-3">
                        <UserGroupIcon className={`w-6 h-6 ${selectedRole === 'patient' ? 'text-blue-600' : 'text-gray-400'}`} />
                        <div>
                          <div className={`text-sm font-medium ${selectedRole === 'patient' ? 'text-blue-900' : 'text-gray-900'}`}>
                            Patient
                          </div>
                          <div className={`text-xs ${selectedRole === 'patient' ? 'text-blue-700' : 'text-gray-500'}`}>
                            Seeking care
                          </div>
                        </div>
                      </div>
                    </label>
                    
                    <label className={`relative flex cursor-pointer rounded-lg border p-4 hover:bg-gray-50 transition-colors ${
                      selectedRole === 'doctor' ? 'border-blue-500 ring-2 ring-blue-500 bg-blue-50' : 'border-gray-300'
                    }`}>
                      <input
                        {...registerForm.register('role')}
                        type="radio"
                        value="doctor"
                        className="sr-only"
                      />
                      <div className="flex items-center space-x-3">
                        <AcademicCapIcon className={`w-6 h-6 ${selectedRole === 'doctor' ? 'text-blue-600' : 'text-gray-400'}`} />
                        <div>
                          <div className={`text-sm font-medium ${selectedRole === 'doctor' ? 'text-blue-900' : 'text-gray-900'}`}>
                            Doctor
                          </div>
                          <div className={`text-xs ${selectedRole === 'doctor' ? 'text-blue-700' : 'text-gray-500'}`}>
                            Healthcare provider
                          </div>
                        </div>
                      </div>
                    </label>
                  </div>
                </div>

                {/* Name Fields */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="form-group">
                    <label className="form-label">First Name</label>
                    <input
                      {...registerForm.register('firstName')}
                      type="text"
                      className={registerForm.formState.errors.firstName ? 'form-input-error' : 'form-input'}
                      placeholder="First name"
                    />
                    {registerForm.formState.errors.firstName && (
                      <div className="form-error">
                        <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        {registerForm.formState.errors.firstName.message}
                      </div>
                    )}
                  </div>

                  <div className="form-group">
                    <label className="form-label">Last Name</label>
                    <input
                      {...registerForm.register('lastName')}
                      type="text"
                      className={registerForm.formState.errors.lastName ? 'form-input-error' : 'form-input'}
                      placeholder="Last name"
                    />
                    {registerForm.formState.errors.lastName && (
                      <div className="form-error">
                        <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        {registerForm.formState.errors.lastName.message}
                      </div>
                    )}
                  </div>
                </div>

                {/* Email Field */}
                <div className="form-group">
                  <label className="form-label">Email address</label>
                  <input
                    {...registerForm.register('email')}
                    type="email"
                    className={registerForm.formState.errors.email ? 'form-input-error' : 'form-input'}
                    placeholder="Enter your email address"
                  />
                  {registerForm.formState.errors.email && (
                    <div className="form-error">
                      <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                      {registerForm.formState.errors.email.message}
                    </div>
                  )}
                </div>

                {/* Doctor-specific fields */}
                {selectedRole === 'doctor' && (
                  <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                    <h3 className="text-sm font-medium text-blue-900 mb-3">Professional Information</h3>
                    <div className="form-group">
                      <label className="form-label">Medical Specialization</label>
                      <select
                        {...registerForm.register('specialization')}
                        className="form-input"
                      >
                        <option value="">Select your specialization</option>
                        {SPECIALIZATIONS.map((spec) => (
                          <option key={spec} value={spec}>{spec}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                {/* Password Fields */}
                <div className="space-y-4">
                  <div className="form-group">
                    <label className="form-label">Password</label>
                    <div className="relative">
                      <input
                        {...registerForm.register('password')}
                        type={showPassword ? 'text' : 'password'}
                        className={`${registerForm.formState.errors.password ? 'form-input-error' : 'form-input'} pr-10`}
                        placeholder="Create a strong password"
                      />
                      <button
                        type="button"
                        className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                        onClick={() => setShowPassword(!showPassword)}
                      >
                        {showPassword ? <EyeSlashIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
                      </button>
                    </div>
                    {registerForm.formState.errors.password && (
                      <div className="form-error">
                        <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        {registerForm.formState.errors.password.message}
                      </div>
                    )}
                  </div>

                  <div className="form-group">
                    <label className="form-label">Confirm Password</label>
                    <div className="relative">
                      <input
                        {...registerForm.register('confirmPassword')}
                        type={showConfirmPassword ? 'text' : 'password'}
                        className={`${registerForm.formState.errors.confirmPassword ? 'form-input-error' : 'form-input'} pr-10`}
                        placeholder="Confirm your password"
                      />
                      <button
                        type="button"
                        className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      >
                        {showConfirmPassword ? <EyeSlashIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
                      </button>
                    </div>
                    {registerForm.formState.errors.confirmPassword && (
                      <div className="form-error">
                        <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        {registerForm.formState.errors.confirmPassword.message}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="btn-primary btn-lg w-full"
              >
                {isSubmitting ? (
                  <>
                    <div className="spinner mr-2"></div>
                    Creating account...
                  </>
                ) : (
                  'Create account'
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      <Head>
        <title>SymptoBridge AI — From Symptoms to the Right Specialist</title>
        <meta
          name="description"
          content="SymptoBridge AI — From Symptoms to the Right Specialist. Connect with doctors, get AI-powered symptom analysis, and manage your healthcare journey all in one place."
        />
      </Head>

      <div className="bg-white">
        {/* Header */}
        <header className="bg-white/80 backdrop-blur-md shadow-sm sticky top-0 z-40 border-b border-gray-100">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center py-4">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-lg flex items-center justify-center">
                  <span className="text-white font-bold text-lg">A</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-xl font-bold gradient-text">SymptoBridge</span>
                  <span className="text-xs text-gray-600 -mt-1">AI-Powered Healthcare</span>
                </div>
              </div>
              <div className="flex items-center space-x-4">
                <Link
                  href="/auth/login"
                  className="nav-link hover-lift"
                >
                  Sign In
                </Link>
                <Link
                  href="/auth/register"
                  className="btn-primary hover-lift"
                >
                  Get Started
                </Link>
              </div>
            </div>
          </div>
        </header>

        <main>
          {/* Hero Section */}
          <section className="relative overflow-hidden bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 text-white">
            <div className="absolute inset-0 bg-black/20"></div>
            <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 lg:py-32">
              <div className="text-center animate-fade-in">
                <div className="mb-4">
                  <div className="text-lg font-semibold text-blue-200 mb-2">Welcome to</div>
                  <h1 className="text-4xl md:text-6xl font-bold mb-2 leading-tight">
                    SymptoBridge AI
                  </h1>
                  <p className="text-xl md:text-2xl font-medium text-blue-100 mb-6">
                    AI-Powered Healthcare Platform
                  </p>
                </div>
                <p className="text-xl md:text-2xl mb-8 text-blue-100 max-w-3xl mx-auto leading-relaxed">
                  Connect with verified doctors, get instant AI symptom analysis, and manage your healthcare journey all in one intelligent platform.
                </p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <Link
                    href="/auth/register?role=patient"
                    className="btn-lg bg-white text-blue-600 hover:bg-blue-50 px-8 py-4 rounded-xl font-semibold transition-all duration-200 inline-flex items-center justify-center hover-lift shadow-xl"
                  >
                    <UserGroupIcon className="w-5 h-5 mr-2" />
                    Join as Patient
                    <ArrowRightIcon className="ml-2 h-5 w-5" />
                  </Link>
                  <Link
                    href="/auth/register?role=doctor"
                    className="btn-lg border-2 border-white text-white hover:bg-white hover:text-blue-600 px-8 py-4 rounded-xl font-semibold transition-all duration-200 inline-flex items-center justify-center hover-lift"
                  >
                    <AcademicCapIcon className="w-5 h-5 mr-2" />
                    Join as Doctor
                    <ArrowRightIcon className="ml-2 h-5 w-5" />
                  </Link>
                </div>
                <p className="mt-6 text-blue-200 text-sm">
                  Already have an account?{' '}
                  <Link
                    href="/auth/login"
                    className="text-white underline hover:no-underline font-medium"
                  >
                    Sign in here
                  </Link>
                </p>
              </div>
            </div>
            
            {/* Decorative elements */}
            <div className="absolute top-20 left-10 w-20 h-20 bg-blue-400/20 rounded-full blur-xl"></div>
            <div className="absolute bottom-20 right-10 w-32 h-32 bg-indigo-400/20 rounded-full blur-xl"></div>
          </section>

          {/* Features Section */}
          <section className="py-20 bg-gray-50">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="text-center mb-16 animate-fade-in">
                <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
                  Why Choose SymptoBridge?
                </h2>
                <p className="text-xl text-gray-600 max-w-2xl mx-auto">
                  Experience healthcare like never before with our AI-powered platform
                </p>
              </div>

              <div className="grid md:grid-cols-3 gap-8">
                <div className="card hover-lift animate-slide-in">
                  <div className="card-body text-center">
                    <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl flex items-center justify-center mb-6 mx-auto shadow-lg">
                      <HeartIcon className="h-8 w-8 text-white" />
                    </div>
                    <h3 className="text-xl font-semibold text-gray-900 mb-4">
                      AI Symptom Checker
                    </h3>
                    <p className="text-gray-600 leading-relaxed">
                      Get instant, intelligent analysis of your symptoms with our advanced AI technology.
                    </p>
                  </div>
                </div>

                <div className="card hover-lift animate-slide-in" style={{ animationDelay: '0.1s' }}>
                  <div className="card-body text-center">
                    <div className="w-16 h-16 bg-gradient-to-br from-green-500 to-green-600 rounded-2xl flex items-center justify-center mb-6 mx-auto shadow-lg">
                      <UserGroupIcon className="h-8 w-8 text-white" />
                    </div>
                    <h3 className="text-xl font-semibold text-gray-900 mb-4">
                      Connect with Doctors
                    </h3>
                    <p className="text-gray-600 leading-relaxed">
                      Find and book appointments with verified healthcare professionals.
                    </p>
                  </div>
                </div>

                <div className="card hover-lift animate-slide-in" style={{ animationDelay: '0.2s' }}>
                  <div className="card-body text-center">
                    <div className="w-16 h-16 bg-gradient-to-br from-purple-500 to-purple-600 rounded-2xl flex items-center justify-center mb-6 mx-auto shadow-lg">
                      <ClockIcon className="h-8 w-8 text-white" />
                    </div>
                    <h3 className="text-xl font-semibold text-gray-900 mb-4">
                      24/7 Healthcare
                    </h3>
                    <p className="text-gray-600 leading-relaxed">
                      Access healthcare services anytime, anywhere. Always available for your health needs.
                    </p>
                  </div>
                </div>
              </div>

              {/* Quick Access CTA */}
              <div className="text-center mt-12">
                <button
                  onClick={() => setAuthMode('register')}
                  className="btn-primary btn-lg hover-lift inline-flex items-center"
                >
                  Get Started Today
                  <ArrowRightIcon className="ml-2 h-5 w-5" />
                </button>
              </div>
            </div>
          </section>

          {/* Stats Section */}
          <section className="py-16 bg-white">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
                <div className="animate-fade-in">
                  <div className="text-4xl font-bold text-blue-600 mb-2">1000+</div>
                  <div className="text-gray-600">Verified Doctors</div>
                </div>
                <div className="animate-fade-in" style={{ animationDelay: '0.1s' }}>
                  <div className="text-4xl font-bold text-green-600 mb-2">50k+</div>
                  <div className="text-gray-600">Patients Served</div>
                </div>
                <div className="animate-fade-in" style={{ animationDelay: '0.2s' }}>
                  <div className="text-4xl font-bold text-purple-600 mb-2">98%</div>
                  <div className="text-gray-600">Satisfaction Rate</div>
                </div>
                <div className="animate-fade-in" style={{ animationDelay: '0.3s' }}>
                  <div className="text-4xl font-bold text-indigo-600 mb-2">24/7</div>
                  <div className="text-gray-600">Available Support</div>
                </div>
              </div>
            </div>
          </section>

          {/* Trust Section */}
          <section className="py-16 bg-gray-50">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="text-center mb-12">
                <h2 className="text-3xl font-bold text-gray-900 mb-4">
                  Trusted & Secure
                </h2>
                <p className="text-xl text-gray-600">
                  Your health data is protected with enterprise-grade security
                </p>
              </div>

              <div className="grid md:grid-cols-3 gap-8 text-center">
                <div className="flex flex-col items-center">
                  <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mb-4">
                    <ShieldCheckIcon className="w-6 h-6 text-green-600" />
                  </div>
                  <h3 className="font-semibold text-gray-900 mb-2">HIPAA Compliant</h3>
                  <p className="text-gray-600">Full compliance with healthcare data protection standards</p>
                </div>
                
                <div className="flex flex-col items-center">
                  <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mb-4">
                    <DevicePhoneMobileIcon className="w-6 h-6 text-blue-600" />
                  </div>
                  <h3 className="font-semibold text-gray-900 mb-2">Mobile Optimized</h3>
                  <p className="text-gray-600">Access your health information from any device, anywhere</p>
                </div>
                
                <div className="flex flex-col items-center">
                  <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center mb-4">
                    <StarIcon className="w-6 h-6 text-purple-600" />
                  </div>
                  <h3 className="font-semibold text-gray-900 mb-2">Award Winning</h3>
                  <p className="text-gray-600">Recognized for innovation in digital healthcare delivery</p>
                </div>
              </div>
            </div>
          </section>
        </main>

        {/* Footer */}
        <footer className="bg-gray-900 text-white py-12">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid md:grid-cols-4 gap-8">
              <div>
                <div className="flex items-center space-x-2 mb-4">
                  <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center">
                    <span className="text-white font-bold text-lg">S</span>
                  </div>
                  <span className="text-xl font-bold text-blue-400">SymptoBridge</span>
                </div>
                <p className="text-gray-400 leading-relaxed">
                  AI-powered healthcare platform connecting patients with verified doctors for better health outcomes.
                </p>
              </div>
              
              <div>
                <h4 className="font-semibold mb-4">For Patients</h4>
                <ul className="space-y-2 text-gray-400">
                  <li><button onClick={() => setAuthMode('register')} className="hover:text-white transition-colors">Get Started</button></li>
                  <li><button onClick={() => setAuthMode('register')} className="hover:text-white transition-colors">Symptom Checker</button></li>
                  <li><button onClick={() => setAuthMode('register')} className="hover:text-white transition-colors">Find Doctors</button></li>
                  <li><button onClick={() => setAuthMode('register')} className="hover:text-white transition-colors">Book Appointments</button></li>
                </ul>
              </div>
              
              <div>
                <h4 className="font-semibold mb-4">For Doctors</h4>
                <ul className="space-y-2 text-gray-400">
                  <li><button onClick={() => setAuthMode('register')} className="hover:text-white transition-colors">Join Our Platform</button></li>
                  <li><button onClick={() => setAuthMode('register')} className="hover:text-white transition-colors">Patient Management</button></li>
                  <li><button onClick={() => setAuthMode('register')} className="hover:text-white transition-colors">Virtual Consultations</button></li>
                  <li><button onClick={() => setAuthMode('register')} className="hover:text-white transition-colors">Analytics</button></li>
                </ul>
              </div>
              
              <div>
                <h4 className="font-semibold mb-4">Support</h4>
                <ul className="space-y-2 text-gray-400">
                  <li><Link href="#" className="hover:text-white transition-colors">Help Center</Link></li>
                  <li><Link href="#" className="hover:text-white transition-colors">Contact Us</Link></li>
                  <li><Link href="#" className="hover:text-white transition-colors">Privacy Policy</Link></li>
                  <li><Link href="#" className="hover:text-white transition-colors">Terms of Service</Link></li>
                </ul>
              </div>
            </div>
            
            <div className="border-t border-gray-800 mt-8 pt-8 text-center text-gray-400">
              <p>&copy; 2026 SymptoBridge AI. All rights reserved. Made with ❤️ for better healthcare.</p>
            </div>
          </div>
        </footer>

        {/* Authentication Modal */}
        {renderAuthModal()}
      </div>
    </>
  );
};

export default HomePage; 