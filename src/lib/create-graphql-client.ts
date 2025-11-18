import { Client, cacheExchange, fetchExchange } from "urql";

export const createClient = (url: string, token?: string) =>
  new Client({
    url,
    exchanges: [cacheExchange, fetchExchange],
    fetchOptions: () => {
      if (token) {
        return {
          headers: {
            "Authorization-Bearer": token,
          },
        };
      }
      return {};
    },
  });
