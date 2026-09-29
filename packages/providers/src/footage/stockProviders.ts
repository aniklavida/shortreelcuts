/**
 * The one place a `SHORTREELCUTS_FOOTAGE_PROVIDER` value becomes an
 * adapter, so nothing anywhere else has to know which libraries exist.
 *
 * **There is no default.** A self-hoster chooses Pexels or Pixabay in
 * their `.env`, exactly as they choose the model behind script and voice;
 * a missing choice resolves to the deterministic stub in the footage
 * stage, and an unrecognised choice fails at boot rather than quietly
 * picking one of the two.
 */
import type { FootageConnection, FootageProvider } from "../types.js";
import { createPexelsFootageProvider } from "./pexels.js";
import { createPixabayFootageProvider } from "./pixabay.js";
import { KNOWN_STOCK_PROVIDERS, UnknownStockProviderError, remoteStockConnectionFrom } from "./remoteStock.js";

export function createStockFootageProvider(connection: FootageConnection): FootageProvider {
  const remote = remoteStockConnectionFrom(connection);
  switch (connection.provider) {
    case "pexels":
      return createPexelsFootageProvider(remote);
    case "pixabay":
      return createPixabayFootageProvider(remote);
    default:
      throw new UnknownStockProviderError(connection.provider);
  }
}

export { KNOWN_STOCK_PROVIDERS, UnknownStockProviderError };
