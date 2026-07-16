// منطق الآلة الحاسبة كدوال نقيّة (pure functions) لسهولة الاختبار وإعادة الاستخدام.
// الحالة (state) تتكوّن من:
//   display            : النص المعروض حالياً
//   previousValue      : القيمة المخزّنة قبل العملية (أو null)
//   operator           : العملية المنتظرة (+ − × ÷) أو null
//   waitingForOperand  : هل ننتظر إدخال رقم جديد بعد ضغط عملية؟
//   expression         : نص العملية الجارية لعرضه في السطر العلوي

export const initialState = {
  display: '0',
  previousValue: null,
  operator: null,
  waitingForOperand: false,
  expression: '',
};

const MAX_DIGITS = 12;

// يحوّل الرقم إلى نص مقروء بدون فقدان الدقة قدر الإمكان.
function formatNumber(value) {
  if (!isFinite(value)) return 'خطأ';

  // نتفادى الترميز العلمي للأرقام المتوسطة، ونحدّ عدد المنازل.
  let str = String(value);
  if (str.replace(/[-.]/g, '').length > MAX_DIGITS) {
    // نقرّب لعدد مناسب من الأرقام المعنوية.
    str = value.toPrecision(MAX_DIGITS);
    // إزالة الأصفار الزائدة بعد الفاصلة.
    if (str.indexOf('.') !== -1) {
      str = str.replace(/\.?0+$/, '');
    }
    // إزالة الأصفار الزائدة في الترميز العلمي.
    str = String(parseFloat(str));
  }
  return str;
}

function compute(a, b, operator) {
  switch (operator) {
    case '+':
      return a + b;
    case '−':
      return a - b;
    case '×':
      return a * b;
    case '÷':
      return b === 0 ? Infinity : a / b;
    default:
      return b;
  }
}

// إدخال رقم (0-9)
export function inputDigit(state, digit) {
  const { display, waitingForOperand } = state;

  if (waitingForOperand) {
    return { ...state, display: String(digit), waitingForOperand: false };
  }

  // نمنع تجاوز الحد الأقصى لعدد الأرقام.
  if (display.replace(/[-.]/g, '').length >= MAX_DIGITS) {
    return state;
  }

  return {
    ...state,
    display: display === '0' ? String(digit) : display + digit,
  };
}

// إدخال الفاصلة العشرية
export function inputDot(state) {
  const { display, waitingForOperand } = state;

  if (waitingForOperand) {
    return { ...state, display: '0.', waitingForOperand: false };
  }

  if (display.indexOf('.') === -1) {
    return { ...state, display: display + '.' };
  }

  return state;
}

// مسح كل شيء (AC)
export function clearAll() {
  return { ...initialState };
}

// عكس الإشارة (±)
export function toggleSign(state) {
  const value = parseFloat(state.display) * -1;
  return { ...state, display: formatNumber(value) };
}

// النسبة المئوية (%)
export function inputPercent(state) {
  const value = parseFloat(state.display) / 100;
  return { ...state, display: formatNumber(value) };
}

// تنفيذ عملية حسابية (+ − × ÷) أو المساواة (=)
export function performOperation(state, nextOperator) {
  const { display, previousValue, operator } = state;
  const inputValue = parseFloat(display);

  // إذا كنا ننتظر معاملاً وضغط المستخدم عملية أخرى، نغيّر العملية فقط.
  if (state.waitingForOperand && operator && nextOperator !== '=') {
    return {
      ...state,
      operator: nextOperator,
      expression: `${formatNumber(previousValue)} ${nextOperator}`,
    };
  }

  let newValue = inputValue;

  if (previousValue == null) {
    newValue = inputValue;
  } else if (operator) {
    newValue = compute(previousValue, inputValue, operator);
  }

  const formatted = formatNumber(newValue);

  if (nextOperator === '=') {
    // انتهت العملية: نعرض النتيجة ونصفّر السلسلة.
    return {
      ...initialState,
      display: formatted === 'خطأ' ? 'خطأ' : formatted,
      expression:
        previousValue != null && operator
          ? `${formatNumber(previousValue)} ${operator} ${formatNumber(
              inputValue,
            )} =`
          : '',
    };
  }

  return {
    ...state,
    display: formatted,
    previousValue: newValue,
    operator: nextOperator,
    waitingForOperand: true,
    expression: `${formatted} ${nextOperator}`,
  };
}

// حذف آخر خانة (⌫)
export function backspace(state) {
  const { display, waitingForOperand } = state;

  if (waitingForOperand) return state;

  if (display.length <= 1 || (display.length === 2 && display.startsWith('-'))) {
    return { ...state, display: '0' };
  }

  return { ...state, display: display.slice(0, -1) };
}
