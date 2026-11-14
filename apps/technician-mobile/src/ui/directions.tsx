import { useState } from 'react';
import { Linking, Text } from 'react-native';
import { directionsUrl } from '../itinerary';
import { Button, InlineNotice } from './components';
import { colors, typography } from './tokens';

export function DirectionsButton({ address }: { address: string }) {
  const [error, setError] = useState(false);
  const url = directionsUrl(address);
  if (!url) return null;
  return (
    <>
      <Button
        title="Open directions"
        variant="secondary"
        hint="Shares this destination with Google Maps in its app or browser"
        onPress={() => {
          setError(false);
          void Linking.openURL(url).catch(() => setError(true));
        }}
      />
      {error ? (
        <InlineNotice tone="warning" title="Directions unavailable">
          <Text selectable style={{ ...typography.body, color: colors.warning }}>
            Open your preferred navigation app and enter: {address}. Your appointment remains available here.
          </Text>
        </InlineNotice>
      ) : null}
    </>
  );
}
