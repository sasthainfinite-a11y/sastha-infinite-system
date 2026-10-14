const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const AUTH_ENABLED = Boolean(ADMIN_USERNAME && ADMIN_PASSWORD);
if (process.env.NODE_ENV === 'production' && !AUTH_ENABLED) {
  console.error('Startup blocked: set ADMIN_USERNAME and ADMIN_PASSWORD before production deployment.');
  process.exit(1);
}
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, 'sastha-infinite.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS job_sheets (id INTEGER PRIMARY KEY AUTOINCREMENT, job_number TEXT NOT NULL UNIQUE, job_date TEXT NOT NULL, customer_name TEXT, payload TEXT NOT NULL, created_at TEXT NOT NULL);`);
app.disable('x-powered-by');
app.use(express.json({limit:'15mb'}));
app.use((req,res,next)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');next()});
app.get('/api/health',(req,res)=>res.json({ok:true,database:'SQLite',timestamp:new Date().toISOString()}));
// Protect all app pages and APIs with HTTP Basic Auth when credentials are configured.
// The public health endpoint intentionally exposes no business data and remains available to Render.
app.use((req,res,next)=>{
  if (!AUTH_ENABLED || req.path === '/api/health') return next();
  const header = req.headers.authorization || '';
  if (header.startsWith('Basic ')) {
    let decoded = '';
    try { decoded = Buffer.from(header.slice(6), 'base64').toString('utf8'); } catch (_) {}
    const splitAt = decoded.indexOf(':');
    if (splitAt >= 0) {
      const suppliedUser = decoded.slice(0, splitAt);
      const suppliedPass = decoded.slice(splitAt + 1);
      const equals = (a, b) => { const x=Buffer.from(a); const y=Buffer.from(b); return x.length===y.length && crypto.timingSafeEqual(x,y); };
      if (equals(suppliedUser, ADMIN_USERNAME) && equals(suppliedPass, ADMIN_PASSWORD)) return next();
    }
  }
  res.setHeader('WWW-Authenticate', 'Basic realm=\"Sastha Infinite Business System\", charset=\"UTF-8\"');
  return res.status(401).type('text').send('Authentication required.');
});
app.get('/api/database',(req,res)=>{const row=db.prepare('SELECT payload FROM app_state WHERE id=1').get();if(!row)return res.json(null);try{return res.json(JSON.parse(row.payload))}catch(e){return res.status(500).json({error:'Database payload could not be read'})}});
app.put('/api/database',(req,res)=>{if(!req.body||typeof req.body!=='object'||Array.isArray(req.body))return res.status(400).json({error:'Expected a database object'});const payload=JSON.stringify(req.body);db.prepare(`INSERT INTO app_state(id,payload,updated_at) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at`).run(payload,new Date().toISOString());res.json({ok:true,updatedAt:new Date().toISOString()})});
app.get('/api/job-sheets/next-number',(req,res)=>{const raw=String(req.query.date||new Date().toISOString().slice(0,10));if(!/^\d{4}-\d{2}-\d{2}$/.test(raw))return res.status(400).json({error:'Invalid date'});const day=raw.replace(/-/g,'');const prefix='SI-'+day+'-';const row=db.prepare("SELECT MAX(CAST(substr(job_number, length(?) + 1) AS INTEGER)) AS n FROM job_sheets WHERE job_number LIKE ?").get(prefix,prefix+'%');res.json({jobNo:prefix+String((row.n||0)+1).padStart(3,'0')})});
app.get('/api/job-sheets',(req,res)=>{const rows=db.prepare('SELECT job_number,job_date,customer_name,payload,created_at FROM job_sheets ORDER BY id DESC LIMIT 500').all();res.json(rows.map(r=>({...r,payload:JSON.parse(r.payload)})))});
app.post('/api/job-sheets',(req,res)=>{const p=req.body;if(!p||!p.jobDate)return res.status(400).json({error:'jobDate is required'});try{const day=String(p.jobDate).replace(/-/g,'');if(!/^\d{8}$/.test(day))return res.status(400).json({error:'Invalid job date'});const prefix='SI-'+day+'-';const tx=db.transaction(()=>{let jobNo=String(p.jobNo||'');if(!jobNo||jobNo==='PENDING'||db.prepare('SELECT 1 FROM job_sheets WHERE job_number=?').get(jobNo)){const row=db.prepare("SELECT MAX(CAST(substr(job_number, length(?) + 1) AS INTEGER)) AS n FROM job_sheets WHERE job_number LIKE ?").get(prefix,prefix+'%');let seq=(row.n||0)+1;jobNo=prefix+String(seq).padStart(3,'0');while(db.prepare('SELECT 1 FROM job_sheets WHERE job_number=?').get(jobNo)){seq++;jobNo=prefix+String(seq).padStart(3,'0')}}const payload={...p,jobNo};db.prepare('INSERT INTO job_sheets(job_number,job_date,customer_name,payload,created_at) VALUES(?,?,?,?,?)').run(jobNo,String(p.jobDate),String(p.customer||''),JSON.stringify(payload),new Date().toISOString());return jobNo});const jobNo=tx();res.status(201).json({ok:true,jobNo})}catch(e){if(String(e.message).includes('UNIQUE'))return res.status(409).json({error:'This job number already exists'});res.status(500).json({error:'Could not save job sheet'})}});

// Unified document search and PDF delivery endpoints
function readBusinessState(){const row=db.prepare('SELECT payload FROM app_state WHERE id=1').get();if(!row)return {};try{return JSON.parse(row.payload)||{}}catch{return {}}}
function safeTotal(kind,d){if(kind==='invoice')return (d.items||[]).reduce((a,x)=>a+(Number(x.qty)||0)*(Number(x.rate)||0),0)-(Number(d.discount)||0)+(Number(d.tax)||0);if(kind==='voucher')return Number(d.amount)||0;return (d.items||[]).reduce((a,x)=>a+(Number(x.qty)||0)*(Number(x.rate)||0),0)}
function getDoc(kind,id){if(kind==='job-sheet'){const r=db.prepare('SELECT job_number,job_date,payload FROM job_sheets WHERE job_number=? OR CAST(id AS TEXT)=?').get(id,id);return r?{kind:'job-sheet',id:r.job_number,number:r.job_number,date:r.job_date,...JSON.parse(r.payload)}:null}const state=readBusinessState();let d=null;if(kind==='invoice')d=(state.invoices||[]).find(x=>String(x.id)===String(id));else if(kind==='voucher')d=(state.vouchers||[]).find(x=>String(x.id)===String(id));else if(kind==='quotation')d=(state.documents||[]).find(x=>String(x.id)===String(id)&&x.type==='Quotation');else if(kind==='delivery')d=(state.documents||[]).find(x=>String(x.id)===String(id)&&x.type==='Delivery Order');else if(kind==='other')d=(state.documents||[]).find(x=>String(x.id)===String(id));return d?{...d,kind}:null}
function allSearchDocs(){const state=readBusinessState();const rows=[];for(const d of state.invoices||[])rows.push({kind:'invoice',id:d.id,number:d.number,date:d.date,company:d.business||'',customer:d.customerName||'',customerCompany:d.company||'',email:d.customerEmail||d.email||'',total:safeTotal('invoice',d),status:d.status||'',raw:d});for(const d of state.documents||[])rows.push({kind:d.type==='Quotation'?'quotation':d.type==='Delivery Order'?'delivery':'other',id:d.id,number:d.number,date:d.date,company:d.business||'',customer:d.customerName||'',customerCompany:d.company||'',email:d.customerEmail||d.email||'',total:safeTotal('document',d),status:d.status||'',raw:d});for(const d of state.vouchers||[])rows.push({kind:'voucher',id:d.id,number:d.number,date:d.date,company:d.business||'',customer:d.payee||'',customerCompany:'',email:d.customerEmail||d.email||'',total:safeTotal('voucher',d),status:d.status||'Recorded',raw:d});for(const r of db.prepare('SELECT job_number,job_date,payload FROM job_sheets ORDER BY id DESC').all()){let p={};try{p=JSON.parse(r.payload)}catch{}rows.push({kind:'job-sheet',id:r.job_number,number:r.job_number,date:r.job_date,company:p.business||'IT Services',customer:p.customer||'',customerCompany:p.company||'',email:p.email||'',total:Number(String(p.grandTotal||'0').replace(/,/g,''))||0,status:p.status||'Saved',raw:p})}return rows}
app.get('/api/documents/search',(req,res)=>{const type=String(req.query.type||'').toLowerCase(),company=String(req.query.company||'').toLowerCase().trim(),q=String(req.query.q||'').toLowerCase().trim(),from=String(req.query.from||''),to=String(req.query.to||'');let rows=allSearchDocs().filter(x=>(!type||type==='all'||x.kind===type)&&(!company||(x.company+' '+x.customerCompany+' '+x.customer).toLowerCase().includes(company))&&(!q||(x.number+' '+x.customer+' '+x.customerCompany+' '+x.company+' '+x.status).toLowerCase().includes(q))&&(!from||String(x.date||'')>=from)&&(!to||String(x.date||'')<=to));rows.sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))||String(b.number).localeCompare(String(a.number)));res.json(rows.map(({raw,...x})=>x))});
// Unified professional PDF renderer used by downloads, WhatsApp file sharing, and email attachments.
const LOGO_PATH = path.join(__dirname, 'assets', 'sastha-logo.jpg');
const PDF_GOLD = '#C99A36';
const PDF_INK = '#242321';
const PDF_MUTED = '#66635D';
const PDF_LINE = '#E4E0D6';
const PDF_PALE = '#F6F1E5';
const PDF_MARGIN = 42;

