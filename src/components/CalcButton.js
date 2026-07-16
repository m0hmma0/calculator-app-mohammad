import React from 'react';
import { Pressable, Text, StyleSheet } from 'react-native';

import { colors, layout } from '../theme';

// زر واحد في لوحة الآلة الحاسبة.
// type: 'digit' | 'function' | 'operator'
// wide: يجعل الزر يمتد على خانتين (مثل زر 0)
// active: يبرز زر العملية المختارة حالياً
export default function CalcButton({
  label,
  onPress,
  type = 'digit',
  wide = false,
  active = false,
}) {
  const bg =
    type === 'operator'
      ? active
        ? colors.operatorActive
        : colors.operator
      : type === 'function'
      ? colors.function
      : colors.digit;

  const textColor =
    type === 'operator'
      ? active
        ? colors.operatorActiveText
        : colors.operatorText
      : type === 'function'
      ? colors.functionText
      : colors.digitText;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.button,
        wide && styles.wide,
        { backgroundColor: bg },
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.label, { color: textColor }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: layout.radius,
    alignItems: 'center',
    justifyContent: 'center',
    // ظل خفيف موحّد على الويب و iOS و Android (المعمارية الجديدة في RN 0.81)
    boxShadow: '0px 2px 4px rgba(0, 0, 0, 0.25)',
    // على الويب: مؤشر يد
    cursor: 'pointer',
    userSelect: 'none',
  },
  wide: {
    flex: 2,
    aspectRatio: undefined,
  },
  pressed: {
    opacity: 0.6,
  },
  label: {
    fontSize: 32,
    fontWeight: '500',
  },
});
