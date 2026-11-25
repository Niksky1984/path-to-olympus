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
    apiKey: 'PASTE_YOUR_API_KEY',
    authDomain: 'your-project.firebaseapp.com',
    projectId: 'your-project',
    storageBucket: 'your-project.appspot.com',
    messagingSenderId: '000000000000',
    appId: '1:000000000000:web:0000000000000000',
  },
  // The e-mail of the Admin account (Firebase → Authentication → Users).
  // Must match the e-mail written in firestore.rules.
  adminEmail: 'admin@example.com',
  // Firestore document that holds the journey: athletes/<athleteId>
  athleteId: 'david',
};
