(function () {
  const config = window.SARI_FIREBASE_CONFIG;
  const COLLECTIONS = ['agents', 'sales', 'debts', 'users', 'codes', 'agentSettlements'];
  const ready = Boolean(config?.apiKey && config?.projectId);
  let auth, db, profile = null, currentUser = null, dataCallback = null;
  let listeners = [], cache = Object.create(null), saveQueue = Promise.resolve(), activationPromise = null;

  if (ready && window.firebase) {
    const app = firebase.initializeApp(config);
    auth = firebase.auth(app);
    db = firebase.firestore(app);
    auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(console.error);
  }

  const clone = value => JSON.parse(JSON.stringify(value));
  const roleRef = uid => db.collection('userRoles').doc(uid);
  const rowId = row => String(row.id ?? row.code ?? row.value ?? row.username ?? row.name);
  const paths = (collection, uid) => uid
    ? db.collection('agentData').doc(uid).collection(collection)
    : db.collection('appData').doc(collection).collection('records');

  function normalizeData(value) {
    const out = value || {};
    for (const key of COLLECTIONS) out[key] ||= [];
    out.pricing ||= {agent:{device:45000,subscriptions:{1:18000,2:36000,3:54000}},headquarters:{device:50000,subscriptions:{1:25000,2:50000,3:75000}}};
    return out;
  }

  function includeSignedInAccount(value, role) {
    const users = value.users || (value.users = []);
    if (users.some(user => user.username === role.username)) return false;
    users.push({
      id: `firebase-${role.uid}`,
      name: role.displayName || role.agentName || role.username,
      username: role.username,
      code: role.agentCode || '',
      role: role.role === 'agent' ? 'وكيل' : 'مدير رئيسي'
    });
    return true;
  }

  function remember(data, uid) {
    for (const key of COLLECTIONS) {
      cache[`${uid || 'admin'}:${key}`] = new Map((data[key] || []).map(row => [rowId(row), JSON.stringify(row)]));
    }
    cache[`${uid || 'admin'}:pricing`] = JSON.stringify(data.pricing || {});
  }

  async function writeRows(collection, rows, uid) {
    const key = `${uid || 'admin'}:${collection}`;
    const oldRows = cache[key] || new Map();
    const newRows = new Map((rows || []).map(row => [rowId(row), JSON.stringify(row)]));
    let batch = db.batch(), operations = 0;
    const commitIfFull = async () => { if (operations >= 450) { await batch.commit(); batch = db.batch(); operations = 0; } };
    for (const [id, json] of newRows) {
      if (oldRows.get(id) === json) continue;
      batch.set(paths(collection, uid).doc(id), JSON.parse(json));
      operations++; await commitIfFull();
    }
    for (const id of oldRows.keys()) {
      if (newRows.has(id)) continue;
      batch.delete(paths(collection, uid).doc(id));
      operations++; await commitIfFull();
    }
    if (operations) await batch.commit();
    cache[key] = newRows;
  }

  async function writePricing(pricing, uid) {
    const key = `${uid || 'admin'}:pricing`, json = JSON.stringify(pricing || {});
    if (cache[key] === json) return;
    const ref = uid ? db.collection('agentData').doc(uid).collection('meta').doc('pricing') : db.collection('appData').doc('meta');
    await ref.set({pricing: pricing || {} });
    cache[key] = json;
  }

  function onlyForAgent(allData, role) {
    const agent = (allData.agents || []).find(a => a.code === role.agentCode || a.name === role.agentName) || {};
    const name = agent.name || role.agentName;
    const code = agent.code || role.agentCode;
    const codes = (allData.codes || []).filter(c => c.assignedAgentUid === role.uid || c.assignedAgentCode === code);
    const sales = (allData.sales || []).filter(s => s.seller === name || s.agentUid === role.uid);
    for (const sale of sales) {
      if (sale.deviceNo && !codes.some(c => String(c.value) === String(sale.deviceNo))) {
        codes.push({value:sale.deviceNo,customerName:sale.name,status:'مباع',assignedAgentUid:role.uid,assignedAgentCode:code});
      }
    }
    const user = (allData.users || []).find(u => u.code === code || u.name === name) || {name,code,username:role.username,role:'\u0648\u0643\u064a\u0644'};
    return normalizeData({
      agents: agent.id ? [agent] : [], sales,
      debts: (allData.debts || []).filter(d => d.source === name || d.agentUid === role.uid),
      users: [user], codes,
      agentSettlements: (allData.agentSettlements || []).filter(s => s.agent === name || s.agentUid === role.uid),
      pricing: allData.pricing || {}
    });
  }

  async function replaceAgentView(allData, uid, role) {
    const view = onlyForAgent(allData, {...role,uid});
    for (const collection of COLLECTIONS) await writeRows(collection, view[collection], uid);
    await writePricing(view.pricing, uid);
  }

  async function loadCollection(collection, uid) {
    const snapshot = await paths(collection, uid).get();
    return snapshot.docs.map(doc => ({...doc.data(), id:doc.data().id ?? doc.id}));
  }

  async function readData(uid) {
    const rows = await Promise.all(COLLECTIONS.map(key => loadCollection(key, uid)));
    const pricingRef = uid ? db.collection('agentData').doc(uid).collection('meta').doc('pricing') : db.collection('appData').doc('meta');
    const pricingDoc = await pricingRef.get();
    const value = Object.fromEntries(COLLECTIONS.map((key,index) => [key,rows[index]]));
    value.pricing = pricingDoc.exists ? pricingDoc.data().pricing : undefined;
    return normalizeData(value);
  }

  async function syncAdminSnapshot(data) {
    const roles = await db.collection('userRoles').get();
    const agents = roles.docs.filter(doc => ['agent', 'وكيل'].includes(doc.data().role));
    await Promise.all(agents.map(doc => replaceAgentView(data, doc.id, doc.data())));
  }

  async function saveAdmin(data) {
    for (const collection of COLLECTIONS) await writeRows(collection, data[collection], null);
    await writePricing(data.pricing, null);
    syncAdminSnapshot(data).catch(error => showBackgroundCloudError(error));
  }

  function detach() { listeners.forEach(unsub => unsub()); listeners=[]; }
  function publish(value) { if (dataCallback) dataCallback(normalizeData(clone(value))); }

  function watchAdmin() {
    const state = normalizeData({});
    const rebuild = () => publish(state);
    for (const collection of COLLECTIONS) {
      listeners.push(paths(collection).onSnapshot(snapshot => {
        if (snapshot.metadata.hasPendingWrites) return;
        state[collection] = snapshot.docs.map(doc => ({...doc.data(),id:doc.data().id ?? doc.id}));
        cache[`admin:${collection}`] = new Map(state[collection].map(row => [rowId(row),JSON.stringify(row)]));
        rebuild();
      }, showBackgroundCloudError));
    }
    listeners.push(db.collection('appData').doc('meta').onSnapshot(snapshot => {
      if (snapshot.metadata.hasPendingWrites) return;
      state.pricing = snapshot.exists ? snapshot.data().pricing : undefined;
      cache['admin:pricing'] = JSON.stringify(state.pricing || {});
      rebuild();
    }, showBackgroundCloudError));
  }

  function watchAgent(uid) {
    const state = normalizeData({});
    const rebuild = () => publish(state);
    for (const collection of COLLECTIONS) {
      listeners.push(paths(collection,uid).onSnapshot(snapshot => {
        if (snapshot.metadata.hasPendingWrites) return;
        state[collection] = snapshot.docs.map(doc => ({...doc.data(),id:doc.data().id ?? doc.id}));
        cache[`${uid}:${collection}`] = new Map(state[collection].map(row => [rowId(row),JSON.stringify(row)]));
        rebuild();
      }, showBackgroundCloudError));
    }
    listeners.push(db.collection('agentData').doc(uid).collection('meta').doc('pricing').onSnapshot(snapshot => {
      if (snapshot.metadata.hasPendingWrites) return;
      state.pricing = snapshot.exists ? snapshot.data().pricing : undefined;
      cache[`${uid}:pricing`] = JSON.stringify(state.pricing || {});
      rebuild();
    }, showBackgroundCloudError));
  }

  async function activateInner(user) {
    detach(); currentUser=user; profile=null;
    const roleDoc=await roleRef(user.uid).get();
    if(!roleDoc.exists) throw new Error('لم يُضف حسابك إلى userRoles في Firestore بعد.');
    profile={...roleDoc.data(),uid:user.uid};
    if(!['admin','agent'].includes(profile.role)) throw new Error('دور الحساب غير صالح.');
    let value;
    if(profile.role==='admin') {
      const existing=await readData(null);
      const meta=await db.collection('appData').doc('meta').get();
      if(!meta.exists) { await saveAdmin(window.sariLocalData()); value=await readData(null); }
      else value=existing;
      if (includeSignedInAccount(value, profile)) await saveAdmin(value);
      remember(value,null); publish(value); watchAdmin();
    } else {
      value=await readData(user.uid); remember(value,user.uid); publish(value); watchAgent(user.uid);
    }
    window.sariCloudProfile=profile;
    window.dispatchEvent(new CustomEvent('sari-cloud-ready',{detail:{profile}}));
  }

  async function activate(user) {
    if (activationPromise) return activationPromise;
    activationPromise = activateInner(user);
    try { return await activationPromise; } finally { activationPromise = null; }
  }

  let lastCloudError = '';
  function showCloudError(error, operation = 'مزامنة البيانات', notifyUser = true) {
    console.error('Firebase:',error);
    if (error?.code === 'permission-denied' && !notifyUser) return;
    const message = error?.code === 'permission-denied'
      ? `رفضت قواعد Firebase العملية: ${operation}. تأكد من وجود userRoles للحساب.`
      : 'تعذر مزامنة Firebase؛ تحقق من الاتصال وإعدادات المشروع.';
    if(window.notify && message !== lastCloudError) {
      lastCloudError = message;
      notify(message);
    }
  }
  const showBackgroundCloudError = error => showCloudError(error, 'المزامنة الخلفية', false);

  window.SariCloud={
    ready,
    profile:()=>profile,
    async signIn(username,password) {
      if(!ready) throw new Error('إعداد Firebase غير مكتمل.');
      const email=`${String(username).trim().toLowerCase()}@${config.projectId}.firebaseapp.com`;
      const credential=await auth.signInWithEmailAndPassword(email,password);
      await activate(credential.user);
    },
    async signOut(){detach();profile=null;currentUser=null;await auth.signOut();},
    async save(data){
      if(!ready||!profile)return;
      if(profile.role!=='admin')return;
      saveQueue=saveQueue.then(()=>saveAdmin(clone(data)));
      return saveQueue.catch(error=>{
        showCloudError(error, 'حفظ بيانات المركز');
        throw error;
      });
    },
    async submitSale(sale){
      if(!profile||profile.role!=='agent')throw new Error('حساب الوكيل غير مصادق عليه.');
      const ref=db.collection('agentSubmissions').doc(currentUser.uid).collection('items').doc(String(sale.id));
      await ref.set({submittedBy:currentUser.uid,sale:clone(sale),createdAt:firebase.firestore.FieldValue.serverTimestamp()});
    },
    async manageUser(payload){
      if(!ready||!profile||profile.role!=='admin') throw new Error('هذه العملية متاحة للمدير فقط.');
      const token=await currentUser.getIdToken();
      const response=await fetch('/api/manage-user',{
        method:'POST',
        headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
        body:JSON.stringify(payload)
      });
      const result=await response.json().catch(()=>({}));
      if(!response.ok) throw new Error(result.error||`تعذر تنفيذ إدارة الحساب (HTTP ${response.status}).`);
      return result;
    },
    start(onData,onSignedOut){
      dataCallback=onData;
      if(!ready){onSignedOut?.();return}
      auth.onAuthStateChanged(async user=>{
        if(!user){detach();profile=null;currentUser=null;onSignedOut?.();return}
        try{await activate(user)}catch(error){showCloudError(error);await auth.signOut();onSignedOut?.()}
      });
    }
  };
})();
