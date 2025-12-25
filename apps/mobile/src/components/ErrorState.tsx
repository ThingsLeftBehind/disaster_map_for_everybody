import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

interface Props {
    message?: string;
    onRetry?: () => void;
}

export function ErrorState({ message = 'エラーが発生しました', onRetry }: Props) {
    return (
        <View style={styles.container}>
            <Text style={styles.icon}>⚠️</Text>
            <Text style={styles.text}>{message}</Text>
            {onRetry && (
                <TouchableOpacity style={styles.button} onPress={onRetry}>
                    <Text style={styles.buttonText}>再試行</Text>
                </TouchableOpacity>
            )}
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
        color: '#dc2626',
        textAlign: 'center',
    },
    button: {
        marginTop: 16,
        backgroundColor: '#3b82f6',
        paddingHorizontal: 20,
        paddingVertical: 10,
        borderRadius: 8,
    },
    buttonText: {
        color: '#ffffff',
        fontWeight: '600',
    },
});
