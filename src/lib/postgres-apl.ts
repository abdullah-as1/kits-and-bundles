import { APL, AuthData, AplReadyResult, AplConfiguredResult } from "@saleor/app-sdk/APL";
import { getPool } from "./database";

export class PostgresAPL implements APL {
  private appName: string;

  constructor(appName: string = "kits-and-bundles") {
    this.appName = appName;
  }

  async get(saleorApiUrl: string): Promise<AuthData | undefined> {
    console.log(`=== PostgresAPL GET ===`);
    console.log(`Looking for tenant: ${saleorApiUrl}, app: ${this.appName}`);

    try {
      const pool = getPool();

      const result = await pool.query(
        "SELECT configurations FROM saleor_app_configuration WHERE tenant = $1 AND app_name = $2 AND is_active = TRUE",
        [saleorApiUrl, this.appName]
      );

      if (result.rows.length === 0) {
        console.log(`No active auth data found for tenant: ${saleorApiUrl}, app: ${this.appName}`);
        return undefined;
      }

      const authData = result.rows[0].configurations as AuthData;
      console.log(`Auth data found for tenant: ${saleorApiUrl}, app: ${this.appName}`);
      console.log(`Token present: ${authData.token ? "Yes" : "No"}`);
      return authData;
    } catch (error) {
      console.error(`PostgresAPL GET error for ${saleorApiUrl}, app: ${this.appName}:`, error);
      throw error;
    }
  }

  async set(authData: AuthData): Promise<void> {
    console.log(`=== PostgresAPL SET ===`);
    console.log(`Setting auth data for tenant: ${authData.saleorApiUrl}, app: ${this.appName}`);
    console.log(`App ID: ${authData.appId}`);
    console.log(`Token present: ${authData.token ? "Yes" : "No"}`);

    try {
      const pool = getPool();

      await pool.query(
        `INSERT INTO saleor_app_configuration (tenant, app_name, configurations, updated_at, is_active) 
         VALUES ($1, $2, $3, NOW(), TRUE) 
         ON CONFLICT (tenant, app_name) 
         DO UPDATE SET configurations = $3, updated_at = NOW(), is_active = TRUE`,
        [authData.saleorApiUrl, this.appName, JSON.stringify(authData)]
      );

      console.log(
        `Auth data saved and activated for tenant: ${authData.saleorApiUrl}, app: ${this.appName}`
      );
    } catch (error) {
      console.error(
        `PostgresAPL SET error for ${authData.saleorApiUrl}, app: ${this.appName}:`,
        error
      );
      throw error;
    }
  }

  async delete(saleorApiUrl: string): Promise<void> {
    console.log(`=== PostgresAPL DELETE ===`);
    console.log(`Deleting auth data for tenant: ${saleorApiUrl}, app: ${this.appName}`);

    try {
      const pool = getPool();

      const result = await pool.query(
        "UPDATE saleor_app_configuration SET is_active = FALSE, updated_at = NOW() WHERE tenant = $1 AND app_name = $2",
        [saleorApiUrl, this.appName]
      );

      console.log(
        `Soft deleted ${result.rowCount} rows for tenant: ${saleorApiUrl}, app: ${this.appName}`
      );
    } catch (error) {
      console.error(`PostgresAPL DELETE error for ${saleorApiUrl}, app: ${this.appName}:`, error);
      throw error;
    }
  }

  async activate(saleorApiUrl: string): Promise<void> {
    console.log(`=== PostgresAPL ACTIVATE ===`);
    console.log(`Activating app for tenant: ${saleorApiUrl}, app: ${this.appName}`);

    try {
      const pool = getPool();

      const result = await pool.query(
        "UPDATE saleor_app_configuration SET is_active = TRUE, updated_at = NOW() WHERE tenant = $1 AND app_name = $2",
        [saleorApiUrl, this.appName]
      );

      console.log(
        `Activated ${result.rowCount} rows for tenant: ${saleorApiUrl}, app: ${this.appName}`
      );
    } catch (error) {
      console.error(`PostgresAPL ACTIVATE error for ${saleorApiUrl}, app: ${this.appName}:`, error);
      throw error;
    }
  }

  async getAll(): Promise<AuthData[]> {
    console.log(`=== PostgresAPL GET_ALL ===`);
    console.log(`Getting all auth data for app: ${this.appName}`);

    try {
      const pool = getPool();

      const result = await pool.query(
        "SELECT configurations FROM saleor_app_configuration WHERE app_name = $1 AND is_active = TRUE",
        [this.appName]
      );

      const authDataList = result.rows.map((row) => row.configurations as AuthData);

      console.log(`Retrieved ${authDataList.length} auth data entries for app: ${this.appName}`);
      return authDataList;
    } catch (error) {
      console.error(`PostgresAPL GET_ALL error for app: ${this.appName}:`, error);
      throw error;
    }
  }

  async isReady(): Promise<AplReadyResult> {
    try {
      const pool = getPool();
      await pool.query("SELECT 1");
      return { ready: true };
    } catch (error) {
      console.error("PostgresAPL readiness check failed:", error);
      return {
        ready: false,
        error: error instanceof Error ? error : new Error("Unknown database error"),
      };
    }
  }

  async isConfigured(): Promise<AplConfiguredResult> {
    const requiredEnvVars = ["DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD"];
    const missingVars = requiredEnvVars.filter((varName) => !process.env[varName]);

    if (missingVars.length > 0) {
      return {
        configured: false,
        error: new Error(`Missing required environment variables: ${missingVars.join(", ")}`),
      };
    }

    return { configured: true };
  }
}
