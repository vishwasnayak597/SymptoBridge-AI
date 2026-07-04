import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { ProtectedRoute } from '../components/ProtectedRoute';
import { useAuthContext } from '../components/AuthProvider';
import VideoCall from '../components/VideoCall';
import toast from 'react-hot-toast';

/**
 * Video call page. The appointment id (?id=...) doubles as the signaling-room key,
 * so doctor and patient landing on the same URL join the same WebRTC session.
 */
const VideoCallPage: React.FC = () => {
  const router = useRouter();
  const { user } = useAuthContext();
  const [appointmentId, setAppointmentId] = useState<string>('');

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const id = urlParams.get('id') || (router.query.id as string) || '';
    setAppointmentId(id);
  }, [router.query]);

  const handleCallEnd = () => {
    const dashboard = user?.role === 'doctor' ? '/doctor/dashboard' : '/patient/dashboard';
    router.push(dashboard);
  };

  const handleError = (error: string) => {
    toast.error(error);
  };

  return (
    <ProtectedRoute allowedRoles={['doctor', 'patient']}>
      <Head>
        <title>Video Call - SymptoBridge AI</title>
      </Head>

      {appointmentId && user ? (
        <VideoCall
          callId={appointmentId}
          userRole={user.role === 'doctor' ? 'host' : 'guest'}
          onCallEnd={handleCallEnd}
          onError={handleError}
        />
      ) : (
        <div className="min-h-screen bg-gray-900 flex items-center justify-center">
          <div className="text-center text-white">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-white mx-auto mb-4"></div>
            <p>Preparing your call…</p>
          </div>
        </div>
      )}
    </ProtectedRoute>
  );
};

export default VideoCallPage;
