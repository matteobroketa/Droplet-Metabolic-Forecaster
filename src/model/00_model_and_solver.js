'use strict';
const ARTIFACT_SCRIPT_TEXT=document.currentScript?.textContent||'';
const WORKER_MODEL_START='const'+' DATA=';
const WORKER_MODEL_END="window.addEventListener('re"+"size'";
let activeWorkerJob=null;
if(typeof DATA==='undefined'||!DATA.cellLines||!DATA.media||!DATA.oils||!DATA.refs)throw new Error('Generated runtime data bundle missing. Run node scripts/build_model_data_bundle.js');
DATA.additives={
    fbs:{id:'fbs',name:'FBS / Serum',unit:'%',default:10,checked:true,mod:{ocr:v=>1+.005*v,gcr:v=>1+.008*v,lpr:v=>1+.006*v,gln:v=>1+.004*v},add:{glc:v=>.5*v/10,gln:v=>.2*v/10},refs:['Freshney 2016']},
    l_glutamine:{id:'l_glutamine',name:'L-Glutamine',unit:'mM',default:2,checked:false,mod:{},add:{gln:v=>v},conflict:['glutamax'],refs:['Common culture supplement']},
    glutamax:{id:'glutamax',name:'GlutaMAX',unit:'mM',default:2,checked:false,mod:{},add:{gln:v=>v},conflict:['l_glutamine'],refs:['Christie & Butler 1994 DOI 10.1016/0168-1656(94)90064-7']},
    sodium_pyruvate:{id:'sodium_pyruvate',name:'Sodium pyruvate',unit:'mM',default:1,checked:false,mod:{ocr:v=>1+.05*v,gcr:v=>Math.max(.2,1-.03*v)},add:{pyr:v=>v},refs:['Crouser et al. 2002 DOI 10.1164/rccm.200203-165OC']},
    hepes:{id:'hepes',name:'HEPES buffer',unit:'mM',default:25,checked:false,mod:{},buffer:v=>.4*v,refs:['Good et al. 1966 DOI 10.1021/bi00866a011']},
    neaa:{id:'neaa',name:'Non-essential amino acids',unit:'×',default:1,checked:false,mod:{gcr:v=>Math.max(.5,1-.03*v)},refs:['Planning estimate']},
    penstrep:{id:'penstrep',name:'Penicillin-Streptomycin',unit:'×',default:1,checked:false,mod:{},refs:['Metabolically inert in this model']},
    its:{id:'its',name:'Insulin / ITS',unit:'µg/mL insulin',default:5,checked:false,mod:{gcr:v=>1+.03*(v/5),ocr:v=>1+.05*(v/5)},refs:['Bottenstein & Sato 1979 DOI 10.1073/pnas.76.1.514']},
    hydrocortisone:{id:'hydrocortisone',name:'Hydrocortisone',unit:'µg/mL',default:.5,checked:false,mod:{gcr:v=>1+.04*v,ocr:v=>1+.02*v},refs:['Planning estimate']},
    egf:{id:'egf',name:'EGF',unit:'ng/mL',default:10,checked:false,mod:{gcr:v=>1+.01*Math.log10(v+1),ocr:v=>1+.008*Math.log10(v+1)},refs:['EGFR/PI3K metabolic signaling']},
    bfgf:{id:'bfgf',name:'bFGF / FGF-2',unit:'ng/mL',default:20,checked:false,mod:{gcr:v=>1+.008*Math.log10(v+1)},refs:['Planning estimate']},
    oligomycin:{id:'oligomycin',name:'Oligomycin',unit:'µM',default:1,checked:false,mod:{ocr:v=>Math.max(.15,1-.80*Math.min(1,v)),gcr:v=>1+.30*Math.min(1,v),lpr:v=>1+.50*Math.min(1,v)},refs:['Divakaruni & Murphy 2012 DOI 10.1016/j.cub.2011.12.054']},
    fccp:{id:'fccp',name:'FCCP',unit:'µM',default:.5,checked:false,mod:{ocr:v=>1+2.5*(1-Math.exp(-Math.max(0,v)/.18)),gcr:v=>1+.2*(1-Math.exp(-Math.max(0,v)/.25))},refs:['Divakaruni et al. 2013 DOI 10.1016/j.cmet.2013.06.009']},
    two_dg:{id:'two_dg',name:'2-Deoxyglucose',unit:'mM',default:5,checked:false,mod:{gcr:v=>Math.max(.05,1-.18*v),lpr:v=>Math.max(.05,1-.18*v),ocr:v=>1+.1*Math.min(1,v/5)},refs:['Zhang et al. 2014 DOI 10.1016/j.bcp.2014.06.007']},
    antimycin_rotenone:{id:'antimycin_rotenone',name:'Antimycin A + Rotenone',unit:'µM each',default:1,checked:false,mod:{ocr:v=>Math.max(.02,.05*(1-Math.min(1,v))),gcr:v=>1+.4*Math.min(1,v),lpr:v=>1+.7*Math.min(1,v)},refs:['Divakaruni & Murphy 2012','Salabei et al. 2014']},
    sodium_lactate:{id:'sodium_lactate',name:'Sodium lactate preload',unit:'mM',default:5,checked:false,mod:{},add:{lac:v=>v},refs:['pH preload model']},
    extra_bicarb:{id:'extra_bicarb',name:'Extra NaHCO₃',unit:'mM',default:10,checked:false,mod:{},buffer:v=>.52*v,add:{bicarb:v=>v},refs:['Bicarbonate buffer estimate']}
  };
