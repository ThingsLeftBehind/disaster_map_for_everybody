import React from 'react';
import { View, ActivityIndicator, Text, StyleSheet } from 'react-native';

interface Props {
    message?: string;
}

export function LoadingState({ message = '読み込み中...' }: Props) {
    return (
        <View style={styles.container}>
            <ActivityIndicator size="large" color="#3b82f6" />
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
    text: {
        marginTop: 12,
        fontSize: 14,
        color: '#64748b',
    },
});
