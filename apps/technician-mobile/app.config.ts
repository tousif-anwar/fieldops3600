import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: config.name ?? 'FieldOps 360',
  slug: config.slug ?? 'fieldops-technician',
  plugins: [
    ...(config.plugins ?? []),
    ['expo-build-properties', {
      android: { usesCleartextTraffic: process.env.FIELDOPS_ALLOW_HTTP === 'true' },
    }],
  ],
});
