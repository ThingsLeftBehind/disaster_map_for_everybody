import React from 'react';
import { View, Text, ScrollView, StyleSheet, Linking, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '../theme';

export function AboutScreen() {
    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            <View style={styles.header}>
                <Text style={styles.title}>避難ナビについて</Text>
            </View>

            <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>アプリ情報</Text>
                    <Text style={styles.text}>避難ナビ (HinaNavi) v1.0.0</Text>
                    <Text style={styles.textMuted}>全国の避難場所・警報情報を提供するアプリです</Text>
                </View>

                <View style={styles.divider} />

                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>データソース</Text>

                    <View style={styles.sourceItem}>
                        <Text style={styles.sourceLabel}>避難場所データ</Text>
                        <Text style={styles.sourceText}>国土地理院「指定緊急避難場所データ」</Text>
                    </View>

                    <View style={styles.sourceItem}>
                        <Text style={styles.sourceLabel}>気象警報</Text>
                        <Text style={styles.sourceText}>気象庁「防災情報XML」</Text>
                    </View>

                    <View style={styles.sourceItem}>
                        <Text style={styles.sourceLabel}>地震情報</Text>
                        <Text style={styles.sourceText}>気象庁「地震情報」</Text>
                    </View>

                    <View style={styles.sourceItem}>
                        <Text style={styles.sourceLabel}>ハザードマップ</Text>
                        <Text style={styles.sourceText}>国土地理院「重ねるハザードマップ」</Text>
                    </View>
                </View>

                <View style={styles.divider} />

                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>免責事項</Text>
                    <View style={styles.disclaimer}>
                        <Text style={styles.disclaimerText}>
                            • 本アプリの情報は参考情報であり、正確性を保証するものではありません{'\n'}
                            • 災害時は必ず公式情報（気象庁、自治体等）を確認してください{'\n'}
                            • 避難場所の開設状況は自治体にご確認ください{'\n'}
                            • 本アプリの利用により生じた損害について、開発者は責任を負いません
                        </Text>
                    </View>
                </View>

                <View style={styles.divider} />

                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>プライバシー</Text>
                    <Text style={styles.text}>
                        本アプリは位置情報を端末内でのみ使用し、サーバーに生の座標を送信しません。
                        プッシュ通知を利用する場合、地域コード（市区町村レベル）のみをサーバーに保存します。
                    </Text>
                </View>

                <View style={styles.divider} />

                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>外部リンク</Text>
                    <TouchableOpacity
                        style={styles.link}
                        onPress={() => Linking.openURL('https://www.jma.go.jp/')}
                    >
                        <Text style={styles.linkText}>気象庁ホームページ →</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={styles.link}
                        onPress={() => Linking.openURL('https://disaportal.gsi.go.jp/')}
                    >
                        <Text style={styles.linkText}>重ねるハザードマップ →</Text>
                    </TouchableOpacity>
                </View>

                <View style={styles.footer}>
                    <Text style={styles.footerText}>© 2024 HinaNavi</Text>
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: theme.colors.background,
    },
    header: {
        paddingHorizontal: theme.spacing.lg,
        paddingVertical: theme.spacing.md,
        backgroundColor: theme.colors.navBackground,
    },
    title: {
        ...theme.typography.h2,
        color: theme.colors.textInverse,
    },
    scrollView: {
        flex: 1,
    },
    content: {
        padding: theme.spacing.lg,
    },
    section: {
        marginBottom: theme.spacing.lg,
    },
    sectionTitle: {
        ...theme.typography.h3,
        color: theme.colors.textPrimary,
        marginBottom: theme.spacing.sm,
    },
    text: {
        ...theme.typography.body,
        color: theme.colors.textPrimary,
        lineHeight: 22,
    },
    textMuted: {
        ...theme.typography.bodySmall,
        color: theme.colors.textSecondary,
        marginTop: theme.spacing.xs,
    },
    divider: {
        height: 1,
        backgroundColor: theme.colors.border,
        marginVertical: theme.spacing.lg,
    },
    sourceItem: {
        marginBottom: theme.spacing.sm,
    },
    sourceLabel: {
        ...theme.typography.label,
        color: theme.colors.textSecondary,
    },
    sourceText: {
        ...theme.typography.body,
        color: theme.colors.textPrimary,
        marginTop: 2,
    },
    disclaimer: {
        backgroundColor: theme.colors.surfaceAlt,
        borderRadius: theme.borderRadius.md,
        padding: theme.spacing.md,
        borderLeftWidth: 3,
        borderLeftColor: theme.colors.warning,
    },
    disclaimerText: {
        ...theme.typography.bodySmall,
        color: theme.colors.textSecondary,
        lineHeight: 20,
    },
    link: {
        paddingVertical: theme.spacing.sm,
    },
    linkText: {
        ...theme.typography.body,
        color: theme.colors.primary,
    },
    footer: {
        alignItems: 'center',
        paddingVertical: theme.spacing.xl,
    },
    footerText: {
        ...theme.typography.caption,
        color: theme.colors.textMuted,
    },
});
