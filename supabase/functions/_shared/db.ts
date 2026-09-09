// The single Postgres connection used by every function.
//
// app_private is not exposed through the Data API, so supabase-js is no help
// here — the functions talk SQL directly. Connections go through the
// transaction pooler because Edge Functions are short-lived and would otherwise
// exhaust direct connections; prepared statements are disabled since the pooler
// hands out a different backend per transaction.
import postgres from "npm:postgres@3.4.5";
import { env } from "./env.ts";

const connectionString = env("DATABASE_URL") || env("SUPABASE_DB_URL");

if (!connectionString) {
  throw new Error("DATABASE_URL (or SUPABASE_DB_URL) must be set");
}

export const sql = postgres(connectionString, {
  prepare: false,
  max: 3,
  idle_timeout: 20,
  connect_timeout: 10,
  types: {
    // Every primary key here is `bigint generated always as identity`, so int8
    // shows up in almost every response. postgres.BigInt would return them as
    // JavaScript BigInt — which JSON.stringify refuses to serialise, turning
    // any response carrying an id into a 500. These ids are identity counters
    // nowhere near 2^53, so plain numbers are both safe and what clients want.
    bigint: {
      to: 20,
      from: [20],
      serialize: (value: number | bigint) => value.toString(),
      parse: (value: string) => Number(value),
    },
  },
  transform: { undefined: null },
});