function pdfText(value, fallback='') {
  const text = value === undefined || value === null ? fallback : String(value);
  return text.replace(/\r\n/g, '\n').trim();
}
function pdfMoney(value) {
  return 'RM ' + (Number(value) || 0).toLocaleString('en-MY', {minimumFractionDigits:2, maximumFractionDigits:2});
}
function pdfDate(value) {
  const raw = pdfText(value, '-');
  return raw === '' ? '-' : raw;
}
function pdfLine(doc, x1, y1, x2, y2, color=PDF_LINE, width=0.7) {
  doc.save().strokeColor(color).lineWidth(width).moveTo(x1,y1).lineTo(x2,y2).stroke().restore();
}
function pdfTextAt(doc, text, x, y, width, opts={}) {
  const font = opts.font || 'Helvetica';
  const size = opts.size || 9;
  const color = opts.color || PDF_INK;
  const lineGap = opts.lineGap === undefined ? 1.5 : opts.lineGap;
  doc.font(font).fontSize(size).fillColor(color);
  const content = pdfText(text, opts.fallback || '');
  if (!content) return y;
  const h = doc.heightOfString(content, {width, lineGap, align:opts.align || 'left'});
  doc.text(content, x, y, {width, lineGap, align:opts.align || 'left'});
  return y + h;
}
function pdfSectionLabel(doc, text, x, y, width) {
  doc.font('Helvetica-Bold').fontSize(9.3).fillColor(PDF_GOLD).text(String(text).toUpperCase(), x, y, {width, characterSpacing:0.5});
  return y + 15;
}
function pdfHeader(doc, settings, type, number, data, continuation=false) {
  const pw = doc.page.width;
  doc.save().fillColor(PDF_GOLD).rect(0, 0, pw, 6).fill().restore();
  if (continuation) {
    if (fs.existsSync(LOGO_PATH)) doc.image(LOGO_PATH, PDF_MARGIN, 20, {fit:[38,38]});
    doc.font('Helvetica-Bold').fontSize(13).fillColor(PDF_INK).text(String(type).toUpperCase() + ' - CONTINUED', 90, 27, {width:300});
    doc.font('Helvetica').fontSize(9).fillColor(PDF_MUTED).text('Document No: ' + number, pw-200, 29, {width:158, align:'right'});
    pdfLine(doc, PDF_MARGIN, 70, pw-PDF_MARGIN, 70, PDF_GOLD, 1.2);
    return 86;
  }

  const leftX = 118, leftW = 284, rightX = pw-174, rightW = 132;
  let cy = 29;
  if (fs.existsSync(LOGO_PATH)) doc.image(LOGO_PATH, PDF_MARGIN, 31, {fit:[62,62]});
  cy = pdfTextAt(doc, pdfText(settings.name, 'SASTHA INFINITE ENTERPRISE').toUpperCase(), leftX, cy, leftW, {font:'Helvetica-Bold',size:15.2,lineGap:0.5});
  cy += 2;
  cy = pdfTextAt(doc, pdfText(settings.tagline, 'Excellence. Innovation.'), leftX, cy, leftW, {size:8.6,color:PDF_MUTED,lineGap:0.5}) + 2;
  const regLine = [settings.reg ? 'Registration No: ' + settings.reg : '', settings.ssm ? 'SSM: ' + settings.ssm : ''].filter(Boolean).join('  |  ');
  if (regLine) cy = pdfTextAt(doc, regLine, leftX, cy, leftW, {size:8.2,color:PDF_MUTED,lineGap:0.5}) + 2;
  cy = pdfTextAt(doc, pdfText(settings.address), leftX, cy, leftW, {size:8.1,color:PDF_MUTED,lineGap:0.4}) + 2;
  const contactLine = [settings.phone, settings.email, settings.website].map(x=>pdfText(x)).filter(Boolean).join('  |  ');
  if (contactLine) cy = pdfTextAt(doc, contactLine, leftX, cy, leftW, {size:8.1,color:PDF_MUTED,lineGap:0.4}) + 2;

  let ry = 30;
  ry = pdfTextAt(doc, String(type).toUpperCase(), rightX, ry, rightW, {font:'Helvetica-Bold',size:type.length>14?17:23,align:'right',lineGap:0.5});
  ry += 3;
  ry = pdfTextAt(doc, number, rightX, ry, rightW, {font:'Helvetica-Bold',size:12,align:'right',lineGap:0.5});
  ry += 5;
  if (data.business) ry = pdfTextAt(doc, data.business, rightX, ry, rightW, {size:8.7,align:'right',color:PDF_MUTED,lineGap:0.5}) + 2;
  const dateText = pdfDate(data.date || data.jobDate);
  ry = pdfTextAt(doc, 'Date: ' + dateText, rightX, ry, rightW, {size:8.5,align:'right',lineGap:0.5}) + 1;
  const dueLabel = type === 'Quotation' ? 'Valid Until: ' : type === 'Delivery Order' ? 'Delivery Date: ' : 'Due: ';
  if (type !== 'Job Sheet' && type !== 'Payment Voucher' && data.due) ry = pdfTextAt(doc, dueLabel + pdfDate(data.due), rightX, ry, rightW, {size:8.5,align:'right',lineGap:0.5}) + 1;
  if (data.status) {
    const status = pdfText(data.status);
    doc.font('Helvetica-Bold').fontSize(7.8);
    const sw = Math.min(rightW, Math.max(42, doc.widthOfString(status)+14));
    const sx = rightX+rightW-sw;
    doc.save().fillColor(PDF_PALE).roundedRect(sx, ry+2, sw, 16, 4).fill().restore();
    doc.font('Helvetica-Bold').fontSize(7.8).fillColor(PDF_INK).text(status.toUpperCase(), sx+6, ry+6, {width:sw-12,align:'center',lineBreak:false});
    ry += 21;
  }
  const ruleY = Math.max(132, cy+8, ry+6);
  pdfLine(doc, PDF_MARGIN, ruleY, pw-PDF_MARGIN, ruleY, PDF_GOLD, 1.6);
  return ruleY + 19;
}
function pdfCustomerAndPayment(doc, y, settings, data, kind) {
  const leftX=PDF_MARGIN, colGap=28, colW=(doc.page.width-PDF_MARGIN*2-colGap)/2, rightX=leftX+colW+colGap;
  const isJob=kind==='job-sheet';
  let ly=pdfSectionLabel(doc, isJob?'Customer':(kind==='voucher'?'Payee':'Bill To'),leftX,y,colW);
  const customerName=pdfText(data.customerName||data.customer||data.payee, '');
  ly=pdfTextAt(doc, customerName, leftX,ly,colW,{font:'Helvetica-Bold',size:10.3,lineGap:1})+2;
  if (data.company && pdfText(data.company).toLowerCase()!==customerName.toLowerCase()) ly=pdfTextAt(doc,data.company,leftX,ly,colW,{size:9,lineGap:1})+1;
  ly=pdfTextAt(doc,pdfText(data.customerAddress||data.address),leftX,ly,colW,{size:8.8,color:PDF_MUTED,lineGap:1})+2;
  const contact=[data.customerPhone||data.phone,data.customerEmail||data.email].map(pdfText).filter(Boolean).join(' | ');
  if(contact) ly=pdfTextAt(doc,contact,leftX,ly,colW,{size:8.3,color:PDF_MUTED,lineGap:1})+1;

  let ry=pdfSectionLabel(doc,isJob?'Job Details':(kind==='invoice'?'Payment Details':'Document Details'),rightX,y,colW);
  if(isJob){
    const rows=[['Technician / Staff',data.technician],['Priority',data.priority],['Service',Array.isArray(data.categories)?data.categories.join(', '):data.categories],['Time',[data.startTime,data.endTime].filter(Boolean).join(' - ')],['Follow-up',data.followup]];
    for(const [label,value] of rows){if(!pdfText(value))continue;ry=pdfTextAt(doc,label+': '+pdfText(value),rightX,ry,colW,{size:8.7,lineGap:0.8})+2;}
  } else if(kind==='invoice'){
    if(settings.bank) ry=pdfTextAt(doc,settings.bank,rightX,ry,colW,{font:'Helvetica-Bold',size:10.1})+1;
    if(settings.bankAccount) ry=pdfTextAt(doc,settings.bankAccount,rightX,ry,colW,{size:9.5})+3;
    const terms=pdfText(data.terms||settings.terms);
    if(terms) ry=pdfTextAt(doc,terms,rightX,ry,colW,{size:8.5,color:PDF_MUTED,lineGap:1.4})+1;
  } else {
    if(data.sourceQuotationNumber) ry=pdfTextAt(doc,'From Quotation: '+data.sourceQuotationNumber,rightX,ry,colW,{size:8.7})+2;
    if(data.sourceInvoiceNumber) ry=pdfTextAt(doc,'From Invoice: '+data.sourceInvoiceNumber,rightX,ry,colW,{size:8.7})+2;
    if(data.relatedInvoiceNumber) ry=pdfTextAt(doc,'Related Invoice: '+data.relatedInvoiceNumber,rightX,ry,colW,{size:8.7})+2;
    if(data.due) ry=pdfTextAt(doc,(data.type==='Quotation'?'Valid Until: ':'Delivery Date: ')+data.due,rightX,ry,colW,{size:8.7})+2;
    if(!data.sourceQuotationNumber&&!data.sourceInvoiceNumber&&!data.relatedInvoiceNumber&&!data.due) ry=pdfTextAt(doc,data.business||'',rightX,ry,colW,{size:8.8,color:PDF_MUTED})+1;
  }
  return Math.max(ly,ry)+13;
}
function pdfTableHeader(doc, y, includePrices=true) {
  const x=PDF_MARGIN, full=doc.page.width-PDF_MARGIN*2;
  const cols=includePrices?{desc:full*0.51,qty:full*0.11,rate:full*0.17,amount:full*0.21}:{desc:full*0.70,qty:full*0.30};
  doc.save().fillColor(PDF_PALE).roundedRect(x,y,full,23,3).fill().restore();
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#5B4B29');
  doc.text('DESCRIPTION',x+8,y+7,{width:cols.desc-12,lineBreak:false});
  doc.text('QTY',x+cols.desc,y+7,{width:cols.qty-6,align:'right',lineBreak:false});
  if(includePrices){doc.text('RATE (RM)',x+cols.desc+cols.qty,y+7,{width:cols.rate-6,align:'right',lineBreak:false});doc.text('AMOUNT (RM)',x+cols.desc+cols.qty+cols.rate,y+7,{width:cols.amount-7,align:'right',lineBreak:false});}
  return {y:y+29,cols,full};
}
function pdfContinuation(doc, settings, type, number) {
  doc.addPage({size:'A4',margin:PDF_MARGIN});
  return pdfHeader(doc,settings,type,number,{},true);
}
function pdfDrawItems(doc, y, data, kind, settings, number) {
  const includePrices = !['delivery'].includes(kind);
  const items=Array.isArray(data.items)?data.items:[];
  if(!items.length) return y+2;
  if(y>doc.page.height-190) y=pdfContinuation(doc,settings,kind==='job-sheet'?'Job Sheet':(data.type||(kind==='invoice'?'Invoice':kind==='voucher'?'Payment Voucher':kind==='quotation'?'Quotation':kind==='delivery'?'Delivery Order':'Business Document')),number);
  let table=pdfTableHeader(doc,y,includePrices); y=table.y;
  const x=PDF_MARGIN, {desc,qty,rate,amount}=table.cols;
  doc.font('Helvetica').fontSize(9.1).fillColor(PDF_INK);
  for(let i=0;i<items.length;i++){
    const it=items[i]||{};
    const description=pdfText(it.description||it.desc,'Service / item');
    const qtyValue=Number(it.qty)||0;
    const rateValue=Number(it.rate??it.price)||0;
    doc.font('Helvetica').fontSize(9.1);
    const descHeight=doc.heightOfString(description,{width:desc-18,lineGap:1.7});
    const rowH=Math.max(25,descHeight+12);
    if(y+rowH>doc.page.height-92){y=pdfContinuation(doc,settings,kind==='job-sheet'?'Job Sheet':(data.type||(kind==='invoice'?'Invoice':kind==='voucher'?'Payment Voucher':kind==='quotation'?'Quotation':kind==='delivery'?'Delivery Order':'Business Document')),number);table=pdfTableHeader(doc,y,includePrices);y=table.y;}
    if(i%2===1)doc.save().fillColor('#FCFBF8').rect(x,y-4,table.full,rowH).fill().restore();
    doc.font('Helvetica').fontSize(9.1).fillColor(PDF_INK).text(description,x+8,y,{width:desc-18,lineGap:1.7});
    doc.font('Helvetica').fontSize(8.9).fillColor(PDF_INK).text(qtyValue.toFixed(2),x+desc,y,{width:qty-7,align:'right',lineBreak:false});
    if(includePrices){doc.text(rateValue.toFixed(2),x+desc+qty,y,{width:rate-7,align:'right',lineBreak:false});doc.text((qtyValue*rateValue).toFixed(2),x+desc+qty+rate,y,{width:amount-8,align:'right',lineBreak:false});}
    pdfLine(doc,x,y+rowH-4,x+table.full,y+rowH-4,PDF_LINE,0.45);
    y+=rowH;
  }
  return y+8;
}
function pdfDrawTotals(doc,x,y,w,data,kind) {
  const items=Array.isArray(data.items)?data.items:[];
  const subtotal=items.reduce((s,it)=>s+(Number(it.qty)||0)*(Number(it.rate??it.price)||0),0);
  if(kind==='voucher'){
    doc.save().fillColor(PDF_PALE).roundedRect(x,y,w,44,5).fill().restore();
    doc.font('Helvetica-Bold').fontSize(10).fillColor(PDF_INK).text('AMOUNT',x+10,y+8,{width:w-20});
    doc.font('Helvetica-Bold').fontSize(15).text(pdfMoney(data.amount),x+10,y+23,{width:w-20,align:'right'});
    return y+52;
  }
  let cy=y;
  const total=kind==='invoice'?subtotal-(Number(data.discount)||0)+(Number(data.tax)||0):subtotal;
  const row=(label,value,bold=false)=>{doc.font(bold?'Helvetica-Bold':'Helvetica').fontSize(bold?9.5:9).fillColor(PDF_INK).text(label,x,cy,{width:w*0.48,lineBreak:false});doc.text(value,x+w*0.48,cy,{width:w*0.52,align:'right',lineBreak:false});cy+=17;};
  if(kind==='invoice'){
    row('Subtotal',pdfMoney(subtotal));
    row('Discount','- '+pdfMoney(data.discount));
    row('Tax',pdfMoney(data.tax));
  }
  doc.save().fillColor(PDF_PALE).roundedRect(x,cy+2,w,31,4).fill().restore();
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(PDF_INK).text('TOTAL',x+9,cy+11,{width:w*0.42,lineBreak:false});
  doc.font('Helvetica-Bold').fontSize(13).text(pdfMoney(total),x+w*0.42,cy+9,{width:w*0.58-9,align:'right',lineBreak:false});
  cy+=40;
  if(data.status){doc.font('Helvetica').fontSize(8.8).fillColor(PDF_MUTED).text('Status',x,cy,{width:w/2,lineBreak:false});doc.font('Helvetica-Bold').fillColor(PDF_INK).text(pdfText(data.status),x+w/2,cy,{width:w/2,align:'right',lineBreak:false});cy+=14;}
  return cy;
}
function pdfDrawNotes(doc,x,y,w,data,settings,kind) {
  const notes=pdfText(data.notes||data.reported||data.customerComments);
  const terms=kind==='invoice'?pdfText(data.terms||settings.terms):'';
  let cy=y;
  if(notes){cy=pdfSectionLabel(doc,kind==='job-sheet'?'Reported Issue / Request':'Notes / Scope of Work',x,cy,w);cy=pdfTextAt(doc,notes,x,cy,w,{size:8.8,lineGap:1.7})+12;}
  if(kind==='job-sheet'&&data.workDone){cy=pdfSectionLabel(doc,'Work Carried Out / Findings',x,cy,w);cy=pdfTextAt(doc,data.workDone,x,cy,w,{size:8.8,lineGap:1.7})+9;}
  if(kind==='job-sheet'&&data.parts){cy=pdfSectionLabel(doc,'Parts / Equipment Used',x,cy,w);cy=pdfTextAt(doc,data.parts,x,cy,w,{size:8.8,lineGap:1.7})+9;}
  if(kind==='job-sheet'&&data.recommendations){cy=pdfSectionLabel(doc,'Recommendations / Follow-up',x,cy,w);cy=pdfTextAt(doc,data.recommendations,x,cy,w,{size:8.8,lineGap:1.7})+9;}
  if(terms){cy=pdfSectionLabel(doc,'Payment Terms',x,cy,w);cy=pdfTextAt(doc,terms,x,cy,w,{size:8.6,color:PDF_MUTED,lineGap:1.7})+8;}
  return cy;
}
function pdfDrawJobSheet(doc, y, data, settings, number) {
  const type='Job Sheet', left=PDF_MARGIN, gap=28, col=(doc.page.width-PDF_MARGIN*2-gap)/2, right=left+col+gap;
  let cur=pdfCustomerAndPayment(doc,y,settings,data,'job-sheet');
  const sections=[
    ['Reported Issue / Request',data.reported],
    ['Work Carried Out / Findings',data.workDone],
    ['Parts / Equipment Used',data.parts],
    ['Recommendations / Follow-up',data.recommendations],
    ['Customer Comments',data.customerComments]
  ].filter(x=>pdfText(x[1]));
  for(const [label,body] of sections){
    const bodyHeight=(()=>{doc.font('Helvetica').fontSize(8.8);return doc.heightOfString(pdfText(body),{width:doc.page.width-PDF_MARGIN*2,lineGap:1.5})})();
    const need=18+bodyHeight+10;
    if(cur+need>doc.page.height-150)cur=pdfContinuation(doc,settings,type,number);
    cur=pdfSectionLabel(doc,label,left,cur,doc.page.width-PDF_MARGIN*2);
    cur=pdfTextAt(doc,body,left,cur,doc.page.width-PDF_MARGIN*2,{size:8.8,lineGap:1.5})+10;
    pdfLine(doc,left,cur-4,doc.page.width-PDF_MARGIN,cur-4,PDF_LINE,0.45);
  }
  if(cur>doc.page.height-150)cur=pdfContinuation(doc,settings,type,number);
  cur+=5;
  cur=pdfSectionLabel(doc,'Customer Acknowledgement',left,cur,doc.page.width-PDF_MARGIN*2);
  const sigY=cur+2;
  if(data.signature){
    try{
      const m=String(data.signature).match(/^data:image\/(png|jpeg);base64,(.+)$/);
      if(m)doc.image(Buffer.from(m[2],'base64'),left,sigY,{fit:[170,42],align:'left',valign:'center'});
    }catch(e){}
  }
  const lineY=sigY+47;
  pdfLine(doc,left,lineY,left+190,lineY,'#88857F',0.7);
  const signer=pdfText(data.signerName||data.customer||data.customerName);
  if(signer)pdfTextAt(doc,signer,left,lineY+5,220,{font:'Helvetica-Bold',size:9.5});
  if(data.signDate)pdfTextAt(doc,'Date: '+pdfDate(data.signDate),left,lineY+19,220,{size:8.2,color:PDF_MUTED});
}
function generatePDFBuffer(kind,id) {
  const d=getDoc(kind,id);
  if(!d) return Promise.reject(Object.assign(new Error('Document not found'),{statusCode:404}));
  const PDFDocument=require('pdfkit');
  const settings=readBusinessState().settings||{};
  const type=kind==='job-sheet'?'Job Sheet':(d.type||(kind==='invoice'?'Invoice':kind==='voucher'?'Payment Voucher':kind==='quotation'?'Quotation':kind==='delivery'?'Delivery Order':'Business Document'));
  const number=pdfText(d.jobNo||d.number||d.job_number||id);
  return new Promise((resolve,reject)=>{
    const chunks=[];
    const doc=new PDFDocument({size:'A4',margin:PDF_MARGIN,bufferPages:true,compress:true,info:{Title:type+' '+number,Author:settings.name||'Sastha Infinite Enterprise',Subject:'Business document'}});
    doc.on('data',chunk=>chunks.push(chunk));
    doc.on('error',reject);
    doc.on('end',()=>resolve(Buffer.concat(chunks)));
    try {
      let y=pdfHeader(doc,settings,type,number,d,false);
      if(kind==='job-sheet'){
        pdfDrawJobSheet(doc,y,d,settings,number);
      } else {
        y=pdfCustomerAndPayment(doc,y,settings,d,kind);
        y=pdfDrawItems(doc,y,d,kind,settings,number);
        if(y>doc.page.height-190){y=pdfContinuation(doc,settings,type,number);}
        const left=PDF_MARGIN, gap=28, leftW=265, rightX=left+leftW+gap, rightW=doc.page.width-PDF_MARGIN-rightX;
        pdfDrawNotes(doc,left,y,leftW,d,settings,kind);
        pdfDrawTotals(doc,rightX,y,rightW,d,kind);
        if(d.signature){
          const signY=Math.min(doc.page.height-125, Math.max(y+90, doc.y+12));
          if(signY<doc.page.height-90){
            try{const m=String(d.signature).match(/^data:image\/(png|jpeg);base64,(.+)$/);if(m){doc.font('Helvetica-Bold').fontSize(8.5).fillColor(PDF_MUTED).text('CUSTOMER ACKNOWLEDGEMENT',left,signY,{width:220});doc.image(Buffer.from(m[2],'base64'),left,signY+12,{fit:[135,35]});pdfLine(doc,left,signY+50,left+165,signY+50,'#88857F',0.6);pdfTextAt(doc,pdfText(d.signerName),left,signY+54,200,{font:'Helvetica-Bold',size:8.5});}}catch(e){}
          }
        }
      }
      const range=doc.bufferedPageRange();
      for(let p=range.start;p<range.start+range.count;p++){
        doc.switchToPage(p);
        const ph=doc.page.height, pw=doc.page.width;
        pdfLine(doc,PDF_MARGIN,ph-56,pw-PDF_MARGIN,ph-56,PDF_LINE,0.65);
        const footer=pdfText(settings.footer,'Thank you for your business.')+'  |  '+pdfText(settings.name,'SASTHA INFINITE ENTERPRISE');
        doc.font('Helvetica').fontSize(7.4).fillColor(PDF_MUTED).text(footer,PDF_MARGIN,ph-45,{width:pw-PDF_MARGIN*2,align:'center',lineGap:0.5});
      }
      doc.end();
    } catch(err) { reject(err); }
  });
}
function pdfFilename(kind,id,d) {
  const type=kind==='job-sheet'?'Job Sheet':(d.type||(kind==='invoice'?'Invoice':kind==='voucher'?'Payment Voucher':kind==='quotation'?'Quotation':kind==='delivery'?'Delivery Order':'Business Document'));
  const number=d.jobNo||d.number||d.job_number||id;
  return String(type+'-'+number).replace(/[^a-z0-9_-]+/gi,'-')+'.pdf';
}
app.get('/api/documents/pdf/:kind/:id',async(req,res)=>{
  const kind=String(req.params.kind), id=String(req.params.id), d=getDoc(kind,id);
  if(!d)return res.status(404).json({error:'Document not found'});
  try{
    const buffer=await generatePDFBuffer(kind,id);
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition',`attachment; filename="${pdfFilename(kind,id,d)}"`);
    res.setHeader('Content-Length',String(buffer.length));
    res.setHeader('Cache-Control','no-store');
    res.end(buffer);
  }catch(e){console.error('PDF generation failed:',e);res.status(500).json({error:'Could not generate PDF document.'});}
});
app.post('/api/documents/email/:kind/:id',async(req,res)=>{
  const kind=String(req.params.kind), id=String(req.params.id), d=getDoc(kind,id);
  if(!d)return res.status(404).json({error:'Document not found'});
  const email=String(req.body&&req.body.email||d.customerEmail||d.email||'').trim();
  if(!email)return res.status(400).json({error:'Customer email is required'});
  if(!process.env.SMTP_HOST||!process.env.SMTP_USER||!process.env.SMTP_PASS)return res.status(503).json({error:'Email attachment sending is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and SMTP_FROM in the hosting environment.'});
  try{
    const nodemailer=require('nodemailer');
    const pdf=await generatePDFBuffer(kind,id);
    const settings=readBusinessState().settings||{};
    const type=kind==='job-sheet'?'Job Sheet':(d.type||(kind==='invoice'?'Invoice':kind==='voucher'?'Payment Voucher':kind==='quotation'?'Quotation':kind==='delivery'?'Delivery Order':'Business Document'));
    const filename=pdfFilename(kind,id,d);
    const transporter=nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||587),secure:String(process.env.SMTP_SECURE||'false')==='true',auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}});
    await transporter.sendMail({from:process.env.SMTP_FROM||process.env.SMTP_USER,to:email,subject:`${settings.name||'Sastha Infinite Enterprise'} ${type} ${d.jobNo||d.number||id}`,text:`Please find attached your ${type} PDF from ${settings.name||'Sastha Infinite Enterprise'}.`,attachments:[{filename,content:pdf,contentType:'application/pdf'}]});
    res.json({ok:true,message:'Professionally formatted PDF attachment emailed successfully.'});
  }catch(e){console.error('Email PDF failed:',e);res.status(500).json({error:'Could not send PDF email. Check SMTP settings and server logs.'});}
});

// Serve only application HTML; do not expose server.js, package.json, or deployment files as static downloads.
app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'index.html')));
app.get('/index.html',(req,res)=>res.sendFile(path.join(__dirname,'index.html')));
app.get('/job-sheet.html',(req,res)=>res.sendFile(path.join(__dirname,'job-sheet.html')));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'index.html')));
app.listen(PORT,'0.0.0.0',()=>console.log(`Sastha Infinite Business System running on port ${PORT}; SQLite database: ${path.join(DATA_DIR,'sastha-infinite.sqlite')}`));
