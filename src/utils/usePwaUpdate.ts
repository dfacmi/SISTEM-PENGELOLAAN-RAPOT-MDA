import { useCallback, useEffect, useState } from 'react';

export const PWA_UPDATE_EVENT = 'siakad-mda-sw-update';

let activeRegistration: ServiceWorkerRegistration | null = null;
let waitingWorker: ServiceWorker | null = null;
let reloadScheduled = false;

function notifyUpdateAvailable(reg: ServiceWorkerRegistration) {
  activeRegistration = reg;
  if (reg.waiting) {
    waitingWorker = reg.waiting;
    window.dispatchEvent(new CustomEvent(PWA_UPDATE_EVENT));
  }
}

export function registerPwaServiceWorker() {
  if (
    typeof window === 'undefined' ||
    !('serviceWorker' in navigator) ||
    !import.meta.env.PROD
  ) {
    return;
  }

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadScheduled) {
      window.location.reload();
    }
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { updateViaCache: 'none' })
      .then((reg) => {
        activeRegistration = reg;

        if (reg.waiting && navigator.serviceWorker.controller) {
          notifyUpdateAvailable(reg);
        }

        reg.addEventListener('updatefound', () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (
              installing.state === 'installed' &&
              navigator.serviceWorker.controller
            ) {
              waitingWorker = reg.waiting || installing;
              window.dispatchEvent(new CustomEvent(PWA_UPDATE_EVENT));
            }
          });
        });

        const checkUpdate = () => {
          reg.update().catch(() => {});
        };

        window.addEventListener('focus', checkUpdate);
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') {
            checkUpdate();
          }
        });
        window.setInterval(checkUpdate, 20 * 60 * 1000);
        checkUpdate();
      })
      .catch((err) => {
        console.warn('Registrasi Service Worker PWA dilewati:', err);
      });
  });
}

export function usePwaUpdate() {
  const [updateAvailable, setUpdateAvailable] = useState<boolean>(() =>
    Boolean(waitingWorker)
  );
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const onUpdateEvent = () => {
      setUpdateAvailable(true);
      setDismissed(false);
    };
    window.addEventListener(PWA_UPDATE_EVENT, onUpdateEvent);
    if (activeRegistration?.waiting && navigator.serviceWorker.controller) {
      setUpdateAvailable(true);
    }
    return () => {
      window.removeEventListener(PWA_UPDATE_EVENT, onUpdateEvent);
    };
  }, []);

  const applyUpdate = useCallback(() => {
    const target = waitingWorker || activeRegistration?.waiting;
    reloadScheduled = true;
    if (target) {
      target.postMessage({ type: 'SKIP_WAITING' });
      window.setTimeout(() => {
        window.location.reload();
      }, 900);
    } else {
      window.location.reload();
    }
  }, []);

  const dismissUpdateBanner = useCallback(() => {
    setDismissed(true);
  }, []);

  return {
    updateAvailable: updateAvailable && !dismissed,
    applyUpdate,
    dismissUpdateBanner,
  };
}
