import express from 'express';
import cors from 'cors';
import { createClient } from '@libsql/client';
import { requireAuth } from './auth.js';

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Double-entry schema. All money is stored as integer cents.
await db.batch(
  [
    `CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('asset','liability','equity','income','expense')),
      UNIQUE (user_id, name)
    )`,
    `CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      date TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT ''
    )`,
    `CREATE TABLE IF NOT EXISTS entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      debit INTEGER NOT NULL DEFAULT 0 CHECK (debit >= 0),
      credit INTEGER NOT NULL DEFAULT 0 CHECK (credit >= 0),
      CHECK ((debit = 0) <> (credit = 0))
    )`,
    'CREATE INDEX IF NOT EXISTS idx_entries_tx ON entries(transaction_id)',
    'CREATE INDEX IF NOT EXISTS idx_entries_account ON entries(account_id)',
  ],
  'write'
);

const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'income', 'expense'];

const DEFAULT_ACCOUNTS = [
  ['Cash', 'asset'],
  ['Bank', 'asset'],
  ['Credit Card', 'liability'],
  ['Opening Balance', 'equity'],
  ['Salary', 'income'],
  ['Food', 'expense'],
  ['Transport', 'expense'],
  ['Other Expenses', 'expense'],
];

const toCents = (n) => Math.round(Number(n) * 100);

// Runs once per user: create a chart of accounts, and convert any rows from the
// legacy single-entry `expenses` table into journal entries (Dr expense / Cr Cash).
async function ensureSetup(userId) {
  const { rows } = await db.execute({
    sql: 'SELECT COUNT(*) AS count FROM accounts WHERE user_id = ?',
    args: [userId],
  });
  if (rows[0].count > 0) return;

  const tx = await db.transaction('write');
  try {
    for (const [name, type] of DEFAULT_ACCOUNTS) {
      await tx.execute({
        sql: 'INSERT INTO accounts (user_id, name, type) VALUES (?, ?, ?)',
        args: [userId, name, type],
      });
    }

    const legacy = await tx
      .execute({
        sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'expenses'",
        args: [],
      })
      .then((r) => r.rows.length > 0);
    if (legacy) {
      const { rows: old } = await tx.execute({
        sql: 'SELECT amount, category, date, note FROM expenses WHERE user_id = ? ORDER BY id',
        args: [userId],
      });
      const { rows: accts } = await tx.execute({
        sql: 'SELECT id, name FROM accounts WHERE user_id = ?',
        args: [userId],
      });
      const idByName = Object.fromEntries(accts.map((a) => [a.name, a.id]));
      for (const e of old) {
        let expenseId = idByName[e.category];
        if (!expenseId) {
          const r = await tx.execute({
            sql: "INSERT INTO accounts (user_id, name, type) VALUES (?, ?, 'expense')",
            args: [userId, e.category],
          });
          expenseId = idByName[e.category] = Number(r.lastInsertRowid);
        }
        const cents = toCents(e.amount);
        if (cents <= 0) continue;
        const t = await tx.execute({
          sql: 'INSERT INTO transactions (user_id, date, description) VALUES (?, ?, ?)',
          args: [userId, e.date, e.note || e.category],
        });
        const txId = Number(t.lastInsertRowid);
        await tx.execute({
          sql: 'INSERT INTO entries (transaction_id, account_id, debit, credit) VALUES (?, ?, ?, 0)',
          args: [txId, expenseId, cents],
        });
        await tx.execute({
          sql: 'INSERT INTO entries (transaction_id, account_id, debit, credit) VALUES (?, ?, 0, ?)',
          args: [txId, idByName.Cash, cents],
        });
      }
    }
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  } finally {
    tx.close();
  }
}

const app = express();
app.use(cors());
app.use(express.json());
app.use('/api', requireAuth);

// Express 5 forwards rejected promises from async handlers to the error handler.
app.get('/api/accounts', async (req, res) => {
  await ensureSetup(req.userId);
  const { rows } = await db.execute({
    sql: `SELECT a.id, a.name, a.type,
                 COALESCE(SUM(e.debit), 0) AS debit,
                 COALESCE(SUM(e.credit), 0) AS credit
          FROM accounts a
          LEFT JOIN entries e ON e.account_id = a.id
          WHERE a.user_id = ?
          GROUP BY a.id
          ORDER BY a.id`,
    args: [req.userId],
  });
  res.json(rows);
});

