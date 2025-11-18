import type { NextApiRequest, NextApiResponse } from "next";
import {
  AddLinesToCheckoutDocument,
  CheckoutDetailsFragment,
  CreateExampleCheckoutDocument,
  GetCheckoutDetailsDocument,
  GetVariantDetailsDocument,
} from "../../../generated/graphql";
import { createClient } from "../../lib/create-graphql-client";
import { getVariantPrice } from "../../lib/get-variant-price";
import { DEFAULT_CHANNEL } from "../../const";
import { apl } from "../../saleor-app";

type SuccessfulResponse = {
  checkout: CheckoutDetailsFragment;
};

type ErrorResponse = {
  errorMessage: string;
};

export type AddToCartResponseData = SuccessfulResponse | ErrorResponse;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<AddToCartResponseData>
) {
  // Add CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Saleor-Domain");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  console.info("Add to cart has been called");

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

  const client = createClient(authData.saleorApiUrl, authData.token);

  // Validate incoming data
  const variantId = req.body.variantId as string;
  if (!variantId) {
    return res.status(400).json({ errorMessage: "variantId has not been provided" });
  }

  const quantity = req.body.quantity;
  if (!quantity) {
    return res.status(400).json({ errorMessage: "quantity has not been provided" });
  }

  const checkoutId = req.body.checkoutId as string | undefined;

  console.debug("Incoming data validated");

  const variantQuery = await client
    .query(GetVariantDetailsDocument, { channel: DEFAULT_CHANNEL, id: variantId })
    .toPromise();

  if (variantQuery.error) {
    return res.status(400).json({
      errorMessage: `Could not fetch variant ${variantId}. Error: ${variantQuery.error.message}`,
    });
  }

  const productVariant = variantQuery.data?.productVariant;
  if (!productVariant) {
    return res.status(400).json({ errorMessage: "Product variant not found" });
  }

  if (!checkoutId) {
    console.log("No checkoutId provided - creating new checkout");

    const price = getVariantPrice(
      quantity,
      productVariant.quantityPricing,
      productVariant.pricing?.price?.gross.amount
    );

    const createCheckoutMutation = await client
      .mutation(CreateExampleCheckoutDocument, {
        input: {
          channel: DEFAULT_CHANNEL,
          lines: [{ quantity, variantId, price }],
        },
      })
      .toPromise();

    if (createCheckoutMutation.error || !createCheckoutMutation.data?.checkoutCreate?.checkout) {
      return res.status(400).json({
        errorMessage: `Could not create checkout. Error: ${createCheckoutMutation.error?.message}`,
      });
    }

    return res.status(200).json({ checkout: createCheckoutMutation.data.checkoutCreate.checkout });
  }

  console.log("Adding to existing checkout");

  const checkoutQuery = await client
    .query(GetCheckoutDetailsDocument, { id: checkoutId })
    .toPromise();

  const checkout = checkoutQuery.data?.checkout;
  if (checkoutQuery.error || !checkout) {
    return res.status(400).json({
      errorMessage: `Could not fetch checkout. Error: ${checkoutQuery.error?.message}`,
    });
  }

  const existingLine = checkout.lines.find((line) => line.variant.id === variantId);
  const combinedQuantity = existingLine ? existingLine.quantity + quantity : quantity;

  const price = getVariantPrice(
    combinedQuantity,
    productVariant.quantityPricing,
    productVariant.pricing?.price?.gross.amount
  );

  const addLinesMutation = await client
    .mutation(AddLinesToCheckoutDocument, {
      id: checkoutId,
      lines: [{ quantity, variantId, price }],
    })
    .toPromise();

  const updatedCheckout = addLinesMutation.data?.checkoutLinesAdd?.checkout;
  if (addLinesMutation.error || !updatedCheckout) {
    return res.status(400).json({
      errorMessage: `Failed to add lines. Error: ${addLinesMutation.error?.message}`,
    });
  }

  return res.status(200).json({ checkout: updatedCheckout });
}
