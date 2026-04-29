import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, query, orderBy, limit, serverTimestamp, updateDoc, doc } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDhG6OGZOZBpfU7zHMwUyafxBZa_eX6Jeg",
  authDomain: "yupidemo-white.firebaseapp.com",
  projectId: "yupidemo-white",
  storageBucket: "yupidemo-white.firebasestorage.app",
  messagingSenderId: "568162275709",
  appId: "1:568162275709:web:ca95b79a9dd1c993b47c14",
  measurementId: "G-NKK1PF69ZW"
};

// Initialize Firebase only if the config is not the placeholder
let app, db;
const isConfigured = firebaseConfig.apiKey !== "REPLACE_WITH_API_KEY";

if (isConfigured) {
  try {
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    console.log("Firebase initialized successfully");
  } catch (error) {
    console.error("Firebase initialization error:", error);
  }
} else {
  console.warn("Firebase is not configured! Scores will not be saved. Please update firebaseConfig in firebase-db.js.");
}

// Global player state
export const PlayerState = {
  docId: null,
  name: null,
  points: 0
};

/**
 * Registers a new player session in Firestore.
 */
export async function registerPlayer(name) {
  PlayerState.name = name;
  PlayerState.points = 0;

  if (!isConfigured || !db) return { success: false, error: "Firebase not configured" };

  try {
    const docRef = await addDoc(collection(db, "leaderboard"), {
      name: name,
      points: 0,
      timestamp: serverTimestamp()
    });
    PlayerState.docId = docRef.id;
    return { success: true };
  } catch (e) {
    console.error("Error registering player: ", e);
    return { success: false, error: e.message };
  }
}

/**
 * Updates the player's final score in Firestore.
 */
export async function saveScore(points) {
  PlayerState.points = points;

  if (!isConfigured || !db || !PlayerState.docId) return { success: false };

  try {
    const playerRef = doc(db, "leaderboard", PlayerState.docId);
    await updateDoc(playerRef, {
      points: points,
      completedAt: serverTimestamp()
    });
    return { success: true };
  } catch (e) {
    console.error("Error saving score: ", e);
    return { success: false, error: e.message };
  }
}

/**
 * Fetches the top 500 leaderboard.
 * Sorts by points (descending).
 */
export async function fetchLeaderboard() {
  if (!isConfigured || !db) return []; // Return empty array if not configured

  try {
    const q = query(
      collection(db, "leaderboard"),
      orderBy("points", "desc"),
      limit(500)
    );
    
    const querySnapshot = await getDocs(q);
    const results = [];
    querySnapshot.forEach((doc) => {
      results.push({ id: doc.id, ...doc.data() });
    });
    return results;
  } catch (e) {
    console.error("Error fetching leaderboard: ", e);
    return [];
  }
}
