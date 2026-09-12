import { useEffect, useState } from 'react'
import './App.css'
import Login from './Login.jsx'
import { useAuth } from './AuthContext.jsx'

const API_URL = '/api/expenses'

const emptyForm = { amount: '', category: '', date: '', note: '' }

function App() {
  const { user, loading: authLoading, signOut } = useAuth()

  if (authLoading) {
    return <p className="status-text">Loading…</p>
  }

  if (!user) {
    return <Login />
  }

  return <ExpenseTracker user={user} signOut={signOut} />
}

function ExpenseTracker({ user, signOut }) {
  const [expenses, setExpenses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadExpenses()
  }, [])

  async function authedFetch(url, options = {}) {
    const token = await user.getIdToken()
    return fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${token}`,
      },
    })
  }

  async function loadExpenses() {
    setLoading(true)
    setError(null)
    try {
      const res = await authedFetch(API_URL)
      if (!res.ok) throw new Error('Failed to load expenses')
      const data = await res.json()
      setExpenses(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function startEdit(expense) {
    setEditingId(expense.id)
    setForm({
      amount: String(expense.amount),
      category: expense.category,
      date: expense.date,
      note: expense.note ?? '',
    })
  }

  function cancelEdit() {
    setEditingId(null)
    setForm(emptyForm)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.amount || !form.category || !form.date) return

    setSaving(true)
    setError(null)
    const payload = {
      amount: Number(form.amount),
      category: form.category,
      date: form.date,
      note: form.note,
    }

    try {
      const res = await authedFetch(
        editingId ? `${API_URL}/${editingId}` : API_URL,
        {
          method: editingId ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      )
      if (!res.ok) throw new Error('Failed to save expense')
      await loadExpenses()
      cancelEdit()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id) {
    setError(null)
    try {
      const res = await authedFetch(`${API_URL}/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete expense')
      setExpenses((prev) => prev.filter((expense) => expense.id !== id))
      if (editingId === id) cancelEdit()
    } catch (err) {
      setError(err.message)
    }
  }

  const total = expenses.reduce((sum, expense) => sum + expense.amount, 0)

  return (
    <div className="page">
      <div className="page-header">
        <h1>Daily Expense Tracker</h1>
        <div className="user-bar">
          <span className="user-name">{user.displayName || user.email}</span>
          <button type="button" className="secondary" onClick={signOut}>
            Sign out
          </button>
        </div>
      </div>

      <div className="total-card">
        <span className="total-label">Total</span>
        <span className="total-amount">${total.toFixed(2)}</span>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <form className="expense-form" onSubmit={handleSubmit}>
        <h2>{editingId ? 'Edit expense' : 'Add expense'}</h2>
        <div className="form-row">
          <input
            type="number"
            step="0.01"
            placeholder="Amount"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            required
          />
          <input
            type="text"
            placeholder="Category"
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            required
          />
          <input
            type="date"
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
            required
          />
          <input
            type="text"
            placeholder="Note (optional)"
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
          />
        </div>
        <div className="form-actions">
          <button type="submit" disabled={saving}>
            {editingId ? 'Save changes' : 'Add expense'}
          </button>
          {editingId && (
            <button type="button" className="secondary" onClick={cancelEdit}>
              Cancel
            </button>
          )}
        </div>
      </form>

      {loading ? (
        <p className="status-text">Loading expenses…</p>
      ) : expenses.length === 0 ? (
        <p className="status-text">No expenses yet.</p>
      ) : (
        <ul className="expense-list">
          {expenses.map((expense) => (
            <li key={expense.id} className="expense-item">
              <div className="expense-main">
                <span className="expense-amount">
                  ${expense.amount.toFixed(2)}
                </span>
                <span className="expense-category">{expense.category}</span>
                <span className="expense-date">{expense.date}</span>
                {expense.note && (
                  <span className="expense-note">{expense.note}</span>
                )}
              </div>
              <div className="expense-actions">
                <button type="button" onClick={() => startEdit(expense)}>
                  Edit
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => handleDelete(expense.id)}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default App
