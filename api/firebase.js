
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.4.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.4.0/firebase-firestore.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.4.0/firebase-analytics.js";

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
