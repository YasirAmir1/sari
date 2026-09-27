const STORE='sari-app-v1';
const defaultPricing={agent:{device:45000,subscriptions:{1:18000,2:36000,3:54000}},headquarters:{device:50000,subscriptions:{1:25000,2:50000,3:75000}}};
const seed={agents:[{id:1,name:'أحمد الجبوري',phone:'0770 123 4567',code:'AG-001',price:18000},{id:2,name:'علي الكرخي',phone:'0781 456 7890',code:'AG-002',price:18500},{id:3,name:'حسن العبيدي',phone:'0750 321 9876',code:'AG-003',price:17500}],sales:[{id:1,name:'محمد كريم',type:'اشتراك جديد',seller:'المركز الرئيسي',amount:25000,paid:25000,date:today(),code:'SR-1001'},{id:2,name:'سعد ناصر',type:'جهاز جديد',seller:'أحمد الجبوري',amount:45000,paid:30000,date:today(),code:'SR-1002'},{id:3,name:'ضياء علي',type:'تجديد اشتراك',seller:'علي الكرخي',amount:18500,paid:18500,date:day(-1),code:'SR-1003'},{id:4,name:'قاسم فاضل',type:'جهاز جديد',seller:'المركز الرئيسي',amount:50000,paid:20000,date:day(-1),code:'SR-1004'},{id:5,name:'أوس مهدي',type:'اشتراك جديد',seller:'حسن العبيدي',amount:17500,paid:17500,date:day(-2),code:'SR-1005'}],debts:[{id:2,name:'سعد ناصر',phone:'0780 123 1122',source:'أحمد الجبوري',total:45000,paid:30000,due:day(4),note:'دفعة متبقية'},{id:4,name:'قاسم فاضل',phone:'0771 500 2211',source:'المركز الرئيسي',total:50000,paid:20000,due:day(2),note:'جهاز جديد'}],users:[{id:1,name:'مدير المركز',username:'admin',code:'SAR-ADMIN-01',role:'مدير رئيسي'},{id:2,name:'مشرف المبيعات',username:'sales-admin',code:'SAR-ADMIN-02',role:'أدمن'},{id:3,name:'مدير الحسابات',username:'accounts-admin',code:'SAR-ADMIN-03',role:'أدمن'},{id:4,name:'أحمد الجبوري',username:'ahmad.j',code:'AG-001',role:'وكيل'},{id:5,name:'علي الكرخي',username:'ali.k',code:'AG-002',role:'وكيل'},{id:6,name:'حسن العبيدي',username:'hasan.o',code:'AG-003',role:'وكيل'}]};

// تعريف الدوال الأساسية أولاً لتجنب مشاكل الأسبقية
function today(){return new Date().toISOString().slice(0,10)}
function day(n){let d=new Date();d.setDate(d.getDate()+n);return d.toISOString().slice(0,10)}
function accountBadge(profile){if(!profile)return'الحساب الحالي';let username=profile.username||'admin',identity=profile.role==='agent'?(profile.agentName||profile.displayName||username):'الرئيسية';return `${username} · ${identity}`}

const badge = function(){
  let salesBadge = document.querySelector('#sales-badge');
  let debtsBadge = document.querySelector('#debts-badge');
  let todayEl = document.querySelector('#today');

  if(salesBadge) salesBadge.textContent = data?.sales?.length || 0;
  if(debtsBadge) debtsBadge.textContent = data?.debts?.length || 0;

  if(todayEl) {
    let now = new Date(),
        dateText = new Intl.DateTimeFormat('ar-IQ-u-nu-latn',{weekday:'long',day:'numeric',month:'long'}).format(now),
        timeText = new Intl.DateTimeFormat('en-US',{hour:'numeric',minute:'2-digit'}).format(now);
    todayEl.textContent = `${dateText} · ${timeText}`;
  }
};

let data;
try{
  data=JSON.parse(localStorage.getItem(STORE))||structuredClone(seed);
}catch{
  data=structuredClone(seed);
}

const salesAdmin=data.users?.find(u=>u.username==='admin');
if(salesAdmin&&salesAdmin.name!=='مدير مبيعات'){
  salesAdmin.name='مدير مبيعات';
  localStorage.setItem(STORE,JSON.stringify(data));
}

data.codes ||= [];
data.agentSettlements ||= [];
data.pricing ||= structuredClone(defaultPricing);
data.pricing.agent ||= structuredClone(defaultPricing.agent);
data.pricing.headquarters ||= structuredClone(defaultPricing.headquarters);

for(const group of ['agent','headquarters']) {
  data.pricing[group].subscriptions ||= structuredClone(defaultPricing[group].subscriptions);
}

for(const user of data.users.filter(u=>u.role==='وكيل')){
  if(!data.agents.some(a=>a.code===user.code||a.name===user.name)){
    data.agents.push({id:user.id,name:user.name,phone:user.phone||'—',code:user.code,price:Number(data.pricing.agent.device)||0});
  }
}

let view='home',filter='',debtFilter='',agentPanel='sales',query='',installPrompt=null,qrStream=null,qrObserver=null,queryTimer=null,agentSort='asc',subscriberOwnerFilter='',subscriberStatusFilter='';

const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)],
    esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]||c)),
    money=x=>Number(x||0).toLocaleString('en-US');

