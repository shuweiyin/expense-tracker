import { useState } from 'react'
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
} from 'firebase/auth'
import { auth } from './firebase'
import { friendlyAuthError } from './authErrors'
import './Login.css'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [info, setInfo] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleGoogleSignIn() {
    setError(null)
    setInfo(null)
    try {
      await signInWithPopup(auth, new GoogleAuthProvider())
    } catch (err) {
      setError(friendlyAuthError(err))
    }
  }

  async function handleEmailSubmit(e) {
    e.preventDefault()
    setError(null)
    setInfo(null)
    setSubmitting(true)
    try {
      // Try signing in first. If there's no account yet, fall back to creating
      // one — Firebase's email-enumeration protection means we can't reliably
      // ask up front whether the account already exists.
      await signInWithEmailAndPassword(auth, email, password)
    } catch {
      try {
        await createUserWithEmailAndPassword(auth, email, password)
      } catch (createErr) {
        setError(
          createErr.code === 'auth/email-already-in-use'
            ? 'Incorrect email or password.'
            : friendlyAuthError(createErr)
        )
      }
    } finally {
      setSubmitting(false)
    }
  }

  async function handleForgotPassword() {
    setError(null)
    setInfo(null)
    if (!email) {
      setError('Enter your email above first, then click "Forgot password?".')
      return
    }
    try {
      await sendPasswordResetEmail(auth, email)
      setInfo('Password reset email sent — check your inbox.')
    } catch (err) {
      setError(friendlyAuthError(err))
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>Daily Expense Tracker</h1>
        <p className="login-subtitle">Sign in to track your expenses</p>

        {error && <div className="login-error">{error}</div>}
        {info && <div className="login-info">{info}</div>}

        <button type="button" className="google-button" onClick={handleGoogleSignIn}>
          Sign in with Google
        </button>

        <div className="login-divider">
          <span>or</span>
        </div>

        <form onSubmit={handleEmailSubmit} className="login-form">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
          />
          <button type="submit" disabled={submitting}>
            {submitting ? 'Please wait…' : 'Continue'}
          </button>
        </form>

        <button type="button" className="link-button" onClick={handleForgotPassword}>
          Forgot password?
        </button>

        <p className="login-hint">
          New here? Just enter an email and password above — we'll create your account.
        </p>
      </div>
    </div>
  )
}
