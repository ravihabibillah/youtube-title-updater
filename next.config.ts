import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["googleapis", "@napi-rs/keyring"],
};

export default nextConfig;
