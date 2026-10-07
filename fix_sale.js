const fs = require('fs');
let code = fs.readFileSync('app.js', 'utf8');

const s1 = "if(a.dataset.delete==='sale'){";
const s2 = "notify('\u062a\u0645 \u062d\u0630\u0641 \u0627\u0644\u0633\u0637\u0631 \u0648\u062c\u0645\u064a\u0639 \u0627\u0644\u062a\u0639\u0627\u0645\u0644\u0627\u062a \u0627\u0644\u0645\u0631\u062a\u0628\u0637\u0629 \u0628\u0647 \u0646\u0647\u0627\u0626\u064a\u0627\u064b \u0648\u062a\u062d\u062f\u064a\u062b \u0627\u0644\u0633\u062d\u0627\u0628\u0629');return}";

let i1 = code.indexOf(s1);
if (i1 === -1) {
    console.log("Could not find start");
    process.exit(1);
}
let i2 = code.indexOf(s2, i1);
if (i2 === -1) {
    console.log("Could not find end");
    process.exit(1);
}
let end = i2 + s2.length;

let oldBlock = code.substring(i1, end);

const replacement = "if(a.dataset.delete==='sale'){if(!window.confirm('\u0647\u0644 \u0623\u0646\u062a \u0645\u062a\u0623\u0643\u062f \u0645\u0646 \u0645\u0633\u062d \u0627\u0644\u0633\u0637\u0631 \u0645\u0646 \u0627\u0644\u062f\u0627\u062a\u0627 \u0627\u0644\u0631\u0626\u064a\u0633\u064a\u0629 \u062a\u0645\u0627\u0645\u0627\u064b\u061f'))return;let saleId=Number(a.dataset.id);let sale=data.sales.find(x=>x.id===saleId);if(sale){data.sales=data.sales.filter(x=>x.id!==saleId);data.debts=data.debts.filter(d=>d.id!==saleId);data.agentSettlements.forEach(st=>{if(st.saleIds&&st.saleIds.includes(saleId))st.saleIds=st.saleIds.filter(id=>id!==saleId)});data.agentSettlements=data.agentSettlements.filter(st=>st.saleIds&&st.saleIds.length>0);if(sale.deviceNo){let devKey=String(sale.deviceNo).trim().replace(/[\\\\s-]/g,'');data.codes=data.codes.filter(c=>String(c.value).trim().replace(/[\\\\s-]/g,'')!==devKey);}}await save();render();notify('\u062a\u0645 \u062d\u0630\u0641 \u0627\u0644\u0633\u0637\u0631 \u0648\u062c\u0645\u064a\u0639 \u0627\u0644\u062a\u0639\u0627\u0645\u0644\u0627\u062a \u0627\u0644\u0645\u0631\u062a\u0628\u0637\u0629 \u0628\u0647 \u0646\u0647\u0627\u0626\u064a\u0627\u064b \u0648\u0645\u0646 \u0627\u0644\u062f\u0627\u062a\u0627 \u0627\u0644\u0631\u0626\u064a\u0633\u064a\u0629 \u062a\u0645\u0627\u0645\u0627\u064b');return}";

code = code.substring(0, i1) + replacement + code.substring(end);
fs.writeFileSync('app.js', code);
console.log("Replaced block successfully.");

