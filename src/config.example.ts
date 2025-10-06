/**
 * Configuration for Pure ROR Matcher
 * 
 * Copy this file to config.ts and fill in your actual values.
 * The config.ts file is gitignored and should never be committed.
 */

// Your Pure API base URL (without trailing slash)
export const PURE_BASE_URL = "https://your-institution.pure.elsevier.com/ws/api";

// Your Pure API key with read/write permissions for external organizations
export const PURE_API_KEY = "your-api-key-here";

// ROR identifier type configuration for your Pure instance
// You may need to adjust the URI path to match your instance's setup
export const ROR_TYPE = {
  uri: "/dk/atira/pure/ueoexternalorganisation/ueoexternalorganisationsources/ror",
  term: { en_GB: "ROR ID", da_DK: "ROR ID" },
};
