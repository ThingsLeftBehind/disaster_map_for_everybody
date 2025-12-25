import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import type { Shelter } from '../api/types';

interface Props {
    shelter: Shelter;
    onPress?: () => void;
}

export function ShelterCard({ shelter, onPress }: Props) {
    const distance = shelter.distanceKm ?? shelter.distance;
    const distanceLabel = formatDistance(distance);
    const hazardCount = Object.values(shelter.hazards || {}).filter(Boolean).length;

    return (
        <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7}>
            <View style={styles.header}>
                <Text style={styles.name} numberOfLines={1}>{shelter.name}</Text>
                {distanceLabel && (
                    <View style={styles.distanceBadge}>
                        <Text style={styles.distanceText}>{distanceLabel}</Text>
                    </View>
                )}
            </View>

            <Text style={styles.address} numberOfLines={1}>
                {shelter.address || shelter.pref_city || '住所不明'}
            </Text>

            <View style={styles.footer}>
                <Text style={styles.hazardText}>
                    対応ハザード: {hazardCount > 0 ? `${hazardCount}種類` : '不明'}
                </Text>
                {shelter.is_same_address_as_shelter && (
                    <Text style={styles.caution}>要確認</Text>
                )}
            </View>
        </TouchableOpacity>
    );
}

function formatDistance(km: number | undefined): string | null {
    if (typeof km !== 'number' || !Number.isFinite(km)) return null;
    if (km < 1) return `${Math.round(km * 1000)}m`;
    if (km < 10) return `${km.toFixed(1)}km`;
    return `${Math.round(km)}km`;
}

const styles = StyleSheet.create({
    card: {
        backgroundColor: '#ffffff',
        borderRadius: 12,
        padding: 12,
        marginBottom: 8,
        borderWidth: 1,
        borderColor: '#e2e8f0',
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
    },
    name: {
        flex: 1,
        fontSize: 15,
        fontWeight: '600',
        color: '#1e293b',
        marginRight: 8,
    },
    distanceBadge: {
        backgroundColor: '#dbeafe',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
    },
    distanceText: {
        fontSize: 12,
        fontWeight: '600',
        color: '#1d4ed8',
    },
    address: {
        marginTop: 4,
        fontSize: 12,
        color: '#64748b',
    },
    footer: {
        marginTop: 8,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    hazardText: {
        fontSize: 11,
        color: '#94a3b8',
    },
    caution: {
        fontSize: 10,
        fontWeight: '600',
        color: '#d97706',
        backgroundColor: '#fef3c7',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
    },
});
