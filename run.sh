#!/usr/bin/env bash
# مُشغّل مريح لتطبيق الآلة الحاسبة.
# يضبط Node 20 (المتوافق مع Expo SDK 54) ثم يشغّل خادم التطوير.
#
# الاستخدام:
#   ./run.sh          # يفتح لوحة Expo (رمز QR لـ Expo Go + خيارات الويب/أندرويد/iOS)
#   ./run.sh web      # الويب مباشرة على http://localhost:8081
set -e

# تفعيل Node 20 عبر nvm إن وُجد
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  export NVM_DIR="$HOME/.nvm"
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
  nvm use 20 >/dev/null 2>&1 || nvm use --lts >/dev/null 2>&1 || true
fi

cd "$(dirname "$0")"

case "${1:-}" in
  web)     exec npx expo start --web --port 8081 ;;
  android) exec npx expo start --android ;;
  ios)     exec npx expo start --ios ;;
  *)       exec npx expo start ;;   # لوحة كاملة مع رمز QR
esac