function normalizeCellName(name){return String(name||'').toLowerCase().replace(/[^a-z0-9]+/g,'');}
function auditCellDatabase(cellLines){
  const issues=[];
  const seen=new Map();
  for(const cell of Object.values(cellLines)){
    if(cell.aliasOf){
      if(!cellLines[cell.aliasOf])issues.push(`Alias ${cell.id} points to missing canonical line ${cell.aliasOf}.`);
      continue;
    }
    const key=normalizeCellName(cell.name);
    if(!seen.has(key))seen.set(key,[]);
    seen.get(key).push(cell.id);
    const tier=String(cell.rateTier||cell.evidenceTier||'').toUpperCase();
    const basis=String(cell.rateBasis||cell.estimateBasis||'');
    if(key==='hela'&&/(lung)/i.test(String(cell.group||'')+' '+String(cell.tissue||'')+' '+basis))issues.push('HeLa record still carries lung lineage metadata or basis text.');
    if(key==='nih3t3'&&tier==='A'&&/(human msc|asc)/i.test(basis))issues.push('NIH 3T3 still claims Tier A from human MSC/ASC rates.');
  }
  for(const [key, ids] of seen.entries())if(ids.length>1)issues.push(`Duplicate selectable cell-line name ${key}: ${ids.join(', ')}`);
  return issues;
}
const CELL_DATABASE_ISSUES = auditCellDatabase(DATA.cellLines);

