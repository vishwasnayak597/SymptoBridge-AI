import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';
import { 
  EyeIcon, 
  EyeSlashIcon, 
  ExclamationCircleIcon,
  UserGroupIcon,
  AcademicCapIcon 
} from '@heroicons/react/24/outline';
import { useAuthContext } from '../../components/AuthProvider';

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

const baseValidationSchema = yup.object({
  email: yup
    .string()
    .email('Please enter a valid email address')
    .required('Email is required'),
  password: yup
    .string()
    .min(7, 'Password must be at least 7 characters')
    .required('Password is required'),
  confirmPassword: yup
    .string()
    .oneOf([yup.ref('password')], 'Passwords must match')
    .required('Please confirm your password'),
  firstName: yup
    .string()
    .required('First name is required')
    .max(50, 'First name must be less than 50 characters'),
  lastName: yup
    .string()
    .required('Last name is required')
    .max(50, 'Last name must be less than 50 characters'),
  phone: yup
    .string()
    .matches(/^[\+]?[1-9][\d]{0,15}$/, 'Please enter a valid phone number')
    .optional(),
  role: yup
    .string()
    .oneOf(['patient', 'doctor'], 'Please select a valid role')
    .required('Role is required'),
});

const doctorValidationSchema = baseValidationSchema.shape({
  specialization: yup
    .string()
    .when('role', {
      is: 'doctor',
      then: (schema) => schema.required('Specialization is required for doctors'),
      otherwise: (schema) => schema.optional(),
    }),
  licenseNumber: yup
    .string()
    .when('role', {
      is: 'doctor',
      then: (schema) => schema.required('License number is required for doctors'),
      otherwise: (schema) => schema.optional(),
    }),
  experience: yup
    .number()
    .when('role', {
      is: 'doctor',
      then: (schema) => schema.min(0, 'Experience must be a positive number').required('Experience is required for doctors'),
      otherwise: (schema) => schema.optional(),
    }),
  consultationFee: yup
    .number()
    .when('role', {
      is: 'doctor',
      then: (schema) => schema.min(0, 'Consultation fee must be a positive number').required('Consultation fee is required for doctors'),
      otherwise: (schema) => schema.optional(),
    }),
});

const SPECIALIZATIONS = [
  'General Practice',
  'Internal Medicine',
  'Pediatrics',
  'Cardiology',
  'Dermatology',
  'Orthopedics',
  'Psychiatry',
  'Neurology',
  'Oncology',
  'Gastroenterology',
  'Pulmonology',
  'Endocrinology',
  'Gynecology',
  'Urology',
  'Ophthalmology',
  'Anesthesiology',
  'Radiology',
  'Pathology',
  'Emergency Medicine',
  'Family Medicine',
  'Other',
];

/**
 * Registration page component with beautiful UI
 */
