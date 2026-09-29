import { useEffect, useState } from 'react'
import './App.css'
import Login from './Login.jsx'
import { useAuth } from './AuthContext.jsx'

const TYPES = ['asset', 'liability', 'equity', 'income', 'expense']
const TYPE_LABELS = {
  asset: 'Assets',
  liability: 'Liabilities',
  equity: 'Equity',
  income: 'Income',
  expense: 'Expenses',
}

const cents = (value) => Math.round(Number(value || 0) * 100)
const money = (c) =>
  (c < 0 ? '-' : '') + '$' + (Math.abs(c) / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

// Assets and expenses grow with debits; everything else grows with credits.
const balanceOf = (a) =>
  a.type === 'asset' || a.type === 'expense' ? a.debit - a.credit : a.credit - a.debit

const emptyLine = () => ({ account_id: '', debit: '', credit: '' })
const today = () => new Date().toISOString().slice(0, 10)
const emptyForm = () => ({
  date: today(),
  description: '',
  lines: [emptyLine(), emptyLine()],
})

function App() {
  const { user, loading: authLoading, signOut } = useAuth()

  if (authLoading) {
    return <p className="status-text">Loading…</p>
  }

  if (!user) {
    return <Login />
  }

  return <Ledger user={user} signOut={signOut} />
}

function Ledger({ user, signOut }) {
  const [accounts, setAccounts] = useState([])
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('journal')
  const [form, setForm] = useState(emptyForm)
  const [newAccount, setNewAccount] = useState({ name: '', type: 'expense' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    load()
  }, [])

  async function api(path, options = {}) {
    const token = await user.getIdToken()
    const res = await fetch(`/api/${path}`, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        Authorization: `Bearer ${token}`,
      },
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || `Request failed (${res.status})`)
    }
    return res.status === 204 ? null : res.json()
  }

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const accts = await api('accounts')
      const txs = await api('transactions')
      setAccounts(accts)
      setTransactions(txs)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function setLine(index, patch) {
    setForm((f) => ({
      ...f,
      lines: f.lines.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    }))
  }

  const totalDebit = form.lines.reduce((s, l) => s + cents(l.debit), 0)
  const totalCredit = form.lines.reduce((s, l) => s + cents(l.credit), 0)
  const balanced = totalDebit > 0 && totalDebit === totalCredit

  async function handleSubmit(e) {
    e.preventDefault()
    if (!balanced) return
    const entries = form.lines
      .filter((l) => l.account_id && (cents(l.debit) || cents(l.credit)))
      .map((l) => ({
        account_id: Number(l.account_id),
        debit: cents(l.debit),
        credit: cents(l.credit),
      }))

    setSaving(true)
    setError(null)
    try {
      await api('transactions', {
        method: 'POST',
        body: JSON.stringify({ date: form.date, description: form.description, entries }),
      })
      setForm(emptyForm())
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id) {
    setError(null)
    try {
      await api(`transactions/${id}`, { method: 'DELETE' })
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleAddAccount(e) {
    e.preventDefault()
    setError(null)
    try {
      await api('accounts', { method: 'POST', body: JSON.stringify(newAccount) })
      setNewAccount({ name: '', type: newAccount.type })
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  const sum = (type) =>
    accounts.filter((a) => a.type === type).reduce((s, a) => s + balanceOf(a), 0)
  const netWorth = sum('asset') - sum('liability')
  const tbDebit = accounts.reduce((s, a) => s + a.debit, 0)
  const tbCredit = accounts.reduce((s, a) => s + a.credit, 0)

  return (
    <div className="page">
      <div className="page-header">
        <h1>Double-Entry Ledger</h1>
        <div className="user-bar">
          <span className="user-name">{user.displayName || user.email}</span>
          <button type="button" className="secondary" onClick={signOut}>
            Sign out
          </button>
        </div>
      </div>

      <div className="total-card">
        <span className="total-label">Net worth</span>
        <span className="total-amount">{money(netWorth)}</span>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="tabs">
        <button
          type="button"
          className={tab === 'journal' ? 'active' : ''}
          onClick={() => setTab('journal')}
        >
          Journal
        </button>
        <button
          type="button"
          className={tab === 'accounts' ? 'active' : ''}
          onClick={() => setTab('accounts')}
        >
          Accounts
        </button>
      </div>

      {loading ? (
        <p className="status-text">Loading…</p>
      ) : tab === 'journal' ? (
        <>
          <form className="expense-form" onSubmit={handleSubmit}>
            <h2>New journal entry</h2>
            <div className="entry-head">
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                required
              />
              <input
                type="text"
                placeholder="Description"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <div className="line-grid line-header">
              <span>Account</span>
              <span>Debit</span>
              <span>Credit</span>
              <span />
            </div>
            {form.lines.map((line, i) => (
              <div className="line-grid" key={i}>
                <select
                  value={line.account_id}
                  onChange={(e) => setLine(i, { account_id: e.target.value })}
                  required
                >
                  <option value="">Select account…</option>
                  {TYPES.map((type) => (
                    <optgroup key={type} label={TYPE_LABELS[type]}>
                      {accounts
                        .filter((a) => a.type === type)
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </select>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={line.debit}
                  onChange={(e) => setLine(i, { debit: e.target.value, credit: '' })}
                />
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={line.credit}
                  onChange={(e) => setLine(i, { credit: e.target.value, debit: '' })}
                />
                <button
                  type="button"
                  className="icon-btn"
                  disabled={form.lines.length <= 2}
                  onClick={() =>
                    setForm({ ...form, lines: form.lines.filter((_, j) => j !== i) })
                  }
                  aria-label="Remove line"
                >
                  ×
                </button>
              </div>
            ))}
            <div className="line-grid line-total">
              <span>
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => setForm({ ...form, lines: [...form.lines, emptyLine()] })}
                >
                  + Add line
                </button>
              </span>
              <span>{money(totalDebit)}</span>
              <span>{money(totalCredit)}</span>
              <span />
            </div>
            <p className={balanced ? 'balance-ok' : 'balance-bad'}>
              {balanced
                ? 'Balanced'
                : `Out of balance by ${money(Math.abs(totalDebit - totalCredit))}`}
            </p>
            <div className="form-actions">
              <button type="submit" disabled={saving || !balanced}>
                Post entry
              </button>
            </div>
          </form>

          {transactions.length === 0 ? (
            <p className="status-text">No journal entries yet.</p>
          ) : (
            <ul className="expense-list">
              {transactions.map((t) => (
                <li key={t.id} className="journal-item">
                  <div className="journal-head">
                    <span className="expense-date">{t.date}</span>
                    <span className="journal-desc">{t.description}</span>
                    <button
                      type="button"
                      className="danger small"
                      onClick={() => handleDelete(t.id)}
                    >
                      Delete
                    </button>
                  </div>
                  <table className="ledger-table">
                    <tbody>
                      {t.entries.map((e, i) => (
                        <tr key={i}>
                          <td className={e.credit ? 'indent' : ''}>{e.account_name}</td>
                          <td className="num">{e.debit ? money(e.debit) : ''}</td>
                          <td className="num">{e.credit ? money(e.credit) : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          <table className="ledger-table accounts-table">
            <thead>
              <tr>
                <th>Account</th>
                <th className="num">Debit</th>
                <th className="num">Credit</th>
                <th className="num">Balance</th>
              </tr>
            </thead>
            {TYPES.map((type) => (
              <tbody key={type}>
                <tr className="group-row">
                  <td colSpan="3">{TYPE_LABELS[type]}</td>
                  <td className="num">{money(sum(type))}</td>
                </tr>
                {accounts
                  .filter((a) => a.type === type)
                  .map((a) => (
                    <tr key={a.id}>
                      <td className="indent">{a.name}</td>
                      <td className="num">{a.debit ? money(a.debit) : ''}</td>
                      <td className="num">{a.credit ? money(a.credit) : ''}</td>
                      <td className="num">{money(balanceOf(a))}</td>
                    </tr>
                  ))}
              </tbody>
            ))}
            <tfoot>
              <tr>
                <td>Trial balance</td>
                <td className="num">{money(tbDebit)}</td>
                <td className="num">{money(tbCredit)}</td>
                <td className="num">{tbDebit === tbCredit ? '✓' : '✗'}</td>
              </tr>
            </tfoot>
          </table>

          <form className="expense-form" onSubmit={handleAddAccount}>
            <h2>Add account</h2>
            <div className="entry-head">
              <input
                type="text"
                placeholder="Account name"
                value={newAccount.name}
                onChange={(e) => setNewAccount({ ...newAccount, name: e.target.value })}
                required
              />
              <select
                value={newAccount.type}
                onChange={(e) => setNewAccount({ ...newAccount, type: e.target.value })}
              >
                {TYPES.map((type) => (
                  <option key={type} value={type}>
                    {TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-actions">
              <button type="submit">Add account</button>
            </div>
          </form>
        </>
      )}
    </div>
  )
}

export default App