const PHYS={kH_O2_37C_mM_atm:1.094,kH_CO2_37C_mM_atm:28.88,waterVapor37_atm:.0627,R:0.082057,Q10_OCR:2.3,Q10_GCR:1.8,Q10_LPR:1.9,Q10_GLN:1.8,pKa1_37:6.103,pKa1TempCoeff:-0.011,pKa2_37:10.329,pKa2TempCoeff:-0.02,pKw_37:13.62,pKwTempCoeff:-0.032};
const VESSELS={
  eppendorf_1_5:{id:'eppendorf_1_5',name:'1.5 mL microcentrifuge tube',kind:'tube',capacity_uL:1500,diameter_mm:6.0,storageMode:'static_tube'},
  falcon_15:{id:'falcon_15',name:'15 mL conical tube',kind:'tube',capacity_uL:15000,diameter_mm:14.5,storageMode:'static_tube'},
  ptfe_600:{id:'ptfe_600',name:'600 µm ID PTFE tubing',kind:'tubing',diameter_mm:0.6,length_mm:1000,storageMode:'ptfe_tubing'},
  custom:{id:'custom',name:'custom geometry',kind:'custom',capacity_uL:null,diameter_mm:null,storageMode:null}
};
const STATE_KEY='metabolic-forecaster-__ARTIFACT_RELEASE__';
const $=s=>document.querySelector(s), $$=s=>Array.from(document.querySelectorAll(s));
const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
const fmt=(x,d=3)=>Number.isFinite(x)?Number(x).toLocaleString(undefined,{maximumFractionDigits:d,minimumFractionDigits:0}):'—';
const hoursLabel=h=>{if(!Number.isFinite(h))return '—'; if(h<0)return '—'; const d=Math.floor(h/24), hh=Math.floor(h%24), m=Math.round((h-Math.floor(h))*60); if(d>0)return `${d} d ${hh} h`; if(hh>0)return `${hh} h ${m} m`; return `${m} m`;};
function volumeFromSlider(t){return .07*Math.pow(100,Number(t));}
function sliderFromVol(v){return Math.log10(v/.07)/Math.log10(100);}
function groupOptions(sel,obj,extra){sel.innerHTML=''; const groups={}; Object.values(obj).filter(o=>!o.hidden&&!o.aliasOf).forEach(o=>(groups[o.group||'Other']??=[]).push(o)); for(const [g,items] of Object.entries(groups)){const og=document.createElement('optgroup'); og.label=g; items.sort((a,b)=>String(a.name).localeCompare(String(b.name))); items.forEach(o=>{const opt=document.createElement('option'); opt.value=o.id; opt.textContent=o.name+(extra?extra(o):''); og.appendChild(opt)}); sel.appendChild(og)}}
function gasPreset(){const id=$('#headspaceGas').value; if(id==='air')return {name:'ambient air',o2:.2095,co2:.0004,custom:false}; if(id==='co2air')return {name:'5% CO₂ / air',o2:.95*.2095,co2:.05,custom:false}; if(id==='lowoxygen')return {name:'5% O₂ / 5% CO₂',o2:.05,co2:.05,custom:false}; if(id==='n2co2')return {name:'95% N₂ / 5% CO₂',o2:0,co2:.05,custom:false}; if(id==='nitrogen')return {name:'pure N₂',o2:0,co2:0,custom:false}; const o2pct=clamp(Number.isFinite(Number($('#customO2').value))?Number($('#customO2').value):0,0,100), co2pct=clamp(Number.isFinite(Number($('#customCO2').value))?Number($('#customCO2').value):0,0,100); return {name:'custom gas',o2:o2pct/100,co2:co2pct/100,custom:true,o2pct,co2pct,balancePct:100-o2pct-co2pct};}
function vaporAtm(T){const es_hPa=6.1094*Math.exp(17.625*T/(T+243.04)); return clamp(es_hPa/1013.25,0,.2);}
function o2Eq(T,gas){const kh=PHYS.kH_O2_37C_mM_atm*Math.exp(-.025*(T-37)); return Math.max(0,kh*gas.o2*(1-vaporAtm(T))*1000);}
function co2Eq(T,gas){const kh=PHYS.kH_CO2_37C_mM_atm*Math.exp(-.025*(T-37)); return Math.max(.001,kh*gas.co2*(1-vaporAtm(T)));}
function carbonateConstants(T){
  const dT=(Number.isFinite(T)?T:37)-37;
  const pKa1=PHYS.pKa1_37+PHYS.pKa1TempCoeff*dT;
  const pKa2=PHYS.pKa2_37+PHYS.pKa2TempCoeff*dT;
  const pKw=PHYS.pKw_37+PHYS.pKwTempCoeff*dT;
  return {pKa1,pKa2,pKw,K1:Math.pow(10,-pKa1),K2:Math.pow(10,-pKa2),Kw:Math.pow(10,-pKw)};
}
function carbonateSpecies(dic_mM,pH,T){
  const constants=carbonateConstants(T);
  const H=Math.pow(10,-clamp(Number.isFinite(pH)?pH:7.4,0,14));
  const den=Math.max(1e-30,H*H+constants.K1*H+constants.K1*constants.K2);
  const alpha0=(H*H)/den;
  const alpha1=(constants.K1*H)/den;
  const alpha2=(constants.K1*constants.K2)/den;
  const dic=Math.max(0,Number.isFinite(dic_mM)?dic_mM:0);
  const co2=dic*alpha0;
  const hco3=dic*alpha1;
  const co3=dic*alpha2;
  return {pH:-Math.log10(H),H,alpha0,alpha1,alpha2,co2,hco3,co3,h_mM:H*1000,oh_mM:(constants.Kw/Math.max(H,1e-14))*1000};
}
function carbonateBaseline(p){
  if(p&&p._carbonateBaseline)return p._carbonateBaseline;
  const pH0=Number.isFinite(p?.pH0)?p.pH0:7.4;
  const bicarb=Math.max(0,p?.sub?.bicarb||0);
  const co2=Math.max(1e-6,Number.isFinite(p?.CO2Initial)?p.CO2Initial:(Number.isFinite(p?.CO2eq)?p.CO2eq:0.001));
  const constants=carbonateConstants(p?.T);
  const H=Math.pow(10,-clamp(pH0,0,14));
  const co3=bicarb>0?bicarb*constants.K2/Math.max(H,1e-14):0;
  const dic=Math.max(0,co2+bicarb+co3);
  const oh_mM=(constants.Kw/Math.max(H,1e-14))*1000;
  const ta0=bicarb+2*co3+oh_mM-H*1000;
  const baseline={dic0:dic,ta0,pH0};
  if(p)p._carbonateBaseline=baseline;
  return baseline;
}
function solveCarbonateState(dic_mM,acidEq_mM,p,referencePH=null){
  const baseline=carbonateBaseline(p);
  const targetTA=baseline.ta0-Math.max(0,Number.isFinite(acidEq_mM)?acidEq_mM:0);
  const beta=Math.max(0,Number.isFinite(p?.buffer)?p.buffer:0);
  const refPH=referencePH==null?baseline.pH0:referencePH;
  const residual=(pH)=>{
    const spec=carbonateSpecies(dic_mM,pH,p?.T);
    const nonBicarb=beta*(pH-refPH);
    return spec.hco3+2*spec.co3+spec.oh_mM-spec.h_mM+nonBicarb-targetTA;
  };
  let lo=4, hi=10.5, flo=residual(lo), fhi=residual(hi);
  if(!(flo<=0&&fhi>=0)){
    lo=0.5; hi=13.5; flo=residual(lo); fhi=residual(hi);
  }
  let pH;
  if(!(flo<=0&&fhi>=0)){
    const candidates=[0.5,2,4,6,7,8,10,12,13.5].map(v=>({pH:v,res:Math.abs(residual(v))})).sort((a,b)=>a.res-b.res);
    pH=candidates[0].pH;
  }else{
    for(let i=0;i<60;i++){
      const mid=(lo+hi)/2;
      const fm=residual(mid);
      if(fm>=0)hi=mid; else lo=mid;
    }
    pH=(lo+hi)/2;
  }
  const species=carbonateSpecies(dic_mM,pH,p?.T);
  return {...species,dic:Math.max(0,dic_mM),targetTA};
}
function boundaryEquilibriumPH(boundaryCO2_mM,p){
  const baseline=carbonateBaseline(p);
  const beta=Math.max(0,Number.isFinite(p?.buffer)?p.buffer:0);
  const targetTA=baseline.ta0;
  const residual=(pH)=>{
    const spec=carbonateSpecies(1,pH,p?.T);
    const alpha0=Math.max(1e-9,spec.alpha0);
    const dic=Math.max(0,boundaryCO2_mM)/alpha0;
    const state=carbonateSpecies(dic,pH,p?.T);
    return state.hco3+2*state.co3+state.oh_mM-state.h_mM+beta*(pH-baseline.pH0)-targetTA;
  };
  let lo=4, hi=10.5, flo=residual(lo), fhi=residual(hi);
  if(!(flo<=0&&fhi>=0)){
    lo=0.5; hi=13.5; flo=residual(lo); fhi=residual(hi);
  }
  if(!(flo<=0&&fhi>=0))return baseline.pH0;
  for(let i=0;i<60;i++){
    const mid=(lo+hi)/2;
    const fm=residual(mid);
    if(fm>=0)hi=mid; else lo=mid;
  }
  return (lo+hi)/2;
}
function sanitizeHalf(half){return Math.max(.05,Number.isFinite(half)?half:.05);}
function kFromHalf(half){return Math.log(2)/sanitizeHalf(half);}
function effectiveHalfTime(half,scale=1,mode='reference_scaled'){const base=sanitizeHalf(half), safeScale=Math.max(1e-9,Number.isFinite(scale)?scale:1); return mode==='measured_effective'?base:base/safeScale;}
function finitePairConductance(half,capA,capB){if(!(capA>0)||!(capB>0))return 0; return kFromHalf(half)*(capA*capB)/(capA+capB);}
function boundaryConductance(half,cap){return cap>0?kFromHalf(half)*cap:0;}
function integerLike(v){return Number.isFinite(v)&&Math.abs(v-Math.round(v))<=1e-9;}
function activeNumericInputIds(){
  const ids=new Set(['temperature','totalEmulsion','aqueousFraction','residualOil','gasHalf','oilHalf','dropHalf','maxDays','logStep','initAqO2Pct','initOilO2Pct','initReservoirO2Pct','initHeadspaceO2Pct','initHeadspaceCO2Pct','glucoseFloor','glutamineFloor','doublingTime','lagPhase','carryingCapacity','o2Km','pasteurThreshold','pasteurMax','targetCells','hypoxiaPct','lambda','pH0','pHFloor','pHCeiling','headspaceVolume','vesselDiameter','tubingLength','surfaceAccess','gradientFactor','centerPenalty','decimals','marginWarning','warburgOverride','volumeT']);
  if($('#headspaceGas')?.value==='custom'){ids.add('customO2'); ids.add('customCO2');}
  if($('#cellLine')?.value==='custom')['customOCR','customGCR','customLPR','customGlnCR'].forEach(id=>ids.add(id));
  if($('#medium')?.value==='custom_medium')['customGlucose','customGln','customBicarb','customBuffer'].forEach(id=>ids.add(id));
  ['ocrOverride','gcrOverride','lprOverride','glnOverride'].forEach(id=>{if(String(document.getElementById(id)?.value??'').trim()!=='')ids.add(id);});
  const vesselPreset=$('#vesselPreset')?.value||'custom';
  if(vesselPreset!=='custom')ids.delete('headspaceVolume');
  if(vesselPreset!=='custom'&&vesselPreset!=='ptfe_600'){ids.delete('vesselDiameter'); ids.delete('tubingLength');}
  if(vesselPreset==='ptfe_600')ids.add('vesselDiameter');
  return ids;
}
function configCompatibilityIssues(p){
  const issues=[];
  if(p&&p.pHBoundaryMode==='closed_headspace_mass_balance'&&p.atmMode!=='closed')issues.push('Finite headspace CO₂ mass balance requires a closed gas boundary. Change the gas mode to closed or select an external CO₂ boundary.');
  return issues;
}

