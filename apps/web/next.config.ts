import createNextIntlPlugin from "next-intl/plugin";
import type { NextConfig } from "next";

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  transpilePackages: ["@nojv/db", "@nojv/domain", "@nojv/i18n", "@nojv/ui"]
};

export default withNextIntl(nextConfig);
