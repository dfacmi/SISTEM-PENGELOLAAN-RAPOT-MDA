import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export type ClientPlatform = 'ios' | 'android' | 'windows' | 'mac_other';

export function detectClientPlatform(): ClientPlatform {
  if (typeof navigator === 'undefined') return 'mac_other';
  const ua = navigator.userAgent || '';
  const isIpadDesktopMode =
    navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1;
  if (/iPad|iPhone|iPod/i.test(ua) || isIpadDesktopMode) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  if (/Windows/i.test(ua)) return 'windows';
  return 'mac_other';
}

export function isRunningStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    nav.standalone === true
  );
}

export function usePwaInstall() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState<boolean>(() =>
    isRunningStandalone()
  );
  const [platform] = useState<ClientPlatform>(() => detectClientPlatform());

  useEffect(() => {
    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const onAppInstalled = () => {
      setDeferredPrompt(null);
      setIsInstalled(true);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);

    const media = window.matchMedia?.('(display-mode: standalone)');
    const onDisplayChange = () => {
      if (isRunningStandalone()) setIsInstalled(true);
    };
    media?.addEventListener?.('change', onDisplayChange);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
      media?.removeEventListener?.('change', onDisplayChange);
    };
  }, []);

  const triggerNativeInstall = async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    if (!deferredPrompt) return 'unavailable';
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        setDeferredPrompt(null);
        setIsInstalled(true);
      }
      return choice.outcome;
    } catch {
      return 'unavailable';
    }
  };

  return {
    canNativeInstall: Boolean(deferredPrompt),
    isInstalled,
    platform,
    triggerNativeInstall,
  };
}
