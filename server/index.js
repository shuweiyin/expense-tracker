import 'dotenv/config';
import app from './app.js';

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Expense tracker API running at http://localhost:${PORT}`);
});
