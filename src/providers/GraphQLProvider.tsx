import { useAppBridge } from "@saleor/app-sdk/app-bridge";
import { PropsWithChildren } from "react";
import { Provider } from "urql";
import { createClient } from "../lib/create-graphql-client";

export function GraphQLProvider(props: PropsWithChildren<{}>) {
  const { appBridgeState } = useAppBridge();
  const url = appBridgeState?.saleorApiUrl!;
  const token = appBridgeState?.token;

  if (!url) {
    console.warn("Install the app in the Dashboard to be able to query Saleor API.");
    return <div>{props.children}</div>;
  }

  const client = createClient(url, token);

  return <Provider value={client} {...props} />;
}
