import { Redirect } from 'expo-router';

// AuthSession completes/validates the code response in AuthProvider. Once that
// provider unlocks the authenticated stack, leave the native callback route.
export default function OAuthCallback() {
  return <Redirect href="/(tabs)/index" />;
}
