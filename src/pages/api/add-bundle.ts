import type { NextApiRequest, NextApiResponse } from "next";
import { GetProductDetailsDocument } from "../../../generated/graphql";
import { createClient } from "../../lib/create-graphql-client";
import { DEFAULT_CHANNEL } from "../../const";
import { apl } from "../../saleor-app";

type SuccessfulResponse = {
  message: string;
  productData: any;
};

type ErrorResponse = {
  errorMessage: string;
};

export type AddBundleResponseData = SuccessfulResponse | ErrorResponse;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<AddBundleResponseData>
) {
  // Add CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Saleor-Domain");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  console.info("Add bundle API has been called");

  const saleorApiUrl = req.headers["saleor-domain"] as string;
  if (!saleorApiUrl) {
    return res.status(400).json({ errorMessage: "Saleor-Domain header is required" });
  }

  // Get auth data directly using full API URL
  const authData = await apl.get(saleorApiUrl);
  if (!authData) {
    return res.status(400).json({
      errorMessage: `No auth data found for ${saleorApiUrl}. Is the app installed?`,
    });
  }

  console.log("Auth data found:", {
    saleorApiUrl: authData.saleorApiUrl,
    appId: authData.appId,
    tokenPresent: !!authData.token,
    tokenLength: authData.token?.length || 0,
    actualToken: authData.token // Show actual token for debugging
  });

  const client = createClient(authData.saleorApiUrl, authData.token);

  // Validate incoming data
  const { product_id, bundle_quantity, variants } = req.body;

  if (!product_id) {
    return res.status(400).json({ errorMessage: "product_id is required" });
  }

  if (!bundle_quantity) {
    return res.status(400).json({ errorMessage: "bundle_quantity is required" });
  }

  if (!variants || !Array.isArray(variants)) {
    return res.status(400).json({ errorMessage: "variants array is required" });
  }

  console.log("Request data:", { product_id, bundle_quantity, variants });

  try {
    // Query product details using direct fetch instead of URQL
    const query = `
      query GetProductDetails($id: ID!, $channel: String!) {
        product(id: $id, channel: $channel) {
          id
          name
          metadata {
            key
            value
          }
        }
      }
    `;

    const response = await fetch(authData.saleorApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization-Bearer': authData.token,
      },
      body: JSON.stringify({
        query,
        variables: {
          id: product_id,
          channel: DEFAULT_CHANNEL
        }
      })
    });

    const result = await response.json();

    if (result.errors) {
      console.error("GraphQL Errors:", result.errors);
      return res.status(400).json({
        errorMessage: `GraphQL errors: ${result.errors.map((e: any) => e.message).join(', ')}`,
      });
    }

    const product = result.data?.product;
    if (!product) {
      return res.status(404).json({ errorMessage: "Product not found" });
    }

    // Log the response
    console.log("Product Details Response:", JSON.stringify(product, null, 2));

    // Validate pricing method - only one should be present
    const pricingMethods = ['discountedSum', 'fixedPrice', 'noDiscount'];
    const presentPricingMethods = pricingMethods.filter(method => 
      product.metadata?.some((m: any) => m.key === method)
    );

    console.log("Present pricing methods:", presentPricingMethods);

    if (presentPricingMethods.length === 0) {
      return res.status(400).json({
        errorMessage: "Pricing is not set for this bundle"
      });
    }

    if (presentPricingMethods.length > 1) {
      return res.status(400).json({
        errorMessage: "Pricing is not set for this bundle - multiple pricing methods found",
        foundMethods: presentPricingMethods
      });
    }

    // Validate required variants
    const requiredMeta = product.metadata?.find((m: any) => m.key === 'required');
    if (requiredMeta?.value) {
      const requiredVariants = JSON.parse(requiredMeta.value);
      console.log("Required variants:", requiredVariants);
      console.log("Requested variants:", variants);
      
      // Check if all required variants are present in the request
      const missingRequired = requiredVariants.filter((reqVariant: string) => 
        !variants.includes(reqVariant)
      );
      
      if (missingRequired.length > 0) {
        return res.status(400).json({
          errorMessage: "Required variant is missing",
          missingVariants: missingRequired
        });
      }
    }

    // Use variants from the request
    console.log("Processing variants from request:", variants);

    // Fetch details for each variant
    const variantQuery = `
      query GetVariantPrice($id: ID!, $channel: String!) {
        productVariant(id: $id, channel: $channel) {
          id
          name
          sku
          pricing {
            price {
              gross {
                amount
                currency
              }
            }
          }
        }
      }
    `;

    const variantDetails = [];
    for (const variantId of variants) {
      try {
        const variantResponse = await fetch(authData.saleorApiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization-Bearer': authData.token,
          },
          body: JSON.stringify({
            query: variantQuery,
            variables: {
              id: variantId,
              channel: DEFAULT_CHANNEL
            }
          })
        });

        const variantResult = await variantResponse.json();
        
        if (variantResult.data?.productVariant) {
          variantDetails.push(variantResult.data.productVariant);
          console.log(`Variant ${variantId} Details:`, JSON.stringify(variantResult.data.productVariant, null, 2));
        } else {
          console.log(`Variant ${variantId} not found or error:`, variantResult.errors);
        }
      } catch (error) {
        console.error(`Error fetching variant ${variantId}:`, error);
      }
    }

    return res.status(200).json({ 
      message: "Bundle processed successfully",
      productData: product,
      variantDetails: variantDetails
    });

  } catch (error) {
    console.error("Unexpected error:", error);
    return res.status(500).json({ 
      errorMessage: "Internal server error" 
    });
  }
}
