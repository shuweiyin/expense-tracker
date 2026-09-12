const MESSAGES = {
  'auth/invalid-email': 'That email address doesn’t look right.',
  'auth/missing-password': 'Please enter a password.',
  'auth/weak-password': 'Password should be at least 6 characters.',
  'auth/wrong-password': 'Incorrect password. Try again or reset it below.',
  'auth/invalid-credential': 'Incorrect email or password.',
  'auth/user-disabled': 'This account has been disabled.',
  'auth/too-many-requests': 'Too many attempts. Please wait a moment and try again.',
  'auth/popup-closed-by-user': 'Sign-in was cancelled.',
  'auth/network-request-failed': 'Network error. Check your connection and try again.',
  'auth/email-already-in-use': 'An account already exists with that email.',
}

export function friendlyAuthError(error) {
  return MESSAGES[error?.code] ?? 'Something went wrong. Please try again.'
}
