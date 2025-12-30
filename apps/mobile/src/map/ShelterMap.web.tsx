import { StyleSheet, Text, View } from 'react-native';

import { spacing, typography, useThemedStyles } from '@/src/ui/theme';

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

export function ShelterMap({ markers }: ShelterMapProps) {
  const styles = useThemedStyles(createStyles);
  const count = markers.length;
  return (
    <View style={styles.panel}>
      <Text style={styles.title}>地図はモバイルで表示されます。</Text>
      <Text style={styles.caption}>表示対象: {count}件</Text>
    </View>
  );
}

const createStyles = (colors: { background: string; border: string; text: string; muted: string }) =>
  StyleSheet.create({
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
