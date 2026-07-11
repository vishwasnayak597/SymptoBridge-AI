import { useSyncExternalStore } from 'react';

function subscribe(callback: () => void) {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

const getSnapshot = () => navigator.onLine;
const getServerSnapshot = () => true; // assume online during SSR/prerender

/**
 * Slim banner shown while the browser is offline. Cached pages and the
 * persisted query cache keep read views working; this just tells the user
 * why nothing new is loading.
 */
export default function OfflineBanner() {
  const online = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  if (online) return null;
  return (
    <div
      role="status"
      className="fixed bottom-0 inset-x-0 z-50 bg-gray-900 text-white text-sm text-center py-2 px-4"
    >
      You&rsquo;re offline — showing saved data. Changes will need a connection.
    </div>
  );
}
