import { useState } from 'react';
import {
  Modal, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radii, spacing, touch, typography } from './tokens';
import { TextButton } from './components';

export function DropdownField({
  label, value, options, placeholder = 'Select an answer', required = false,
  disabled = false, error, onChange,
}: {
  label: string;
  value: string;
  options: string[];
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  error?: string;
  onChange(value: string): void;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>
        {label}{required ? ' *' : ''}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}. ${value || placeholder}`}
        accessibilityHint="Opens the list of answers"
        accessibilityState={{ disabled, expanded: open }}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.control, disabled && styles.disabled, pressed && styles.pressed]}
      >
        <Text style={[styles.value, !value && styles.placeholder]} numberOfLines={2}>
          {value || placeholder}
        </Text>
        <Text style={styles.chevron}>▾</Text>
      </Pressable>
      {error ? (
        <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>
          {error}
        </Text>
      ) : null}
      <Modal
        visible={open}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={close}
      >
        <View style={styles.modalRoot}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close answer list"
            onPress={close}
            style={styles.backdrop}
          />
          <SafeAreaView edges={['bottom']} style={styles.sheet}>
            <View style={styles.sheetHeading}>
              <View style={styles.sheetCopy}>
                <Text accessibilityRole="header" style={styles.sheetTitle}>{label}</Text>
                <Text style={styles.sheetHint}>Choose one answer</Text>
              </View>
              <TextButton title="Close" onPress={close} />
            </View>
            {options.length ? (
              <ScrollView keyboardShouldPersistTaps="handled">
                {options.map((option, index) => {
                  const selected = option === value;
                  return (
                    <Pressable
                      key={option}
                      accessibilityRole="radio"
                      accessibilityLabel={option}
                      accessibilityState={{ selected }}
                      onPress={() => { onChange(option); close(); }}
                      style={({ pressed }) => [
                        styles.option,
                        selected && styles.optionSelected,
                        index < options.length - 1 && styles.optionBorder,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
                        {option}
                      </Text>
                      <Text style={[styles.check, selected && styles.checkSelected]}>
                        {selected ? '✓' : ''}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            ) : (
              <Text style={styles.sheetHint}>No answers are configured for this field.</Text>
            )}
          </SafeAreaView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  label: { ...typography.label, color: colors.ink },
  control: {
    minHeight: touch.option, borderWidth: 1, borderColor: colors.borderStrong,
    borderRadius: radii.md, backgroundColor: colors.surface, paddingHorizontal: spacing.md,
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
  },
  value: { ...typography.body, color: colors.ink, flex: 1 },
  placeholder: { color: colors.muted },
  chevron: { ...typography.section, color: colors.muted, lineHeight: 20 },
  error: { ...typography.small, color: colors.danger },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.76 },
  modalRoot: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(17, 35, 31, 0.4)' },
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  sheet: {
    maxHeight: '82%', backgroundColor: colors.surface,
    borderTopLeftRadius: radii.sheet, borderTopRightRadius: radii.sheet,
    paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm,
  },
  sheetHeading: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    gap: spacing.md, paddingBottom: spacing.md,
  },
  sheetCopy: { flex: 1, gap: 2 },
  sheetTitle: { ...typography.section, color: colors.ink },
  sheetHint: { ...typography.small, color: colors.muted },
  option: {
    minHeight: touch.option, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', gap: spacing.md, paddingHorizontal: spacing.sm,
  },
  optionBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  optionSelected: { backgroundColor: colors.primaryWash },
  optionText: { ...typography.body, color: colors.ink, flex: 1 },
  optionTextSelected: { color: colors.primary, fontWeight: '600' },
  check: { ...typography.section, color: colors.primary, minWidth: 24, textAlign: 'right' },
  checkSelected: { color: colors.primary },
});
