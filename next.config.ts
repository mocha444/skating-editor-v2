import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.1.241", "localhost", "127.0.0.1"],
  assetPrefix: "/skating",
};

export default nextConfig;
