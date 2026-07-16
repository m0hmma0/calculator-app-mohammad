import React from 'react';
import { View, StyleSheet } from 'react-native';

import CalcButton from './CalcButton';
import { layout } from '../theme';

// تخطيط الأزرار في شبكة 5 صفوف × 4 أعمدة (تشبه آلة iOS الحاسبة).
export default function Keypad({ onAction, activeOperator }) {
  return (
    <View style={styles.keypad}>
      <View style={styles.row}>
        <CalcButton label="AC" type="function" onPress={() => onAction('clear')} />
        <CalcButton label="±" type="function" onPress={() => onAction('sign')} />
        <CalcButton label="%" type="function" onPress={() => onAction('percent')} />
        <CalcButton
          label="÷"
          type="operator"
          active={activeOperator === '÷'}
          onPress={() => onAction('operator', '÷')}
        />
      </View>

      <View style={styles.row}>
        <CalcButton label="7" onPress={() => onAction('digit', 7)} />
        <CalcButton label="8" onPress={() => onAction('digit', 8)} />
        <CalcButton label="9" onPress={() => onAction('digit', 9)} />
        <CalcButton
          label="×"
          type="operator"
          active={activeOperator === '×'}
          onPress={() => onAction('operator', '×')}
        />
      </View>

      <View style={styles.row}>
        <CalcButton label="4" onPress={() => onAction('digit', 4)} />
        <CalcButton label="5" onPress={() => onAction('digit', 5)} />
        <CalcButton label="6" onPress={() => onAction('digit', 6)} />
        <CalcButton
          label="−"
          type="operator"
          active={activeOperator === '−'}
          onPress={() => onAction('operator', '−')}
        />
      </View>

      <View style={styles.row}>
        <CalcButton label="1" onPress={() => onAction('digit', 1)} />
        <CalcButton label="2" onPress={() => onAction('digit', 2)} />
        <CalcButton label="3" onPress={() => onAction('digit', 3)} />
        <CalcButton
          label="+"
          type="operator"
          active={activeOperator === '+'}
          onPress={() => onAction('operator', '+')}
        />
      </View>

      <View style={styles.row}>
        <CalcButton label="⌫" type="function" onPress={() => onAction('backspace')} />
        <CalcButton label="0" onPress={() => onAction('digit', 0)} />
        <CalcButton label="." onPress={() => onAction('dot')} />
        <CalcButton label="=" type="operator" onPress={() => onAction('equals')} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  keypad: {
    width: '100%',
    gap: layout.gap,
  },
  row: {
    flexDirection: 'row',
    gap: layout.gap,
  },
});
