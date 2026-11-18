import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);

const provider = new GoogleAuthProvider();
export const WORKSPACE_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
];

WORKSPACE_SCOPES.forEach((scope) => provider.addScope(scope));
provider.setCustomParameters({
  prompt: 'select_account',
});

let isSigningIn = false;
// In-memory cache only for the OAuth access token (never localStorage/sessionStorage)
let cachedAccessToken: string | null = null;

export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: (user: User | null) => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        if (onAuthFailure) onAuthFailure(user);
      }
    } else {
      cachedAccessToken = null;
      if (onAuthFailure) onAuthFailure(null);
    }
  });
};

export type GoogleSignInResult =
  | { cancelled: true }
  | { cancelled?: false; user: User; accessToken: string; idToken: string };

export const googleSignIn = async (): Promise<GoogleSignInResult | null> => {
  if (isSigningIn) {
    return { cancelled: true };
  }
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error(
        'Gagal mendapatkan token akses Google Sheets & Drive dari Google Sign-In.'
      );
    }

    const idToken = await result.user.getIdToken();
    cachedAccessToken = credential.accessToken;
    return {
      cancelled: false,
      user: result.user,
      accessToken: cachedAccessToken,
      idToken,
    };
  } catch (error: any) {
    const code = error?.code || '';
    if (
      code === 'auth/popup-closed-by-user' ||
      code === 'auth/cancelled-popup-request'
    ) {
      // User closed or cancelled the sign-in popup — treat as graceful cancellation
      return { cancelled: true };
    }
    if (code === 'auth/popup-blocked') {
      throw new Error(
        'Jendela pop-up login Google diblokir oleh browser. Izinkan pop-up untuk halaman ini lalu coba lagi.'
      );
    }
    if (code === 'auth/network-request-failed') {
      throw new Error(
        'Koneksi jaringan terputus saat login Google. Periksa internet Anda lalu coba lagi.'
      );
    }
    if (code === 'auth/unauthorized-domain') {
      throw new Error(
        'Domain aplikasi belum terdaftar di Firebase Authentication. Hubungi pengelola sistem.'
      );
    }
    throw new Error(error?.message || 'Gagal login dengan Google.');
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

export const logout = async () => {
  await auth.signOut();
  cachedAccessToken = null;
};
