import React, { useReducer, useEffect, useCallback } from 'react';
import { View, StyleSheet, Platform, useWindowDimensions } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import Display from './src/components/Display';
import Keypad from './src/components/Keypad';
import { colors, layout } from './src/theme';
import {
  initialState,
  inputDigit,
  inputDot,
  clearAll,
  toggleSign,
  inputPercent,
  performOperation,
  backspace,
} from './src/logic/calculator';

// مُخفِّض (reducer) يوجّه كل حدث إلى الدالة المناسبة في منطق الآلة الحاسبة.
function reducer(state, action) {
  switch (action.type) {
    case 'digit':
      return inputDigit(state, action.value);
    case 'dot':
      return inputDot(state);
    case 'clear':
      return clearAll();
    case 'sign':
      return toggleSign(state);
    case 'percent':
      return inputPercent(state);
    case 'operator':
      return performOperation(state, action.value);
    case 'equals':
      return performOperation(state, '=');
    case 'backspace':
      return backspace(state);
    default:
      return state;
  }
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const { width } = useWindowDimensions();

  // مُرسِل موحّد تستدعيه لوحة الأزرار.
  const onAction = useCallback((type, value) => {
    dispatch({ type, value });
  }, []);

  // دعم لوحة المفاتيح على الويب (تجربة أفضل في المتصفح).
  useEffect(() => {
    if (Platform.OS !== 'web') return;

    const handler = (e) => {
      const k = e.key;
      if (k >= '0' && k <= '9') onAction('digit', Number(k));
      else if (k === '.') onAction('dot');
      else if (k === '+') onAction('operator', '+');
      else if (k === '-') onAction('operator', '−');
      else if (k === '*') onAction('operator', '×');
      else if (k === '/') { e.preventDefault(); onAction('operator', '÷'); }
      else if (k === 'Enter' || k === '=') { e.preventDefault(); onAction('equals'); }
      else if (k === 'Backspace') onAction('backspace');
      else if (k === 'Escape') onAction('clear');
      else if (k === '%') onAction('percent');
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onAction]);

  // نحدّ عرض المحتوى على الشاشات العريضة (الويب/الأجهزة اللوحية).
  const panelWidth = Math.min(width - 32, layout.maxWidth);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safe}>
        <StatusBar style="light" />
        <View style={styles.center}>
          <View style={[styles.panel, { width: panelWidth }]}>
            <Display value={state.display} expression={state.expression} />
            <Keypad onAction={onAction} activeOperator={state.operator} />
          </View>
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  panel: {
    // نحجز مساحة سفلية أكبر قليلاً على الويب لجماليات التخطيط.
    ...Platform.select({
      web: { paddingBottom: 24 },
      default: {},
    }),
  },
});
