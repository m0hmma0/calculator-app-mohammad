// نظام الألوان والقياسات الموحّد للتطبيق.
// يدعم الوضع الداكن (الافتراضي) بأسلوب يشبه آلة iOS الحاسبة.

export const colors = {
  background: '#17171C',
  display: '#17171C',
  displayText: '#FFFFFF',
  displaySecondary: '#8E8E93',

  // أزرار الأرقام (رمادي داكن)
  digit: '#2E2F38',
  digitText: '#FFFFFF',

  // الأزرار الوظيفية العلوية (AC، ±، %)
  function: '#4E505F',
  functionText: '#FFFFFF',

  // أزرار العمليات (÷ × − + =)
  operator: '#FF9F0A',
  operatorText: '#FFFFFF',
  operatorActive: '#FFFFFF',
  operatorActiveText: '#FF9F0A',
};

export const layout = {
  gap: 12,
  radius: 40,
  maxWidth: 420, // يحدّ عرض اللوحة على الويب لتبدو كهاتف
};
