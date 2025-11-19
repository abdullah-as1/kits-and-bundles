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
  const { product_id, bundle_quantity, variants, checkoutId } = req.body;

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

    // Validate quantity metadata for all requested variants
    const quantityMeta = product.metadata?.find((m: any) => m.key === 'quantity');
    const quantityMapping = quantityMeta?.value ? JSON.parse(quantityMeta.value) : {};
    
    const missingQuantityVariants = variants.filter((variantId: string) => 
      !quantityMapping.hasOwnProperty(variantId)
    );
    
    if (missingQuantityVariants.length > 0) {
      return res.status(400).json({
        errorMessage: `The quantity for variant(s) ${missingQuantityVariants.join(', ')} is not set`,
        missingQuantityVariants: missingQuantityVariants
      });
    }

    const pricingMethod = presentPricingMethods[0];
    
    if (pricingMethod === 'noDiscount') {
      // Fetch variant details and prices
      const variantQuery = `
        query GetVariantPrice($id: ID!, $channel: String!) {
          productVariant(id: $id, channel: $channel) {
            id
            name
            quantityAvailable
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
        const variantResponse = await fetch(authData.saleorApiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization-Bearer': authData.token,
          },
          body: JSON.stringify({
            query: variantQuery,
            variables: { id: variantId, channel: DEFAULT_CHANNEL }
          })
        });

        const variantResult = await variantResponse.json();
        if (variantResult.data?.productVariant) {
          const variant = variantResult.data.productVariant;
          
          // Check stock availability
          if (variant.quantityAvailable === 0) {
            return res.status(400).json({ errorMessage: "Out of stock" });
          }
          
          variantDetails.push(variant);
        } else {
          return res.status(400).json({ errorMessage: `Variant ${variantId} not found` });
        }
      }

      // Create checkout
      const createCheckoutMutation = `
        mutation CreateExampleCheckout($input: CheckoutCreateInput!) {
          checkoutCreate(input: $input) {
            checkout {
              id
              token
              lines {
                id
                variant { id }
              }
            }
          }
        }
      `;

      // Get quantity mapping from product metadata
      const quantityMeta = product.metadata?.find((m: any) => m.key === 'quantity');
      const quantityMapping = quantityMeta?.value ? JSON.parse(quantityMeta.value) : {};

      const checkoutLines = variantDetails.map(variant => {
        const variantQuantity = parseInt(quantityMapping[variant.id] || '1');
        const totalQuantity = variantQuantity * bundle_quantity;
        
        return {
          variantId: variant.id,
          quantity: totalQuantity,
          price: variant.pricing.price.gross.amount
        };
      });

      // Create or add to checkout
      let checkout;
      let newLineIds = [];
      
      if (!checkoutId) {
        // Create new checkout
        const createCheckoutMutation = `
          mutation CreateExampleCheckout($input: CheckoutCreateInput!) {
            checkoutCreate(input: $input) {
              checkout {
                id
                token
                lines {
                  id
                  variant { id }
                }
              }
            }
          }
        `;

        const checkoutResponse = await fetch(authData.saleorApiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization-Bearer': authData.token,
          },
          body: JSON.stringify({
            query: createCheckoutMutation,
            variables: {
              input: {
                channel: DEFAULT_CHANNEL,
                lines: checkoutLines
              }
            }
          })
        });

        const checkoutResult = await checkoutResponse.json();
        if (checkoutResult.errors) {
          return res.status(400).json({ errorMessage: `Checkout creation failed: ${checkoutResult.errors.map((e: any) => e.message).join(', ')}` });
        }

        checkout = checkoutResult.data?.checkoutCreate?.checkout;
        newLineIds = checkout?.lines?.map((line: any) => line.id) || [];
      } else {
        // Get existing line IDs first
        const existingLinesQuery = `
          query GetExistingLines($id: ID!) {
            checkout(id: $id) {
              lines {
                id
              }
            }
          }
        `;

        const existingResponse = await fetch(authData.saleorApiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization-Bearer': authData.token,
          },
          body: JSON.stringify({
            query: existingLinesQuery,
            variables: { id: checkoutId }
          })
        });

        const existingResult = await existingResponse.json();
        const existingLineIds = existingResult.data?.checkout?.lines?.map((line: any) => line.id) || [];

        // Add to existing checkout
        const addLinesToCheckoutMutation = `
          mutation AddLinesToCheckout($id: ID!, $lines: [CheckoutLineInput!]!) {
            checkoutLinesAdd(id: $id, lines: $lines) {
              checkout {
                id
                token
                lines {
                  id
                  variant { id }
                }
              }
            }
          }
        `;

        const addLinesResponse = await fetch(authData.saleorApiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization-Bearer': authData.token,
          },
          body: JSON.stringify({
            query: addLinesToCheckoutMutation,
            variables: {
              id: checkoutId,
              lines: checkoutLines
            }
          })
        });

        const addLinesResult = await addLinesResponse.json();
        if (addLinesResult.errors) {
          return res.status(400).json({ errorMessage: `Adding lines failed: ${addLinesResult.errors.map((e: any) => e.message).join(', ')}` });
        }

        checkout = addLinesResult.data?.checkoutLinesAdd?.checkout;
        
        // Find new line IDs by comparing with existing ones
        const allLineIds = checkout?.lines?.map((line: any) => line.id) || [];
        newLineIds = allLineIds.filter(id => !existingLineIds.includes(id));
      }
      
      if (!checkout) {
        return res.status(400).json({ errorMessage: "Failed to create checkout" });
      }

      // Add metadata only to newly added lines
      const requiredMeta = product.metadata?.find((m: any) => m.key === 'required');
      const optionalMeta = product.metadata?.find((m: any) => m.key === 'optional');
      const requiredVariants = requiredMeta?.value ? JSON.parse(requiredMeta.value) : [];
      const optionalVariants = optionalMeta?.value ? Object.keys(JSON.parse(optionalMeta.value)) : [];

      const updateMetadataMutation = `
        mutation UpdateMetadata($id: ID!, $input: [MetadataInput!]!) {
          updateMetadata(id: $id, input: $input) {
            errors { message }
          }
        }
      `;

      // Only update metadata for new lines
      for (const line of checkout.lines) {
        if (newLineIds.includes(line.id)) {
          const isRequired = requiredVariants.includes(line.variant.id);
          const isOptional = optionalVariants.includes(line.variant.id);
          
          const status = isRequired ? 'required' : (isOptional ? 'optional' : 'unknown');
          const message = isRequired 
            ? 'This variant is required in the bundle and cannot be removed from the cart. Remove the whole bundle from the cart.'
            : 'This product is optional and can be removed from the bundle.';

          await fetch(authData.saleorApiUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization-Bearer': authData.token,
            },
            body: JSON.stringify({
              query: updateMetadataMutation,
              variables: {
                id: line.id,
                input: [
                  { key: 'bundle', value: product.name },
                  { key: 'required_or_optional', value: status },
                  { key: 'message', value: message }
                ]
              }
            })
          });
        }
      }

      // Add bundle_quantity metadata to checkout
      const checkoutMetadataQuery = `
        query GetCheckoutMetadata($id: ID!) {
          checkout(id: $id) {
            metadata {
              key
              value
            }
          }
        }
      `;

      // Get existing checkout metadata
      const metadataResponse = await fetch(authData.saleorApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization-Bearer': authData.token,
        },
        body: JSON.stringify({
          query: checkoutMetadataQuery,
          variables: { id: checkout.id }
        })
      });

      const metadataResult = await metadataResponse.json();
      const existingMetadata = metadataResult.data?.checkout?.metadata || [];
      
      // Find existing bundle_quantity metadata
      const bundleQuantityMeta = existingMetadata.find((m: any) => m.key === 'bundle_quantity');
      let bundleQuantities = {};
      
      if (bundleQuantityMeta?.value) {
        bundleQuantities = JSON.parse(bundleQuantityMeta.value);
      }
      
      // Update with current bundle
      bundleQuantities[product.name] = (bundleQuantities[product.name] || 0) + bundle_quantity;

      // Update checkout metadata
      await fetch(authData.saleorApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization-Bearer': authData.token,
        },
        body: JSON.stringify({
          query: updateMetadataMutation,
          variables: {
            id: checkout.id,
            input: [
              { key: 'bundle_quantity', value: JSON.stringify(bundleQuantities) }
            ]
          }
        })
      });

      return res.status(200).json({ 
        message: "Bundle checkout created successfully with noDiscount pricing",
        checkout: checkout
      });
    }

    if (pricingMethod === 'fixedPrice') {
      // Get fixed price and optional prices
      const fixedPriceMeta = product.metadata?.find((m: any) => m.key === 'fixedPrice');
      const optionalMeta = product.metadata?.find((m: any) => m.key === 'optional');
      const requiredMeta = product.metadata?.find((m: any) => m.key === 'required');
      
      const bundlePrice = parseFloat(fixedPriceMeta?.value || '0');
      const optionalPrices = optionalMeta?.value ? JSON.parse(optionalMeta.value) : {};
      const requiredVariants = requiredMeta?.value ? JSON.parse(requiredMeta.value) : [];

      // Fetch variant details
      const variantQuery = `
        query GetVariantPrice($id: ID!, $channel: String!) {
          productVariant(id: $id, channel: $channel) {
            id
            name
            quantityAvailable
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
        const variantResponse = await fetch(authData.saleorApiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization-Bearer': authData.token,
          },
          body: JSON.stringify({
            query: variantQuery,
            variables: { id: variantId, channel: DEFAULT_CHANNEL }
          })
        });

        const variantResult = await variantResponse.json();
        if (variantResult.data?.productVariant) {
          const variant = variantResult.data.productVariant;
          
          // Check stock availability
          if (variant.quantityAvailable === 0) {
            return res.status(400).json({ errorMessage: "Out of stock" });
          }
          
          variantDetails.push(variant);
        } else {
          return res.status(400).json({ errorMessage: `Variant ${variantId} not found` });
        }
      }

      // Calculate proportional prices for required variants
      const requiredVariantDetails = variantDetails.filter(v => requiredVariants.includes(v.id));
      const totalOriginalPrice = requiredVariantDetails.reduce((sum, v) => sum + v.pricing.price.gross.amount, 0);

      // Get quantity mapping
      const quantityMeta = product.metadata?.find((m: any) => m.key === 'quantity');
      const quantityMapping = quantityMeta?.value ? JSON.parse(quantityMeta.value) : {};

      const checkoutLines = variantDetails.map(variant => {
        const variantQuantity = parseInt(quantityMapping[variant.id] || '1');
        const totalQuantity = variantQuantity * bundle_quantity;
        
        let price;
        if (requiredVariants.includes(variant.id)) {
          // Proportional allocation for required variants, divided by quantity
          const weight = variant.pricing.price.gross.amount / totalOriginalPrice;
          price = (bundlePrice * weight) / variantQuantity;
        } else {
          // Direct price for optional variants, divided by quantity
          const optionalPrice = parseFloat(optionalPrices[variant.id] || variant.pricing.price.gross.amount);
          price = optionalPrice / variantQuantity;
        }
        
        return {
          variantId: variant.id,
          quantity: totalQuantity,
          price: price
        };
      });

      // Create or add to checkout
      let checkout;
      let newLineIds = [];
      
      if (!checkoutId) {
        const createCheckoutMutation = `
          mutation CreateExampleCheckout($input: CheckoutCreateInput!) {
            checkoutCreate(input: $input) {
              checkout {
                id
                token
                lines {
                  id
                  variant { id }
                }
              }
            }
          }
        `;

        const checkoutResponse = await fetch(authData.saleorApiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization-Bearer': authData.token,
          },
          body: JSON.stringify({
            query: createCheckoutMutation,
            variables: {
              input: {
                channel: DEFAULT_CHANNEL,
                lines: checkoutLines
              }
            }
          })
        });

        const checkoutResult = await checkoutResponse.json();
        if (checkoutResult.errors) {
          return res.status(400).json({ errorMessage: `Checkout creation failed: ${checkoutResult.errors.map((e: any) => e.message).join(', ')}` });
        }

        checkout = checkoutResult.data?.checkoutCreate?.checkout;
        newLineIds = checkout?.lines?.map((line: any) => line.id) || [];
      } else {
        // Get existing line IDs first
        const existingLinesQuery = `
          query GetExistingLines($id: ID!) {
            checkout(id: $id) {
              lines {
                id
              }
            }
          }
        `;

        const existingResponse = await fetch(authData.saleorApiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization-Bearer': authData.token,
          },
          body: JSON.stringify({
            query: existingLinesQuery,
            variables: { id: checkoutId }
          })
        });

        const existingResult = await existingResponse.json();
        const existingLineIds = existingResult.data?.checkout?.lines?.map((line: any) => line.id) || [];

        const addLinesToCheckoutMutation = `
          mutation AddLinesToCheckout($id: ID!, $lines: [CheckoutLineInput!]!) {
            checkoutLinesAdd(id: $id, lines: $lines) {
              checkout {
                id
                token
                lines {
                  id
                  variant { id }
                }
              }
            }
          }
        `;

        const addLinesResponse = await fetch(authData.saleorApiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization-Bearer': authData.token,
          },
          body: JSON.stringify({
            query: addLinesToCheckoutMutation,
            variables: {
              id: checkoutId,
              lines: checkoutLines
            }
          })
        });

        const addLinesResult = await addLinesResponse.json();
        if (addLinesResult.errors) {
          return res.status(400).json({ errorMessage: `Adding lines failed: ${addLinesResult.errors.map((e: any) => e.message).join(', ')}` });
        }

        checkout = addLinesResult.data?.checkoutLinesAdd?.checkout;
        
        // Find new line IDs by comparing with existing ones
        const allLineIds = checkout?.lines?.map((line: any) => line.id) || [];
        newLineIds = allLineIds.filter(id => !existingLineIds.includes(id));
      }
      
      if (!checkout) {
        return res.status(400).json({ errorMessage: "Failed to create checkout" });
      }

      // Add metadata to checkout lines (only new lines)
      const requiredVariantsForMeta = requiredMeta?.value ? JSON.parse(requiredMeta.value) : [];
      const optionalVariantsForMeta = optionalMeta?.value ? Object.keys(JSON.parse(optionalMeta.value)) : [];

      const updateMetadataMutation = `
        mutation UpdateMetadata($id: ID!, $input: [MetadataInput!]!) {
          updateMetadata(id: $id, input: $input) {
            errors { message }
          }
        }
      `;

      // Only update metadata for new lines
      for (const line of checkout.lines) {
        if (newLineIds.includes(line.id)) {
          const isRequired = requiredVariantsForMeta.includes(line.variant.id);
          const isOptional = optionalVariantsForMeta.includes(line.variant.id);
          
          const status = isRequired ? 'required' : (isOptional ? 'optional' : 'unknown');
          const message = isRequired 
            ? 'This variant is required in the bundle and cannot be removed from the cart. Remove the whole bundle from the cart.'
            : 'This product is optional and can be removed from the bundle.';

          await fetch(authData.saleorApiUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization-Bearer': authData.token,
            },
            body: JSON.stringify({
              query: updateMetadataMutation,
              variables: {
                id: line.id,
                input: [
                  { key: 'bundle', value: product.name },
                  { key: 'required_or_optional', value: status },
                  { key: 'message', value: message }
                ]
              }
            })
          });
        }
      }

      // Add bundle_quantity metadata to checkout
      const checkoutMetadataQuery = `
        query GetCheckoutMetadata($id: ID!) {
          checkout(id: $id) {
            metadata {
              key
              value
            }
          }
        }
      `;

      const metadataResponse = await fetch(authData.saleorApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization-Bearer': authData.token,
        },
        body: JSON.stringify({
          query: checkoutMetadataQuery,
          variables: { id: checkout.id }
        })
      });

      const metadataResult = await metadataResponse.json();
      const existingMetadata = metadataResult.data?.checkout?.metadata || [];
      
      const bundleQuantityMeta = existingMetadata.find((m: any) => m.key === 'bundle_quantity');
      let bundleQuantities = {};
      
      if (bundleQuantityMeta?.value) {
        bundleQuantities = JSON.parse(bundleQuantityMeta.value);
      }
      
      bundleQuantities[product.name] = (bundleQuantities[product.name] || 0) + bundle_quantity;

      await fetch(authData.saleorApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization-Bearer': authData.token,
        },
        body: JSON.stringify({
          query: updateMetadataMutation,
          variables: {
            id: checkout.id,
            input: [
              { key: 'bundle_quantity', value: JSON.stringify(bundleQuantities) }
            ]
          }
        })
      });

      return res.status(200).json({ 
        message: "Bundle checkout created successfully with fixedPrice pricing",
        checkout: checkout
      });
    }

    if (pricingMethod === 'discountedSum') {
      // Get discount percentage
      const discountMeta = product.metadata?.find((m: any) => m.key === 'discountedSum');
      const discountPercent = parseFloat(discountMeta?.value || '0');

      // Fetch variant details
      const variantQuery = `
        query GetVariantPrice($id: ID!, $channel: String!) {
          productVariant(id: $id, channel: $channel) {
            id
            name
            quantityAvailable
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
        const variantResponse = await fetch(authData.saleorApiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization-Bearer': authData.token,
          },
          body: JSON.stringify({
            query: variantQuery,
            variables: { id: variantId, channel: DEFAULT_CHANNEL }
          })
        });

        const variantResult = await variantResponse.json();
        if (variantResult.data?.productVariant) {
          const variant = variantResult.data.productVariant;
          
          // Check stock availability
          if (variant.quantityAvailable === 0) {
            return res.status(400).json({ errorMessage: "Out of stock" });
          }
          
          variantDetails.push(variant);
        } else {
          return res.status(400).json({ errorMessage: `Variant ${variantId} not found` });
        }
      }

      // Get quantity mapping
      const quantityMeta = product.metadata?.find((m: any) => m.key === 'quantity');
      const quantityMapping = quantityMeta?.value ? JSON.parse(quantityMeta.value) : {};

      const checkoutLines = variantDetails.map(variant => {
        const variantQuantity = parseInt(quantityMapping[variant.id] || '1');
        const totalQuantity = variantQuantity * bundle_quantity;
        
        // Apply discount to original price
        const originalPrice = variant.pricing.price.gross.amount;
        const discountedPrice = originalPrice * (1 - discountPercent / 100);
        
        return {
          variantId: variant.id,
          quantity: totalQuantity,
          price: discountedPrice
        };
      });

      // Create or add to checkout
      let checkout;
      let newLineIds = [];
      
      if (!checkoutId) {
        const createCheckoutMutation = `
          mutation CreateExampleCheckout($input: CheckoutCreateInput!) {
            checkoutCreate(input: $input) {
              checkout {
                id
                token
                lines {
                  id
                  variant { id }
                }
              }
            }
          }
        `;

        const checkoutResponse = await fetch(authData.saleorApiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization-Bearer': authData.token,
          },
          body: JSON.stringify({
            query: createCheckoutMutation,
            variables: {
              input: {
                channel: DEFAULT_CHANNEL,
                lines: checkoutLines
              }
            }
          })
        });

        const checkoutResult = await checkoutResponse.json();
        if (checkoutResult.errors) {
          return res.status(400).json({ errorMessage: `Checkout creation failed: ${checkoutResult.errors.map((e: any) => e.message).join(', ')}` });
        }

        checkout = checkoutResult.data?.checkoutCreate?.checkout;
        newLineIds = checkout?.lines?.map((line: any) => line.id) || [];
      } else {
        // Get existing line IDs first
        const existingLinesQuery = `
          query GetExistingLines($id: ID!) {
            checkout(id: $id) {
              lines {
                id
              }
            }
          }
        `;

        const existingResponse = await fetch(authData.saleorApiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization-Bearer': authData.token,
          },
          body: JSON.stringify({
            query: existingLinesQuery,
            variables: { id: checkoutId }
          })
        });

        const existingResult = await existingResponse.json();
        const existingLineIds = existingResult.data?.checkout?.lines?.map((line: any) => line.id) || [];

        const addLinesToCheckoutMutation = `
          mutation AddLinesToCheckout($id: ID!, $lines: [CheckoutLineInput!]!) {
            checkoutLinesAdd(id: $id, lines: $lines) {
              checkout {
                id
                token
                lines {
                  id
                  variant { id }
                }
              }
            }
          }
        `;

        const addLinesResponse = await fetch(authData.saleorApiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization-Bearer': authData.token,
          },
          body: JSON.stringify({
            query: addLinesToCheckoutMutation,
            variables: {
              id: checkoutId,
              lines: checkoutLines
            }
          })
        });

        const addLinesResult = await addLinesResponse.json();
        if (addLinesResult.errors) {
          return res.status(400).json({ errorMessage: `Adding lines failed: ${addLinesResult.errors.map((e: any) => e.message).join(', ')}` });
        }

        checkout = addLinesResult.data?.checkoutLinesAdd?.checkout;
        
        // Find new line IDs by comparing with existing ones
        const allLineIds = checkout?.lines?.map((line: any) => line.id) || [];
        newLineIds = allLineIds.filter(id => !existingLineIds.includes(id));
      }
      
      if (!checkout) {
        return res.status(400).json({ errorMessage: "Failed to create checkout" });
      }

      // Add metadata to checkout lines (only new lines)
      const requiredMeta = product.metadata?.find((m: any) => m.key === 'required');
      const optionalMeta = product.metadata?.find((m: any) => m.key === 'optional');
      const requiredVariantsForMeta = requiredMeta?.value ? JSON.parse(requiredMeta.value) : [];
      const optionalVariantsForMeta = optionalMeta?.value ? Object.keys(JSON.parse(optionalMeta.value)) : [];

      const updateMetadataMutation = `
        mutation UpdateMetadata($id: ID!, $input: [MetadataInput!]!) {
          updateMetadata(id: $id, input: $input) {
            errors { message }
          }
        }
      `;

      // Only update metadata for new lines
      for (const line of checkout.lines) {
        if (newLineIds.includes(line.id)) {
          const isRequired = requiredVariantsForMeta.includes(line.variant.id);
          const isOptional = optionalVariantsForMeta.includes(line.variant.id);
          
          const status = isRequired ? 'required' : (isOptional ? 'optional' : 'unknown');
          const message = isRequired 
            ? 'This variant is required in the bundle and cannot be removed from the cart. Remove the whole bundle from the cart.'
            : 'This product is optional and can be removed from the bundle.';

          await fetch(authData.saleorApiUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization-Bearer': authData.token,
            },
            body: JSON.stringify({
              query: updateMetadataMutation,
              variables: {
                id: line.id,
                input: [
                  { key: 'bundle', value: product.name },
                  { key: 'required_or_optional', value: status },
                  { key: 'message', value: message }
                ]
              }
            })
          });
        }
      }

      // Add bundle_quantity metadata to checkout
      const checkoutMetadataQuery = `
        query GetCheckoutMetadata($id: ID!) {
          checkout(id: $id) {
            metadata {
              key
              value
            }
          }
        }
      `;

      const metadataResponse = await fetch(authData.saleorApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization-Bearer': authData.token,
        },
        body: JSON.stringify({
          query: checkoutMetadataQuery,
          variables: { id: checkout.id }
        })
      });

      const metadataResult = await metadataResponse.json();
      const existingMetadata = metadataResult.data?.checkout?.metadata || [];
      
      const bundleQuantityMeta = existingMetadata.find((m: any) => m.key === 'bundle_quantity');
      let bundleQuantities = {};
      
      if (bundleQuantityMeta?.value) {
        bundleQuantities = JSON.parse(bundleQuantityMeta.value);
      }
      
      bundleQuantities[product.name] = (bundleQuantities[product.name] || 0) + bundle_quantity;

      await fetch(authData.saleorApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization-Bearer': authData.token,
        },
        body: JSON.stringify({
          query: updateMetadataMutation,
          variables: {
            id: checkout.id,
            input: [
              { key: 'bundle_quantity', value: JSON.stringify(bundleQuantities) }
            ]
          }
        })
      });

      return res.status(200).json({ 
        message: "Bundle checkout created successfully with discountedSum pricing",
        checkout: checkout
      });
    }

    return res.status(400).json({ errorMessage: `Pricing method ${pricingMethod} not implemented` });

  } catch (error) {
    console.error("Unexpected error:", error);
    return res.status(500).json({ 
      errorMessage: "Internal server error" 
    });
  }
}
