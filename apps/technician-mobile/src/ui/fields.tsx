import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, typography } from './tokens';
import { controlStyles, textStyles } from './styles';
import { TextButton } from './components';
import type { FormField } from '../contracts';

export function ServiceField({
  field,
  value,
  disabled,
  error,
  onChange,
}: {
  field: FormField;
  value: string;
  disabled?: boolean;
  error?: string;
  onChange(value: string): void;
}) {
  const [focused, setFocused] = useState(false);
  if (!field.inputType || field.inputType === 'choice')
    return (
      <DropdownField
        label={field.label}
        value={value}
        options={field.options}
        required={field.required}
        disabled={disabled}
        error={error}
        onChange={onChange}
      />
    );
  const numeric = field.inputType === 'number';
  return (
    <View style={styles.field}>
      <Text style={textStyles.label}>
        {field.label}
        {field.required ? ' *' : ''}
      </Text>
      <TextInput
        accessibilityLabel={`${field.label}${field.required ? ', required' : ''}`}
        accessibilityHint={numeric ? 'Enter a number' : 'Enter your service observations'}
        editable={!disabled}
        value={value}
        onChangeText={onChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        inputMode={numeric ? 'decimal' : 'text'}
        multiline={!numeric}
        maxLength={field.maxLength ?? (numeric ? 32 : 2000)}
        style={[
          controlStyles.input,
          !numeric && controlStyles.multiline,
          disabled && controlStyles.disabled,
          focused && controlStyles.focused,
        ]}
        placeholder={numeric ? 'Enter a number' : 'Enter service details'}
        placeholderTextColor={colors.muted}
      />
      {numeric && (field.minimum != null || field.maximum != null) ? (
        <Text style={textStyles.secondary}>
          {field.minimum != null ? `Minimum ${field.minimum}` : ''}
          {field.minimum != null && field.maximum != null ? ' · ' : ''}
          {field.maximum != null ? `Maximum ${field.maximum}` : ''}
        </Text>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function DropdownField({
  label,
  value,
  options,
  placeholder = 'Select an answer',
  required = false,
  disabled = false,
  error,
  onChange,
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
      <Text style={textStyles.label}>
        {label}
        {required ? ' *' : ''}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}. ${value || placeholder}`}
        accessibilityHint="Opens the list of answers"
        accessibilityState={{ disabled, expanded: open }}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.control,
          disabled && controlStyles.disabled,
          pressed && controlStyles.pressed,
        ]}
      >
        <Text style={[styles.value, !value && styles.placeholder]}>{value || placeholder}</Text>
        <Ionicons
          name="chevron-down"
          size={spacing.xl}
          color={colors.muted}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
      </Pressable>
      {error ? (
        <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>
          {error}
        </Text>
      ) : null}
      <Modal
        visible={open}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={close}
      >
        <View style={controlStyles.modal}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close answer list"
            onPress={close}
            style={controlStyles.backdrop}
          />
          <SafeAreaView edges={['bottom']} style={styles.sheet}>
            <View style={controlStyles.sheetHeading}>
              <View style={controlStyles.sheetCopy}>
                <Text accessibilityRole="header" style={textStyles.heading}>
                  {label}
                </Text>
                <Text style={textStyles.secondary}>Choose one answer</Text>
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
                      accessibilityState={{ checked: selected }}
                      onPress={() => {
                        onChange(option);
                        close();
                      }}
                      style={({ pressed }) => [
                        controlStyles.option,
                        selected && controlStyles.selected,
                        index < options.length - 1 && controlStyles.optionBorder,
                        pressed && controlStyles.pressed,
                      ]}
                    >
                      <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
                        {option}
                      </Text>
                      <Ionicons
                        name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                        size={spacing.xl}
                        color={selected ? colors.primary : colors.borderStrong}
                        accessibilityElementsHidden
                        importantForAccessibility="no"
                      />
                    </Pressable>
                  );
                })}
              </ScrollView>
            ) : (
              <Text style={textStyles.secondary}>No answers are configured for this field.</Text>
            )}
          </SafeAreaView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.sm },
  control: { ...controlStyles.input, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  value: { ...typography.body, color: colors.ink, flex: 1 },
  placeholder: { color: colors.muted },
  error: { ...typography.small, color: colors.danger },
  sheet: { ...controlStyles.sheet, paddingBottom: spacing.sm },
  optionText: { ...typography.body, color: colors.ink, flex: 1 },
  optionTextSelected: { color: colors.primary, fontWeight: typography.label.fontWeight },
});
