import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/drizzle/schema";

const connectionString = process.env.DATABASE_URL!;

// `max` war bisher implizit auf
// den postgres.js-Default (10) gesetzt. Explizit dokumentiert, damit bei
// künftigen Änderungen (z.B. mehr parallele Next.js-Instanzen oder ein
// niedrigeres Postgres max_connections) bewusst entschieden wird, statt den
// Default stillschweigend zu übernehmen. Aktuell: max_connections=100 in
// Postgres, davon ~10 durch diesen Pool belegt (siehe H5-Audit-Befund) -
// bei einer einzelnen Next.js-Instanz unkritisch.
const client = postgres(connectionString, { prepare: false, max: 10 });
export const db = drizzle(client, { schema });
