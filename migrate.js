import fs from "fs";
import { pool } from "./db.js";

const sql = fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

try {
  await pool.query(sql);
  console.log("Schema applied.");
} catch (err) {
  console.error("Migration failed:", err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
