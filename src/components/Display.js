import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

import { colors } from '../theme';

// شاشة العرض: سطر علوي صغير للعملية الجارية، وسطر كبير للنتيجة.
export default function Display({ value, expression }) {
  // نصغّر حجم الخط تلقائياً كلما طال الرقم حتى لا يخرج عن الشاشة.
  const length = value.length;
  const fontSize = length > 9 ? 48 : length > 6 ? 64 : 80;

  return (
    <View style={styles.container}>
      <Text style={styles.expression} numberOfLines={1}>
        {expression || ' '}
      </Text>
      <Text
        style={[styles.value, { fontSize }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.4}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    justifyContent: 'flex-end',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  expression: {
    color: colors.displaySecondary,
    fontSize: 22,
    fontWeight: '400',
    marginBottom: 6,
  },
  value: {
    color: colors.displayText,
    fontWeight: '300',
  },
});