const RegisterPage: React.FC = () => {
  const router = useRouter();
  const { register: registerUser, isAuthenticated, user, isLoading } = useAuthContext();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm({
    resolver: yupResolver(doctorValidationSchema),
    defaultValues: {
      role: 'patient',
    },
  });

  // Handle role query parameter from home page
  useEffect(() => {
    const { role } = router.query;
    if (role === 'patient' || role === 'doctor') {
      setValue('role', role);
    }
  }, [router.query, setValue]);

  const selectedRole = watch('role');

  useEffect(() => {
    if (isAuthenticated && user && !router.asPath.includes('/video-call/')) {
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
  }, [isAuthenticated, user, router]);

  const onSubmit = async (data: RegisterFormData): Promise<void> => {
    try {
      setIsSubmitting(true);
      await registerUser(data);
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
        <title>Create Account - SymptoBridge AI</title>
        <meta name="description" content="Create your SymptoBridge AI account" />
      </Head>

      <div className="auth-container animate-fade-in">
        <div className="auth-card hover-lift max-w-lg">
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
            <h2 className="auth-title">Create your account</h2>
            <p className="auth-subtitle">
              Join thousands of users transforming healthcare
            </p>
          </div>

          {/* Form */}
          <form className="auth-form" onSubmit={handleSubmit(onSubmit)}>
            <div className="auth-fields">
              {/* Role Selection */}
              <div className="form-group">
                <label className="form-label">I am a</label>
                <div className="grid grid-cols-2 gap-4">
                  <label className={`relative flex cursor-pointer rounded-lg border p-4 hover:bg-gray-50 transition-colors ${
                    selectedRole === 'patient' ? 'border-blue-500 ring-2 ring-blue-500 bg-blue-50' : 'border-gray-300'
                  }`}>
                    <input
                      {...register('role')}
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
                          Seeking medical care
                        </div>
                      </div>
                    </div>
                  </label>
                  
                  <label className={`relative flex cursor-pointer rounded-lg border p-4 hover:bg-gray-50 transition-colors ${
                    selectedRole === 'doctor' ? 'border-blue-500 ring-2 ring-blue-500 bg-blue-50' : 'border-gray-300'
                  }`}>
                    <input
                      {...register('role')}
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
                {errors.role && (
                  <div className="form-error">
                    <ExclamationCircleIcon className="w-4 h-4 mr-1" />
                    {errors.role.message}
                  </div>
                )}
              </div>

              {/* Name Fields */}
              <div className="grid grid-cols-2 gap-4">
                <div className="form-group">
                  <label htmlFor="firstName" className="form-label">
                    First Name
                  </label>
                  <input
                    {...register('firstName')}
                    type="text"
                    autoComplete="given-name"
                    className={errors.firstName ? 'form-input-error' : 'form-input'}
                    placeholder="First name"
                  />
                  {errors.firstName && (
                    <div className="form-error">
                      <ExclamationCircleIcon className="w-4 h-4 mr-1" />
                      {errors.firstName.message}
                    </div>
                  )}
                </div>

                <div className="form-group">
                  <label htmlFor="lastName" className="form-label">
                    Last Name
                  </label>
                  <input
                    {...register('lastName')}
                    type="text"
                    autoComplete="family-name"
                    className={errors.lastName ? 'form-input-error' : 'form-input'}
                    placeholder="Last name"
                  />
                  {errors.lastName && (
                    <div className="form-error">
                      <ExclamationCircleIcon className="w-4 h-4 mr-1" />
                      {errors.lastName.message}
                    </div>
                  )}
                </div>
              </div>

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

              {/* Phone Field */}
              <div className="form-group">
                <label htmlFor="phone" className="form-label">
                  Phone Number <span className="text-gray-500">(optional)</span>
                </label>
                <input
                  {...register('phone')}
                  type="tel"
                  autoComplete="tel"
                  className={errors.phone ? 'form-input-error' : 'form-input'}
                  placeholder="Enter your phone number"
                />
                {errors.phone && (
                  <div className="form-error">
                    <ExclamationCircleIcon className="w-4 h-4 mr-1" />
                    {errors.phone.message}
                  </div>
                )}
              </div>



              {/* Doctor-specific Fields */}
              {selectedRole === 'doctor' && (
                <div className="space-y-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
                  <h3 className="text-sm font-medium text-blue-900 mb-3">Professional Information</h3>
                  
                  <div className="form-group">
                    <label htmlFor="specialization" className="form-label">
                      Medical Specialization
                    </label>
                    <select
                      {...register('specialization')}
                      className={errors.specialization ? 'form-input-error' : 'form-input'}
                    >
                      <option value="">Select your specialization</option>
                      {SPECIALIZATIONS.map((spec) => (
                        <option key={spec} value={spec}>
                          {spec}
                        </option>
                      ))}
                    </select>
                    {errors.specialization && (
                      <div className="form-error">
                        <ExclamationCircleIcon className="w-4 h-4 mr-1" />
                        {errors.specialization.message}
                      </div>
                    )}
                  </div>

                  <div className="form-group">
                    <label htmlFor="licenseNumber" className="form-label">
                      Medical License Number
                    </label>
                    <input
                      {...register('licenseNumber')}
                      type="text"
                      className={errors.licenseNumber ? 'form-input-error' : 'form-input'}
                      placeholder="Enter your medical license number"
                    />
                    {errors.licenseNumber && (
                      <div className="form-error">
                        <ExclamationCircleIcon className="w-4 h-4 mr-1" />
                        {errors.licenseNumber.message}
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="form-group">
                      <label htmlFor="experience" className="form-label">
                        Experience (years)
                      </label>
                      <input
                        {...register('experience', { valueAsNumber: true })}
                        type="number"
                        min="0"
                        max="50"
                        className={errors.experience ? 'form-input-error' : 'form-input'}
                        placeholder="Years"
                      />
                      {errors.experience && (
                        <div className="form-error">
                          <ExclamationCircleIcon className="w-4 h-4 mr-1" />
                          {errors.experience.message}
                        </div>
                      )}
                    </div>

                    <div className="form-group">
                      <label htmlFor="consultationFee" className="form-label">
                        Consultation Fee ($)
                      </label>
                      <input
                        {...register('consultationFee', { valueAsNumber: true })}
                        type="number"
                        min="0"
                        step="0.01"
                        className={errors.consultationFee ? 'form-input-error' : 'form-input'}
                        placeholder="0.00"
                      />
                      {errors.consultationFee && (
                        <div className="form-error">
                          <ExclamationCircleIcon className="w-4 h-4 mr-1" />
                          {errors.consultationFee.message}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}



              {/* Password Fields */}
              <div className="grid grid-cols-1 gap-4">
                <div className="form-group">
                  <label htmlFor="password" className="form-label">
                    Password
                  </label>
                  <div className="relative">
                    <input
                      {...register('password')}
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      className={`${errors.password ? 'form-input-error' : 'form-input'} pr-10`}
                      placeholder="Create a strong password"
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

                <div className="form-group">
                  <label htmlFor="confirmPassword" className="form-label">
                    Confirm Password
                  </label>
                  <div className="relative">
                    <input
                      {...register('confirmPassword')}
                      type={showConfirmPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      className={`${errors.confirmPassword ? 'form-input-error' : 'form-input'} pr-10`}
                      placeholder="Confirm your password"
                    />
                    <button
                      type="button"
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600 transition-colors"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    >
                      {showConfirmPassword ? (
                        <EyeSlashIcon className="h-5 w-5" />
                      ) : (
                        <EyeIcon className="h-5 w-5" />
                      )}
                    </button>
                  </div>
                  {errors.confirmPassword && (
                    <div className="form-error">
                      <ExclamationCircleIcon className="w-4 h-4 mr-1" />
                      {errors.confirmPassword.message}
                    </div>
                  )}
                </div>
              </div>
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
                    Creating account...
                  </>
                ) : (
                  'Create account'
                )}
              </button>
            </div>

            {/* Divider */}
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white text-gray-500">Already have an account?</span>
              </div>
            </div>

            {/* Login Link */}
            <div className="text-center">
              <Link
                href="/auth/login"
                className="btn-outline btn-lg w-full"
              >
                Sign in to your account
              </Link>
            </div>
          </form>
        </div>

        {/* Footer */}
        <div className="text-center mt-8 text-sm text-gray-500 max-w-md">
          <p>
            By creating an account, you agree to our{' '}
            <Link href="/terms" className="text-blue-600 hover:text-blue-800">
              Terms of Service
            </Link>{' '}
            and{' '}
            <Link href="/privacy" className="text-blue-600 hover:text-blue-800">
              Privacy Policy
            </Link>
          </p>
        </div>
      </div>
    </>
  );
};

export default RegisterPage; 