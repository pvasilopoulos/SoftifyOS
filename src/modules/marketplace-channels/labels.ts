export const MARKETPLACE_PROVIDERS = [
  "SKROUTZ",
  "BESTPRICE",
  "PUBLIC",
  "SHOPIFY",
  "WOOCOMMERCE",
  "AMAZON",
  "CUSTOM",
] as const;

export type MarketplaceProvider = (typeof MARKETPLACE_PROVIDERS)[number];

export const MARKETPLACE_STATUSES = [
  "DRAFT",
  "ACTIVE",
  "PAUSED",
  "ERROR",
] as const;

export type MarketplaceChannelStatus = (typeof MARKETPLACE_STATUSES)[number];

export const marketplaceProviderLabel: Record<MarketplaceProvider, string> = {
  SKROUTZ: "Skroutz",
  BESTPRICE: "BestPrice",
  PUBLIC: "Public.com",
  SHOPIFY: "Shopify",
  WOOCOMMERCE: "WooCommerce",
  AMAZON: "Amazon",
  CUSTOM: "Custom / άλλο",
};

export const marketplaceStatusLabel: Record<MarketplaceChannelStatus, string> = {
  DRAFT: "Πρόχειρο",
  ACTIVE: "Ενεργό",
  PAUSED: "Σε παύση",
  ERROR: "Σφάλμα",
};

export const marketplaceStatusTone: Record<
  MarketplaceChannelStatus,
  "slate" | "emerald" | "amber" | "rose"
> = {
  DRAFT: "slate",
  ACTIVE: "emerald",
  PAUSED: "amber",
  ERROR: "rose",
};

/** Sensible defaults when picking a provider in the create form */
export const marketplaceProviderDefaults: Record<
  MarketplaceProvider,
  {
    code: string;
    name: string;
    credentialsSecretKey: string;
    apiBaseHost: string;
    syncCatalog: boolean;
    syncOrders: boolean;
    syncStock: boolean;
    syncPrices: boolean;
  }
> = {
  SKROUTZ: {
    code: "SKROUTZ",
    name: "Skroutz Marketplace",
    credentialsSecretKey: "SKROUTZ_TOKEN",
    apiBaseHost: "api.skroutz.gr",
    syncCatalog: true,
    syncOrders: true,
    syncStock: true,
    syncPrices: true,
  },
  BESTPRICE: {
    code: "BESTPRICE",
    name: "BestPrice",
    credentialsSecretKey: "BESTPRICE_TOKEN",
    apiBaseHost: "www.bestprice.gr",
    syncCatalog: true,
    syncOrders: false,
    syncStock: true,
    syncPrices: true,
  },
  PUBLIC: {
    code: "PUBLIC",
    name: "Public Marketplace",
    credentialsSecretKey: "PUBLIC_TOKEN",
    apiBaseHost: "api.public.gr",
    syncCatalog: true,
    syncOrders: true,
    syncStock: true,
    syncPrices: true,
  },
  SHOPIFY: {
    code: "SHOPIFY",
    name: "Shopify",
    credentialsSecretKey: "SHOPIFY_TOKEN",
    apiBaseHost: "myshopify.com",
    syncCatalog: true,
    syncOrders: true,
    syncStock: true,
    syncPrices: true,
  },
  WOOCOMMERCE: {
    code: "WOO",
    name: "WooCommerce",
    credentialsSecretKey: "WOO_TOKEN",
    apiBaseHost: "",
    syncCatalog: true,
    syncOrders: true,
    syncStock: true,
    syncPrices: true,
  },
  AMAZON: {
    code: "AMAZON",
    name: "Amazon",
    credentialsSecretKey: "AMAZON_TOKEN",
    apiBaseHost: "sellingpartnerapi-eu.amazon.com",
    syncCatalog: true,
    syncOrders: true,
    syncStock: true,
    syncPrices: true,
  },
  CUSTOM: {
    code: "CUSTOM",
    name: "Custom channel",
    credentialsSecretKey: "MARKETPLACE_TOKEN",
    apiBaseHost: "",
    syncCatalog: true,
    syncOrders: true,
    syncStock: false,
    syncPrices: false,
  },
};
