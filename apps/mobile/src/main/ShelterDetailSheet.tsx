import { useMemo, useRef } from 'react';
import {
  Animated,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';

import type { Shelter } from '@/src/api/types';
import { colors, radii, spacing, typography } from '@/src/ui/theme';

type Props = {
  visible: boolean;
  shelter: Shelter | null;
  distanceLabel: string | null;
  isFavorite: boolean;
  onClose: () => void;
  onToggleFavorite: () => void;
  onFocusMap: () => void;
};

export function ShelterDetailSheet({
  visible,
  shelter,
  distanceLabel,
  isFavorite,
  onClose,
  onToggleFavorite,
  onFocusMap,
}: Props) {
  const translateY = useRef(new Animated.Value(0)).current;

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 8,
        onPanResponderMove: (_, gesture) => {
          translateY.setValue(Math.max(0, gesture.dy));
        },
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dy > 80 || gesture.vy > 0.5) {
            Animated.timing(translateY, {
              toValue: 200,
              duration: 160,
              useNativeDriver: true,
            }).start(() => {
              translateY.setValue(0);
              onClose();
            });
            return;
          }
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        },
      }),
    [onClose, translateY]
  );

  if (!visible || !shelter) return null;

  const hazardList = formatHazards(shelter);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]} {...panResponder.panHandlers}>
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <Text style={styles.title}>{shelter.name ?? '避難所'}</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={styles.closeText}>閉じる</Text>
            </Pressable>
          </View>
          {shelter.address ? <Text style={styles.address}>{shelter.address}</Text> : null}
          {distanceLabel ? <Text style={styles.distance}>{distanceLabel}</Text> : null}

          <View style={styles.actionRow}>
            <Pressable style={styles.actionButton} onPress={onToggleFavorite}>
              <FontAwesome name={isFavorite ? 'star' : 'star-o'} size={16} color={colors.text} />
              <Text style={styles.actionText}>保存</Text>
            </Pressable>
            <Pressable style={styles.actionButton} onPress={onFocusMap}>
              <FontAwesome name="map-marker" size={16} color={colors.text} />
              <Text style={styles.actionText}>地図で見る</Text>
            </Pressable>
          </View>

          {hazardList ? (
            <View style={styles.infoBlock}>
              <Text style={styles.infoLabel}>対応ハザード</Text>
              <Text style={styles.infoText}>{hazardList}</Text>
            </View>
          ) : null}
          {shelter.notes ? (
            <View style={styles.infoBlock}>
              <Text style={styles.infoLabel}>備考</Text>
              <Text style={styles.infoText}>{shelter.notes}</Text>
            </View>
          ) : null}
        </Animated.View>
      </View>
    </Modal>
  );
}

function formatHazards(shelter: Shelter) {
  const flags = shelter.hazards ?? {};
  const labels = HAZARD_OPTIONS.filter((option) => Boolean(flags?.[option.key])).map((option) => option.label);
  if (labels.length === 0) return null;
  return labels.join(' / ');
}

const HAZARD_OPTIONS = [
  { key: 'flood', label: '洪水' },
  { key: 'landslide', label: '土砂災害' },
  { key: 'storm_surge', label: '高潮' },
  { key: 'earthquake', label: '地震' },
  { key: 'tsunami', label: '津波' },
  { key: 'large_fire', label: '大規模火災' },
  { key: 'inland_flood', label: '内水氾濫' },
  { key: 'volcano', label: '火山' },
] as const;

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  handle: {
    width: 44,
    height: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  title: {
    ...typography.subtitle,
    color: colors.text,
    flex: 1,
    marginRight: spacing.sm,
  },
  closeText: {
    ...typography.caption,
    color: colors.muted,
  },
  address: {
    ...typography.body,
    color: colors.text,
  },
  distance: {
    ...typography.caption,
    color: colors.muted,
    marginTop: spacing.xs,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginVertical: spacing.md,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  actionText: {
    ...typography.label,
    color: colors.text,
  },
  infoBlock: {
    marginTop: spacing.sm,
  },
  infoLabel: {
    ...typography.caption,
    color: colors.muted,
    marginBottom: spacing.xxs,
  },
  infoText: {
    ...typography.body,
    color: colors.text,
  },
});
