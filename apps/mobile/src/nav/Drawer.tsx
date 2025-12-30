import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { spacing, typography, useThemedStyles, useTheme } from '@/src/ui/theme';

type DrawerContextValue = {
  openDrawer: () => void;
  closeDrawer: () => void;
  isOpen: boolean;
};

const DrawerContext = createContext<DrawerContextValue | null>(null);
const ANIMATION_MS = 220;

export function useDrawer() {
  const ctx = useContext(DrawerContext);
  if (!ctx) {
    return { openDrawer: () => {}, closeDrawer: () => {}, isOpen: false };
  }
  return ctx;
}

export function DrawerProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [visible, setVisible] = useState(false);
  const { width } = useWindowDimensions();
  const drawerWidth = Math.min(320, Math.max(240, width * 0.82));
  const translateX = useRef(new Animated.Value(drawerWidth)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!isOpen) {
      translateX.setValue(drawerWidth);
    }
  }, [drawerWidth, isOpen, translateX]);

  const openDrawer = useCallback(() => {
    if (isOpen) return;
    setVisible(true);
    setIsOpen(true);
    Animated.parallel([
      Animated.timing(translateX, {
        toValue: 0,
        duration: ANIMATION_MS,
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 1,
        duration: ANIMATION_MS,
        useNativeDriver: true,
      }),
    ]).start();
  }, [backdropOpacity, isOpen, translateX]);

  const closeDrawer = useCallback(() => {
    if (!isOpen) return;
    setIsOpen(false);
    Animated.parallel([
      Animated.timing(translateX, {
        toValue: drawerWidth,
        duration: ANIMATION_MS,
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: ANIMATION_MS,
        useNativeDriver: true,
      }),
    ]).start(() => setVisible(false));
  }, [backdropOpacity, drawerWidth, isOpen, translateX]);

  const value = useMemo(
    () => ({ openDrawer, closeDrawer, isOpen }),
    [openDrawer, closeDrawer, isOpen]
  );

  return (
    <DrawerContext.Provider value={value}>
      {children}
      <DrawerOverlay
        visible={visible}
        drawerWidth={drawerWidth}
        translateX={translateX}
        backdropOpacity={backdropOpacity}
        onClose={closeDrawer}
      />
    </DrawerContext.Provider>
  );
}

function DrawerOverlay({
  visible,
  drawerWidth,
  translateX,
  backdropOpacity,
  onClose,
}: {
  visible: boolean;
  drawerWidth: number;
  translateX: Animated.Value;
  backdropOpacity: Animated.Value;
  onClose: () => void;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useThemedStyles((themeColors) => createStyles(themeColors));
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 12,
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dx > 40) {
            onClose();
          }
        },
      }),
    [onClose]
  );

  const navigateTo = useCallback(
    (route: string) => {
      onClose();
      setTimeout(() => router.push(route as never), ANIMATION_MS);
    },
    [onClose, router]
  );

  if (!visible) return null;

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]} />
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
        <Animated.View
          style={[
            styles.drawer,
            {
              width: drawerWidth,
              paddingTop: insets.top + spacing.lg,
              transform: [{ translateX }],
              borderRightWidth: 0,
              borderLeftWidth: 1,
              borderLeftColor: colors.border,
              right: 0,
              left: undefined,
            },
          ]}
          {...panResponder.panHandlers}
        >
          <Text style={styles.drawerTitle}>メニュー</Text>
          {drawerItems.map((item) => (
            <Pressable key={item.route} onPress={() => navigateTo(item.route)} style={styles.drawerItem}>
              <Text style={styles.drawerItemText}>{item.label}</Text>
            </Pressable>
          ))}
        </Animated.View>
      </View>
    </Modal>
  );
}

const drawerItems = [
  { label: '設定', route: '/settings' },
  { label: 'MySafetyPinCard', route: '/mysafety' },
  { label: '注意・免責事項', route: '/disclaimer' },
  { label: 'お知らせ', route: '/notices' },
  { label: '出典', route: '/sources' },
];

const createStyles = (colors: { background: string; border: string; text: string }) =>
  StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-start',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
  },
  drawer: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.lg,
  },
  drawerTitle: {
    ...typography.subtitle,
    color: colors.text,
    marginBottom: spacing.md,
  },
  drawerItem: {
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  drawerItemText: {
    ...typography.body,
    color: colors.text,
  },
});
