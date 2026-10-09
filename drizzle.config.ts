import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env.local" });

// DB_TARGET=test points migrations at the Neon test branch
const url = process.env.DB_TARGET === "test" ? process.env.DATABASE_URL_TEST : process.env.DATABASE_URL;

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  casing: "snake_case",
  dbCredentials: { url: url ?? "" },
});
