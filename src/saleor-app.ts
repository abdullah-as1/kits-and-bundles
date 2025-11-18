import { SaleorApp } from "@saleor/app-sdk/saleor-app";
import { APL, FileAPL, UpstashAPL } from "@saleor/app-sdk/APL";
import { PostgresAPL } from "./lib/postgres-apl";

/**
 * By default auth data are stored in the `.auth-data.json` (FileAPL).
 * For multi-tenant applications and deployments please use UpstashAPL or PostgresAPL.
 *
 * To read more about storing auth data, read the
 * [APL documentation](https://github.com/saleor/saleor-app-sdk/blob/main/docs/apl.md)
 */
export let apl: APL;
switch (process.env.APL) {
  case "postgres":
    const appName = process.env.APP_NAME || "kits-and-bundles";
    apl = new PostgresAPL(appName);
    console.log("=== USING POSTGRES APL ===");
    console.log("App Name:", appName);
    console.log("DB_HOST:", process.env.DB_HOST);
    console.log("DB_NAME:", process.env.DB_NAME);
    console.log("DB_USER:", process.env.DB_USER);
    console.log("DB_PASSWORD:", process.env.DB_PASSWORD ? "***" : "Not set");
    break;
  default:
    apl = new FileAPL();
    console.log("=== USING FILE APL (Development) ===");
}

export const saleorApp = new SaleorApp({
  apl,
});