app.post('/api/accounts', async (req, res) => {
  const name = String(req.body.name ?? '').trim();
  const { type } = req.body;
  if (!name || !ACCOUNT_TYPES.includes(type)) {
    return res.status(400).json({ error: 'name and a valid type are required' });
  }
  try {
    const r = await db.execute({
      sql: 'INSERT INTO accounts (user_id, name, type) VALUES (?, ?, ?)',
      args: [req.userId, name, type],
    });
    res.status(201).json({ id: Number(r.lastInsertRowid), name, type, debit: 0, credit: 0 });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'An account with that name already exists' });
    }
    throw err;
  }
});

app.get('/api/transactions', async (req, res) => {
  await ensureSetup(req.userId);
  const { rows: txs } = await db.execute({
    sql: 'SELECT id, date, description FROM transactions WHERE user_id = ? ORDER BY date DESC, id DESC',
    args: [req.userId],
  });
  const { rows: entries } = await db.execute({
    sql: `SELECT e.transaction_id, e.account_id, a.name AS account_name, e.debit, e.credit
          FROM entries e
          JOIN transactions t ON t.id = e.transaction_id
          JOIN accounts a ON a.id = e.account_id
          WHERE t.user_id = ?
          ORDER BY e.id`,
    args: [req.userId],
  });
  const byTx = new Map();
  for (const e of entries) {
    if (!byTx.has(e.transaction_id)) byTx.set(e.transaction_id, []);
    byTx.get(e.transaction_id).push({
      account_id: e.account_id,
      account_name: e.account_name,
      debit: e.debit,
      credit: e.credit,
    });
  }
  res.json(txs.map((t) => ({ ...t, entries: byTx.get(t.id) ?? [] })));
});

// Body: { date, description, entries: [{ account_id, debit, credit }] } with amounts in cents.
function validateTransaction(body) {
  const { date, entries } = body ?? {};
  if (!date) return 'date is required';
  if (!Array.isArray(entries) || entries.length < 2) {
    return 'a transaction needs at least two entries';
  }
  let debit = 0;
  let credit = 0;
  for (const e of entries) {
    const d = e.debit ?? 0;
    const c = e.credit ?? 0;
    if (!Number.isInteger(d) || !Number.isInteger(c) || d < 0 || c < 0) {
      return 'amounts must be non-negative integers (cents)';
    }
    if ((d === 0) === (c === 0)) {
      return 'each entry must have exactly one of debit or credit';
    }
    if (!Number.isInteger(e.account_id)) return 'each entry needs an account_id';
    debit += d;
    credit += c;
  }
  if (debit !== credit) return `debits (${debit}) must equal credits (${credit})`;
  return null;
}

app.post('/api/transactions', async (req, res) => {
  const problem = validateTransaction(req.body);
  if (problem) return res.status(400).json({ error: problem });

  const { date, entries } = req.body;
  const description = String(req.body.description ?? '').trim();
  const accountIds = [...new Set(entries.map((e) => e.account_id))];
  const { rows: owned } = await db.execute({
    sql: `SELECT id FROM accounts WHERE user_id = ? AND id IN (${accountIds.map(() => '?').join(',')})`,
    args: [req.userId, ...accountIds],
  });
  if (owned.length !== accountIds.length) {
    return res.status(400).json({ error: 'unknown account' });
  }

  const tx = await db.transaction('write');
  let txId;
  try {
    const t = await tx.execute({
      sql: 'INSERT INTO transactions (user_id, date, description) VALUES (?, ?, ?)',
      args: [req.userId, date, description],
    });
    txId = Number(t.lastInsertRowid);
    for (const e of entries) {
      await tx.execute({
        sql: 'INSERT INTO entries (transaction_id, account_id, debit, credit) VALUES (?, ?, ?, ?)',
        args: [txId, e.account_id, e.debit ?? 0, e.credit ?? 0],
      });
    }
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  } finally {
    tx.close();
  }
  res.status(201).json({ id: txId });
});

app.delete('/api/transactions/:id', async (req, res) => {
  const { id } = req.params;
  const { rows } = await db.execute({
    sql: 'SELECT id FROM transactions WHERE id = ? AND user_id = ?',
    args: [id, req.userId],
  });
  if (rows.length === 0) return res.status(404).json({ error: 'Transaction not found' });
  await db.batch(
    [
      { sql: 'DELETE FROM entries WHERE transaction_id = ?', args: [id] },
      { sql: 'DELETE FROM transactions WHERE id = ? AND user_id = ?', args: [id, req.userId] },
    ],
    'write'
  );
  res.status(204).end();
});

export default app;
