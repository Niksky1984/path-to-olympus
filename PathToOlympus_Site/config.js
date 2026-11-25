/* =============================================================================
 * Path to Olympus — configuration (the ONLY file you need to edit).
 *
 * Leave apiKey as "PASTE..." to run in DEMO mode: everything works on this
 * device only (saved in the browser), with a "+1 day" button for testing.
 *
 * For the real two-phone version, paste your Firebase web config below
 * (Firebase console → Project settings → Your apps → Web app → Config).
 * ========================================================================== */
window.OLYMPUS_CONFIG = {
  firebase: {
    apiKey: 'AIzaSyBPcRyyWb1LD4n9TdbI55hQNTXxPGP-BKA',
    authDomain: 'path-to-olympus.firebaseapp.com',
    projectId: 'path-to-olympus',
    storageBucket: 'path-to-olympus.firebasestorage.app',
    messagingSenderId: '11039117380',
    appId: '1:11039117380:web:a06d64fcacae5c5e37ec11',
  },
  // The e-mail of the Admin account (Firebase → Authentication → Users).
  // Must match the e-mail written in firestore.rules.
  adminEmail: 'niksha1984@gmail.com',
  // Firestore document that holds the journey: athletes/<athleteId>
  athleteId: 'david',
};
