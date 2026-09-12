import express from 'express';
import cors from 'cors';
import { createClient } from '@libsql/client';
import { requireAuth } from './auth.js';

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

await db.execute(`
  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    amount REAL NOT NULL,
    category TEXT NOT NULL,
    date TEXT NOT NULL,
    note TEXT
  )
`);

const { rows: columns } = await db.execute('PRAGMA table_info(expenses)');
const hasUserId = columns.some((col) => col.name === 'user_id');
if (!hasUserId) {
  await db.execute('ALTER TABLE expenses ADD COLUMN user_id TEXT');
}

const SEED = [
  [12.5, 'Food', '2026-06-01', 'Lunch'],
  [45, 'Transport', '2026-06-02', 'Taxi'],
  [8, 'Food', '2026-06-03', 'Coffee'],
];

async function seedIfEmpty(userId) {
  const { rows } = await db.execute({
    sql: 'SELECT COUNT(*) AS count FROM expenses WHERE user_id = ?',
    args: [userId],
  });
  if (rows[0].count > 0) return;
  for (const [amount, category, date, note] of SEED) {
    await db.execute({
      sql: 'INSERT INTO expenses (amount, category, date, note, user_id) VALUES (?, ?, ?, ?, ?)',
      args: [amount, category, date, note, userId],
    });
  }
}

const app = express();
app.use(cors());
app.use(express.json());
app.use('/api', requireAuth);

app.get('/api/expenses', async (req, res) => {
  await seedIfEmpty(req.userId);
  const { rows } = await db.execute({
    sql: 'SELECT * FROM expenses WHERE user_id = ? ORDER BY date DESC, id DESC',
    args: [req.userId],
  });
  res.json(rows);
});

app.post('/api/expenses', async (req, res) => {
  const { amount, category, date, note } = req.body;
  if (amount == null || !category || !date) {
    return res.status(400).json({ error: 'amount, category, and date are required' });
  }
  const result = await db.execute({
    sql: 'INSERT INTO expenses (amount, category, date, note, user_id) VALUES (?, ?, ?, ?, ?)',
    args: [amount, category, date, note ?? '', req.userId],
  });
  const { rows } = await db.execute({
    sql: 'SELECT * FROM expenses WHERE id = ? AND user_id = ?',
    args: [result.lastInsertRowid, req.userId],
  });
  res.status(201).json(rows[0]);
});

app.put('/api/expenses/:id', async (req, res) => {
  const { id } = req.params;
  const { rows: existingRows } = await db.execute({
    sql: 'SELECT * FROM expenses WHERE id = ? AND user_id = ?',
    args: [id, req.userId],
  });
  if (existingRows.length === 0) return res.status(404).json({ error: 'Expense not found' });

  const { amount, category, date, note } = req.body;
  if (amount == null || !category || !date) {
    return res.status(400).json({ error: 'amount, category, and date are required' });
  }
  await db.execute({
    sql: 'UPDATE expenses SET amount = ?, category = ?, date = ?, note = ? WHERE id = ? AND user_id = ?',
    args: [amount, category, date, note ?? '', id, req.userId],
  });
  const { rows } = await db.execute({
    sql: 'SELECT * FROM expenses WHERE id = ? AND user_id = ?',
    args: [id, req.userId],
  });
  res.json(rows[0]);
});

app.delete('/api/expenses/:id', async (req, res) => {
  const { id } = req.params;
  const { rows: existingRows } = await db.execute({
    sql: 'SELECT * FROM expenses WHERE id = ? AND user_id = ?',
    args: [id, req.userId],
  });
  if (existingRows.length === 0) return res.status(404).json({ error: 'Expense not found' });
  await db.execute({
    sql: 'DELETE FROM expenses WHERE id = ? AND user_id = ?',
    args: [id, req.userId],
  });
  res.status(204).end();
});

export default app;
