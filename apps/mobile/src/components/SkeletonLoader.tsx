import React from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import { theme } from '../theme';

interface Props {
    width?: number | string;
    height?: number;
    borderRadius?: number;
    style?: object;
}

export function SkeletonLoader({
    width = '100%',
    height = 16,
    borderRadius = theme.borderRadius.sm,
    style,
}: Props) {
    const animatedValue = React.useRef(new Animated.Value(0)).current;

    React.useEffect(() => {
        const animation = Animated.loop(
            Animated.sequence([
                Animated.timing(animatedValue, {
                    toValue: 1,
                    duration: 1000,
                    useNativeDriver: true,
                }),
                Animated.timing(animatedValue, {
                    toValue: 0,
                    duration: 1000,
                    useNativeDriver: true,
                }),
            ])
        );
        animation.start();
        return () => animation.stop();
    }, [animatedValue]);

    const opacity = animatedValue.interpolate({
        inputRange: [0, 1],
        outputRange: [0.3, 0.7],
    });

    return (
        <Animated.View
            style={[
                styles.skeleton,
                { width, height, borderRadius, opacity },
                style,
            ]}
        />
    );
}

export function ShelterCardSkeleton() {
    return (
        <View style={styles.card}>
            <View style={styles.cardHeader}>
                <SkeletonLoader width="70%" height={18} />
                <SkeletonLoader width={50} height={24} borderRadius={theme.borderRadius.sm} />
            </View>
            <SkeletonLoader width="50%" height={12} style={{ marginTop: 8 }} />
            <SkeletonLoader width="40%" height={10} style={{ marginTop: 12 }} />
        </View>
    );
}

export function ListSkeleton({ count = 3 }: { count?: number }) {
    return (
        <View style={styles.list}>
            {Array.from({ length: count }).map((_, i) => (
                <ShelterCardSkeleton key={i} />
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    skeleton: {
        backgroundColor: theme.colors.surfaceAlt,
    },
    card: {
        backgroundColor: theme.colors.surface,
        borderRadius: theme.borderRadius.lg,
        padding: theme.spacing.md,
        marginBottom: theme.spacing.sm,
        borderWidth: 1,
        borderColor: theme.colors.border,
    },
    cardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
    },
    list: {
        padding: theme.spacing.lg,
    },
});
