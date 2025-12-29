import { StyleSheet } from 'react-native';
import MapView, { Marker } from 'react-native-maps';

import { colors } from '@/src/ui/theme';

export type ShelterMarker = {
  id: string;
  lat: number;
  lon: number;
  title?: string;
};

export type ShelterMapRegion = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

type ShelterMapProps = {
  region: ShelterMapRegion;
  markers: ShelterMarker[];
  onPressMarker?: (id: string) => void;
};

export function ShelterMap({ region, markers, onPressMarker }: ShelterMapProps) {
  return (
    <MapView style={styles.map} region={region}>
      {markers.map((marker) => (
        <Marker
          key={marker.id}
          coordinate={{ latitude: marker.lat, longitude: marker.lon }}
          title={marker.title}
          pinColor={marker.id === 'current' ? colors.text : undefined}
          onPress={() => onPressMarker?.(marker.id)}
        />
      ))}
    </MapView>
  );
}

const styles = StyleSheet.create({
  map: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
});
