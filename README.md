# الآلة الحاسبة — Calculator App

تطبيق آلة حاسبة مبني بـ **React Native + Expo SDK 54**، يعمل على:

- 🌐 **الويب** (react-native-web)
- 🤖 **أندرويد** (Google Play)
- 🍏 **iOS** (App Store)
- 📱 **Expo Go** بدون مشاكل توافقية (SDK 54)

بتصميم داكن أنيق يشبه آلة iOS الحاسبة، ودعم لوحة المفاتيح على الويب.

---

## المتطلبات

- **Node.js 20 LTS** (SDK 54 يتطلب Node ≥ 20). المشروع مضبوط لاستخدام Node 20 عبر `nvm`.
- للأجهزة: تطبيق **Expo Go** على هاتفك (من Play Store أو App Store).

```bash
nvm use 20      # أو: nvm install 20
```

---

## التشغيل

### الطريقة السريعة (مُوصى بها)

```bash
./run.sh          # يفتح لوحة Expo كاملة مع رمز QR
./run.sh web      # الويب مباشرة على http://localhost:8081
```

### أو يدوياً

```bash
npm install       # أول مرة فقط
npx expo start    # لوحة Expo (اضغط w للويب، a لأندرويد، i لـ iOS)
npx expo start --web   # الويب مباشرة
```

بعد التشغيل:

| المنصّة | كيف |
|---------|-----|
| **الويب** | افتح http://localhost:8081 أو اضغط `w` |
| **الهاتف (Expo Go)** | امسح رمز QR الظاهر في الطرفية بتطبيق Expo Go |
| **محاكي أندرويد** | اضغط `a` |
| **محاكي iOS** (على macOS) | اضغط `i` |

### المعاينة الحية (Fast Refresh)

عند تشغيل `npx expo start`، أي تعديل تحفظه في ملفات الشيفرة **ينعكس فوراً** في المتصفح أو Expo Go دون إعادة تحميل يدوية، مع الحفاظ على حالة التطبيق.

---

## بنية المشروع

```
.
├── App.js                      # المكوّن الجذر + reducer + دعم لوحة المفاتيح على الويب
├── index.js                    # نقطة الدخول (registerRootComponent)
├── app.json                    # إعدادات Expo (الأيقونات، المعرّفات، الويب)
├── babel.config.js             # babel-preset-expo
├── run.sh                      # مُشغّل مريح (يضبط Node 20)
├── assets/                     # الأيقونات وشاشة البداية
└── src/
    ├── theme.js                # الألوان والقياسات الموحّدة
    ├── logic/
    │   └── calculator.js       # منطق الحساب كدوال نقيّة (قابلة للاختبار)
    └── components/
        ├── Display.js          # الشاشة (سطر العملية + النتيجة)
        ├── Keypad.js           # شبكة الأزرار 5×4
        └── CalcButton.js       # زر واحد (رقم / وظيفة / عملية)
```

---

## المزايا

- العمليات الأساسية: `+ − × ÷`، النسبة `%`، عكس الإشارة `±`، الحذف `⌫`.
- سلسلة عمليات متتابعة (مثل `2 + 3 × 4`).
- عرض العملية الجارية في سطر علوي صغير.
- تصغير حجم الخط تلقائياً للأرقام الطويلة، وحدّ أقصى لعدد الخانات لتفادي الأخطاء.
- **دعم لوحة المفاتيح على الويب**: الأرقام، `+ - * /`، `Enter`/`=`، `Backspace`، `Esc` (مسح)، `%`.

---

## البناء والنشر للمتاجر (EAS Build)

Expo Go رائع للتطوير، ولنشر نسخة مستقلة على المتاجر استخدم **EAS Build**:

```bash
npm install -g eas-cli
eas login
eas build:configure

# بناء للأندرويد (AAB لـ Google Play)
eas build --platform android

# بناء لـ iOS (يتطلب حساب Apple Developer)
eas build --platform ios

# النشر التلقائي إلى المتاجر
eas submit --platform android
eas submit --platform ios
```

### الويب (نشر ثابت)

```bash
npx expo export --platform web    # يُخرج مجلد dist/ جاهز للاستضافة
```

> قبل النشر، عدّل `bundleIdentifier` (iOS) و `package` (أندرويد) في `app.json` إلى معرّف نطاقك الخاص بدل `com.example.calculator`.
