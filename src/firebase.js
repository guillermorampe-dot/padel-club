import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBj07fuKb791l39O10Bdnqh2obADbBOTL0",
  authDomain: "padel-club-492bd.firebaseapp.com",
  projectId: "padel-club-492bd",
  storageBucket: "padel-club-492bd.firebasestorage.app",
  messagingSenderId: "598902273476",
  appId: "1:598902273476:web:6cb8034ff3866daa8ba091",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);