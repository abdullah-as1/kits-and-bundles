import { createAppRegisterHandler } from "@saleor/app-sdk/handlers/next";
import { saleorApp } from "../../saleor-app";
import { saveStoreInstallation } from "../../lib/store-registry";
import type { NextApiRequest, NextApiResponse } from "next";

/**
 * Required endpoint, called by Saleor to install app.
 * It will exchange tokens with app, so saleorApp.apl will contain token
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    return await createAppRegisterHandler({
      apl: saleorApp.apl,
      onRequestVerified: async (req, { authData }) => {
        console.log("=== APP INSTALLATION DEBUG ===");
        console.log("Request method:", req.method);
        console.log("Request URL:", req.url);
        console.log("Store domain:", authData.domain);
        console.log("Store API URL:", authData.saleorApiUrl);
        console.log("Token:", authData.token ? "Present" : "Missing");
        console.log("Full auth data:", JSON.stringify(authData, null, 2));
        console.log("===============================");

        if (!authData.domain || !authData.saleorApiUrl) {
          throw new Error("Missing domain or Saleor API URL");
        }

        try {
          await saveStoreInstallation(authData.domain, authData.saleorApiUrl);
          console.log("Store installation saved successfully");
        } catch (error) {
          console.error("Failed to save store installation:", error);
          throw error;
        }
      },
    })(req, res);
  } catch (error) {
    console.error("=== REGISTRATION ERROR ===");
    console.error(error);
    return res.status(500).json({ error: "App registration failed" });
  }
}

