import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, query, orderBy, limit, serverTimestamp, updateDoc, doc } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

// TODO: Replace this placeholder config with your actual Firebase project config
// Find this in Firebase Console > Project Settings > General > Your apps
const firebaseConfig = {
  apiKey: "REPLACE_WITH_API_KEY",
  authDomain: "REPLACE_WITH_AUTH_DOMAIN",
  projectId: "REPLACE_WITH_PROJECT_ID",
  storageBucket: "REPLACE_WITH_STORAGE_BUCKET",
  messagingSenderId: "REPLACE_WITH_MESSAGING_SENDER_ID",
  appId: "REPLACE_WITH_APP_ID"
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
  code: null,
  name: null,
  email: null,
  phone: null,
  score: 0,
  timeTaken: 0, // Lower is better for tie-breaking
};

/**
 * Registers a new player session in Firestore.
 */
export async function registerPlayer(code, name, email, phone) {
  PlayerState.code = code;
  PlayerState.name = name;
  PlayerState.email = email;
  PlayerState.phone = phone;
  PlayerState.score = 0;
  PlayerState.timeTaken = 0;

  if (!isConfigured || !db) return { success: false, error: "Firebase not configured" };

  try {
    const docRef = await addDoc(collection(db, "leaderboard"), {
      code: code,
      name: name,
      email: email,
      phone: phone,
      score: 0,
      timeTaken: 0,
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
export async function saveScore(score, timeTaken) {
  PlayerState.score = score;
  PlayerState.timeTaken = timeTaken;

  if (!isConfigured || !db || !PlayerState.docId) return { success: false };

  try {
    const playerRef = doc(db, "leaderboard", PlayerState.docId);
    await updateDoc(playerRef, {
      score: score,
      timeTaken: timeTaken,
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
 * Sorts by score (descending) and then timeTaken (ascending).
 */
export async function fetchLeaderboard() {
  if (!isConfigured || !db) return []; // Return empty array if not configured

  try {
    const q = query(
      collection(db, "leaderboard"),
      orderBy("score", "desc"),
      orderBy("timeTaken", "asc"),
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
