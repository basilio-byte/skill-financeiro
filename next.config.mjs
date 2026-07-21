/** @type {import('next').NextConfig} */
const nextConfig = {
  // Gera um build standalone para uma imagem Docker enxuta no Easypanel.
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
