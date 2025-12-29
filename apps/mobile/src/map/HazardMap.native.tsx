import { StyleSheet } from 'react-native';
import MapView, { UrlTile } from 'react-native-maps';

export type HazardTile = {
  id: string;
  url: string;
  minZoom?: number;
  maxZoom?: number;
  opacity?: number;
  flipY?: boolean;
};

export type HazardMapRegion = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

type HazardMapProps = {
  region: HazardMapRegion;
  tiles: HazardTile[];
  onRegionChangeComplete?: (region: HazardMapRegion) => void;
};

export function HazardMap({ region, tiles, onRegionChangeComplete }: HazardMapProps) {
  return (
    <MapView style={styles.map} region={region} onRegionChangeComplete={onRegionChangeComplete}>
      {tiles.map((tile) => (
        <UrlTile
          key={tile.id}
          urlTemplate={tile.url}
          maximumZ={tile.maxZoom}
          minimumZ={tile.minZoom}
          opacity={tile.opacity ?? 0.6}
          flipY={tile.flipY}
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
