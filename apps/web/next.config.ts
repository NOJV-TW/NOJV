import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@nojv/db", "@nojv/domain", "@nojv/i18n", "@nojv/ui"]
};

export default nextConfig;
