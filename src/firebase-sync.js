import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc, deleteDoc, collection, getDocs, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';

/** The account allowed to approve/reject community food submissions. */
export const ADMIN_EMAIL = 'vijay_toshniwal1@rediffmail.com';
export function isAdmin() {
  return !!auth.currentUser && auth.currentUser.email === ADMIN_EMAIL;
}

const firebaseConfig = {
  apiKey: 'AIzaSyBx9hA1S2FU-oYkJDnQtivqjnTqJZyg6VA',
  authDomain: 'nutrition-pulse.firebaseapp.com',
  projectId: 'nutrition-pulse',
  storageBucket: 'nutrition-pulse.firebasestorage.app',
  messagingSenderId: '964919125909',
  appId: '1:964919125909:web:224636830515588e1f789c',
};

const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

let cloudReady = false;

export function isCloudReady() {
  return cloudReady;
}

export function watchAuthState(callback) {
  onAuthStateChanged(auth, callback);
}

export function signIn(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export function signUp(email, password) {
  return createUserWithEmailAndPassword(auth, email, password);
}

export function signOutUser() {
  return signOut(auth);
}

export function resetPassword(email) {
  return sendPasswordResetEmail(auth, email);
}

export async function loadCloudState(uid) {
  cloudReady = false;
  const snapshot = await getDoc(doc(db, 'users', uid, 'private', 'appData'));
  cloudReady = true;
  return snapshot.exists() ? snapshot.data().state : null;
}

export async function saveCloudState(uid, state) {
  if (!cloudReady) return;
  try {
    await setDoc(doc(db, 'users', uid, 'private', 'appData'), { state: JSON.parse(JSON.stringify(state)), updatedAt: serverTimestamp() });
  } catch (error) {
    console.warn('Cloud save failed', error);
  }
}

/**
 * Shared food bank: one collection all signed-in users read and contribute to,
 * so a food any user has entered resolves instantly for everyone else.
 * Requires a Firestore rule allowing authenticated read/write on /foodBank.
 */
export async function fetchFoodBankEntry(key) {
  try {
    const snapshot = await getDoc(doc(db, 'foodBank', key));
    return snapshot.exists() ? snapshot.data() : null;
  } catch {
    return null;
  }
}

/**
 * The whole shared food bank, fetched once after sign-in so approved foods can
 * appear in the search suggestions (not just when their exact name is typed).
 */
export async function fetchFoodBank() {
  if (!auth.currentUser) return [];
  try {
    const snapshot = await getDocs(collection(db, 'foodBank'));
    return snapshot.docs.map(d => ({ key: d.id, ...d.data() }));
  } catch {
    return [];
  }
}

/**
 * Every user-entered food — including the admin's own — goes to a moderation
 * queue (foodBankPending) first, never straight into the shared bank, so
 * every entry gets the same review before it becomes everyone's default.
 */
export function submitFoodForReview(key, entry) {
  if (!auth.currentUser) return;
  setDoc(doc(db, 'foodBankPending', key), {
    ...entry,
    submittedBy: auth.currentUser.email,
    submittedAt: serverTimestamp(),
  }).catch(() => {});
}

export async function fetchPendingFoods() {
  if (!isAdmin()) return [];
  try {
    const snapshot = await getDocs(collection(db, 'foodBankPending'));
    return snapshot.docs.map(d => ({ key: d.id, ...d.data() }));
  } catch {
    return [];
  }
}

export async function approvePendingFood(key, entry) {
  if (!isAdmin()) return;
  const { submittedBy, submittedAt, ...clean } = entry;
  await setDoc(doc(db, 'foodBank', key), { ...clean, approvedBy: auth.currentUser.email, updatedAt: serverTimestamp() });
  await deleteDoc(doc(db, 'foodBankPending', key));
}

export async function rejectPendingFood(key) {
  if (!isAdmin()) return;
  await deleteDoc(doc(db, 'foodBankPending', key));
}

/**
 * Activity synced from outside the app: an iPhone Shortcut PATCHes a doc in
 * the activityInbox collection via the Firestore REST API, addressed by a
 * long random token only the user's devices know — so the Shortcut needs no
 * password. Shape: { date: 'YYYY-MM-DD', steps, burnKcal, exMin }.
 */
export async function fetchActivitySync(token) {
  if (!token) return null;
  try {
    const snapshot = await getDoc(doc(db, 'activityInbox', token));
    return snapshot.exists() ? snapshot.data() : null;
  } catch {
    return null;
  }
}

export const FIREBASE_WEB_API_KEY = firebaseConfig.apiKey;
export const FIREBASE_PROJECT_ID = firebaseConfig.projectId;
