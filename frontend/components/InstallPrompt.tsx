import React, { useEffect, useState } from 'react';

/**
 * PWA install prompt.
 *
 * Chrome/Edge/Android fire `beforeinstallprompt` when the app meets install
 * criteria (manifest + service worker + HTTPS). We capture it and surface a
 * branded banner instead of relying on the browser's easy-to-miss menu item.
 * Dismissal is remembered so we never nag. On iOS the event never fires and the
 * banner simply doesn't show (Add-to-Home-Screen there is a manual Safari flow).
 */

const DISMISS_KEY = 'pwa-install-dismissed';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => void;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const InstallPrompt: React.FC = () => {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Already running as an installed app? Nothing to prompt.
    if (window.matchMedia?.('(display-mode: standalone)').matches) return;
    try {
      if (localStorage.getItem(DISMISS_KEY) === '1') return;
    } catch {
      /* private mode / storage blocked — just proceed */
    }

    const onPrompt = (e: Event) => {
      e.preventDefault(); // stop the mini-infobar; we present our own
      setDeferred(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    const onInstalled = () => {
      setVisible(false);
      setDeferred(null);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = async () => {
    if (!deferred) return;
    deferred.prompt();
    try {
      await deferred.userChoice;
    } catch {
      /* user closed the native dialog */
    }
    setDeferred(null);
    setVisible(false);
  };

  const dismiss = () => {
    setVisible(false);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* ignore */
    }
  };

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label="Install SymptoBridge"
      className="fixed inset-x-0 bottom-4 z-50 mx-auto flex w-[92%] max-w-md items-center gap-3 rounded-2xl border border-orange-100 bg-white p-3 shadow-lg sm:left-4 sm:right-auto sm:mx-0"
    >
      <img src="/icon-192.png" alt="" width={44} height={44} className="rounded-xl" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-gray-900">Install SymptoBridge</p>
        <p className="truncate text-xs text-gray-500">Add it to your home screen for quick, app-like access.</p>
      </div>
      <button
        onClick={dismiss}
        className="rounded-lg px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100"
        aria-label="Not now"
      >
        Not now
      </button>
      <button
        onClick={install}
        className="rounded-lg bg-[#E8765A] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#d9634a] focus:outline-none focus:ring-2 focus:ring-orange-300"
      >
        Install
      </button>
    </div>
  );
};

export default InstallPrompt;
