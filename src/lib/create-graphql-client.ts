import { Client, cacheExchange, fetchExchange } from "urql";

export const createClient = (url: string, token?: string) =>
  new Client({
    url,
    exchanges: [cacheExchange, fetchExchange],
    fetchOptions: () => {
      const headers: Record<string, string> = {};
      if (token) {
        headers["Authorization-Bearer"] = token;
      }
      console.log("GraphQL Client - URL:", url);
      console.log("GraphQL Client - Headers:", headers);
      return { headers };
    },
  });
