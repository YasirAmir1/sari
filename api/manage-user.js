const admin = require('firebase-admin');

function getAdmin() {
  if (admin.apps.length) return admin;
  const privateKey = String(process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !privateKey) {
    throw new Error('Firebase Admin environment variables are missing.');
  }
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey
    })
  });
  return admin;
}

const normalizeUsername = value => String(value || '').trim().toLowerCase();
const normalizeRole = value => value === 'وكيل' ? 'agent' : 'admin';

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function validateAccount(data, passwordRequired) {
  const username = normalizeUsername(data.username);
  const name = String(data.name || '').trim();
  const password = String(data.password || '');
  const role = normalizeRole(data.role);
  if (!/^[a-z0-9._-]{3,40}$/i.test(username)) {
    fail(400, 'اسم المستخدم يجب أن يحتوي على 3 أحرف أو أكثر من a-z أو الأرقام أو . _ -.');
  }
  if (!name) fail(400, 'اسم الحساب مطلوب.');
  if (passwordRequired && password.length < 6) {
    fail(400, 'كلمة المرور يجب أن تتكون من 6 أحرف على الأقل.');
  }
  if (!passwordRequired && password && password.length < 6) {
    fail(400, 'كلمة المرور يجب أن تتكون من 6 أحرف على الأقل.');
  }
  return { username, name, password, role };
}

async function requireAdmin(firebaseAdmin, token) {
  if (!token) fail(401, 'يجب تسجيل الدخول أولاً.');
  let decoded;
  try {
    decoded = await firebaseAdmin.auth().verifyIdToken(token);
  } catch {
    fail(401, 'جلسة تسجيل الدخول منتهية. سجّل الدخول مرة أخرى.');
  }
  const role = await firebaseAdmin.firestore().collection('userRoles').doc(decoded.uid).get();
  if (!role.exists || role.data().role !== 'admin') {
    fail(403, 'هذه العملية متاحة للمدير فقط.');
  }
  return decoded;
}

function roleData(account, data, includeCreatedAt) {
  const value = {
    role: account.role,
    username: account.username,
    displayName: account.name,
    agentName: account.role === 'agent' ? account.name : null,
    agentCode: account.role === 'agent' ? String(data.code || '').trim() : null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };
  if (includeCreatedAt) value.createdAt = admin.firestore.FieldValue.serverTimestamp();
  return value;
}

async function manageUser(data, callerUid) {
  const firebaseAdmin = getAdmin();
  const auth = firebaseAdmin.auth();
  const db = firebaseAdmin.firestore();
  const action = String(data.action || '');
  const projectId = process.env.FIREBASE_PROJECT_ID;

  if (action === 'create') {
    const account = validateAccount(data, true);
    const email = `${account.username}@${projectId}.firebaseapp.com`;
    let user;
    try {
      user = await auth.createUser({ email, password: account.password, displayName: account.name });
      await db.collection('userRoles').doc(user.uid).set(roleData(account, data, true));
      return { uid: user.uid, username: account.username, email, role: account.role };
    } catch (error) {
      if (user) await auth.deleteUser(user.uid).catch(() => {});
      if (error.code === 'auth/email-already-exists') fail(409, 'اسم المستخدم مستخدم مسبقاً.');
      throw error;
    }
  }

  if (action === 'provision') {
    const password = String(data.password || '');
    const accounts = Array.isArray(data.accounts) ? data.accounts : [];
    if (password.length < 6) fail(400, 'كلمة المرور المؤقتة يجب أن تتكون من 6 أحرف على الأقل.');
    if (!accounts.length || accounts.length > 100) fail(400, 'لا توجد حسابات صالحة للتفعيل.');
    const results = [];
    for (const item of accounts) {
      const account = validateAccount({...item, password}, true);
      const email = `${account.username}@${projectId}.firebaseapp.com`;
      try {
        await auth.getUserByEmail(email);
        results.push({username: account.username, status: 'exists'});
      } catch (error) {
        if (error.code !== 'auth/user-not-found') throw error;
        const user = await auth.createUser({email, password, displayName: account.name});
        await db.collection('userRoles').doc(user.uid).set(roleData(account, item, true));
        results.push({username: account.username, status: 'created'});
      }
    }
    return {results};
  }

  if (action === 'update') {
    const oldUsername = normalizeUsername(data.oldUsername);
    const account = validateAccount(data, false);
    const oldEmail = oldUsername ? `${oldUsername}@${projectId}.firebaseapp.com` : '';
    let user;
    try {
      if (!oldEmail) fail(400, 'اسم المستخدم القديم مطلوب.');
      user = await auth.getUserByEmail(oldEmail);
    } catch (error) {
      if (error.code !== 'auth/user-not-found') throw error;
      if (!account.password) fail(404, 'هذا الحساب غير مفعّل. أدخل كلمة مرور جديدة لتفعيله.');
      try {
        user = await auth.createUser({
          email: `${account.username}@${projectId}.firebaseapp.com`,
          password: account.password,
          displayName: account.name
        });
        await db.collection('userRoles').doc(user.uid).set(roleData(account, data, true));
        return { uid: user.uid, username: account.username, role: account.role, provisioned: true };
      } catch (createError) {
        if (createError.code === 'auth/email-already-exists') fail(409, 'اسم المستخدم الجديد مستخدم مسبقاً.');
        throw createError;
      }
    }
    const updates = { displayName: account.name };
    if (account.password) updates.password = account.password;
    if (account.username !== oldUsername) {
      updates.email = `${account.username}@${projectId}.firebaseapp.com`;
    }
    try {
      await auth.updateUser(user.uid, updates);
      await db.collection('userRoles').doc(user.uid).set(roleData(account, data, false), { merge: true });
    } catch (error) {
      if (error.code === 'auth/email-already-exists') fail(409, 'اسم المستخدم الجديد مستخدم مسبقاً.');
      if (error.code === 'auth/invalid-password') fail(400, 'كلمة المرور الجديدة غير صالحة.');
      throw error;
    }
    return { uid: user.uid, username: account.username, role: account.role };
  }

  if (action === 'delete') {
    const username = normalizeUsername(data.username);
    if (!username) fail(400, 'اسم المستخدم مطلوب.');
    const user = await auth.getUserByEmail(`${username}@${projectId}.firebaseapp.com`);
    if (user.uid === callerUid) fail(409, 'لا يمكن حذف الحساب المدير المستخدم حالياً.');
    await auth.deleteUser(user.uid);
    await db.collection('userRoles').doc(user.uid).delete();
    return { uid: user.uid };
  }

  fail(400, 'عملية الحساب غير معروفة.');
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') {
    return res.status(200).json({
      ready: Boolean(process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY),
      projectConfigured: Boolean(process.env.FIREBASE_PROJECT_ID),
      clientConfigured: Boolean(process.env.FIREBASE_CLIENT_EMAIL),
      keyConfigured: Boolean(process.env.FIREBASE_PRIVATE_KEY)
    });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const firebaseAdmin = getAdmin();
    const decoded = await requireAdmin(firebaseAdmin, token);
    const result = await manageUser(req.body || {}, decoded.uid);
    return res.status(200).json(result);
  } catch (error) {
    const status = Number(error.status) || (error.code === 'auth/email-already-exists' ? 409 : 500);
    const message = status >= 500
      ? `تعذر تنفيذ إدارة الحساب: ${error.message || 'خطأ في إعدادات Vercel أو Firebase.'}`
      : error.message;
    console.error('manage-user:', error);
    return res.status(status).json({ error: message });
  }
};
