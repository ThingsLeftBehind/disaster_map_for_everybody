import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '@/src/ui/theme';

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

export function HazardMap({ tiles }: HazardMapProps) {
  return (
    <View style={styles.panel}>
      <Text style={styles.title}>ハザード地図はWebでは簡易表示です。</Text>
      <Text style={styles.caption}>レイヤー {tiles.length > 0 ? 'ON' : 'OFF'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: spacing.md,
  },
  title: {
    ...typography.subtitle,
    color: colors.text,
    textAlign: 'center',
  },
  caption: {
    ...typography.small,
    color: colors.muted,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
});
