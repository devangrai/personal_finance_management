import { Snaptrade } from "snaptrade-typescript-sdk";

export type SnapTradeConfig = {
  clientId: string;
  consumerKey: string;
};

export type SnapTradeEnvironmentName = "production";

/**
 * Tiny wrapper around the official snaptrade-typescript-sdk so the
 * rest of the app doesn't need to import SDK internals directly.
 *
 * The SDK itself is auto-generated from their OpenAPI spec and can be
 * clunky to use — this file exists to give us a stable surface to call.
 */

export function assertSnapTradeConfig(config: SnapTradeConfig) {
  if (!config.clientId || !config.consumerKey) {
    throw new Error(
      "Missing SnapTrade credentials (clientId + consumerKey required)."
    );
  }
}

export function createSnapTradeClient(config: SnapTradeConfig) {
  assertSnapTradeConfig(config);
  return new Snaptrade({
    clientId: config.clientId,
    consumerKey: config.consumerKey
  });
}

// Re-export commonly used types so consumers don't have to chase them
// across the SDK's nested namespaces.
export type SnapTradeClient = ReturnType<typeof createSnapTradeClient>;
