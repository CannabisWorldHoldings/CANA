import { defineCloudflareConfig } from '@opennextjs/cloudflare';

const cloudflareConfig = {
  ...defineCloudflareConfig(),
  buildCommand: 'npm run build',
};

export default cloudflareConfig;
