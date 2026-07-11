import { createApp } from "./http/app.js";
import { createDb } from "./db/connection.js";

const db = createDb(process.env.DB_PATH ?? "data.db");
const app = createApp(db);

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`ledger service listening on http://localhost:${port}`);
});
