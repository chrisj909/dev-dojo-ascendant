import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  turbopack: {
    // Pin the workspace root. Without it Next walks upward looking for a
    // lockfile and can settle on one in a parent directory — a stray
    // package-lock.json in the home folder is enough — which silently changes
    // how modules resolve.
    root: path.resolve(__dirname),
  },
  typedRoutes: true,
};

export default nextConfig;
