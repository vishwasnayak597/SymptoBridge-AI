import React, { useEffect } from 'react';
import type { AppProps } from 'next/app';
import { Toaster } from 'react-hot-toast';
import { QueryClientProvider } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { AuthProvider } from '../components/AuthProvider';
import ErrorBoundary from '../components/ErrorBoundary';
import OfflineBanner from '../components/OfflineBanner';
import { queryClient, queryPersister } from '../lib/queryClient';
import '../styles/globals.css';

/**
 * Main App component with error boundary and global providers.
 *
 * Server state is managed by React Query; the cache is persisted to
 * IndexedDB so reloads (and offline visits) render last-known data
 * immediately. The service worker handles offline delivery of the shell.
 */
const App: React.FC<AppProps> = ({ Component, pageProps }) => {
  useEffect(() => {
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Offline support is progressive enhancement — never block the app on it.
      });
    }
  }, []);

  const app = (
    <AuthProvider>
      <Component {...pageProps} />
      <OfflineBanner />
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: '#363636',
            color: '#fff',
            borderRadius: '8px',
            fontSize: '14px',
            maxWidth: '500px',
          },
          success: {
            duration: 3000,
            iconTheme: {
              primary: '#10B981',
              secondary: '#fff',
            },
          },
          error: {
            duration: 5000,
            iconTheme: {
              primary: '#EF4444',
              secondary: '#fff',
            },
          },
          loading: {
            iconTheme: {
              primary: '#E8765A',
              secondary: '#fff',
            },
          },
        }}
      />
    </AuthProvider>
  );

  return (
    <ErrorBoundary>
      {queryPersister ? (
        <PersistQueryClientProvider
          client={queryClient}
          persistOptions={{ persister: queryPersister, maxAge: 24 * 60 * 60 * 1000 }}
        >
          {app}
        </PersistQueryClientProvider>
      ) : (
        // SSR/prerender path: no IndexedDB, plain provider
        <QueryClientProvider client={queryClient}>{app}</QueryClientProvider>
      )}
    </ErrorBoundary>
  );
};

export default App;
