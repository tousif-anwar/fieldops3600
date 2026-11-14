import { useState } from 'react';
import { Linking, Text } from 'react-native';
import { directionsUrl } from '../itinerary';
import { Button, InlineNotice } from './components';
import { textStyles } from './styles';

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
          <Text selectable style={textStyles.warning}>
            Enter this address in your navigation app: {address}.
          </Text>
        </InlineNotice>
      ) : null}
    </>
  );
}
