import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface Props {
    kind: string;
    status?: string | null;
    variant?: 'urgent' | 'advisory' | 'reference';
}

export function AlertChip({ kind, status, variant = 'advisory' }: Props) {
    const variantStyle =
        variant === 'urgent' ? styles.urgent :
            variant === 'reference' ? styles.reference :
                styles.advisory;

    return (
        <View style={[styles.chip, variantStyle]}>
            <Text style={[styles.text, variant === 'urgent' && styles.urgentText]}>
                {kind}
            </Text>
            {status && (
                <Text style={styles.status}>{status}</Text>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    chip: {
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 8,
        marginRight: 6,
        marginBottom: 6,
    },
    text: {
        fontSize: 12,
        fontWeight: '600',
    },
    status: {
        fontSize: 10,
        marginTop: 2,
        opacity: 0.8,
    },
    urgent: {
        backgroundColor: '#fee2e2',
        borderWidth: 1,
        borderColor: '#fecaca',
    },
    urgentText: {
        color: '#991b1b',
    },
    advisory: {
        backgroundColor: '#fef3c7',
        borderWidth: 1,
        borderColor: '#fcd34d',
    },
    reference: {
        backgroundColor: '#f1f5f9',
        borderWidth: 1,
        borderColor: '#e2e8f0',
    },
});
