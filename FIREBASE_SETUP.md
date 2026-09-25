# تفعيل Firebase لتطبيق الساري

إعداد الويب لمشروع `sari-ebb8e` موجود في `firebase-config.js`. شغّل الموقع عبر HTTPS أو خادم محلي، وليس بفتح ملف `index.html` مباشرة.

## 1. فعّل تسجيل الدخول

من Firebase Console افتح **Build → Authentication → Get started → Sign-in method**، ثم فعّل **Email/Password**.

## 2. أنشئ قاعدة البيانات

افتح **Build → Firestore Database → Create database** وأنشئ قاعدة بوضع الإنتاج.

## 3. أنشئ حساب المدير

من **Authentication → Users → Add user** أنشئ حساب المدير. اسم المستخدم `admin` يتحول داخل التطبيق إلى البريد:

```text
admin@sari-ebb8e.firebaseapp.com
```

اختر كلمة مرور للحساب. بعد إنشاء المستخدم انسخ **UID** الخاص به.

## 4. سجّل دور المدير في Firestore

من تبويب **Data** أنشئ مجموعة `userRoles`، ثم مستنداً يكون معرّفه UID الذي نسخته. أضف الحقول:

```text
role: "admin"      (string)
username: "admin"  (string)
```

أنشئ حساباً لكل وكيل من Authentication بالطريقة نفسها. البريد هو اسم المستخدم متبوعاً بـ`@sari-ebb8e.firebaseapp.com`. لكل UID مستند في `userRoles` بالحقول:

```text
role: "agent"                  (string)
username: "ahmad.j"            (string)
agentCode: "AG-001"            (string)
agentName: "اسم الوكيل كما في التطبيق" (string)
```

استبدل المثال ببيانات كل وكيل. الحسابات وكلمات المرور تُدار من Firebase Authentication، لا من رموز الدخول المحلية القديمة.

## 5. انشر قواعد الأمان

انسخ محتوى `firestore.rules` إلى **Firestore Database → Rules** ثم اضغط **Publish**. القواعد تمنع الوكيل من قراءة بيانات الإدارة، وتسمح له بقراءة نسخته الخاصة وإرسال طلبات البيع فقط. لا تستخدم قواعد مفتوحة للجميع.

## 6. إدارة الحسابات عبر Vercel بدون Blaze

إدارة الحسابات من الموقع تعمل عبر `api/manage-user.js` في Vercel، ولا تحتاج Firebase Functions أو ترقية Blaze. أنشئ مفتاح خدمة من:

**Firebase Console → Project settings → Service accounts → Generate new private key**

لا ترفع ملف JSON إلى GitHub. في Vercel افتح **Project Settings → Environment Variables** وأضف المتغيرات التالية للقيم الموجودة في ملف المفتاح:

```text
FIREBASE_PROJECT_ID=sari-ebb8e
FIREBASE_CLIENT_EMAIL=client_email
FIREBASE_PRIVATE_KEY=private_key
```

أضفها إلى **Production** و**Preview**، ثم أعد النشر. عند نسخ `FIREBASE_PRIVATE_KEY` إلى Vercel اترك قيمة المفتاح كاملة، بما فيها:

```text
-----BEGIN PRIVATE KEY-----
...
-----END PRIVATE KEY-----
```

هذه القيم سرية ولا توضع في `firebase-config.js` أو GitHub. لا تستخدم مفتاح الخدمة في المتصفح.

## 7. Firebase Functions (اختياري)

مسار Functions القديم اختياري فقط إذا قررت استخدام Firebase Functions لاحقاً. مسار Vercel أعلاه هو المسار المستخدم حالياً ولا يحتاج إلى هذه الخطوة. إذا رغبت بنشر المسار القديم، من مجلد المشروع ثبّت Firebase CLI ثم نفّذ:

```text
npm install -g firebase-tools
firebase login
firebase use sari-ebb8e
cd functions
npm install
cd ..
firebase deploy --only functions,firestore:rules
```

بعد النشر ستظهر في صفحة «المستخدمون والأدمن» إمكانية إضافة حساب أدمن أو وكيل، وتغيير اسم المستخدم وكلمة المرور ورمز الوكيل، وحذف الحساب. كلمة المرور لا تُخزّن داخل بيانات التطبيق؛ تحفظها Firebase Authentication فقط.

لأسباب أمنية، لا تضع `serviceAccount.json` أو أي مفتاح خاص داخل المشروع أو GitHub.

## 8. سجّل الدخول وانقل البيانات المحلية

افتح التطبيق على الجهاز الذي يحتوي بيانات `localStorage` الحالية، ثم سجّل الدخول بحساب المدير وكلمة المرور التي أنشأتها. إذا كانت قاعدة Firestore جديدة، يرفع التطبيق بيانات هذا المتصفح أول مرة. بيانات متصفحات أو أجهزة أخرى لا تُدمج تلقائياً؛ صدّرها واحتفظ بنسخة احتياطية قبل النقل.

من صفحة الأكواد اربط كل رقم جهاز باسم المشترك ورمز الوكيل المسؤول عنه حتى يظهر الجهاز للوكيل المناسب. بعدها يستطيع الوكيل تسجيل بيع باسمه، وتصل العملية للإدارة للاعتماد.

إعداد Firebase Web الظاهر في التطبيق ليس مفتاحاً سرياً. لا تنشر Service Account JSON أو مفاتيح خاصة في الموقع أو GitHub.
