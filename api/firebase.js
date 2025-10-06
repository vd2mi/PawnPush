
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAnalytics } from "firebase/analytics";

const firebaseConfig = {
  apiKey: "AIzaSyBz6YA8veeDSY-naBqYdafJbcnfsnDi3EY",
  authDomain: "pawnpush-leaderboard.firebaseapp.com",
  projectId: "pawnpush-leaderboard",
  storageBucket: "pawnpush-leaderboard.appspot.com",
  messagingSenderId: "948510714839",
  appId: "1:948510714839:web:4e31534f1b4f305fa57992",
  measurementId: "G-F0QKLGBD7P"
};

const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const db = getFirestore(app);

export { app, analytics, db };
