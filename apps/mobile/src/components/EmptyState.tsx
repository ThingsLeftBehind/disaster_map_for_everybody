import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface Props {
    message?: string;
    icon?: string;
}

export function EmptyState({ message = 'データがありません', icon = '📭' }: Props) {
    return (
        <View style={styles.container}>
            <Text style={styles.icon}>{icon}</Text>
            <Text style={styles.text}>{message}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    icon: {
        fontSize: 48,
        marginBottom: 12,
    },
    text: {
        fontSize: 14,
        color: '#64748b',
        textAlign: 'center',
    },
});