const save=()=>{
  try {
    localStorage.setItem(STORE,JSON.stringify(data));
  } catch(e) {
    console.error("Local storage save error:", e);
  }

  if(window.SariCloud && typeof window.SariCloud.profile === 'function' && window.SariCloud?.profile()?.role==='admin') {
    return window.SariCloud.save(data).then(()=>{
      notify('تم حفظ البيانات بنجاح');
      return true;
    }).catch(error=>{
      notify(error?.message||'تعذر حفظ البيانات في السحابة، تمت المزامنة محلياً');
      return false;
    });
  }
  notify('تم حفظ البيانات على هذا الجهاز');
  return Promise.resolve(true);
};

function date(x){
  try{
    return new Intl.DateTimeFormat('en-US',{day:'numeric',month:'short',year:'numeric'}).format(new Date(x+'T12:00:00'));
  }catch{
    return x;
  }
}

function addMonths(dateValue,months){
  let [y,m,d]=String(dateValue||today()).split('-').map(Number),
      target=new Date(y,m-1+Number(months),1),
      last=new Date(target.getFullYear(),target.getMonth()+1,0).getDate();
  target.setDate(Math.min(d,last));
  return `${target.getFullYear()}-${String(target.getMonth()+1).padStart(2,'0')}-${String(target.getDate()).padStart(2,'0')}`;
}

function subscriptionMonths(type){
  return String(type||'').includes('3')||String(type||'').includes('ثلاث')?3:String(type||'').includes('شهرين')||String(type||'').includes('2')?2:1;
}

function initials(n){
  return String(n||'').trim().split(/\s+/)[0]?.charAt(0)||'';
}

function fld(label,name,type='text',options={}){
  let full=options.full?' full':'',
      required=options.required===false?'':' required',
      value=options.value??'',
      placeholder=options.placeholder?` placeholder="${esc(options.placeholder)}"`:'',
      attrs=`${options.min!==undefined?` min="${esc(options.min)}"`:''}${options.max!==undefined?` max="${esc(options.max)}"`:''}${options.step!==undefined?` step="${esc(options.step)}"`:''}`;

  let control=type==='select'?
      `<select name="${esc(name)}"${required}>${(options.options||[]).map(x=>`<option value="${esc(x.value)}"${String(x.value)===String(value)?' selected':''}>${esc(x.label)}</option>`).join('')}</select>`:
      `<input name="${esc(name)}" type="${esc(type)}" value="${esc(value)}"${required}${placeholder}${attrs}>`;

  return `<div class="field${full}"><label for="${esc(name)}">${esc(label)}</label>${control}</div>`;
}

function notify(s){
  let t=$('#toast');
  if(!t) return;
  t.textContent=s;
  t.classList.add('show');
  clearTimeout(notify.t);
  notify.t=setTimeout(()=>t.classList.remove('show'),2400);
}

function heading(title,sub,action=''){
  let greet=view==='home'?(new Date().getHours()<12?'صباح الخير، أهلاً بك':'مساء الخير، أهلاً بك'):'إدارة النظام';
  return `<div class="heading"><div><small>${greet}</small><h1>${title}</h1><p>${sub}</p></div>${action?`<div class="heading-actions"><button class="button primary" data-action="${action}"><span class="plus">＋</span>${({sale:'تسجيل عملية بيع',agent:'إضافة وكيل',debt:'إضافة دين',user:'إضافة مستخدم',code:'توليد أكواد'})[action]}</button>${action==='sale'?'<button class="button primary" data-action="new-device-sale">بيع جهاز جديد</button><button class="button primary" data-action="agent-invoice">تسجيل عملية بيع للوكيل</button>':''}${action==='debt'?'<button class="button secondary" data-action="export-debts"><span class="plus">⇩</span>تصدير الديون</button>':''}</div>`:''}</div>`;
}

function stat(name,value,unit,icon,foot){
  return `<div class="stat"><div class="stat-top"><span>${name}</span><span class="stat-icon">${icon}</span></div><div class="stat-value">${value}<small>${unit||''}</small></div><div class="stat-foot">${foot}</div></div>`;
}

function state(paid,amount){
  return paid>=amount?'<span class="status">مكتمل</span>':'<span class="status debt">عليه دين</span>';
}

function render(){
  badge();
  let main=$('#main-content');
  if(!main) return;

  if(view==='home'){
    let totalSales=data.sales.reduce((a,b)=>a+Number(b.amount||0),0);
    let totalDebts=data.debts.reduce((a,b)=>a+(Number(b.total||0)-Number(b.paid||0)),0);
    let totalAgents=data.agents.length;

    main.innerHTML=`
      ${heading('لوحة التحكم','نظرة عامة على المبيعات والنشاط اليومي','sale')}
      <div class="stats">
        ${stat('إجمالي المبيعات', money(totalSales), 'د.ع', '💰', 'المبيعات الكلية المسجلة')}
        ${stat('الديون المتبقية', money(totalDebts), 'د.ع', '⚠️', 'المبالغ الواجب تحصيلها')}
        ${stat('الوكلاء النشطون', totalAgents, 'وكيل', '🤝', 'المسجلين في النظام')}
      </div>
      <div class="card">
        <h3>أحدث العمليات</h3>
        <div class="table-wrap">
          <table>
            <thead><tr><th>المستفيد</th><th>النوع</th><th>البائع</th><th>المبلغ</th><th>الحالة</th></tr></thead>
            <tbody>
              ${data.sales.slice(-5).reverse().map(s=>`
                <tr>
                  <td>${esc(s.name)}</td>
                  <td>${esc(s.type)}</td>
                  <td>${esc(s.seller)}</td>
                  <td>${money(s.amount)} د.ع</td>
                  <td>${state(s.paid, s.amount)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }
}

document.addEventListener('DOMContentLoaded', ()=>{
  render();
});