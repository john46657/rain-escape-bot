/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Interne Pakete werden als TypeScript-Quellen eingebunden.
  transpilePackages: ['@nexus/shared', '@nexus/permissions'],
  /**
   * Der Browser spricht nie direkt mit der API (andere Herkunft, Cookies,
   * CORS). Stattdessen proxied Next alle /api- und /auth-Pfade serverseitig.
   */
  async rewrites() {
    const target = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000';
    return [
      { source: '/api/:path*', destination: `${target}/api/:path*` },
      { source: '/auth/:path*', destination: `${target}/auth/:path*` },
      { source: '/health/:path*', destination: `${target}/health/:path*` },
    ];
  },
  // Erlaubt die Vorschau-Domain der Entwicklungsumgebung.
  allowedDevOrigins: ['*.e2b.app', 'localhost', '127.0.0.1'],
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
