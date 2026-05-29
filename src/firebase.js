import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyAsMRNWUMMuZ1dsOgP_X3BLkWkpwJEcKEY",
  authDomain: "piezo-6375a.firebaseapp.com",
  databaseURL:
    "https://piezo-6375a-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "piezo-6375a",
  storageBucket: "piezo-6375a.firebasestorage.app",
  messagingSenderId: "692903329682",
  appId: "1:692903329682:web:e2a2222826cc8ee102cb4b",
  measurementId: "G-5E8Y7P4MFD",
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
