/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The workspace packages ship TypeScript source (no build step), so Next has
  // to transpile them rather than treat them as prebuilt node_modules.
  transpilePackages: [
    "@shortreelcuts/db",
    "@shortreelcuts/plan",
    "@shortreelcuts/providers",
    "@shortreelcuts/render",
    "@shortreelcuts/sheet",
    "@shortreelcuts/stages",
    "@shortreelcuts/worker",
  ],
  // The workspace packages are NodeNext TypeScript: their internal imports are
  // written with a `.js` extension even though the files on disk are `.ts`.
  // Webpack needs to be told that, or every intra-package import 404s.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js", ".jsx"],
      ".mjs": [".mts", ".mjs"],
      ".cjs": [".cts", ".cjs"],
    };
    return config;
  },
  // No telemetry is collected or shipped.
};

export default nextConfig;
