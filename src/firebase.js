import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getFunctions } from 'firebase/functions';

// TODO: Replace with your Firebase config from Firebase Console
// Instructions: See FIREBASE_SETUP_GUIDE.md
const firebaseConfig = {
  apiKey: "AIzaSyBbRiVD_BsRagZikuX51L8oKnPsSKu90ws",
  authDomain: "kids-marketplace-ed624.firebaseapp.com",
  projectId: "kids-marketplace-ed624",
  storageBucket: "kids-marketplace-ed624.firebasestorage.app",
  messagingSenderId: "983464077052",
  appId: "1:983464077052:web:18c578b4957137529c1979",
  measurementId: "G-WQPER6HTJP"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase services
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app);

export default app;
