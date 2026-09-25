const { onCall, HttpsError } = require('firebase-functions/v1/https');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();
const auth = admin.auth();

const normalizeUsername = value => String(value || '').trim().toLowerCase();
const normalizeRole = value => value === 'وكيل' ? 'agent' : 'admin';

async function requireAdmin(context) {
  if (!context.auth) throw new HttpsError('unauthenticated', 'يجب تسجيل الدخول أولاً.');
  const doc = await db.collection('userRoles').doc(context.auth.uid).get();
  if (!doc.exists || doc.data().role !== 'admin') {
    throw new HttpsError('permission-denied', 'هذه العملية متاحة للمدير فقط.');
  }
  return doc.data();
}

function validateAccount(data, { passwordRequired }) {
  const username = normalizeUsername(data.username);
  const name = String(data.name || '').trim();
  const password = String(data.password || '');
  const role = normalizeRole(data.role);
  if (!/^[a-z0-9._-]{3,40}$/i.test(username)) {
    throw new HttpsError('invalid-argument', 'اسم المستخدم يجب أن يحتوي على 3 أحرف أو أكثر من a-z أو الأرقام أو . _ -.');
  }
  if (!name) throw new HttpsError('invalid-argument', 'اسم الحساب مطلوب.');
  if (passwordRequired && password.length < 6) {
    throw new HttpsError('invalid-argument', 'كلمة المرور يجب أن تتكون من 6 أحرف على الأقل.');
  }
  if (!passwordRequired && password && password.length < 6) {
    throw new HttpsError('invalid-argument', 'كلمة المرور يجب أن تتكون من 6 أحرف على الأقل.');
  }
  return { username, name, password, role };
}

exports.manageUser = onCall(async (data, context) => {
  await requireAdmin(context);
  const action = String(data?.action || '');

  if (action === 'create') {
    const account = validateAccount(data, { passwordRequired: true });
    const email = `${account.username}@${process.env.GCLOUD_PROJECT}.firebaseapp.com`;
    let user;
    try {
      user = await auth.createUser({
        email,
        password: account.password,
        displayName: account.name
      });
      await db.collection('userRoles').doc(user.uid).set({
        role: account.role,
        username: account.username,
        displayName: account.name,
        agentName: account.role === 'agent' ? account.name : null,
        agentCode: account.role === 'agent' ? String(data.code || '').trim() : null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      return { uid: user.uid, username: account.username, email, role: account.role };
    } catch (error) {
      if (user) await auth.deleteUser(user.uid).catch(() => {});
      if (error.code === 'auth/email-already-exists') {
        throw new HttpsError('already-exists', 'اسم المستخدم مستخدم مسبقاً.');
      }
      throw new HttpsError('internal', 'تعذر إنشاء الحساب.');
    }
  }

  if (action === 'update') {
    const oldUsername = normalizeUsername(data.oldUsername);
    const account = validateAccount(data, { passwordRequired: false });
    if (!oldUsername) throw new HttpsError('invalid-argument', 'اسم المستخدم القديم مطلوب.');
    const email = `${oldUsername}@${process.env.GCLOUD_PROJECT}.firebaseapp.com`;
    let user;
    try {
      user = await auth.getUserByEmail(email);
    } catch {
      if (!account.password) {
        throw new HttpsError('not-found', 'هذا الحساب غير مفعّل في Firebase. أدخل كلمة مرور جديدة لتفعيله.');
      }
      try {
        user = await auth.createUser({
          email: `${account.username}@${process.env.GCLOUD_PROJECT}.firebaseapp.com`,
          password: account.password,
          displayName: account.name
        });
        await db.collection('userRoles').doc(user.uid).set({
          role: account.role,
          username: account.username,
          displayName: account.name,
          agentName: account.role === 'agent' ? account.name : null,
          agentCode: account.role === 'agent' ? String(data.code || '').trim() : null,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        return { uid: user.uid, username: account.username, role: account.role, provisioned: true };
      } catch (error) {
        if (error.code === 'auth/email-already-exists') {
          throw new HttpsError('already-exists', 'اسم المستخدم الجديد مستخدم مسبقاً.');
        }
        throw new HttpsError('internal', 'تعذر تفعيل الحساب القديم.');
      }
    }
    const updates = { displayName: account.name };
    if (account.password) updates.password = account.password;
    if (account.username !== oldUsername) {
      updates.email = `${account.username}@${process.env.GCLOUD_PROJECT}.firebaseapp.com`;
    }
    try {
      await auth.updateUser(user.uid, updates);
      await db.collection('userRoles').doc(user.uid).set({
        role: account.role,
        username: account.username,
        displayName: account.name,
        agentName: account.role === 'agent' ? account.name : null,
        agentCode: account.role === 'agent' ? String(data.code || '').trim() : null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      return { uid: user.uid, username: account.username, role: account.role };
    } catch (error) {
      if (error.code === 'auth/email-already-exists') {
        throw new HttpsError('already-exists', 'اسم المستخدم الجديد مستخدم مسبقاً.');
      }
      throw new HttpsError('internal', 'تعذر تحديث الحساب.');
    }
  }

  if (action === 'delete') {
    const username = normalizeUsername(data.username);
    if (!username) throw new HttpsError('invalid-argument', 'اسم المستخدم مطلوب.');
    const email = `${username}@${process.env.GCLOUD_PROJECT}.firebaseapp.com`;
    let user;
    try {
      user = await auth.getUserByEmail(email);
    } catch {
      throw new HttpsError('not-found', 'لم يتم العثور على حساب Firebase لهذا المستخدم.');
    }
    if (user.uid === context.auth.uid) {
      throw new HttpsError('failed-precondition', 'لا يمكن حذف الحساب المدير المستخدم حالياً.');
    }
    await auth.deleteUser(user.uid);
    await db.collection('userRoles').doc(user.uid).delete();
    return { uid: user.uid };
  }

  throw new HttpsError('invalid-argument', 'عملية الحساب غير معروفة.');
});
