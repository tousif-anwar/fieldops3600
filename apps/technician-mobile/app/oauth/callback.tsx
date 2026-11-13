import { Redirect } from 'expo-router';

// AuthSession completes/validates the code response in AuthProvider. Once that
// provider unlocks the authenticated stack, leave the native callback route.
export default function OAuthCallback() {
  // An index.tsx file owns the group's root URL; "index" is not a URL segment.
  return <Redirect href="/(tabs)" />;
}
