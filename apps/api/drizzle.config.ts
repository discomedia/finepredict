import { defineConfig } from "drizzle-kit";
import "./src/load-environment.js";

export default defineConfig({
  dialect: "postgresql",
  out: "./drizzle",
  schema: "./src/database/schema.ts",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://invalid/invalid",
  },
});
