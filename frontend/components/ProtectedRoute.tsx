import React, { ReactNode, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useAuthContext } from './AuthProvider';
import { User } from '../../shared/types';

interface ProtectedRouteProps {
  children: ReactNode;
  allowedRoles?: Array<'patient' | 'doctor' | 'admin'>;
  requireEmailVerification?: boolean;
  requireDoctorVerification?: boolean;
  redirectTo?: string;
  fallback?: ReactNode;
}

/**
 * Protected route component for role-based access control
 */
export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  allowedRoles = [],
  requireEmailVerification = false,
  requireDoctorVerification = false,
  redirectTo = '/auth/login',
  fallback = null,
}) => {
  const { user, isLoading, isAuthenticated } = useAuthContext();
  const router = useRouter();

  useEffect(() => {
    // Also wait for the router: on a static export the query string isn't parsed until
    // hydration, and redirecting before then would lose it.
    if (isLoading || !router.isReady) return;

    if (!isAuthenticated) {
      // Carry the page they were heading to (query included), so a deep link like a
      // booking suggestion or a waitlist offer survives the login. The login page
      // only follows it if it's a safe same-site path — see lib/redirect.ts.
      const here = router.asPath;
      const target =
        redirectTo === '/auth/login' && here && !here.startsWith('/auth/')
          ? `${redirectTo}?redirect=${encodeURIComponent(here)}`
          : redirectTo;
      router.push(target);
      return;
    }

    if (allowedRoles.length > 0 && !allowedRoles.includes(user!.role)) {
      router.push('/unauthorized');
      return;
    }

    if (requireEmailVerification && !user!.isEmailVerified) {
      router.push('/auth/verify-email');
      return;
    }

    if (requireDoctorVerification && user!.role === 'doctor' && !user!.isVerified) {
      router.push('/doctor/verification-pending');
      return;
    }
  }, [
    isLoading,
    isAuthenticated,
    user,
    allowedRoles,
    requireEmailVerification,
    requireDoctorVerification,
    redirectTo,
    router,
    router.isReady,
  ]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return fallback;
  }

  if (allowedRoles.length > 0 && !allowedRoles.includes(user!.role)) {
    return fallback;
  }

  if (requireEmailVerification && !user!.isEmailVerified) {
    return fallback;
  }

  if (requireDoctorVerification && user!.role === 'doctor' && !user!.isVerified) {
    return fallback;
  }

  return <>{children}</>;
};

interface RequireAuthProps {
  children: ReactNode;
  fallback?: ReactNode;
}

/**
 * Simple authentication requirement component
 */
export const RequireAuth: React.FC<RequireAuthProps> = ({ children, fallback }) => {
  return (
    <ProtectedRoute fallback={fallback}>
      {children}
    </ProtectedRoute>
  );
};

interface RoleGuardProps {
  children: ReactNode;
  allowedRoles: Array<'patient' | 'doctor' | 'admin'>;
  fallback?: ReactNode;
}

/**
 * Role-based access guard component
 */
export const RoleGuard: React.FC<RoleGuardProps> = ({ children, allowedRoles, fallback }) => {
  return (
    <ProtectedRoute allowedRoles={allowedRoles} fallback={fallback}>
      {children}
    </ProtectedRoute>
  );
}; 