function hardValidateInputs(p){
  const invalid=p.invalid||(p.invalid=[]);
  const add=(msg)=>{if(!invalid.includes(msg))invalid.push(msg)};
  const el=(id)=>document.getElementById(id);
  const raw=(id)=>el(id)?.value;
  const has=(id)=>el(id)!=null && String(el(id).value).trim()!=='';
  const num=(id)=>Number(raw(id));
  const check=(id,label,opt={})=>{
    if(!el(id))return null;
    const v=num(id);
    if(!Number.isFinite(v)){add(`${label} must be a finite number.`);return v;}
    if(opt.gt!==undefined && !(v>opt.gt))add(`${label} must be greater than ${opt.gt}.`);
    if(opt.gte!==undefined && !(v>=opt.gte))add(`${label} must be at least ${opt.gte}.`);
    if(opt.lt!==undefined && !(v<opt.lt))add(`${label} must be less than ${opt.lt}.`);
    if(opt.lte!==undefined && !(v<=opt.lte))add(`${label} must be no more than ${opt.lte}.`);
    return v;
  };
  const totalEmul=check('totalEmulsion','Generated emulsion volume (mL)',{gt:0});
  const residual=check('residualOil','Excess reservoir oil volume (mL)',{gte:0});
  check('gasHalf','Gas-to-oil exchange half-time (min)',{gt:0});
  check('oilHalf','Reservoir-to-emulsion oil mixing half-time (min)',{gt:0});
  check('dropHalf','Oil-to-droplet exchange half-time (min)',{gt:0});
  check('maxDays','Simulation horizon (days)',{gt:0,lte:30});
  check('logStep','Log interval (min)',{gt:0});
  check('initAqO2Pct','Initial aqueous O₂ (% air saturation)',{gte:0,lte:300});
  check('initOilO2Pct','Initial emulsion-oil O₂ (% air saturation)',{gte:0,lte:300});
  check('initReservoirO2Pct','Initial reservoir-oil O₂ (% air saturation)',{gte:0,lte:300});
  check('initHeadspaceO2Pct','Initial headspace O₂ (% dry gas)',{gte:0,lte:100});
  check('initHeadspaceCO2Pct','Initial headspace CO₂ (% dry gas)',{gte:0,lte:100});
  check('glucoseFloor','Glucose floor (mM)',{gte:0});
  check('glutamineFloor','Glutamine floor (mM)',{gte:0});
  check('decimals','Decimals',{gte:2,lte:12});
  check('marginWarning','Short-window warning (h)',{gte:1,lte:48});
  check('carryingCapacity','Carrying capacity (cells/nL)',{gt:0});
  check('o2Km','O₂ uptake K_m (µM)',{gt:0});
  check('pasteurThreshold','Pasteur-effect O₂ threshold (µM)',{gte:0});
  check('pasteurMax','Pasteur maximum multiplier',{gte:1,lte:5});
  check('targetCells','Evaluated droplet cell count',{gte:1,lte:50});
  check('hypoxiaPct','O₂ threshold value',{gte:0,lte:500});
  check('lambda','Occupancy λ',{gte:0,lte:20});
  check('temperature','Temperature (°C)',{gte:33,lte:42});
  check('surfaceAccess','Direct exposed emulsion oil (%)',{gte:0,lte:100});
  check('gradientFactor','Bulk center oxygen access',{gte:0.05,lte:1});
  check('centerPenalty','Evaluated droplet position factor',{gte:0.35,lte:1});
  check('headspaceVolume','Headspace volume (mL)',{gte:0});
  const pH0=check('pH0','Starting pH');
  const pHFloor=check('pHFloor','pH floor');
  const pHCeil=check('pHCeiling','pH ceiling');
  const targetCellsValue=num('targetCells');
  const decimalsValue=num('decimals');
  if(Number.isFinite(targetCellsValue)&&!integerLike(targetCellsValue))add('Evaluated droplet cell count must be an integer.');
  if(Number.isFinite(decimalsValue)&&!integerLike(decimalsValue))add('Decimals must be an integer.');
  if(Number.isFinite(pHFloor)&&Number.isFinite(pHCeil)&&!(pHFloor<pHCeil))add('pH floor must be lower than pH ceiling.');
  if(Number.isFinite(pH0)&&Number.isFinite(pHFloor)&&Number.isFinite(pHCeil)&&(pH0<pHFloor||pH0>pHCeil))add('Starting pH is outside the configured viability interval; adjust starting pH or the pH limits before calculating.');
  if(el('headspaceGas')?.value==='custom'){
    const o2=check('customO2','Custom gas O₂ (%)',{gte:0,lte:100});
    const co2=check('customCO2','Custom gas CO₂ (%)',{gte:0,lte:100});
    if(Number.isFinite(o2)&&Number.isFinite(co2)&&o2+co2>100)add(`Custom gas O₂ + CO₂ cannot exceed 100%; current total is ${fmt(o2+co2,1)}%.`);
  }
  if(el('o2ThresholdMode')?.value==='selected_pct'&&p&&p.O2eq<=1e-6){
    add('Percent-of-selected-gas O₂ thresholds are invalid when the selected gas is effectively anoxic. Use an absolute aqueous O₂ threshold or percent of air saturation instead.');
  }
  const initHeadO2=num('initHeadspaceO2Pct'), initHeadCO2=num('initHeadspaceCO2Pct');
  if(Number.isFinite(initHeadO2)&&Number.isFinite(initHeadCO2)&&initHeadO2+initHeadCO2>100)add(`Initial headspace O₂ + CO₂ cannot exceed 100%; current total is ${fmt(initHeadO2+initHeadCO2,1)}%.`);
  if(el('cellLine')?.value==='custom'){
    check('customOCR','Custom OCR (fmol/cell/min)',{gte:0});
    check('customGCR','Custom GCR (fmol/cell/min)',{gte:0});
    check('customLPR','Custom LPR (fmol/cell/min)',{gte:0});
    check('customGlnCR','Custom glutamine consumption rate (fmol/cell/min)',{gte:0});
    check('doublingTime','Doubling time (h)',{gt:0});
    check('lagPhase','Lag phase (h)',{gte:0});
  }
  for(const [id,label] of [['ocrOverride','OCR override'],['gcrOverride','GCR override'],['lprOverride','LPR override'],['glnOverride','Glutamine-consumption override']]){
    if(has(id))check(id,label,{gte:0});
  }
  if(el('medium')?.value==='custom_medium'){
    check('customGlucose','Custom medium glucose (mM)',{gte:0});
    check('customGln','Custom medium glutamine (mM)',{gte:0});
    check('customBicarb','Custom medium bicarbonate (mM)',{gte:0});
    check('customBuffer','Custom medium buffer capacity (mM/pH)',{gt:0});
  }
  if(el('vesselPreset')?.value==='custom'){
    check('headspaceVolume','Custom headspace volume (mL)',{gte:0});
    check('vesselDiameter','Custom vessel inner diameter (mm)',{gt:0});
    check('tubingLength','Custom tubing length (mm)',{gt:0});
  } else if(el('vesselPreset')?.value==='ptfe_600') {
    check('vesselDiameter','PTFE tubing inner diameter (mm)',{gt:0});
    check('tubingLength','PTFE tubing length (mm)',{gt:0});
  }
  document.querySelectorAll('[id^="qty_"]').forEach(q=>{
    if(q.closest('.additive')?.querySelector('input[type="checkbox"]')?.checked){
      const v=Number(q.value); if(!Number.isFinite(v)||v<0)add(`${q.previousElementSibling?.textContent||'Additive quantity'} must be nonnegative.`);
    }
  });
  if(Number.isFinite(totalEmul)&&Number.isFinite(residual)&&totalEmul>0&&residual>=0){
    const vessel=p.vessel||vesselSpec();
    const cap=Number.isFinite(p.vesselCapacity_uL)?p.vesselCapacity_uL:(Number.isFinite(vessel.capacity_uL)?vessel.capacity_uL:null);
    if(vessel.id!=='custom'&&Number.isFinite(cap)&&p.liquidFill_uL>cap+1e-9)add(`Liquid fill ${fmt(p.liquidFill_uL/1000,3)} mL exceeds ${vessel.name} capacity ${fmt(cap/1000,3)} mL.`);
  }
  if(p&&Number.isFinite(p.Vaq_uL)&&Number.isFinite(p.volume_nL)&&p.Vaq_uL*1000+1e-9<p.volume_nL)add('Total aqueous volume must be at least one target-droplet volume.');
  configCompatibilityIssues(p).forEach(add);
  const activeIds=activeNumericInputIds();
  document.querySelectorAll('input[type="number"],input[type="range"]').forEach(node=>{
    if(node.id&&!activeIds.has(node.id))return;
    const value=String(node.value??'').trim();
    if(value==='')return;
    const label=(document.querySelector(`label[for="${node.id}"]`)?.textContent||node.id).replace(/\s+/g,' ').trim();
    const numeric=Number(value);
    if(!Number.isFinite(numeric)){add(`${label} must be a finite number.`); return;}
    const minAttr=node.getAttribute('min');
    const maxAttr=node.getAttribute('max');
    if(minAttr!=null&&minAttr!==''){
      const min=Number(minAttr);
      if(Number.isFinite(min)&&numeric<min)add(`${label} must be at least ${min}.`);
    }
    if(maxAttr!=null&&maxAttr!==''){
      const max=Number(maxAttr);
      if(Number.isFinite(max)&&numeric>max)add(`${label} must be no more than ${max}.`);
    }
  });
  if(typeof CELL_DATABASE_ISSUES!=='undefined'&&CELL_DATABASE_ISSUES.length)add(`Cell-line database audit failed: ${CELL_DATABASE_ISSUES[0]}`);
  return invalid;
}
function initUI(){groupOptions($('#cellLine'),DATA.cellLines); groupOptions($('#medium'),DATA.media,o=>o.glc!=null?` (${fmt(o.glc,1)} mM glucose)`:o.id==='custom_medium'?' — specify values':''); $('#oilType').innerHTML=Object.values(DATA.oils).map(o=>`<option value="${o.id}">${o.name} (${fmt(o.capacityRatio,1)}× O₂ capacity)</option>`).join(''); renderAdditives(); renderRefs(); bind(); loadState(); updateDynamicUI(); runAndRender();}
function bind(){document.addEventListener('input',e=>{if(e.target.matches('input,select'))debouncedUpdate()}); document.addEventListener('change',e=>{if(e.target.matches('input,select'))debouncedUpdate()}); $$('.tab').forEach(b=>b.addEventListener('click',()=>setTab(b.dataset.tab))); $$('[data-preset]').forEach(b=>b.addEventListener('click',()=>applyPreset(b.dataset.preset))); $('#calculateBtn').addEventListener('click',runAndRender); $('#cancelBtn').addEventListener('click',()=>cancelActiveWorkerJob('Background run cancelled.')); $('#themeBtn').addEventListener('click',toggleTheme); $('#helpBtn').addEventListener('click',()=>$('#helpDialog').classList.add('open')); $('#closeHelpBtn').addEventListener('click',()=>$('#helpDialog').classList.remove('open')); $('#helpDialog').addEventListener('click',e=>{if(e.target.id==='helpDialog')e.currentTarget.classList.remove('open')}); $('#equationsBtn').addEventListener('click',()=>$('#equationsDialog').classList.add('open')); $('#closeEquationsBtn').addEventListener('click',()=>$('#equationsDialog').classList.remove('open')); $('#equationsDialog').addEventListener('click',e=>{if(e.target.id==='equationsDialog')e.currentTarget.classList.remove('open')}); $('#resetBtn').addEventListener('click',()=>{try{localStorage.removeItem(STATE_KEY)}catch(e){} location.reload()}); $('#timeline').addEventListener('mousemove',chartHover); $('#timeline').addEventListener('mouseleave',()=>$('#chartTip').style.display='none'); $('#exportCsvBtn').addEventListener('click',exportCSV); $('#exportJsonBtn').addEventListener('click',exportJSON); $('#downloadDataBtn').addEventListener('click',downloadData); $('#savePngBtn').addEventListener('click',savePNG); $('#copySummaryBtn').addEventListener('click',copySummary); $('#runSweepBtn').addEventListener('click',runSweep); $('#runScenariosBtn').addEventListener('click',runScenarios); $('#runCalibrationBtn')?.addEventListener('click',runCalibration); $('#printBtn').addEventListener('click',()=>print()); $('#storageMode').addEventListener('change',applyModePreset); $('#vesselPreset').addEventListener('change',()=>{syncVesselControls('main');applyVesselPreset();}); $('#vesselPresetEnv')?.addEventListener('change',()=>{syncVesselControls('env');applyVesselPreset();}); $('#cellLine').addEventListener('change',()=>{const c=DATA.cellLines[$('#cellLine').value]; if(c){$('#doublingTime').value=c.dt||24; $('#lagPhase').value=c.lag||0;}});}
let timer=null; function debouncedUpdate(){updateDynamicUI(); saveState(); clearTimeout(timer); timer=setTimeout(()=>{const p=gatherParams(); if(!(p.invalid&&p.invalid.length)&&p.estimatedWorkload&&p.estimatedWorkload.estimatedSteps>500000){$('#lastRun').textContent=`Auto-rerun skipped: estimated solver workload is about ${fmt(p.estimatedWorkload.estimatedSteps,0)} accepted sub-steps. Press Calculate.`; return;} runAndRender();},180)}
function setTab(id){$$('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===id)); $$('.tab-content').forEach(c=>c.classList.toggle('active',c.id===`tab-${id}`)); saveState();}
function toggleTheme(){const dark=document.documentElement.dataset.theme!=='dark'; document.documentElement.dataset.theme=dark?'dark':'light'; $('#themeBtn').textContent=dark?'Light mode':'Dark mode'; if(window.lastResult)drawChart(window.lastResult); saveState();}
function renderAdditives(){const box=$('#additivePanel'); box.innerHTML=Object.values(DATA.additives).map(a=>`<label class="additive"><input id="add_${a.id}" type="checkbox" ${a.checked?'checked':''}><div><div class="name">${a.name}</div><div class="meta">${a.unit||''}</div></div><input id="qty_${a.id}" class="input" type="number" min="0" step="0.01" value="${a.default}"></label>`).join('');}
function renderRefs(){let rows=[]; for(const c of Object.values(DATA.cellLines).filter(c=>!c.hidden)) rows.push(['Cell line',c.name,(c.refs||[]).join('<br>')]); for(const m of Object.values(DATA.media)) rows.push(['Medium',m.name,(m.refs||[]).join('<br>')]); for(const o of Object.values(DATA.oils)) rows.push(['Oil / wall',o.name,(o.refs||[]).join('<br>')]); for(const a of Object.values(DATA.additives)) rows.push(['Additive',a.name,(a.refs||[]).join('<br>')]); for(const r of DATA.refs) rows.push(r); $('#refTable tbody').innerHTML=rows.map(r=>`<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('');}
function applyModePreset(){const id=$('#storageMode').value; const set=(k,v)=>{const el=document.getElementById(k); if(el)el.value=v}; if(id==='static_tube'){set('gasHalf',150);set('oilHalf',480);set('dropHalf',10);set('gradientFactor',.25);set('surfaceAccess',3)} if(id==='shaken_tube'){set('gasHalf',45);set('oilHalf',70);set('dropHalf',8);set('gradientFactor',.65);set('surfaceAccess',12)} if(id==='oil_circulated'){set('gasHalf',25);set('oilHalf',18);set('dropHalf',6);set('gradientFactor',.95);set('surfaceAccess',20)} if(id==='thin_layer'){set('gasHalf',20);set('oilHalf',45);set('dropHalf',8);set('gradientFactor',.90);set('surfaceAccess',55)} if(id==='pdms_chip'){set('gasHalf',60);set('oilHalf',45);set('dropHalf',7);set('gradientFactor',.85);set('surfaceAccess',25);set('oilType','pdms')} if(id==='ptfe_tubing'){set('gasHalf',10);set('oilHalf',20);set('dropHalf',2);set('gradientFactor',1);set('surfaceAccess',100);set('centerPenalty',1)} }
function syncVesselControls(source='main'){const main=$('#vesselPreset'), env=$('#vesselPresetEnv'); if(main&&env){if(source==='env')main.value=env.value; else env.value=main.value;} const spec=VESSELS[(main&&main.value)||'eppendorf_1_5']; const label=spec?spec.name:'custom geometry'; const chip=$('#vesselEnvReadout'); if(chip)chip.textContent=label;}
function vesselSpec(){const id=$('#vesselPreset')?.value||'eppendorf_1_5'; const base=VESSELS[id]||VESSELS.eppendorf_1_5; const spec={...base}; if(spec.kind==='tubing'){spec.diameter_mm=Math.max(.2,Number($('#vesselDiameter')?.value)||spec.diameter_mm||0.6); spec.length_mm=Math.max(1,Number($('#tubingLength')?.value)||spec.length_mm||1000); spec.capacity_uL=Math.PI*Math.pow((spec.diameter_mm||0.6)/2,2)*spec.length_mm;} return spec;}
function applyVesselPreset(){const spec=vesselSpec(); if(spec.id!=='custom'){if(spec.diameter_mm)$('#vesselDiameter').value=spec.diameter_mm; if(spec.storageMode)$('#storageMode').value=spec.storageMode; applyModePreset(); if(spec.kind==='tubing'){$('#atmMode').value='incubator'; $('#surfaceAccess').value=100; $('#gradientFactor').value=1; $('#centerPenalty').value=1;}} updateDynamicUI();}
function fmtVol(uL,d=3){if(!Number.isFinite(uL))return '—'; if(Math.abs(uL)>=1000)return fmt(uL/1000,d)+' mL'; return fmt(uL,1)+' µL';}
function emulsionVolume_uL(){return Math.max(0,(Number($('#totalEmulsion')?.value)||0))*1000;}
function reservoirOilVolume_uL(){return Math.max(0,(Number($('#residualOil')?.value)||0))*1000;}
function phaseVolumes(){const Vemul_uL=Math.max(.001,emulsionVolume_uL()); const aqueousFrac=clamp((Number($('#aqueousFraction')?.value)||0)/100,.001,.95); const Vaq_uL=Vemul_uL*aqueousFrac; const VoilEmul_uL=Math.max(0,Vemul_uL-Vaq_uL); const residualOil_uL=reservoirOilVolume_uL(); const totalOil_uL=VoilEmul_uL+residualOil_uL; const liquid_uL=Vemul_uL+residualOil_uL; return {Vemul_uL,aqueousFrac,Vaq_uL,VoilEmul_uL,residualOil_uL,totalOil_uL,liquid_uL};}
