// Simple in-memory store registry for demo
// In production, use a proper database
const storeRegistry = new Map<string, string>();

export async function saveStoreInstallation(domain: string, apiUrl: string) {
  console.log(`Saving store: ${domain} -> ${apiUrl}`);
  storeRegistry.set(domain, apiUrl);
}

export async function getApiUrlForDomain(domain: string): Promise<string | null> {
  return storeRegistry.get(domain) || null;
}

export async function listStores() {
  return Array.from(storeRegistry.entries());
}
