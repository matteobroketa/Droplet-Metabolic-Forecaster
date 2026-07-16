function captureRawInputs(){
  const raw={};
  $$('input,select,textarea').forEach(el=>{
    if(!el||!el.id)return;
    raw[el.id]=el.type==='checkbox'?!!el.checked:String(el.value??'');
  });
  return raw;
}
function activeAdditiveSelections(){
  return Object.values(DATA.additives||{}).filter(a=>$(`#add_${a.id}`)?.checked).map(a=>({id:a.id,name:a.name,quantity:Number($(`#qty_${a.id}`)?.value)||0}));
}
function buildParameterProvenance(p){
  return {
    cellLine:{id:p.cell?.id||null,name:p.cell?.name||null,source:p.cell?.id==='custom'?'user custom rates':'embedded cell-rate database',rateTier:p.cell?.rateTier||p.cell?.evidenceTier||null,rateBasis:p.cell?.rateBasis||p.cell?.estimateBasis||null},
    medium:{id:p.med?.id||null,name:p.med?.name||null,source:p.med?.id==='custom_medium'?'user custom medium':'embedded medium database'},
    oil:{id:p.oil?.id||null,name:p.oil?.name||null,source:'embedded oil/material database',capacityRatio:p.oil?.capacityRatio??null},
    gasBoundary:{preset:$('#headspaceGas')?.value||null,name:p.gas?.name||null,source:p.gas?.custom?'user-entered gas mixture':'preset gas mixture',atmMode:p.atmMode},
    vessel:{preset:$('#vesselPreset')?.value||null,environmentPreset:$('#vesselPresetEnv')?.value||null,name:p.vessel?.name||null,storageMode:p.storageMode,geometryMode:p.geometryMode},
    rates:{temperatureMode:p.rateTemperatureMode,halfTimeMode:p.halfTimeMode,customCell:!!p.rateScenarioSource?.customCell,overridesActive:!!p.rateScenarioSource?.overridesActive,q10Factor:p.q10Factor,activeAdditives:activeAdditiveSelections()},
    oxygen:{bulkO2ModeRequested:p.bulkO2Mode,thresholdMode:p.o2ThresholdMode,thresholdValue:p.o2ThresholdValue,initialAqPct:p.initAqO2Pct,initialOilPct:p.initOilO2Pct,initialReservoirPct:p.initReservoirO2Pct},
    carbon:{pHBoundaryMode:p.pHBoundaryMode,pHModel:p.pHModel,trackedCarbonInventory:p.pHModel==='carbonate_alkalinity'?'target aqueous + grouped bulk aqueous DIC + optional finite headspace CO₂':'target aqueous + grouped bulk aqueous dissolved CO₂ + optional finite headspace CO₂'},
  };
}
function artifactMetadata(){
  return {
    release:document.querySelector('meta[name="artifact-release"]')?.content||document.body.dataset.release||null,
    commit:document.querySelector('meta[name="artifact-commit"]')?.content||null,
    manifestSha256:document.querySelector('meta[name="artifact-manifest-sha256"]')?.content||null
  };
}
function workerModelSource(){
  const start=ARTIFACT_SCRIPT_TEXT.indexOf(WORKER_MODEL_START);
  const end=ARTIFACT_SCRIPT_TEXT.indexOf(WORKER_MODEL_END);
  if(start<0||end<0||end<=start)return null;
  return ARTIFACT_SCRIPT_TEXT.slice(start,end);
}
function workerScriptSource(){
  const model=workerModelSource();
  if(!model)return null;
  return `const window=self; const document={querySelector:()=>null,querySelectorAll:()=>[],getElementById:()=>null,body:{dataset:{}}}; const navigator={}; ${model}
self.onmessage=(event)=>{
  const {jobId,kind,payload}=event.data||{};
  const progress=(progress)=>self.postMessage({type:'progress',jobId,kind,progress});
  try{
    if(kind==='simulate'){
      const result=Engine.simulate(payload.params,{progress});
      result.rateScenarios=buildRateScenarioResults(payload.params);
      self.postMessage({type:'result',jobId,kind,result});
      return;
    }
    if(kind==='scenarios'){
      const rateScenarios=buildRateScenarioResults(payload.params);
      self.postMessage({type:'result',jobId,kind,result:{params:payload.params,rateScenarios}});
      return;
    }
    if(kind==='sweep'){
      const vols=[.07,.17,.3,.7,1,2,5,7], lambdas=[.05,.1,.3,.8,1.5];
      const rows=[]; const total=vols.length*lambdas.length; let done=0;
      for(const v of vols){
        for(const lam of lambdas){
          const p={...payload.params,volume_nL:v,lambda:lam};
          const N=Math.max(1,p.Vaq_uL*1000/v), p0=Math.exp(-lam), p1=lam*p0, occupancy=buildOccupancyModel(lam,N,p.targetCells);
          Object.assign(p,{N,p0,p1,totalCells:occupancy.expectedTotalCells,bulkInitialCells:occupancy.expectedBulkCells,occupancy,occupiedDroplets:occupancy.occupiedDroplets,occupiedFraction:occupancy.occupiedFraction,empty:p0*N,single:p1*N,multi:Math.max(0,N*(1-p0-p1)),targetProbability:poissonPMF(p.targetCells,lam),chartO2Reference:Math.max(1,p.airO2Eq,p.O2eq,p.initialO2T,p.initialO2Oil,p.initialO2Res,p.o2Threshold)});
          const r=Engine.simulate(p);
          rows.push({volume_nL:v,lambda:lam,targetCells:p.targetCells,targetProbability:p.targetProbability,safeMin:r.safeMin,limiter:r.limiter,maxDays:p.maxDays});
          done+=1;
          progress({phase:'sweep',done,total,fraction:done/Math.max(1,total)});
        }
      }
      self.postMessage({type:'result',jobId,kind,result:{rows}});
      return;
    }
    if(kind==='calibration'){
      const result=runCalibrationFit(payload.params,payload.config,progress);
      self.postMessage({type:'result',jobId,kind,result});
      return;
    }
    throw new Error('Unknown worker job: '+kind);
  }catch(error){
    self.postMessage({type:'error',jobId,kind,error:String(error&&error.stack?error.stack:error)});
  }
};`;
}
function workerSupported(){return typeof Worker==='function'&&!!workerModelSource();}
function cleanupWorkerJob(){if(!activeWorkerJob)return; try{activeWorkerJob.worker.terminate();}catch(e){} try{URL.revokeObjectURL(activeWorkerJob.url);}catch(e){} activeWorkerJob=null;}
function setWorkerRunState(running,progressText=''){const cancel=$('#cancelBtn'),calc=$('#calculateBtn'),sweep=$('#runSweepBtn'),scenarios=$('#runScenariosBtn'),calibration=$('#runCalibrationBtn'); if(cancel)cancel.disabled=!running; if(calc)calc.disabled=running; if(sweep)sweep.disabled=running; if(scenarios)scenarios.disabled=running; if(calibration)calibration.disabled=running; $('#progressNote').textContent=progressText||'';}
function cancelActiveWorkerJob(message='Background run cancelled.'){if(!activeWorkerJob)return; cleanupWorkerJob(); setWorkerRunState(false,''); $('#lastRun').textContent=message;}
function startWorkerJob(kind,payload,{startText,onResult,onProgress,onError}={}){
  if(!workerSupported())return false;
  cancelActiveWorkerJob('');
  const source=workerScriptSource();
  if(!source)return false;
  const jobId=`${kind}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
  const worker=new Worker(url);
  activeWorkerJob={jobId,kind,worker,url};
  setWorkerRunState(true,'');
  $('#lastRun').textContent=startText||'Running in background…';
  worker.onmessage=(event)=>{
    if(!activeWorkerJob||activeWorkerJob.jobId!==jobId)return;
    const msg=event.data||{};
    if(msg.type==='progress'){if(onProgress)onProgress(msg.progress||{}); return;}
    if(msg.type==='result'){cleanupWorkerJob(); setWorkerRunState(false,''); if(onResult)onResult(msg.result); return;}
    if(msg.type==='error'){cleanupWorkerJob(); setWorkerRunState(false,''); if(onError)onError(msg.error||'Worker error');}
  };
  worker.postMessage({jobId,kind,payload});
  return true;
}
function formatWorkerProgress(kind,progress){
  if(kind==='simulate')return `Worker progress ${fmt((progress.fraction||0)*100,0)}% · ${fmt(progress.acceptedSteps||0,0)} accepted steps`;
  if(kind==='sweep')return `Sweep progress ${fmt((progress.fraction||0)*100,0)}% · ${fmt(progress.done||0,0)}/${fmt(progress.total||0,0)} cases`;
  if(kind==='calibration')return `Calibration progress ${fmt((progress.fraction||0)*100,0)}% · ${fmt(progress.done||0,0)}/${fmt(progress.total||0,0)} fits`;
  return 'Worker running…';
}
function liquidVolume_uL(){return phaseVolumes().liquid_uL;}
function autoHeadspace_mL(spec= vesselSpec()){if(spec.id==='custom'||!Number.isFinite(spec.capacity_uL))return Math.max(0,Number($('#headspaceVolume')?.value)||0); return (spec.capacity_uL-liquidVolume_uL())/1000;}
function confidenceForCell(cell){
  if(!cell)return {type:'warn',title:'Rate confidence unavailable',detail:'Select a cell line before interpreting the useful-window forecast.'};
  const tierRaw=String(cell.rateTier||cell.evidenceTier||(cell.id==='custom'?'CUSTOM':'UNSPECIFIED')).toUpperCase();
  const bounds=[];
  if(Number.isFinite(cell.ocrLow)&&Number.isFinite(cell.ocrHigh))bounds.push(`OCR ${fmt(cell.ocrLow,2)}–${fmt(cell.ocrHigh,2)} fmol/cell/min`);
  if(Number.isFinite(cell.gcrLow)&&Number.isFinite(cell.gcrHigh))bounds.push(`GCR ${fmt(cell.gcrLow,2)}–${fmt(cell.gcrHigh,2)}`);
  if(Number.isFinite(cell.lprLow)&&Number.isFinite(cell.lprHigh))bounds.push(`LPR ${fmt(cell.lprLow,2)}–${fmt(cell.lprHigh,2)}`);
  const basis=cell.rateBasis||cell.estimateBasis||'embedded rate record';
  const suffix=bounds.length?` Bounds: ${bounds.join('; ')}.`:'';
  if(tierRaw==='A')return {type:'ok',title:`High rate confidence · Tier A · ${cell.name}`,detail:`Exact or close citation-bound measured rates are available. Use about 50–70% of the predicted useful window until the droplet/oil exchange parameters are calibrated.${suffix} Basis: ${basis}`};
  if(tierRaw==='B')return {type:'warn',title:`Moderate rate confidence · Tier B · ${cell.name}`,detail:`Rates are supported by same-family, partial, or condition-adjacent measurements. Use about 50–70% of the predicted useful window and run low/nominal/high-rate scenarios for quantitative planning.${suffix} Basis: ${basis}`};
  if(tierRaw==='C')return {type:'danger',title:`Low rate confidence · Tier C · ${cell.name}`,detail:`No exact line-specific metabolic profile is embedded; this row uses empirical measured-corpus medians or lineage fallback rates. Use about 25–50% of the predicted useful window unless calibrated with your own depletion or OCR data.${suffix} Basis: ${basis}`};
  if(tierRaw==='CUSTOM')return {type:'warn',title:`Custom rate confidence · ${cell.name}`,detail:'The forecast depends entirely on the custom OCR, glucose, lactate, and glutamine rates you entered. If those values are measured under matching conditions, use about 50–70% of the predicted useful window; otherwise use about 25–50% until calibrated.'};
  return {type:'warn',title:`Unspecified rate confidence · ${cell.name}`,detail:`This cell line lacks a formal A/B/C confidence tier. Treat the output conservatively: use about 25–50% of the predicted useful window or replace rates with measured values. Basis: ${basis}`};
}
function updateConfidenceBanner(cell){
  const box=$('#confidenceBanner'); if(!box)return;
  const c=confidenceForCell(cell);
  box.className=`notice ${c.type} confidence-banner`;
  box.innerHTML=`<span class="confidence-title">${c.title}</span><span class="confidence-detail">${c.detail}</span>`;
}
function updateDynamicUI(){syncVesselControls('main'); const spec=vesselSpec(); const phases=phaseVolumes(); if(spec.id!=='custom'&&spec.diameter_mm)$('#vesselDiameter').value=spec.diameter_mm; if(spec.id!=='custom'&&Number.isFinite(spec.capacity_uL)){const ah=autoHeadspace_mL(spec); $('#headspaceVolume').value=ah>=0?fmt(ah,3):'0';} const v=volumeFromSlider($('#volumeT').value); $('#volumeReadout').textContent=v<1?`${fmt(v*1000,0)} pL`:`${fmt(v,2)} nL`; $('#aqFracReadout').textContent=$('#aqueousFraction').value+'%'; $('#gradReadout').textContent=fmt(Number($('#gradientFactor').value),2)+'×'; const diam=Math.max(.2,Number($('#vesselDiameter')?.value)||6), area=spec.kind==='tubing'?Math.PI*diam*(Math.max(1,Number($('#tubingLength')?.value)||1000)):Math.PI*Math.pow(diam/2,2), depth=spec.kind==='tubing'?diam/2:phases.Vemul_uL/Math.max(.001,area); $('#depthReadout').textContent=spec.kind==='tubing'?`r ${fmt(depth,2)} mm`:fmt(depth,2)+' mm'; $('#vesselReadout').textContent=spec.kind==='tubing'?`${fmt(spec.capacity_uL,1)} µL capacity`:`${fmt(spec.capacity_uL/1000,2)} mL capacity`; $('#tempReadout').textContent=fmt(Number($('#temperature').value),1)+' °C'; $('#customGasBox').classList.toggle('hidden',$('#headspaceGas').value!=='custom'); const cgb=$('#customGasBalance'); if(cgb){const o2=Number($('#customO2')?.value)||0,co2=Number($('#customCO2')?.value)||0,b=100-o2-co2; cgb.textContent=b>=0?`Balance gas: ${fmt(b,1)}%. O₂ + CO₂ must be ≤ 100%.`:`Invalid gas mixture: O₂ + CO₂ = ${fmt(o2+co2,1)}%. Reduce one gas so the total is ≤ 100%.`; cgb.style.color=b>=0?'':'var(--danger)';} $('#customCellFields').classList.toggle('hidden',$('#cellLine').value!=='custom'); $('#customMediumFields').classList.toggle('hidden',$('#medium').value!=='custom_medium'); const cell=DATA.cellLines[$('#cellLine').value]; const med=DATA.media[$('#medium').value]; updateConfidenceBanner(cell); $('#cellMeta').textContent=cell ? [cell.fullName||cell.name, cell.rateTier?('rate tier '+cell.rateTier):(cell.evidenceTier?('Tier '+cell.evidenceTier):''), cell.ocrLow?('OCR '+fmt(cell.ocrLow,2)+'–'+fmt(cell.ocrHigh,2)+' fmol/min'):'' , cell.gcrLow?('GCR '+fmt(cell.gcrLow,2)+'–'+fmt(cell.gcrHigh,2)):'' , cell.recommendedMedium?('medium: '+cell.recommendedMedium):'', cell.rateBasis||cell.estimateBasis||''].filter(Boolean).join(' · ') : '—'; $('#mediumMeta').textContent=med&&med.glc!=null?`${fmt(med.glc,1)} mM glucose`:'custom'; const w=Number($('#warburgOverride').value); $('#warburgReadout').textContent=w<0?'auto':fmt(w,2); const p=quickPopulation(v); $('#poissonReadout').textContent=`P0 ${fmt(p.p0*100,1)}%, P1 ${fmt(p.p1*100,1)}%`; $('#poissonCards').innerHTML=[['Droplets',fmt(p.N,0)],['Expected cells',fmt(p.cells,0)],['Empty droplets',fmt(p.empty,0)],['Single-cell droplets',fmt(p.single,0)],['Multi-cell droplets',fmt(p.multi,0)],['Aqueous droplet volume',fmtVol(phases.Vaq_uL)],['Continuous oil in emulsion',fmtVol(phases.VoilEmul_uL)],['Excess reservoir oil',fmtVol(phases.residualOil_uL)],['Total oil volume',fmtVol(phases.totalOil_uL)],['Liquid fill',fmtVol(phases.liquid_uL)],['Closed headspace',autoHeadspace_mL(spec)>=0?fmt(autoHeadspace_mL(spec),3)+' mL':'invalid']].map(x=>`<div class="model-box"><div class="top">${x[0]}</div><div class="big mono">${x[1]}</div></div>`).join(''); const checked=Object.values(DATA.additives).filter(a=>$(`#add_${a.id}`)?.checked).slice(0,5); $('#additiveChips').innerHTML=checked.map(a=>`<span class="chip">${a.name}</span>`).join('') || '<span class="chip">No additives</span>';}
function quickPopulation(v){const phases=phaseVolumes(); const Vaq=phases.Vaq_uL; const N=Math.max(1,Vaq*1000/v); const lam=Math.max(0,Number($('#lambda').value)||0); const p0=Math.exp(-lam), p1=lam*p0; return {Vaq,N,p0,p1,cells:lam*N,empty:p0*N,single:p1*N,multi:Math.max(0,N*(1-p0-p1))};}
// Pure simulation and calibration helpers live in src/model/10_engine_and_calibration.js.
function gatherParams(){
  const T=Number($('#temperature').value);
  const gas=gasPreset();
  const airGas={o2:.2095,co2:.0004};
  const cellRaw=DATA.cellLines[$('#cellLine').value], medRaw=DATA.media[$('#medium').value], oil=DATA.oils[$('#oilType').value];
  const cell={...cellRaw};
  if(cell.id==='custom'){
    cell.ocr=Number.isFinite(Number($('#customOCR').value))?Number($('#customOCR').value):0;
    cell.gcr=Number.isFinite(Number($('#customGCR').value))?Number($('#customGCR').value):0;
    cell.lpr=Number.isFinite(Number($('#customLPR').value))?Number($('#customLPR').value):0;
    cell.gln=Number.isFinite(Number($('#customGlnCR').value))?Number($('#customGlnCR').value):0;
    cell.dt=Number.isFinite(Number($('#doublingTime').value))?Number($('#doublingTime').value):24;
    cell.lag=Number.isFinite(Number($('#lagPhase').value))?Number($('#lagPhase').value):0;
  }
  const med={...medRaw};
  if(med.id==='custom_medium'){
    med.glc=Number($('#customGlucose').value)||0;
    med.gln=Number($('#customGln').value)||0;
    med.bicarb=Number($('#customBicarb').value)||0;
    med.buffer=Number($('#customBuffer').value)||1;
    med.pyr=0;
    med.lac=0;
  }
  let rates={ocr:cell.ocr||0,gcr:cell.gcr||0,lpr:cell.lpr||0,gln:cell.gln||0};
  let sub={glc:med.glc||0,gln:med.gln||0,pyr:med.pyr||0,bicarb:med.bicarb||0,lac:med.lac||0};
  let buffer=med.buffer||1;
  const warningSet=new Set(), warnings=[];
  const warn=(type,text)=>{const key=type+'|'+text; if(!warningSet.has(key)){warningSet.add(key); warnings.push({type,text});}};
  const conflictPairs=new Set();
  for(const a of Object.values(DATA.additives)){
    const cb=$(`#add_${a.id}`);
    if(!cb||!cb.checked)continue;
    const v=Number($(`#qty_${a.id}`).value)||0;
    if(a.conflict){
      for(const c of a.conflict){
        if($(`#add_${c}`)?.checked){
          const pair=[a.id,c].sort().join(':');
          if(!conflictPairs.has(pair)){
            conflictPairs.add(pair);
            warn('warn',`${DATA.additives[pair.split(':')[0]].name} and ${DATA.additives[pair.split(':')[1]].name} are both selected; verify intended glutamine source.`);
          }
        }
      }
    }
    for(const [k,fn] of Object.entries(a.mod||{}))rates[k]*=fn(v);
    for(const [k,fn] of Object.entries(a.add||{}))sub[k]=(sub[k]||0)+fn(v);
    if(a.buffer)buffer+=a.buffer(v);
  }
  const war=Number($('#warburgOverride').value);
  if(war>=0){
    const base=cell.warburg??.5;
    rates.ocr*=clamp(1-.35*(war-base),.25,2.5);
    rates.gcr*=clamp(1+.75*(war-base),.25,3);
    rates.lpr*=clamp(1+1.0*(war-base),.25,4);
    rates.gln*=clamp(1+.45*(war-base),.25,3);
  }
  ['ocr','gcr','lpr','gln'].forEach(k=>{
    const id={ocr:'ocrOverride',gcr:'gcrOverride',lpr:'lprOverride',gln:'glnOverride'}[k];
    const val=Number($('#'+id).value);
    if(Number.isFinite(val)&&val>=0&&$('#'+id).value!=='')rates[k]=val;
  });
  const rateOverridesActive=['ocrOverride','gcrOverride','lprOverride','glnOverride'].some(id=>String($('#'+id)?.value??'').trim()!=='');
  const rateTemperatureMode=$('#rateTemperatureMode')?.value||'reference_37c_q10';
  const q10Factor={ocr:1,gcr:1,lpr:1,gln:1};
  if(rateTemperatureMode==='reference_37c_q10'){
    q10Factor.ocr=Math.pow(PHYS.Q10_OCR,(T-37)/10);
    q10Factor.gcr=Math.pow(PHYS.Q10_GCR,(T-37)/10);
    q10Factor.lpr=Math.pow(PHYS.Q10_LPR,(T-37)/10);
    q10Factor.gln=Math.pow(PHYS.Q10_GLN,(T-37)/10);
    rates.ocr*=q10Factor.ocr;
    rates.gcr*=q10Factor.gcr;
    rates.lpr*=q10Factor.lpr;
    rates.gln*=q10Factor.gln;
  }

  const volume_nL=volumeFromSlider($('#volumeT').value);
  const pop=quickPopulation(volume_nL);
  const phases=phaseVolumes();
  const totalEmulsion_uL=phases.Vemul_uL;
  const Vaq_uL=phases.Vaq_uL;
  const VoilEmul_uL=phases.VoilEmul_uL;
  const residualOil_uL=phases.residualOil_uL;
  const totalOil_uL=phases.totalOil_uL;
  const liquidFill_uL=phases.liquid_uL;
  const vessel=vesselSpec();
  const vesselDiameter_mm=Math.max(.2,Number($('#vesselDiameter')?.value)||vessel.diameter_mm||6);
  const tubingLength_mm=Math.max(1,Number($('#tubingLength')?.value)||vessel.length_mm||1000);
  const tubingCrossSection_mm2=Math.PI*Math.pow(vesselDiameter_mm/2,2);
  const vesselCapacity_uL=vessel.kind==='tubing'?tubingCrossSection_mm2*tubingLength_mm:(Number.isFinite(vessel.capacity_uL)?vessel.capacity_uL:null);
  const filledTubingLength_mm=vessel.kind==='tubing'?Math.min(tubingLength_mm,liquidFill_uL/Math.max(1e-9,tubingCrossSection_mm2)):null;
  const vesselArea_mm2=vessel.kind==='tubing'?Math.PI*vesselDiameter_mm*Math.max(0,filledTubingLength_mm||0):Math.PI*Math.pow(vesselDiameter_mm/2,2);
  const emulsionDepth_mm=vessel.kind==='tubing'?vesselDiameter_mm/2:totalEmulsion_uL/Math.max(.001,vesselArea_mm2);
  const residualOilDepth_mm=vessel.kind==='tubing'?0:residualOil_uL/Math.max(.001,vesselArea_mm2);
  const O2eq=o2Eq(T,gas);
  const airO2Eq=o2Eq(T,airGas);
  const CO2eq=co2Eq(T,gas);
  const pHBoundaryMode=$('#pHBoundaryMode')?.value||'fixed_starting_pH_boundary';
  const pHModel=$('#pHModel')?.value||'carbonate_alkalinity';
  const pH0Input=Number.isFinite(Number($('#pH0').value))?Number($('#pH0').value):7.4;
  const CO2FromStartingPH=(sub.bicarb>0.5)?clamp(sub.bicarb/Math.pow(10,pH0Input-carbonateConstants(T).pKa1),0.001,200):CO2eq;
  const CO2Initial=CO2FromStartingPH;
  const CO2Boundary=(sub.bicarb>0.5?(pHBoundaryMode==='fixed_starting_pH_boundary'?CO2FromStartingPH:CO2eq):CO2eq);
  let headspace_mL=($('#vesselPreset')?.value&&$('#vesselPreset').value!=='custom')?autoHeadspace_mL(vessel):Math.max(0,Number.isFinite(Number($('#headspaceVolume').value))?Number($('#headspaceVolume').value):0);
  const invalid=[];
  if(gas.custom&&gas.o2+gas.co2>1+1e-9)invalid.push(`Custom gas O₂ + CO₂ cannot exceed 100%; current total is ${fmt((gas.o2+gas.co2)*100,1)}%.`);
  if(vessel.id!=='custom'&&Number.isFinite(vesselCapacity_uL)&&liquidFill_uL>vesselCapacity_uL)invalid.push(`Liquid fill ${fmt(liquidFill_uL/1000,3)} mL exceeds ${vessel.name} capacity ${fmt(vesselCapacity_uL/1000,3)} mL.`);
  if(vessel.kind==='tubing'&&Number.isFinite(vesselCapacity_uL)&&liquidFill_uL>vesselCapacity_uL)invalid.push('Liquid fill exceeds PTFE tubing capacity; increase tubing length or reduce liquid volume.');
  if(headspace_mL<0)headspace_mL=0;

  const targetCellsInput=Number($('#targetCells').value);
  const targetCells=Number.isFinite(targetCellsInput)?targetCellsInput:1;
  const lambdaInput=Number($('#lambda').value);
  const lambda=Number.isFinite(lambdaInput)?lambdaInput:0;
  const targetProbability=poissonPMF(targetCells,lambda);
  const occupancy=buildOccupancyModel(lambda,pop.N,targetCells);
  const initHeadspaceO2Pct=clamp(Number.isFinite(Number($('#initHeadspaceO2Pct')?.value))?Number($('#initHeadspaceO2Pct')?.value):gas.o2*100,0,100);
  const initHeadspaceCO2Pct=clamp(Number.isFinite(Number($('#initHeadspaceCO2Pct')?.value))?Number($('#initHeadspaceCO2Pct')?.value):gas.co2*100,0,100);
  const thresholdMode=$('#o2ThresholdMode')?.value||'selected_pct';
  const thresholdValue=Math.max(0,Number($('#hypoxiaPct').value)||0);
  const rawInputs=captureRawInputs();
  const p={
    T,gas,cell,med,oil,rates,sub,buffer,warnings,invalid,
    volume_nL,targetCells,lambda,targetProbability,N:pop.N,p0:pop.p0,p1:pop.p1,empty:pop.empty,single:pop.single,multi:pop.multi,
    totalCells:occupancy.expectedTotalCells,bulkInitialCells:occupancy.expectedBulkCells,occupancy,occupiedDroplets:occupancy.occupiedDroplets,occupiedFraction:occupancy.occupiedFraction,
    totalEmulsion_uL,Vaq_uL,VoilEmul_uL,residualOil_uL,totalOil_uL,liquidFill_uL,vessel,vesselCapacity_uL,tubingLength_mm,filledTubingLength_mm,
    vesselDiameter_mm,vesselArea_mm2,emulsionDepth_mm,residualOilDepth_mm,
    CO2Initial,CO2Boundary,pHBoundaryMode,pHModel,geometryMode:$('#geometryMode')?.value||'auto',modelTier:$('#modelTier')?.value||'heuristic',halfTimeMode:$('#halfTimeMode')?.value||'reference_scaled',rateTemperatureMode,q10Factor,
    O2eq,airO2Eq,CO2eq,atmMode:$('#atmMode').value,headspace_mL,
    initHeadspaceO2Pct,initHeadspaceCO2Pct,
    headO2Initial:dryGasPctToHeadspaceMoles(initHeadspaceO2Pct,headspace_mL,T),
    headCO2Initial:dryGasPctToHeadspaceMoles(initHeadspaceCO2Pct,headspace_mL,T),
    gasHalf:Number($('#gasHalf').value)||60,oilHalf:Number($('#oilHalf').value)||60,dropHalf:Number($('#dropHalf').value)||10,
    gradientFactor:Number($('#gradientFactor').value)||1,centerPenalty:Number($('#centerPenalty').value)||1,storageMode:$('#storageMode').value,bulkO2Mode:$('#bulkO2Mode')?.value||'auto',
    surfaceAccess:clamp(Number($('#surfaceAccess').value)||0,0,100)/100,pH0:Number($('#pH0').value)||7.4,pHFloor:Number($('#pHFloor').value)||6.8,
    pHCeiling:Number($('#pHCeiling').value)||7.65,o2ThresholdMode:thresholdMode,o2ThresholdValue:thresholdValue,
    initAqO2Pct:clamp((Number.isFinite(Number($('#initAqO2Pct')?.value))?Number($('#initAqO2Pct')?.value):100),0,300),
    initOilO2Pct:clamp((Number.isFinite(Number($('#initOilO2Pct')?.value))?Number($('#initOilO2Pct')?.value):100),0,300),
    initReservoirO2Pct:clamp((Number.isFinite(Number($('#initReservoirO2Pct')?.value))?Number($('#initReservoirO2Pct')?.value):100),0,300),
    glucoseFloor:Math.max(0,(Number.isFinite(Number($('#glucoseFloor')?.value))?Number($('#glucoseFloor')?.value):0.1)),
    glutamineFloor:Math.max(0,(Number.isFinite(Number($('#glutamineFloor')?.value))?Number($('#glutamineFloor')?.value):0.05)),
    prolif:$('#proliferation').value==='on',dt_h:Number.isFinite(Number($('#doublingTime').value))?Number($('#doublingTime').value):(cell.dt||24),lag_h:Number.isFinite(Number($('#lagPhase').value))?Number($('#lagPhase').value):(cell.lag||0),
    logStep:Number.isFinite(Number($('#logStep').value))?Number($('#logStep').value):30,maxDays:Number.isFinite(Number($('#maxDays').value))?Number($('#maxDays').value):14,decimals:Number.isFinite(Number($('#decimals').value))?Number($('#decimals').value):4,
    marginWarning:Number($('#marginWarning').value)||12,carryingCellsPerNL:Math.max(1,Number($('#carryingCapacity')?.value)||300),
    pasteurThreshold_uM:Number.isFinite(Number($('#pasteurThreshold')?.value))?Math.max(0,Number($('#pasteurThreshold')?.value)):20,pasteurMax:clamp(Number($('#pasteurMax')?.value)||1.8,1,5),
    o2Km_uM:Math.max(1e-6,Number($('#o2Km')?.value)||1),rq:Math.max(0,cell.rq||1),estimatedWorkload:null,
    rateScenarioSource:{customCell:cell.id==='custom',overridesActive:rateOverridesActive},rawInputs
  };
  p.o2Threshold=thresholdFromMode(p.o2ThresholdValue,p.o2ThresholdMode,p.O2eq,p.airO2Eq);
  p.initialO2T=p.airO2Eq*p.initAqO2Pct/100;
  p.initialO2B=p.initialO2T;
  p.initialO2Oil=p.airO2Eq*p.initOilO2Pct/100;
  p.initialO2Res=p.airO2Eq*p.initReservoirO2Pct/100;
  p.DICInitial=carbonateBaseline(p).dic0;
  p.chartO2Reference=Math.max(1,p.airO2Eq,p.O2eq,p.initialO2T,p.initialO2Oil,p.initialO2Res,p.o2Threshold);
  hardValidateInputs(p);
  p.estimatedWorkload=estimateSolverWorkload(p);

  if(p.pH0<=p.pHFloor)warn('danger','Initial pH is at or below the pH floor; the endpoint will occur immediately unless limits are changed.');
  if(p.vessel.id!=='custom'&&Number.isFinite(p.vesselCapacity_uL)&&liquidFill_uL>p.vesselCapacity_uL)warn('danger','Invalid geometry: liquid fill exceeds selected vessel capacity. The simulation is blocked until this is corrected.');
  if(residualOil_uL>totalEmulsion_uL)warn('warn','Excess reservoir oil is larger than the generated droplet emulsion. This is valid for an oil overlay or loop, but if you meant a single total-liquid volume, set excess oil to 0 and use aqueous fraction to define the oil inside the emulsion.');
  if(p.gas.o2>.15&&p.gas.co2<.005&&p.sub.bicarb>5&&p.pHBoundaryMode!=='fixed_starting_pH_boundary')warn('warn','Ambient-air boundary with bicarbonate medium can drive strong pH drift when the selected-gas CO₂ boundary is active. Use 5% CO₂/air for bicarbonate-buffered incubations unless ambient exposure is intentional.');
  if(p.sub.bicarb>5&&p.pHBoundaryMode==='fixed_starting_pH_boundary')warn('warn','Bicarbonate pH is using an explicit infinite CO₂ reservoir matched to the starting pH. This is not a closed-system carbon balance.');
  configCompatibilityIssues(p).forEach(text=>warn('danger',text));
  if(p.atmMode==='closed'&&p.headspace_mL<=1e-9)warn('warn','Closed mode has zero headspace volume, so gas exchange with a headspace compartment is disabled.');
  if(p.targetCells>p.carryingCellsPerNL*p.volume_nL)warn('warn','Initial target-cell count exceeds the proliferation carrying-capacity estimate for this droplet volume.');
  if(p.targetProbability<0.001)warn('warn',`The evaluated droplet occupancy is very rare under λ: P(K=${p.targetCells}) = ${fmt(p.targetProbability*100,4)}%. Treat this as a stress-test droplet, not a representative droplet.`);
  else if(p.targetProbability<0.01)warn('warn',`The evaluated droplet occupancy is uncommon under λ: P(K=${p.targetCells}) = ${fmt(p.targetProbability*100,3)}%.`);
  const rt=String(cell.rateTier||cell.evidenceTier||'').toUpperCase();
  if(['B','C','D'].includes(rt))warn('warn',`Cell-line metabolic rates are rate tier ${rt}; run low/nominal/high measured-rate scenarios before quantitative use.`);
  if(p.modelTier==='heuristic'&&p.pHModel==='heuristic_legacy')warn('warn','Both the pH and growth layers remain heuristic. Use measured exchange half-times and direct endpoint validation for release-critical experiments.');
  else if(p.modelTier==='heuristic')warn('warn','Growth remains heuristic. The pH layer is using the carbonate/alkalinity solver with linear non-bicarbonate buffer alkalinity, not a full ionic-strength charge-balance medium model.');
  if(p.modelTier==='measured_inputs'&&p.halfTimeMode==='reference_scaled')warn('warn','Measured-input interpretation is active, but exchange half-times are still being treated as geometry-scaled reference values. Switch half-time interpretation to "effective measured" if your entered half-times already match this exact configuration.');
  if(p.halfTimeMode==='measured_effective')warn('ok','Exchange half-times are being applied directly for the current configuration with no automatic geometry rescaling.');
  if(p.rateTemperatureMode==='measured_selected_temperature')warn('ok','Custom and override rates are being used as already measured at the selected temperature; no Q10 correction is applied.');
  if(p.atmMode==='closed'&&p.headO2Initial>0){
    const oilDemand=(VoilEmul_uL+residualOil_uL)*1000*oil.capacityRatio*Math.max(p.initialO2Oil,p.O2eq);
    if(oilDemand>p.headO2Initial*2)warn('warn','Closed headspace oxygen is small relative to the oil oxygen capacity; oil equilibration can rapidly shift headspace pO₂.');
  }
  if(p.sub.bicarb>0.5){
    const initialBoundaryCO2=p.pHBoundaryMode==='fixed_starting_pH_boundary'?p.CO2Boundary:(p.pHBoundaryMode==='closed_headspace_mass_balance'?co2HeadEq({headCO2:p.headCO2Initial},p):p.CO2eq);
    const pHEq=p.pHModel==='carbonate_alkalinity'?boundaryEquilibriumPH(initialBoundaryCO2,p):(carbonateConstants(p.T).pKa1+Math.log10(Math.max(.05,p.sub.bicarb)/Math.max(.001,initialBoundaryCO2)));
    if(Math.abs(pHEq-p.pH0)>0.15)warn('warn',`Starting pH ${fmt(p.pH0,2)} is inconsistent with the ${p.pHModel==='carbonate_alkalinity'?'carbonate/alkalinity':'simplified bicarbonate'} equilibrium for the selected gas by about ${fmt(Math.abs(pHEq-p.pH0),2)} pH units. The run begins from a nonequilibrium state.`);
  }
  if(p.O2eq<5)warn('warn','Selected boundary gas is effectively anoxic. Initial liquid and closed-headspace oxygen are entered independently and may still start above zero.');
  if(p.estimatedWorkload.estimatedSteps>500000)warn('warn',`Estimated solver workload is high at about ${fmt(p.estimatedWorkload.estimatedSteps,0)} accepted sub-steps. Auto-rerun is disabled for this configuration; use Calculate explicitly.`);
  p.parameterProvenance=buildParameterProvenance(p);
  return p;
}
function renderScenarioTable(result){
  const rows=(result&&result.rateScenarios)||[];
  if(!rows.length){$('#scenarioTable tbody').innerHTML='<tr><td colspan="5">Run a calculation to populate deterministic rate scenarios.</td></tr>'; return;}
  const body=rows.map(row=>`<tr><td>${row.label}${row.available?'':' *'}</td><td>${row.limiter==='simulation horizon'?'≥ '+hoursLabel(result.params.maxDays*24):hoursLabel(row.safeMin/60)}</td><td>${row.limiter}</td><td>${fmt(row.final.O2T,3)} µM</td><td>${fmt(row.final.pH,3)}</td></tr>`).join('');
  const note=rows.some(row=>!row.available)?'<tr><td colspan="5">* Stored low/high bounds were unavailable for at least one scenario, so the current effective rates were reused.</td></tr>':'';
  $('#scenarioTable tbody').innerHTML=body+note;
}
function renderCalibrationResult(result){
  window.lastCalibration=result||null;
  if(window.lastResult)window.lastResult.calibration=result||null;
  if(!result){$('#calibrationSummary').textContent='Paste a measured O₂ series and run calibration to fit transport half-times for the current setup.'; $('#calibrationTable tbody').innerHTML='<tr><td colspan="4">Run calibration to populate residuals.</td></tr>'; return;}
  const keyText=result.parameterKeys.map(key=>`${key} ${fmt(result.bestFit[key],3)} min`).join(' · ');
  const intervalText=result.parameterKeys.map(key=>{const it=result.intervals[key]; return `${key} profile range ${fmt(it.low,3)}–${fmt(it.high,3)} min`;}).join(' · ');
  const corrText=result.correlation==null?'single-parameter fit':`likelihood-weighted local correlation ${fmt(result.correlation,3)}`;
  const warnings=(result.identifiabilityWarnings||[]).map(text=>`<div class="notice warn">${text}</div>`).join('');
  $('#calibrationSummary').innerHTML=`<div><strong>Best fit:</strong> ${keyText}. <strong>RMSE:</strong> ${fmt(result.rmse,3)} µM across ${fmt(result.sampleCount,0)} points. <strong>Observable:</strong> ${result.observableLabel}. <strong>Conditions match current setup:</strong> ${result.predictionConditionsMatchCurrentSetup?'yes':'no'}.</div><div style="margin-top:6px">${intervalText}. ${corrText}.</div>${warnings}`;
  $('#calibrationTable tbody').innerHTML=result.residuals.map(row=>`<tr><td>${fmt(row.time_h,3)} h</td><td>${fmt(row.observed,3)}</td><td>${fmt(row.predicted,3)}</td><td>${fmt(row.residual,3)}</td></tr>`).join('');
}
function completeRunResult(r){window.lastResult=r; if(r.error){renderSolverError(r); saveState(); return;} renderResult(r); drawChart(r); saveState();}
function runAndRenderSync(p){const r=Engine.simulate(p); r.rateScenarios=buildRateScenarioResults(p); completeRunResult(r);}
function runAndRender(){
  updateDynamicUI();
  const p=gatherParams();
  if(p.invalid&&p.invalid.length){window.lastResult=null; renderInvalid(p); saveState(); return;}
  if(startWorkerJob('simulate',{params:p},{
    startText:'Running calculation in background…',
    onProgress:progress=>{$('#progressNote').textContent=formatWorkerProgress('simulate',progress); $('#lastRun').textContent='Running calculation in background…';},
    onResult:r=>{completeRunResult(r); $('#lastRun').textContent=`Updated ${new Date().toLocaleTimeString()} from worker.`;},
    onError:error=>{runAndRenderSync(p); $('#lastRun').textContent=`Worker fallback after error: ${String(error).slice(0,120)}`;}
  }))return;
  runAndRenderSync(p);
}
function runScenarios(){
  const base=window.lastResult&&window.lastResult.params?window.lastResult.params:gatherParams();
  if(base.invalid&&base.invalid.length){$('#scenarioTable tbody').innerHTML=`<tr><td colspan="5">Scenario runs blocked: ${base.invalid.map(x=>String(x)).join(' ')}</td></tr>`; return;}
  if(startWorkerJob('scenarios',{params:base},{
    startText:'Running deterministic scenarios in background…',
    onResult:result=>{if(window.lastResult)window.lastResult.rateScenarios=result.rateScenarios; renderScenarioTable({params:base,rateScenarios:result.rateScenarios}); $('#lastRun').textContent='Deterministic rate scenarios updated.';},
    onError:()=>{const scenarios=buildRateScenarioResults(base); if(window.lastResult)window.lastResult.rateScenarios=scenarios; renderScenarioTable({params:base,rateScenarios:scenarios}); $('#lastRun').textContent='Deterministic rate scenarios updated.';}
  }))return;
  const scenarios=buildRateScenarioResults(base); if(window.lastResult)window.lastResult.rateScenarios=scenarios; renderScenarioTable({params:base,rateScenarios:scenarios}); $('#lastRun').textContent='Deterministic rate scenarios updated.';
}
function calibrationConfigFromUI(){
  return {observable:$('#calibrationObservable')?.value||'O2T',fitMode:$('#calibrationFitMode')?.value||'dropHalf',series:parseCalibrationSeries($('#calibrationSeries')?.value||'')};
}
function runCalibration(){
  const base=window.lastResult&&window.lastResult.params?window.lastResult.params:gatherParams();
  if(base.invalid&&base.invalid.length){$('#calibrationSummary').innerHTML=`<div class="notice danger">${base.invalid.map(x=>String(x)).join(' ')}</div>`; $('#calibrationTable tbody').innerHTML='<tr><td colspan="4">Calibration blocked.</td></tr>'; return;}
  let config;
  try{config=calibrationConfigFromUI();}catch(error){$('#calibrationSummary').innerHTML=`<div class="notice danger">${String(error&&error.message?error.message:error)}</div>`; $('#calibrationTable tbody').innerHTML='<tr><td colspan="4">Calibration input invalid.</td></tr>'; return;}
  if(startWorkerJob('calibration',{params:base,config},{
    startText:'Running calibration in background…',
    onProgress:progress=>{$('#progressNote').textContent=formatWorkerProgress('calibration',progress); $('#lastRun').textContent='Running calibration in background…';},
    onResult:result=>{renderCalibrationResult(result); $('#lastRun').textContent='Calibration updated from worker.';},
    onError:()=>{const result=runCalibrationFit(base,config); renderCalibrationResult(result); $('#lastRun').textContent='Calibration updated.';}
  }))return;
  const result=runCalibrationFit(base,config); renderCalibrationResult(result); $('#lastRun').textContent='Calibration updated.';
}
function uniqueWarningsForResult(r){
  const p=r.params||{};
  const warns=[...(p.warnings||[])];
  const safeH=r.safeMin/60;
  const horizon=r.limiter==='simulation horizon';
  if(horizon)warns.push({type:'ok',text:`No endpoint was reached within the ${fmt(p.maxDays,2)} day simulation horizon; the useful window is reported as ≥ horizon.`});
  if(r.effective?.subDt<.05)warns.push({type:'warn',text:'Fast exchange kinetics triggered adaptive sub-stepping for numerical stability.'});
  if(r.bulkO2Regime?.selectedMode==='grouped_transport_limited'&&r.bulkO2Regime.transportLimited)warns.push({type:'warn',text:'Bulk O₂ is using the conservative grouped empty/single/multi droplet comparison because sampled local depletion can compete with oil-mediated equilibration. Empty and occupied droplets still exchange through the shared oil reservoir. Nutrients remain mean-field across bulk droplets.'});
  else if(r.bulkO2Regime?.selectedMode==='grouped_transport_limited')warns.push({type:'warn',text:'Bulk O₂ is using the conservative grouped empty/single/multi droplet comparison even though sampled oil-mediated equilibration stays faster than local depletion. Use this as a transport-limited sensitivity check; empty and occupied droplets still exchange through the shared oil reservoir.'});
  else if(r.bulkO2Regime?.warningOnly)warns.push({type:'warn',text:'Bulk O₂ remains in the shared oil-buffered mean-field model, but sampled local occupied-droplet depletion is comparable to or faster than oil-mediated equilibration. Run the grouped empty/single/multi model as a conservative transport-limited comparison if local heterogeneity matters.'});
  else warns.push({type:'ok',text:'Bulk O₂ is using the shared mean-field oil reservoir because sampled oil-mediated equilibration stays faster than local occupied-droplet depletion.'});
  if(p.prolif&&safeH>24)warns.push({type:'warn',text:'Proliferation remains a heuristic logistic model; environmental inhibition beyond O₂ limitation is not fully modeled.'});
  if(!horizon&&safeH<p.marginWarning)warns.push({type:safeH<4?'danger':'warn',text:`Useful window is below ${fmt(p.marginWarning,0)} h.`});
  if(p.atmMode==='closed'&&p.headspace_mL<.1)warns.push({type:'warn',text:'Closed headspace is very small; oxygen and CO₂ boundaries can shift rapidly.'});
  if(p.VoilEmul_uL+p.residualOil_uL<0.25*p.Vaq_uL)warns.push({type:'warn',text:'Oil volume is low relative to aqueous droplets; fluorinated-oil oxygen buffering is limited.'});
  if(p.geometryMode==='ideal')warns.push({type:'warn',text:'Volume coupling is set to ideal. Absolute total volume can cancel out mathematically when λ and aqueous fraction are fixed; use geometry-corrected mode for vessel-scale forecasts.'});
  if(p.emulsionDepth_mm>6&&p.storageMode==='static_tube')warns.push({type:'warn',text:'Static emulsion depth is high for the selected vessel diameter; gas-boundary exchange is likely area-limited.'});
  if(p.storageMode==='static_tube'&&p.N>1e6)warns.push({type:'warn',text:'Large static droplet populations may develop center-to-edge oxygen gradients; validate with an oxygen sensor or use circulation/thin-layer storage.'});
  if(p.atmMode==='closed'&&r.mass?.o2ResidualPct>.1)warns.push({type:'warn',text:`Closed-system O₂ mass residual is ${fmt(r.mass.o2ResidualPct,3)}%; check fast exchange or solver settings.`});
  if(r.mass?.closedCarbonBalance&&r.mass?.co2ResidualPct>.1)warns.push({type:'warn',text:`${r.mass.trackedCarbonLabel||'Tracked aqueous + headspace CO₂'} residual is ${fmt(r.mass.co2ResidualPct,3)}%; check fast exchange or solver settings.`});
  return [...new Map(warns.map(w=>[w.type+'|'+w.text,w])).values()];
}
function buildExportPayload(r){
  const meta=artifactMetadata();
  const p=r.params||{};
  const warnings=uniqueWarningsForResult(r);
  return {
    release:document.body.dataset.release,
    artifactRelease:meta.release,
    artifactCommit:meta.commit,
    auditManifestSha256:meta.manifestSha256,
    exportedAt:new Date().toISOString(),
    rawInputs:p.rawInputs||{},
    effectiveParameters:p,
    parameterProvenance:p.parameterProvenance||{},
    halfTimeMode:p.halfTimeMode||null,
    rateTemperatureMode:p.rateTemperatureMode||null,
    transportModel:r.bulkO2Regime?.selectedMode||null,
    transportModelRecommendation:r.bulkO2Regime?.recommendedMode||r.bulkO2Regime?.selectedMode||null,
    pHModel:p.pHModel||'heuristic_legacy',
    actualConductances:r.conductances||{},
    solverTolerances:r.solver?.settings||{},
    solverDiagnostics:r.solver||{},
    warnings,
    uncertaintyScenario:null,
    rateScenarios:r.rateScenarios||[],
    calibration:r.calibration||null,
    massResiduals:r.mass||{},
    trackedCarbonResidualApplicable:!!r.mass?.closedCarbonBalance,
    result:r
  };
}
function renderInvalid(p){$('#safeTime').textContent='Invalid'; $('#limitedBy').textContent='configuration'; $('#safeBar').style.width='100%'; $('#safeBar').style.background='var(--danger)'; $('#safeCard').style.borderColor='rgba(220,38,38,.55)'; $('#eventList').innerHTML='<div class="event-row"><span>Calculation blocked</span><b>fix inputs</b></div>'; const msgs=[...p.invalid,...p.warnings.filter(w=>w.type==='danger').map(w=>w.text)]; $('#warnings').innerHTML=[...new Set(msgs)].map(t=>`<div class="notice danger">${t}</div>`).join('') || '<div class="notice danger">Invalid configuration.</div>'; $('#metrics').innerHTML=[['Liquid fill',fmt(p.liquidFill_uL/1000,3)+' mL','generated emulsion + excess oil'],['Vessel capacity',p.vesselCapacity_uL?fmt(p.vesselCapacity_uL/1000,3)+' mL':'custom','selected vessel'],['Estimated workload',p.estimatedWorkload?fmt(p.estimatedWorkload.estimatedSteps,0)+' steps':'—','pre-run workload estimate'],['Vessel',p.vessel.name,'incubation format']].map(m=>`<div class="metric"><div class="label">${m[0]}</div><div class="val mono">${m[1]}</div><small>${m[2]}</small></div>`).join(''); $('#logTable tbody').innerHTML=`<tr><td colspan="11">${msgs[0]||'Calculation blocked.'}</td></tr>`; $('#scenarioTable tbody').innerHTML=`<tr><td colspan="5">${msgs[0]||'Scenario runs blocked.'}</td></tr>`; $('#gasCards').innerHTML=`<div class="notice danger">${msgs[0]||'Invalid configuration. No forecast was generated.'}</div>`; $('#fluxNote').textContent='Flux balance not calculated for invalid configuration.'; $('#lastRun').textContent=`Calculation blocked: ${msgs[0]||'invalid configuration'}`; const c=$('#timeline'),ctx=c.getContext('2d'),rect=c.getBoundingClientRect(),dpr=devicePixelRatio||1; c.width=Math.max(320,Math.floor(rect.width*dpr)); c.height=Math.max(220,Math.floor(rect.height*dpr)); ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,rect.width,rect.height); ctx.fillStyle=getComputedStyle(document.documentElement).getPropertyValue('--solid'); ctx.fillRect(0,0,rect.width,rect.height); ctx.fillStyle=getComputedStyle(document.documentElement).getPropertyValue('--danger'); ctx.font='16px Inter, system-ui'; ctx.textAlign='center'; ctx.fillText('Invalid configuration — calculation blocked',rect.width/2,rect.height/2);}
function renderSolverError(r){const p=r.params; $('#safeTime').textContent='Stopped'; $('#limitedBy').textContent='solver budget'; $('#safeBar').style.width='100%'; $('#safeBar').style.background='var(--warn)'; $('#safeCard').style.borderColor='rgba(217,119,6,.55)'; $('#eventList').innerHTML='<div class="event-row"><span>Calculation stopped</span><b>solver budget</b></div>'; $('#warnings').innerHTML=`<div class="notice warn">${r.error}</div>`; $('#metrics').innerHTML=[['Accepted steps',fmt(r.solver.acceptedSteps,0),'completed before stop'],['Root iterations',fmt(r.solver.rootIterations,0),'bracketed event refinements'],['Estimated workload',fmt(r.solver.estimatedSteps,0),'pre-run estimate'],['Min / median / max dt',`${fmt(r.solver.actualMinStep,4)} / ${fmt(r.solver.actualMedianStep,4)} / ${fmt(r.solver.actualMaxStep,4)} min`,'accepted timestep distribution']].map(m=>`<div class="metric"><div class="label">${m[0]}</div><div class="val mono">${m[1]}</div><small>${m[2]}</small></div>`).join(''); $('#gasCards').innerHTML=`<div class="notice warn">${r.error}</div>`; $('#scenarioTable tbody').innerHTML=`<tr><td colspan="5">${r.error}</td></tr>`; $('#logTable tbody').innerHTML=`<tr><td colspan="11">${r.error}</td></tr>`; $('#fluxNote').textContent='Flux balance shown below is from the initial state only.'; $('#lastRun').textContent=r.error; const c=$('#timeline'),ctx=c.getContext('2d'),rect=c.getBoundingClientRect(),dpr=devicePixelRatio||1; c.width=Math.max(320,Math.floor(rect.width*dpr)); c.height=Math.max(220,Math.floor(rect.height*dpr)); ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,rect.width,rect.height); ctx.fillStyle=getComputedStyle(document.documentElement).getPropertyValue('--solid'); ctx.fillRect(0,0,rect.width,rect.height); ctx.fillStyle=getComputedStyle(document.documentElement).getPropertyValue('--warn'); ctx.font='16px Inter, system-ui'; ctx.textAlign='center'; ctx.fillText('Solver budget exceeded — adjust horizon or kinetics',rect.width/2,rect.height/2);}
function thresholdLabel(p){if(p.o2ThresholdMode==='absolute_uM')return `absolute ${fmt(p.o2ThresholdValue,3)} µM`; if(p.o2ThresholdMode==='air_pct')return `${fmt(p.o2ThresholdValue,3)}% air saturation`; return `${fmt(p.o2ThresholdValue,3)}% selected-gas equilibrium`;}
function renderResult(r){
  const p=r.params,d=p.decimals,safeH=r.safeMin/60;
  const horizon=r.limiter==='simulation horizon';
  const displayH=horizon?`≥ ${hoursLabel(p.maxDays*24)}`:hoursLabel(safeH);
  $('#safeTime').textContent=displayH;
  $('#limitedBy').textContent=horizon?'no endpoint within horizon':r.limiter;
  const color=horizon?'var(--ok)':safeH<4?'var(--danger)':safeH<12?'var(--warn)':'var(--ok)';
  $('#safeBar').style.width=horizon?'100%':`${clamp((safeH/24)*100,0,100)}%`;
  $('#safeBar').style.background=color;
  $('#safeCard').style.borderColor=horizon?'rgba(22,163,74,.30)':safeH<4?'rgba(220,38,38,.35)':safeH<12?'rgba(217,119,6,.35)':'rgba(22,163,74,.30)';
  const ev=e=>e==null?(horizon?'not reached':'not evaluated after first endpoint'):hoursLabel(e/60);
  $('#eventList').innerHTML=[['Target O₂ threshold',ev(r.events.O2)],['Glucose depletion',ev(r.events.Glucose)],['Glutamine depletion',ev(r.events.Glutamine)],['pH floor',ev(r.events.pH_floor)],['pH ceiling',ev(r.events.pH_ceiling)]].map(x=>`<div class="event-row"><span>${x[0]}</span><b>${x[1]}</b></div>`).join('');
  $('#metrics').innerHTML=[
    ['Useful window',displayH,horizon?'no endpoint reached':'first endpoint in evaluated droplet'],
    ['Limiting factor',horizon?'none within horizon':r.limiter,'minimum endpoint'],
    ['Initial O₂',`${fmt(p.initialO2T,1)} µM`,`${fmt(p.initAqO2Pct,1)}% air saturation`],
    ['Endpoint pH',fmt(r.final.pH,3),'evaluated droplet'],
    ['Endpoint CO₂*',fmt(r.final.CO2T,3)+' mM',p.pHModel==='carbonate_alkalinity'?'evaluated droplet dissolved CO₂ from DIC speciation':'evaluated droplet dissolved CO₂'],
    ['pH model',p.pHModel.replaceAll('_',' '),p.pHModel==='carbonate_alkalinity'?'DIC + alkalinity + water + linear non-bicarbonate buffer':'legacy Henderson-Hasselbalch comparison mode'],
    ['pH boundary',p.pHBoundaryMode.replaceAll('_',' '),'bicarbonate/CO₂'],
    ['Rate source',p.cell.rateTier?('Tier '+p.cell.rateTier):'direct/default',p.cell.rateBasis||p.cell.estimateBasis||'embedded default'],
    ['P(target occupancy)',fmt(p.targetProbability*100,4)+'%',`K=${p.targetCells} at λ ${fmt(p.lambda,2)}`],
    ['Total droplets',fmt(p.N,0),`λ ${fmt(p.lambda,2)}`],
    ['Expected cells',fmt(p.totalCells,0),'conditional on the evaluated droplet'],
    ['Occupied droplets',fmt(p.occupiedDroplets,0),`${fmt(p.occupiedFraction*100,1)}% of non-target droplets`],
    ['Oil O₂ capacity',fmt(r.capacities.capOilE+r.capacities.capOilR,0)+' fmol/µM','water-equivalent']
  ].map(m=>`<div class="metric"><div class="label">${m[0]}</div><div class="val mono">${m[1]}</div><small>${m[2]}</small></div>`).join('');
  $('#logTable tbody').innerHTML=r.log.map(s=>`<tr><td>${fmt(s.t/60,2)} h</td><td>${fmt(s.O2T,d)}</td><td>${fmt(s.O2B,d)}</td><td>${fmt(s.O2Oil,d)}</td><td>${fmt(s.O2Res,d)}</td><td>${fmt(s.CO2T,3)}</td><td>${fmt(s.Glc,d)}</td><td>${fmt(s.Gln,d)}</td><td>${fmt(s.pH,3)}</td><td>${fmt(s.nT,2)}</td><td class="${s.status==='Viable'?'status-ok':s.status==='Hypoxia'?'status-danger':'status-warn'}">${s.status}</td></tr>`).join('');
  const flux=r.initialFlux, max=Math.max(flux.demand,flux.boundaryIntoLiquid,flux.localIntoDroplets,1e-9);
  $('#fluxBar .in').style.width=`${50*Math.max(flux.boundaryIntoLiquid,flux.localIntoDroplets)/max}%`;
  $('#fluxBar .out').style.width=`${50*flux.demand/max}%`;
  const regime=classifyRegime(r);
  $('#fluxNote').textContent=`Regime: ${regime}. Initial oxygen demand ${fmt(flux.demand,2)} fmol/min. Boundary flux into liquid ${fmt(flux.boundaryIntoLiquid,2)} and out of liquid ${fmt(flux.boundaryOutOfLiquid,2)} fmol/min. Local droplet-delivery flux ${fmt(flux.localIntoDroplets,2)} fmol/min.`;
  $('#gasCards').innerHTML=[
    ['Target droplet O₂ capacity',fmt(r.capacities.capT,3)+' fmol/µM'],
    ['Bulk occupied O₂ capacity',fmt(r.capacities.capBulkOccupied,0)+' fmol/µM'],
    ['Bulk empty-droplet O₂ capacity',fmt(r.capacities.capEmpty,0)+' fmol/µM'],
    ['Emulsion oil capacity',fmt(r.capacities.capOilE,0)+' fmol/µM'],
    ['Residual oil capacity',fmt(r.capacities.capOilR,0)+' fmol/µM'],
    ['Finite headspace O₂ capacity',p.atmMode==='closed'?fmt(r.capacities.capHead,0)+' fmol/µM':'replenished'],
    ['Finite headspace CO₂ capacity',p.atmMode==='closed'?fmt(r.capacities.capHeadCO2,0)+' fmol/mM':'replenished'],
    ['Vessel',p.vessel.name],
    ['Vessel capacity',p.vesselCapacity_uL?fmt(p.vesselCapacity_uL,1)+' µL':'custom'],
    ['Vessel area',fmt(p.vesselArea_mm2,1)+' mm²'],
    ['Emulsion depth',fmt(p.emulsionDepth_mm,2)+' mm'],
    ['Residual oil depth',fmt(p.residualOilDepth_mm,2)+' mm'],
    ['Filled tubing length',p.filledTubingLength_mm?fmt(p.filledTubingLength_mm,1)+' mm':'n/a'],
    ['Effective gas half-time',fmt(r.effective.gasResHalf,1)+' min'],
    ['Direct surface half-time',fmt(r.effective.gasDirectHalf,1)+' min'],
    ['Effective oil-mix half-time',fmt(r.effective.oilHalf,1)+' min'],
    ['Target droplet half-time',fmt(r.effective.dropTargetHalf,1)+' min'],
    ['Bulk droplet half-time',fmt(r.effective.dropBulkHalf,1)+' min'],
    ['Half-time interpretation',p.halfTimeMode.replaceAll('_',' '),'reference-scaled or directly measured'],
    ['Bulk O₂ regime',r.bulkO2Regime.selectedMode.replaceAll('_',' '),`drop half-time ${fmt(r.bulkO2Regime.exchangeHalfMin,2)} min vs sampled min local depletion ${Number.isFinite(r.bulkO2Regime.minDepletionMin)?fmt(r.bulkO2Regime.minDepletionMin,2):'∞'} min at ${fmt((r.bulkO2Regime.sampledTimeMin||0)/60,2)} h; depletion/exchange ratio ${Number.isFinite(r.bulkO2Regime.depletionToExchangeRatio)?fmt(r.bulkO2Regime.depletionToExchangeRatio,2):'∞'}x${r.bulkO2Regime.warningOnly?`; grouped transport-limited comparison recommended`:''}`],
    ['Rate temperature mode',p.rateTemperatureMode.replaceAll('_',' '),p.rateTemperatureMode==='reference_37c_q10'?`Q10 OCR ${fmt(p.q10Factor.ocr,3)} · GCR ${fmt(p.q10Factor.gcr,3)} · LPR ${fmt(p.q10Factor.lpr,3)} · GLN ${fmt(p.q10Factor.gln,3)}`:'no Q10 temperature scaling applied'],
    ['Geometry mode',r.geometry.notes],
    ['O₂ threshold',fmt(p.o2Threshold,3)+' µM',thresholdLabel(p)],
    ['Glucose / glutamine floors',fmt(p.glucoseFloor,3)+' / '+fmt(p.glutamineFloor,3)+' mM'],
    ['CO₂ exchange half-time',fmt(r.effective.co2TargetHalf,1)+' min',p.pHModel==='carbonate_alkalinity'?'applied to dissolved CO₂* using frozen carbonate speciation over each accepted substep':'applied to dissolved CO₂'],
    ['Closed O₂ mass residual',p.atmMode==='closed'?fmt(r.mass.o2ResidualPct,4)+'%':'open boundary'],
    [r.mass.trackedCarbonLabel||'Tracked aqueous + headspace CO₂ residual',r.mass.closedCarbonBalance?fmt(r.mass.co2ResidualPct,4)+'%':'not applicable',r.mass.closedCarbonBalance?(p.pHModel==='carbonate_alkalinity'?'finite closed-headspace DIC + headspace CO₂ balance; oil-phase CO₂ is not tracked':'finite closed-headspace dissolved CO₂ + headspace CO₂ balance; oil-phase CO₂ is not tracked'):'external or replenished CO₂ boundary'],
    ['Estimated / actual steps',`${fmt(r.solver.estimatedSteps,0)} / ${fmt(r.solver.acceptedSteps,0)}`,'pre-run estimate vs accepted steps'],
    ['Accepted dt min / median / max',`${fmt(r.solver.actualMinStep,4)} / ${fmt(r.solver.actualMedianStep,4)} / ${fmt(r.solver.actualMaxStep,4)} min`],
    ['Root iterations',fmt(r.solver.rootIterations,0),`budget ${fmt(r.solver.rootBudget,0)}`],
    ['Stable dt estimate',fmt(r.effective.subDt,4)+' min','transfer-based upper bound, not the full accepted-step history'],
    ['Oil capacity ratio',fmt(p.oil.capacityRatio,1)+'× water']
  ].map(x=>`<div class="gas-card"><div class="label">${x[0]}</div><div class="val mono">${x[1]}</div>${x[2]?`<small>${x[2]}</small>`:''}</div>`).join('');
  const uniqueWarns=uniqueWarningsForResult(r);
  $('#warnings').innerHTML=uniqueWarns.map(w=>`<div class="notice ${w.type}">${w.text}</div>`).join('')||'<div class="notice ok">No major configuration warnings.</div>';
  renderScenarioTable(r);
  $('#lastRun').textContent=`Updated ${new Date().toLocaleTimeString()}. ${p.cell.name}, ${fmt(p.volume_nL,3)} nL, λ ${fmt(p.lambda,2)}, ${displayH} useful window.`;
}
function classifyRegime(r){const f=r.initialFlux||{}, p=r.params||{}; if(p.atmMode==='closed'&&p.headspace_mL<0.2)return 'finite-headspace-limited'; if((f.localIntoDroplets||0)<(f.demand||0)*0.8)return 'droplet-interface-limited'; if((f.boundaryIntoLiquid||0)<(f.demand||0)*0.8)return 'gas-boundary-limited'; if((r.capacities.capOilE+r.capacities.capOilR)<(r.capacities.capT+r.capacities.capBulkOccupied)*2)return 'reservoir-capacity-limited'; return 'cellular-demand or horizon-limited';}
function drawChart(r){const c=$('#timeline'),ctx=c.getContext('2d'),rect=c.getBoundingClientRect(),dpr=devicePixelRatio||1; c.width=Math.max(320,Math.floor(rect.width*dpr)); c.height=Math.max(220,Math.floor(rect.height*dpr)); ctx.setTransform(dpr,0,0,dpr,0,0); const W=rect.width,H=rect.height,pad={l:48,r:42,t:18,b:34}; const root=getComputedStyle(document.documentElement); ctx.clearRect(0,0,W,H); ctx.fillStyle=root.getPropertyValue('--solid'); ctx.fillRect(0,0,W,H); const data=r.chart,p=r.params,safeH=r.safeMin/60,xmax=Math.max(2,Math.min(p.maxDays*24,safeH*1.5||24)); const innerW=W-pad.l-pad.r,innerH=H-pad.t-pad.b; const x=t=>pad.l+(t/60)/xmax*innerW; const base=Math.max(1,p.chartO2Reference||p.O2eq); const maxPct=Math.max(115,Math.ceil(Math.max(...data.map(s=>Math.max(s.O2T,s.O2B,s.O2Oil,s.O2Res,p.o2Threshold)).map(v=>100*v/base))/25)*25); const yPct=v=>pad.t+(1-clamp(v,0,maxPct)/maxPct)*innerH, yPH=ph=>pad.t+(1-(clamp(ph,6.4,7.8)-6.4)/1.4)*innerH; ctx.strokeStyle=root.getPropertyValue('--line'); ctx.lineWidth=1; ctx.beginPath(); for(let i=0;i<=4;i++){let yy=pad.t+i*innerH/4; ctx.moveTo(pad.l,yy); ctx.lineTo(W-pad.r,yy)} ctx.stroke(); ctx.fillStyle=root.getPropertyValue('--muted'); ctx.font='11px Inter, system-ui'; ctx.textAlign='center'; for(let i=0;i<=4;i++){ctx.fillText(fmt(i*xmax/4,1)+' h',pad.l+i*innerW/4,H-12)} ctx.textAlign='right'; for(let i=0;i<=4;i++)ctx.fillText(fmt(maxPct-i*maxPct/4,0)+'%',pad.l-8,pad.t+i*innerH/4+4); ctx.textAlign='left'; ctx.fillText('pH 7.8',W-pad.r+4,pad.t+4); ctx.fillText('pH 6.4',W-pad.r+4,pad.t+innerH); const line=(getter,color,yfn=yPct,dash=[])=>{ctx.save();ctx.strokeStyle=color;ctx.lineWidth=2.2;ctx.setLineDash(dash);ctx.beginPath();let started=false; for(const s of data){const xx=x(s.t); if(xx>W-pad.r+4)break; const yy=yfn(getter(s)); if(!started){ctx.moveTo(xx,yy);started=true}else ctx.lineTo(xx,yy)} ctx.stroke();ctx.restore();}; line(s=>100*s.O2T/base,root.getPropertyValue('--a')); line(s=>100*s.O2B/base,'#0ea5e9'); line(s=>100*s.O2Oil/base,root.getPropertyValue('--purple')); line(s=>100*s.O2Res/base,'#a855f7',yPct,[6,4]); line(s=>p.sub.glc?100*s.Glc/p.sub.glc:0,root.getPropertyValue('--b')); line(s=>s.pH,root.getPropertyValue('--warn'),yPH); ctx.save(); ctx.strokeStyle=root.getPropertyValue('--danger'); ctx.setLineDash([7,6]); ctx.lineWidth=1.5; const sx=x(r.safeMin); ctx.beginPath(); ctx.moveTo(sx,pad.t); ctx.lineTo(sx,pad.t+innerH); ctx.stroke(); ctx.fillStyle=root.getPropertyValue('--danger'); ctx.textAlign='center'; ctx.fillText('ENDPOINT',clamp(sx,70,W-70),pad.t+12); ctx.restore(); ctx.save(); ctx.setLineDash([4,4]); ctx.strokeStyle='rgba(37,99,235,.35)'; ctx.beginPath(); ctx.moveTo(pad.l,yPct(100*p.o2Threshold/base)); ctx.lineTo(W-pad.r,yPct(100*p.o2Threshold/base)); ctx.stroke(); ctx.strokeStyle='rgba(217,119,6,.55)'; ctx.beginPath(); ctx.moveTo(pad.l,yPH(p.pHFloor)); ctx.lineTo(W-pad.r,yPH(p.pHFloor)); ctx.stroke(); ctx.restore(); c._chartMap={xmax,pad,innerW,innerH,data,params:p};}
function chartHover(e){const c=$('#timeline'),m=c._chartMap;if(!m||!m.data.length)return; const r=c.getBoundingClientRect(),xx=e.clientX-r.left,tH=clamp((xx-m.pad.l)/m.innerW*m.xmax,0,m.xmax); const stepH=m.data.length>1?Math.max(1e-9,(m.data[1].t-m.data[0].t)/60):m.xmax; const idx=clamp(Math.round(tH/stepH),0,m.data.length-1); const nearest=m.data[idx]; const tip=$('#chartTip'); tip.style.display='block'; tip.style.left=(e.clientX-r.left)+'px'; tip.style.top=(e.clientY-r.top)+'px'; tip.innerHTML=`<b>${fmt(nearest.t/60,2)} h · ${nearest.status}</b>Target O₂ ${fmt(nearest.O2T,3)} µM<br>Bulk O₂ ${fmt(nearest.O2B,3)} µM<br>Emulsion oil O₂ (w.e.) ${fmt(nearest.O2Oil,3)} µM<br>Reservoir oil O₂ (w.e.) ${fmt(nearest.O2Res,3)} µM<br>CO₂ ${fmt(nearest.CO2T,3)} mM · pH ${fmt(nearest.pH,3)}<br>Glc ${fmt(nearest.Glc,3)} mM · Gln ${fmt(nearest.Gln,3)} mM<br>Target cells ${fmt(nearest.nT,2)}`;}
function saveState(){try{const data={theme:document.documentElement.dataset.theme,tab:$('.tab.active')?.dataset.tab}; $$('input,select,textarea').forEach(el=>{if(el.type==='checkbox')data[el.id]=el.checked; else data[el.id]=el.value}); localStorage.setItem(STATE_KEY,JSON.stringify(data));}catch(e){}}
function loadState(){try{const data=JSON.parse(localStorage.getItem(STATE_KEY)||'{}'); if(data.theme){document.documentElement.dataset.theme=data.theme; $('#themeBtn').textContent=data.theme==='dark'?'Light mode':'Dark mode'} Object.entries(data).forEach(([k,v])=>{const el=document.getElementById(k); if(el){if(el.type==='checkbox')el.checked=!!v; else el.value=v}}); if(data.tab)setTab(data.tab);}catch(e){console.warn(e)}}
function applyPreset(id){const set=(k,v)=>{const el=document.getElementById(k); if(el)el.value=v}; if(id==='single'){set('cellLine','mcf7');set('medium','dmem_high');set('volumeT',sliderFromVol(1));set('targetCells',1);set('lambda',.1);set('totalEmulsion',0.1);set('aqueousFraction',30);set('residualOil',0.2);set('storageMode','static_tube');set('headspaceGas','co2air');set('vesselPreset','eppendorf_1_5');} if(id==='dense'){set('cellLine','mcf7');set('medium','dmem_high');set('volumeT',sliderFromVol(.17));set('targetCells',1);set('lambda',.8);set('totalEmulsion',1.0);set('aqueousFraction',55);set('residualOil',0.025);set('storageMode','static_tube');set('vesselPreset','eppendorf_1_5');} if(id==='reservoir'){set('cellLine','hek293');set('medium','dmem_high');set('volumeT',sliderFromVol(.17));set('targetCells',1);set('lambda',.2);set('totalEmulsion',1.0);set('aqueousFraction',40);set('residualOil',1.5);set('storageMode','oil_circulated');set('oilType','hfe7500');set('vesselPreset','falcon_15');} if(id==='pdms'){set('cellLine','hek293');set('medium','dmem_high');set('volumeT',sliderFromVol(1));set('targetCells',5);set('lambda',.5);set('totalEmulsion',0.02);set('aqueousFraction',25);set('residualOil',0);set('storageMode','pdms_chip');set('oilType','pdms');set('vesselPreset','custom');} if(id==='closed'){set('cellLine','jurkat');set('medium','rpmi1640');set('volumeT',sliderFromVol(1));set('targetCells',1);set('lambda',.3);set('totalEmulsion',0.5);set('aqueousFraction',40);set('residualOil',0.5);set('atmMode','closed');set('storageMode','static_tube');set('vesselPreset','eppendorf_1_5');} syncVesselControls('main'); applyVesselPreset(); updateDynamicUI(); runAndRender();}
function toCSV(r){const header='time_h,target_o2_uM,bulk_o2_uM,emulsion_oil_o2_water_equiv_uM,reservoir_oil_o2_water_equiv_uM,glucose_mM,glutamine_mM,lactate_mM,co2_mM,pH,target_cells,bulk_cells,status\n'; return header+r.log.map(s=>[s.t/60,s.O2T,s.O2B,s.O2Oil,s.O2Res,s.Glc,s.Gln,s.Lac,s.CO2T,s.pH,s.nT,s.nBulk,s.status].join(',')).join('\n');}
function download(name,type,content){const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([content],{type})); a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
function exportCSV(){if(window.lastResult)download('metabolic_depletion_forecaster_log.csv','text/csv',toCSV(window.lastResult))} function exportJSON(){if(window.lastResult){download('metabolic_depletion_forecaster_result.json','application/json',JSON.stringify(buildExportPayload(window.lastResult),null,2))}} function downloadData(){download('metabolic_forecaster_data.json','application/json',JSON.stringify(DATA,(k,v)=>typeof v==='function'?v.toString():v,2))}
function savePNG(){const c=$('#timeline'); const out=document.createElement('canvas'); const scale=3; out.width=c.width*scale; out.height=c.height*scale; const ctx=out.getContext('2d'); ctx.imageSmoothingEnabled=true; ctx.drawImage(c,0,0,out.width,out.height); const a=document.createElement('a'); a.href=out.toDataURL('image/png'); a.download='metabolic_depletion_timeline_highres.png'; a.click();}
function copySummary(){const r=window.lastResult;if(!r)return; const p=r.params; const h=r.limiter==='simulation horizon'?`≥ ${hoursLabel(p.maxDays*24)}`:hoursLabel(r.safeMin/60); const conf=confidenceForCell(p.cell); const scenarioRange=(r.rateScenarios&&r.rateScenarios.length)?` Deterministic rate-scenario window: ${r.rateScenarios[0].limiter==='simulation horizon'?'≥ '+hoursLabel(p.maxDays*24):hoursLabel(r.rateScenarios[0].safeMin/60)} to ${r.rateScenarios[2].limiter==='simulation horizon'?'≥ '+hoursLabel(p.maxDays*24):hoursLabel(r.rateScenarios[2].safeMin/60)}.`:''; const txt=`Metabolic Depletion Forecaster: ${p.cell.name} in ${p.med.name}; confidence ${conf.title}; evidence ${p.cell.evidenceTier?('Tier '+p.cell.evidenceTier):'direct/default'}; target droplet ${p.targetCells} cell(s), ${p.volume_nL.toFixed(3)} nL; P(target occupancy) ${fmt(p.targetProbability*100,4)}%; emulsion λ ${p.lambda.toFixed(2)}, ${fmt(p.totalEmulsion_uL/1000,3)} mL generated emulsion, ${Math.round(100*p.Vaq_uL/p.totalEmulsion_uL)}% aqueous, ${fmt(p.residualOil_uL/1000,3)} mL excess oil, ${fmt(p.liquidFill_uL/1000,3)} mL liquid fill; ${p.gas.name}, ${p.T.toFixed(1)} °C, ${p.atmMode} headspace, ${p.storageMode}. Useful window ${h}. Limiting factor: ${r.limiter==='simulation horizon'?'none within horizon':r.limiter}. Endpoint target O₂ ${r.final.O2T.toFixed(3)} µM, CO₂ ${r.final.CO2T.toFixed(3)} mM, glucose ${r.final.Glc.toFixed(3)} mM, glutamine ${r.final.Gln.toFixed(3)} mM, pH ${r.final.pH.toFixed(3)}.${scenarioRange}`; if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(txt).catch(()=>fallbackCopy(txt));}else fallbackCopy(txt); $('#lastRun').textContent='Summary copied.';}
function fallbackCopy(txt){const ta=document.createElement('textarea'); ta.value=txt; ta.style.position='fixed'; ta.style.left='-9999px'; document.body.appendChild(ta); ta.select(); try{document.execCommand('copy')}catch(e){} ta.remove();}
function renderSweepRows(rows){$('#sweepTable tbody').innerHTML=rows.map(row=>`<tr><td>${row.volume_nL<1?fmt(row.volume_nL*1000,0)+' pL':fmt(row.volume_nL,1)+' nL'}</td><td>${fmt(row.lambda,2)}</td><td>${row.targetCells} (${fmt(row.targetProbability*100,3)}%)</td><td>${row.limiter==='simulation horizon'?'≥ '+hoursLabel(row.maxDays*24):hoursLabel(row.safeMin/60)}</td><td>${row.limiter}</td></tr>`).join('');}
function runSweep(){
  const base=gatherParams();
  if(base.invalid&&base.invalid.length){$('#sweepTable tbody').innerHTML=`<tr><td colspan="5">Sweep blocked: ${base.invalid.map(x=>String(x)).join(' ')}</td></tr>`; return;}
  if(startWorkerJob('sweep',{params:base},{
    startText:'Running sweep in background…',
    onProgress:progress=>{$('#progressNote').textContent=formatWorkerProgress('sweep',progress);},
    onResult:result=>{renderSweepRows(result.rows||[]); $('#lastRun').textContent='Sweep updated from worker.';},
    onError:()=>{const vols=[.07,.17,.3,.7,1,2,5,7], lambdas=[.05,.1,.3,.8,1.5]; const rows=[]; vols.forEach(v=>lambdas.forEach(lam=>{const p={...base,volume_nL:v,lambda:lam}; const N=Math.max(1,p.Vaq_uL*1000/v), p0=Math.exp(-lam), p1=lam*p0, occupancy=buildOccupancyModel(lam,N,p.targetCells); Object.assign(p,{N,p0,p1,totalCells:occupancy.expectedTotalCells,bulkInitialCells:occupancy.expectedBulkCells,occupancy,occupiedDroplets:occupancy.occupiedDroplets,occupiedFraction:occupancy.occupiedFraction,empty:p0*N,single:p1*N,multi:Math.max(0,N*(1-p0-p1)),targetProbability:poissonPMF(p.targetCells,lam),chartO2Reference:Math.max(1,p.airO2Eq,p.O2eq,p.initialO2T,p.initialO2Oil,p.initialO2Res,p.o2Threshold)}); const r=Engine.simulate(p); rows.push({volume_nL:v,lambda:lam,targetCells:p.targetCells,targetProbability:p.targetProbability,safeMin:r.safeMin,limiter:r.limiter,maxDays:p.maxDays});})); renderSweepRows(rows); $('#lastRun').textContent='Sweep updated.';}
  }))return;
  const vols=[.07,.17,.3,.7,1,2,5,7], lambdas=[.05,.1,.3,.8,1.5]; const rows=[]; vols.forEach(v=>lambdas.forEach(lam=>{const p={...base,volume_nL:v,lambda:lam}; const N=Math.max(1,p.Vaq_uL*1000/v), p0=Math.exp(-lam), p1=lam*p0, occupancy=buildOccupancyModel(lam,N,p.targetCells); Object.assign(p,{N,p0,p1,totalCells:occupancy.expectedTotalCells,bulkInitialCells:occupancy.expectedBulkCells,occupancy,occupiedDroplets:occupancy.occupiedDroplets,occupiedFraction:occupancy.occupiedFraction,empty:p0*N,single:p1*N,multi:Math.max(0,N*(1-p0-p1)),targetProbability:poissonPMF(p.targetCells,lam),chartO2Reference:Math.max(1,p.airO2Eq,p.O2eq,p.initialO2T,p.initialO2Oil,p.initialO2Res,p.o2Threshold)}); const r=Engine.simulate(p); rows.push({volume_nL:v,lambda:lam,targetCells:p.targetCells,targetProbability:p.targetProbability,safeMin:r.safeMin,limiter:r.limiter,maxDays:p.maxDays});})); renderSweepRows(rows);
}
window.addEventListener('resize',()=>{if(window.lastResult)drawChart(window.lastResult)});
initUI();
