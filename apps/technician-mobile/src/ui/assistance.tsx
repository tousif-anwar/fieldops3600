import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, InlineNotice, TextButton } from './components';
import { colors, spacing, typography } from './tokens';
import { controlStyles, textStyles } from './styles';

const reasons = [
  'Need supervisor assistance',
  'Missing equipment or parts',
  'Safety concern',
  'Predefined answers do not fit',
  'Request reassignment',
];

export function AssistanceSheet({
  visible,
  online,
  submitting,
  error,
  onClose,
  onSubmit,
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
    if (visible) {
      setReason(reasons[0]!);
      setDetail('');
    }
  }, [visible]);
  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={controlStyles.modal}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close assistance request"
          onPress={onClose}
          style={controlStyles.backdrop}
        />
        <SafeAreaView edges={['bottom']} style={controlStyles.sheet}>
          <View style={controlStyles.sheetHeading}>
            <View style={controlStyles.sheetCopy}>
              <Text accessibilityRole="header" style={textStyles.heading}>
                Request assistance
              </Text>
              <Text style={textStyles.secondary}>
                The deadline continues unless your supervisor approves a pause.
              </Text>
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
                  accessibilityState={{ checked: selected }}
                  onPress={() => setReason(option)}
                  style={({ pressed }) => [
                    controlStyles.option,
                    selected && controlStyles.selected,
                    index < reasons.length - 1 && controlStyles.optionBorder,
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
            <Text style={styles.label}>Optional details</Text>
            <TextInput
              accessibilityLabel="Optional assistance details"
              multiline
              maxLength={800}
              value={detail}
              onChangeText={setDetail}
              placeholder="Add context for your supervisor"
              placeholderTextColor={colors.subtle}
              style={[controlStyles.input, controlStyles.multiline]}
            />
            {!online ? (
              <InlineNotice tone="warning">Connect to request assistance.</InlineNotice>
            ) : null}
            {error ? (
              <InlineNotice tone="danger" title="Request not sent">
                {error}
              </InlineNotice>
            ) : null}
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
  scroll: { gap: spacing.sm, paddingBottom: spacing.sm },
  label: { ...typography.label, color: colors.ink, marginTop: spacing.sm },
  optionText: { ...typography.body, color: colors.ink, flex: 1 },
  optionTextSelected: { color: colors.primary, fontWeight: typography.label.fontWeight },
});
