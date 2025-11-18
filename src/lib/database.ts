import { Pool } from "pg";

let pool: Pool | null = null;

export const getPool = (): Pool => {
  if (!pool) {
    pool = new Pool({
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT || "5432"),
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      ssl: {
        rejectUnauthorized: false,
      },
    });

    pool.on("error", (err) => {
      console.error("PostgreSQL pool error:", err);
    });
  }

  return pool;
};

export const initializeDatabase = async (): Promise<void> => {
  const pool = getPool();

  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS saleor_app_configuration (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant TEXT NOT NULL,              
      app_name TEXT NOT NULL,            
      configurations JSONB NOT NULL,     
      is_active BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
  );`;

  try {
    await pool.query(createTableQuery);
    console.log("Database table initialized successfully");
  } catch (error) {
    console.error("Failed to initialize database table:", error);
    throw error;
  }
};
