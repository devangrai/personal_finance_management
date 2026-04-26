export type PlaidConfig = {
  clientId: string;
  secret: string;
  env: "sandbox" | "development" | "production";
  redirectUri?: string;
};

export function assertPlaidConfig(config: PlaidConfig) {
  if (!config.clientId || !config.secret) {
    throw new Error("Missing Plaid credentials.");
  }
}

export type PlaidSyncCursor = {
  itemId: string;
  cursor: string | null;
};
