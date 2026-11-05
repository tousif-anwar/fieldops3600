import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, InlineNotice, TextButton } from './components';
import { colors, radii, spacing, touch, typography } from './tokens';

const reasons = [
  'Need supervisor assistance',
  'Missing equipment or parts',
  'Safety concern',
  'Predefined answers do not fit',
  'Request reassignment',
];

export function AssistanceSheet({
  visible, online, submitting, error, onClose, onSubmit,
}: {
  visible: boolean;
  online: boolean;
  submitting: boolean;
  error?: string;
  onClose(): void;
  onSubmit(reason: string, detail: string): void;
}) {
  const [reason, setReason] = useState(reasons[0]!);
  const [detail, setDetail] = useState('');
  useEffect(() => {
    if (visible) { setReason(reasons[0]!); setDetail(''); }
  }, [visible]);
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.modalRoot}
      >
        <Pressable accessibilityRole="button" accessibilityLabel="Close assistance request" onPress={onClose} style={styles.backdrop} />
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.heading}>
            <View style={styles.copy}>
              <Text accessibilityRole="header" style={styles.title}>Request assistance</Text>
              <Text style={styles.small}>Your supervisor is notified. The SLA continues unless they approve a pause.</Text>
            </View>
            <TextButton title="Close" onPress={onClose} />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}>
            <Text style={styles.label}>What do you need?</Text>
            {reasons.map((option, index) => {
              const selected = reason === option;
              return (
                <Pressable
                  key={option}
                  accessibilityRole="radio"
                  accessibilityLabel={option}
                  accessibilityState={{ selected }}
                  onPress={() => setReason(option)}
                  style={({ pressed }) => [
                    styles.option,
                    selected && styles.optionSelected,
                    index < reasons.length - 1 && styles.optionBorder,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{option}</Text>
                  <Text style={styles.check}>{selected ? '✓' : ''}</Text>
                </Pressable>
              );
            })}
            <Text style={styles.label}>Optional details</Text>
            <TextInput
              accessibilityLabel="Optional assistance details"
              multiline
              maxLength={800}
              value={detail}
              onChangeText={setDetail}
              placeholder="Add context for your supervisor"
              placeholderTextColor={colors.subtle}
              style={styles.input}
            />
            {!online ? <InlineNotice tone="warning">Connect to request assistance.</InlineNotice> : null}
            {error ? <InlineNotice tone="danger" title="Request not sent">{error}</InlineNotice> : null}
            <Button
              title={submitting ? 'Sending request…' : 'Send assistance request'}
              loading={submitting}
              disabled={!online || submitting}
              onPress={() => onSubmit(reason, detail)}
            />
            <TextButton title="Cancel" onPress={onClose} />
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(17, 35, 31, 0.4)' },
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  sheet: {
    maxHeight: '88%', backgroundColor: colors.surface,
    borderTopLeftRadius: radii.sheet, borderTopRightRadius: radii.sheet,
    paddingHorizontal: spacing.lg, paddingTop: spacing.lg,
  },
  heading: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    gap: spacing.md, paddingBottom: spacing.sm,
  },
  copy: { flex: 1, gap: spacing.xs },
  title: { ...typography.section, color: colors.ink },
  small: { ...typography.small, color: colors.muted },
  scroll: { gap: spacing.sm, paddingBottom: spacing.sm },
  label: { ...typography.label, color: colors.ink, marginTop: spacing.sm },
  option: {
    minHeight: touch.option, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', gap: spacing.md, paddingHorizontal: spacing.sm,
  },
  optionBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  optionSelected: { backgroundColor: colors.primaryWash },
  optionText: { ...typography.body, color: colors.ink, flex: 1 },
  optionTextSelected: { color: colors.primary, fontWeight: '600' },
  check: { ...typography.section, color: colors.primary, minWidth: 24, textAlign: 'right' },
  input: {
    minHeight: 96, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radii.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md, color: colors.ink,
    ...typography.body, textAlignVertical: 'top', backgroundColor: colors.surface,
  },
  pressed: { opacity: 0.76 },
});
