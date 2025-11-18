export const DEFAULT_CHANNEL = process.env.NEXT_PUBLIC_DEFAULT_CHANNEL as string;

if (!DEFAULT_CHANNEL) {
  throw new Error("NEXT_PUBLIC_DEFAULT_CHANNEL environment variable is not set");
}
