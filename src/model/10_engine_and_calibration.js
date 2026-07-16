function poissonPMF(k,lambda){if(k<0||lambda<0)return 0; let logp=-lambda+k*Math.log(Math.max(lambda,1e-300)); for(let i=2;i<=k;i++)logp-=Math.log(i); return Math.exp(logp);}
function buildOccupancyModel(lambda,N,targetCells){
  const otherDroplets=Math.max(0,N-1);
  const classes=[];
  let probSum=0, expectedBulkCells=0, occupiedDroplets=0, singleDroplets=0, multiDroplets=0, multiSeedCells=0;
  const tailStart=Math.max(8,Math.ceil(lambda+4*Math.sqrt(lambda+1)));
  const maxK=64;
  for(let k=0;k<=maxK;k++){
    let prob=poissonPMF(k,lambda);
    if(k===maxK || (k>=tailStart && 1-(probSum+prob)<1e-10))prob=Math.max(prob,1-probSum);
    probSum+=prob;
    if(k>0&&prob>0){
      const count=otherDroplets*prob;
      classes.push({k,count});
      occupiedDroplets+=count;
      expectedBulkCells+=count*k;
      if(k===1)singleDroplets+=count;
      if(k>1){multiDroplets+=count; multiSeedCells+=count*k;}
    }
    if(probSum>=1-1e-10&&k>=tailStart)break;
  }
  const emptyDroplets=Math.max(0,otherDroplets-occupiedDroplets);
  return {
    otherDroplets,
    classes,
    emptyDroplets,
    singleDroplets,
    multiDroplets,
    multiSeedCells,
    meanMultiSeedCells:multiDroplets>0?multiSeedCells/multiDroplets:0,
    occupiedDroplets,
    occupiedFraction:otherDroplets>0?occupiedDroplets/otherDroplets:0,
    expectedBulkCells,
    expectedTotalCells:targetCells+expectedBulkCells
  };
}
function bulkCellsAt(occupancy,t,p){return (occupancy?.classes||[]).reduce((sum,c)=>sum+c.count*cellsAt(c.k,t,p,p.volume_nL),0);}
function bulkGroupCellsAt(occupancy,t,p){
  const singleDroplets=Math.max(0,occupancy?.singleDroplets||0);
  const single=singleDroplets>0?singleDroplets*cellsAt(1,t,p,p.volume_nL):0;
  const multi=(occupancy?.classes||[]).reduce((sum,c)=>c.k>=2?sum+c.count*cellsAt(c.k,t,p,p.volume_nL):sum,0);
  return {single,multi,total:single+multi};
}
function oxygenLimitedRate(cellCount,o2,p){if(cellCount<=0||p.rates.ocr<=0)return 0; const km=Math.max(1e-6,p.o2Km_uM||1); const c=Math.max(0,o2); return cellCount*p.rates.ocr*c/(km+c);}
function dryGasPctToHeadspaceMoles(pct,headspace_mL,T){const frac=clamp((pct||0)/100,0,1)*(1-vaporAtm(T)); return frac*headspace_mL/1000/(PHYS.R*(273.15+T))*1e15;}
function headspaceCapacityO2(headspace_mL,T){if(!(headspace_mL>0))return 0; const kh=PHYS.kH_O2_37C_mM_atm*Math.exp(-.025*(T-37)); return 1e12*(headspace_mL/1000)/(kh*PHYS.R*(273.15+T));}
function headspaceCapacityCO2(headspace_mL,T){if(!(headspace_mL>0))return 0; const kh=PHYS.kH_CO2_37C_mM_atm*Math.exp(-.025*(T-37)); return 1e15*(headspace_mL/1000)/(kh*PHYS.R*(273.15+T));}
function thresholdFromMode(value,mode,selectedEq,airEq){if(mode==='absolute_uM')return Math.max(0,value); if(mode==='air_pct')return Math.max(0,airEq*value/100); return Math.max(0,selectedEq*value/100);}
function scenarioSpecs(){return [{id:'low_demand',label:'low metabolic demand'},{id:'nominal',label:'nominal'},{id:'high_demand',label:'high metabolic demand'}];}
function scenarioBoundField(key,scenarioId){if(scenarioId==='low_demand')return key+'Low'; if(scenarioId==='high_demand')return key+'High'; return key;}
function scenarioRatesFromParams(p,scenarioId){
  if(scenarioId==='nominal')return {rates:{...p.rates},available:true,exact:true,reason:'current effective nominal rates'};
  const cell=p.cell||{};
  const overridesActive=!!(p.rateScenarioSource&&p.rateScenarioSource.overridesActive);
  const customCell=!!(p.rateScenarioSource&&p.rateScenarioSource.customCell);
  const rates={...p.rates};
  let changed=false;
  for(const key of ['ocr','gcr','lpr','gln']){
    const nominal=Number(cell[key]);
    const bound=Number(cell[scenarioBoundField(key,scenarioId)]);
    if(!overridesActive&&!customCell&&Number.isFinite(bound)&&bound>=0&&Number.isFinite(nominal)&&nominal>0){
      rates[key]=bound*(p.rates[key]/nominal);
      changed=true;
    }
  }
  if(changed)return {rates,available:true,exact:true,reason:'cell-line stored low/nominal/high bounds scaled through current modifiers'};
  return {rates:{...p.rates},available:false,exact:false,reason:'stored low/high bounds unavailable because custom rates or explicit overrides are active'};
}
function scenarioResultSummary(p,ratesInfo,result,scenarioId){
  return {id:scenarioId,label:scenarioSpecs().find(s=>s.id===scenarioId)?.label||scenarioId,available:ratesInfo.available,exact:ratesInfo.exact,reason:ratesInfo.reason,limiter:result.limiter,safeMin:result.safeMin,final:{O2T:result.final.O2T,Glc:result.final.Glc,Gln:result.final.Gln,pH:result.final.pH},rates:ratesInfo.rates,transportModel:result.bulkO2Regime.selectedMode,solver:{acceptedSteps:result.solver.acceptedSteps,rootIterations:result.solver.rootIterations}};
}
function buildRateScenarioResults(base){
  return scenarioSpecs().map(spec=>{
    const ratesInfo=scenarioRatesFromParams(base,spec.id);
    const scenarioParams={...base,rates:ratesInfo.rates,uncertaintyScenario:spec.id,estimatedWorkload:null};
    scenarioParams.estimatedWorkload=estimateSolverWorkload(scenarioParams);
    const result=Engine.simulate(scenarioParams);
    return scenarioResultSummary(base,ratesInfo,result,spec.id);
  });
}
function parseCalibrationSeries(text){
  const lines=String(text||'').split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  const rows=[];
  for(const line of lines){
    if(/^time/i.test(line))continue;
    const parts=line.split(/[\s,;\t]+/).filter(Boolean);
    if(parts.length<2)throw new Error(`Calibration row "${line}" must contain time_h and O2_uM.`);
    const time_h=Number(parts[0]), observed=Number(parts[1]);
    if(!Number.isFinite(time_h)||!Number.isFinite(observed))throw new Error(`Calibration row "${line}" contains a non-finite value.`);
    if(time_h<0)throw new Error('Calibration times must be nonnegative.');
    rows.push({time_h,observed});
  }
  rows.sort((a,b)=>a.time_h-b.time_h);
  for(let i=1;i<rows.length;i++)if(rows[i].time_h<=rows[i-1].time_h)throw new Error('Calibration times must be strictly increasing.');
  if(rows.length<3)throw new Error('Calibration requires at least three timepoints.');
  return rows;
}
function calibrationObservableLabel(key){return ({O2T:'target droplet O₂',O2B:'bulk droplet O₂',O2Oil:'emulsion oil O₂',O2Res:'reservoir oil O₂'})[key]||key;}
function interpolateObservable(series,timeMin,key){
  if(!series.length)return NaN;
  if(timeMin<=series[0].t)return Number(series[0][key]);
  for(let i=1;i<series.length;i++){
    const a=series[i-1], b=series[i];
    if(timeMin<=b.t){
      const span=Math.max(1e-9,b.t-a.t), frac=(timeMin-a.t)/span;
      return Number(a[key])+(Number(b[key])-Number(a[key]))*frac;
    }
  }
  return Number(series[series.length-1][key]);
}
function calibrationGridForParameter(current,count=19){
  const center=Math.max(0.05,Number.isFinite(current)?current:1);
  const lo=Math.max(0.05,center/16), hi=Math.max(lo*1.01,center*16);
  return Array.from({length:count},(_,i)=>Math.exp(Math.log(lo)+(Math.log(hi)-Math.log(lo))*i/Math.max(1,count-1)));
}
function calibrationParameterKeys(fitMode){return fitMode==='dropHalf+oilHalf'?['dropHalf','oilHalf']:[fitMode||'dropHalf'];}
function calibrationComparisonThreshold(n,k,bestSSE){const dof=Math.max(1,n-k); return bestSSE*(1+3.84/dof);}
function runCalibrationFit(baseParams,config,progressCb=()=>{}){
  const fitMode=config?.fitMode||'dropHalf';
  const observable=config?.observable||'O2T';
  const series=config?.series||[];
  const keys=calibrationParameterKeys(fitMode);
  const inferredStep=series.length>1?Math.max(0.05,Math.min(5,...series.slice(1).map((row,idx)=>Math.max(0.05,(row.time_h-series[idx].time_h)*60/4)))):0.5;
  const calibrationHorizonDays=Math.max(0.01,Math.max(...series.map(row=>row.time_h))/24+0.01);
  const makeParams=(updates={})=>({ ...baseParams, ...updates, estimatedWorkload:null, chartEveryMin:inferredStep, logStep:Math.max(1,inferredStep), maxDays:calibrationHorizonDays });
  const grids=keys.map(key=>calibrationGridForParameter(baseParams[key],keys.length===2?11:19));
  const total=grids.reduce((acc,g)=>acc*g.length,1);
  let done=0;
  const fits=[];
  const sigmaFloor=1e-12;
  const evalFit=(values)=>{
    const updates=Object.fromEntries(keys.map((key,idx)=>[key,values[idx]]));
    const params=makeParams(updates);
    const result=Engine.simulate(params);
    const residuals=series.map(row=>{
      const predicted=interpolateObservable(result.chart,row.time_h*60,observable);
      const residual=predicted-row.observed;
      return {time_h:row.time_h,observed:row.observed,predicted,residual};
    });
    const sse=residuals.reduce((sum,row)=>sum+row.residual*row.residual,0);
    fits.push({values:[...values],updates,sse,residuals,solver:result.solver,limiter:result.limiter,params});
    done+=1;
    progressCb({phase:'calibration',done,total,fraction:done/Math.max(1,total)});
  };
  if(keys.length===1){
    for(const value of grids[0])evalFit([value]);
  }else{
    for(const a of grids[0])for(const b of grids[1])evalFit([a,b]);
  }
  fits.sort((a,b)=>a.sse-b.sse);
  const best=fits[0];
  const threshold=calibrationComparisonThreshold(series.length,keys.length,best.sse);
  const accepted=fits.filter(f=>f.sse<=threshold);
  const intervals={};
  for(let i=0;i<keys.length;i++){
    const vals=accepted.map(f=>f.values[i]).sort((a,b)=>a-b);
    intervals[keys[i]]={low:vals[0],best:best.values[i],high:vals[vals.length-1],thresholdSSE:threshold};
  }
  let correlation=null;
  if(keys.length===2){
    const sigma2=Math.max(sigmaFloor,best.sse/Math.max(1,series.length-keys.length));
    const weights=accepted.map(f=>Math.exp(-(f.sse-best.sse)/(2*sigma2)));
    const logsA=accepted.map(f=>Math.log(f.values[0])), logsB=accepted.map(f=>Math.log(f.values[1]));
    const wsum=weights.reduce((a,b)=>a+b,0)||1;
    const meanA=logsA.reduce((sum,v,idx)=>sum+v*weights[idx],0)/wsum;
    const meanB=logsB.reduce((sum,v,idx)=>sum+v*weights[idx],0)/wsum;
    const cov=logsA.reduce((sum,v,idx)=>sum+(v-meanA)*(logsB[idx]-meanB)*weights[idx],0)/wsum;
    const varA=logsA.reduce((sum,v,idx)=>sum+(v-meanA)*(v-meanA)*weights[idx],0)/wsum;
    const varB=logsB.reduce((sum,v,idx)=>sum+(logsB[idx]-meanB)*(logsB[idx]-meanB)*weights[idx],0)/wsum;
    correlation=(varA>0&&varB>0)?cov/Math.sqrt(varA*varB):null;
  }
  const identifiabilityWarnings=[];
  for(const key of keys){
    const interval=intervals[key];
    if(interval.high/Math.max(0.05,interval.low)>8)identifiabilityWarnings.push(`${key} profile range spans more than 8×, so identifiability is weak.`);
    const grid=grids[keys.indexOf(key)];
    if(interval.best===grid[0]||interval.best===grid[grid.length-1])identifiabilityWarnings.push(`${key} optimum hit the search boundary; widen the calibration range or add more informative data.`);
  }
  if(correlation!=null&&Math.abs(correlation)>0.9)identifiabilityWarnings.push(`Two-parameter fit shows strong likelihood-weighted local correlation (${fmt(correlation,3)}), so the parameters are not cleanly separable from this series alone.`);
  return {
    fitMode,
    observable,
    observableLabel:calibrationObservableLabel(observable),
    parameterKeys:keys,
    bestFit:best.updates,
    intervals,
    correlation,
    sampleCount:series.length,
    rmse:Math.sqrt(best.sse/Math.max(1,series.length)),
    sse:best.sse,
    residuals:best.residuals,
    identifiabilityWarnings,
    calibrationConditions:{cell:baseParams.cell?.name||null,medium:baseParams.med?.name||null,gas:baseParams.gas?.name||null,temperatureC:baseParams.T,storageMode:baseParams.storageMode,vessel:baseParams.vessel?.name||null,observable:calibrationObservableLabel(observable),pHModel:baseParams.pHModel},
    predictionConditionsMatchCurrentSetup:true,
    thresholdSSE:threshold
  };
}
function geometryScales(p){
  if(p.halfTimeMode==='measured_effective'){
    return {gasRes:1,gasDirect:1,oilMix:1,dropTarget:1,dropBulk:1,depthPenalty:1,modeFactor:1,sizeScale:1,notes:'measured effective half-times applied directly'};
  }
  const refDiameter=6, refArea=Math.PI*Math.pow(refDiameter/2,2), refTotal=100, refAq=30, refOilEmul=refTotal-refAq, refResidual=200;
  const A=Math.max(.01,p.vesselArea_mm2||refArea), total=Math.max(.001,p.totalEmulsion_uL||refTotal), oilE=Math.max(.001,p.VoilEmul_uL||refOilEmul), oilR=Math.max(.001,p.residualOil_uL||refResidual);
  const depth=Math.max(.02,p.emulsionDepth_mm||total/A), refDepth=refTotal/refArea;
  const refVolume_nL=1;
  const sizeScale=Math.pow(refVolume_nL/Math.max(1e-9,p.volume_nL||refVolume_nL),1/3);
  const ideal={gasRes:1,gasDirect:1,oilMix:1,dropTarget:clamp(p.centerPenalty,0.01,1)*sizeScale,dropBulk:clamp(p.gradientFactor,0.01,1)*sizeScale,depthPenalty:1,modeFactor:1,sizeScale,notes:'well-mixed concentration model with droplet A/V scaling'};
  if(p.geometryMode==='ideal')return ideal;
  let modeFactor=1, depthExponent=.55;
  if(p.storageMode==='shaken_tube'){modeFactor=2.2; depthExponent=.30;}
  if(p.storageMode==='oil_circulated'){modeFactor=5.5; depthExponent=.12;}
  if(p.storageMode==='thin_layer'){modeFactor=3.8; depthExponent=.22;}
  if(p.storageMode==='pdms_chip'){modeFactor=4.0; depthExponent=.18;}
  if(p.storageMode==='ptfe_tubing'){modeFactor=9.0; depthExponent=.06;}
  if(p.storageMode==='custom'){modeFactor=1.0; depthExponent=.55;}
  const depthPenalty=clamp(Math.pow(refDepth/depth,depthExponent),.06,4);
  const gasRes=clamp((A/oilR)/(refArea/refResidual),.015,80);
  const gasDirect=clamp((A/oilE)/(refArea/refOilEmul),.015,80);
  const oilMix=clamp(Math.sqrt((A/total)/(refArea/refTotal))*modeFactor*depthPenalty,.03,40);
  const targetBase=clamp(Number(p.centerPenalty)||1,.01,1), bulkBase=clamp(Number(p.gradientFactor)||1,.01,1);
  const dropTarget=clamp(targetBase*(targetBase<.99?depthPenalty:Math.sqrt(depthPenalty))*Math.sqrt(modeFactor)*sizeScale,.005,6);
  const dropBulk=clamp(bulkBase*depthPenalty*Math.sqrt(modeFactor)*sizeScale,.005,6);
  return {gasRes,gasDirect,oilMix,dropTarget,dropBulk,depthPenalty,modeFactor,sizeScale,notes:'geometry-corrected area/volume model with droplet A/V scaling'};
}
function occupancyCapacities(p){
  const volume_nL=Math.max(1e-9,p.volume_nL||0);
  const emptyDroplets=Math.max(0,p.occupancy?.emptyDroplets||0);
  const singleDroplets=Math.max(0,p.occupancy?.singleDroplets||0);
  const multiDroplets=Math.max(0,p.occupancy?.multiDroplets||0);
  const capEmpty=emptyDroplets*volume_nL;
  const capSingle=singleDroplets*volume_nL;
  const capMulti=multiDroplets*volume_nL;
  const capBulk=capEmpty+capSingle+capMulti;
  return {capEmpty,capSingle,capMulti,capBulk,capBulkOccupied:capSingle+capMulti};
}
function bulkCountsForMode(p,mode,t=0){
  const grouped=bulkGroupCellsAt(p.occupancy,t,p);
  if(mode==='shared_mean_field')return {single:0,multi:grouped.total,total:grouped.total};
  return grouped;
}
function localDepletionTime(cap,cellCount,p){
  if(!(cap>0)||!(cellCount>0)||!(p.rates.ocr>0))return Infinity;
  const compareO2=Math.max(1e-6,Math.min(Math.max(0,p.initialO2B||0),Math.max(1e-6,p.o2Km_uM||1)));
  const rate=oxygenLimitedRate(cellCount,compareO2,p);
  return rate>0?cap*compareO2/rate:Infinity;
}
function bulkRegimeSampleTimes(p){
  const horizon=Math.max(0,(p.maxDays||0)*24*60);
  if(!(horizon>0)||!p.prolif)return [0];
  const samples=[0];
  if(p.lag_h>0)samples.push(p.lag_h*60);
  for(let i=1;i<=8;i++)samples.push(horizon*i/8);
  return [...new Set(samples.filter(t=>Number.isFinite(t)&&t>=0&&t<=horizon))].sort((a,b)=>a-b);
}
function bulkDepletionTimes(p,baseCaps){
  const best={singleMin:Infinity,multiMin:Infinity,minDepletionMin:Infinity,sampledTimeMin:0,evaluationSamples:0};
  for(const t of bulkRegimeSampleTimes(p)){
    const grouped=bulkGroupCellsAt(p.occupancy,t,p);
    const singleMin=localDepletionTime(baseCaps.capSingle,grouped.single,p);
    const multiMin=localDepletionTime(baseCaps.capMulti,grouped.multi,p);
    best.singleMin=Math.min(best.singleMin,singleMin);
    best.multiMin=Math.min(best.multiMin,multiMin);
    if(Math.min(singleMin,multiMin)<best.minDepletionMin){
      best.minDepletionMin=Math.min(singleMin,multiMin);
      best.sampledTimeMin=t;
    }
    best.evaluationSamples+=1;
  }
  return best;
}
function resolveBulkOxygenRegime(p,effectiveDropBulkHalf=null,baseCaps=occupancyCapacities(p)){
  const exchangeHalfMin=effectiveDropBulkHalf??effectiveHalfTime(p.dropHalf,geometryScales(p).dropBulk,p.halfTimeMode);
  const depletion=bulkDepletionTimes(p,baseCaps);
  const comparisonThresholdRatio=2;
  const depletionToExchangeRatio=Number.isFinite(depletion.minDepletionMin)&&exchangeHalfMin>0?depletion.minDepletionMin/exchangeHalfMin:Infinity;
  const exchangeToDepletionRatio=Number.isFinite(depletion.minDepletionMin)&&depletion.minDepletionMin>0?exchangeHalfMin/depletion.minDepletionMin:Infinity;
  const transportLimited=depletionToExchangeRatio<=comparisonThresholdRatio;
  const requestedMode=p.bulkO2Mode||'auto';
  const recommendedMode=transportLimited?'grouped_transport_limited':'shared_mean_field';
  const selectedMode=requestedMode==='auto'?'shared_mean_field':requestedMode;
  const warningOnly=selectedMode==='shared_mean_field'&&transportLimited;
  return {...depletion,exchangeHalfMin,depletionToExchangeRatio,exchangeToDepletionRatio,comparisonThresholdRatio,transportLimited,requestedMode,recommendedMode,selectedMode,warningOnly};
}
function bulkCapacitiesForMode(baseCaps,mode){
  if(mode==='shared_mean_field')return {capEmpty:0,capSingle:0,capMulti:baseCaps.capBulk,capBulk:baseCaps.capBulk,capBulkOccupied:baseCaps.capBulk,bulkO2Mode:mode};
  return {...baseCaps,bulkO2Mode:mode};
}
function conductanceRate(G,cap){return cap>0?G/cap:0;}
function buildKinetics(p,caps,geom,headCapO2=headspaceCapacityO2(p.headspace_mL,p.T),headCapCO2=headspaceCapacityCO2(p.headspace_mL,p.T)){
  const gasResHalf=effectiveHalfTime(p.gasHalf,geom.gasRes,p.halfTimeMode);
  const gasDirectHalf=effectiveHalfTime(p.gasHalf,geom.gasDirect,p.halfTimeMode);
  const oilHalf=effectiveHalfTime(p.oilHalf,geom.oilMix,p.halfTimeMode);
  const dropTargetHalf=effectiveHalfTime(p.dropHalf,geom.dropTarget,p.halfTimeMode);
  const dropBulkHalf=effectiveHalfTime(p.dropHalf,geom.dropBulk,p.halfTimeMode);
  const co2TargetHalf=sanitizeHalf(dropTargetHalf/2.2);
  const co2BulkHalf=sanitizeHalf(dropBulkHalf/2.2);
  const finiteHeadO2=p.atmMode==='closed'&&headCapO2>1e-9;
  const finiteHeadCO2=p.atmMode==='closed'&&p.pHBoundaryMode==='closed_headspace_mass_balance'&&headCapCO2>1e-9;
  return {
    gasResHalf,gasDirectHalf,oilHalf,dropTargetHalf,dropBulkHalf,co2TargetHalf,co2BulkHalf,
    GgasRes:finiteHeadO2?finitePairConductance(gasResHalf,caps.capOilR,headCapO2):boundaryConductance(gasResHalf,caps.capOilR),
    GgasDirect:finiteHeadO2?finitePairConductance(gasDirectHalf,caps.capOilE*p.surfaceAccess,headCapO2):boundaryConductance(gasDirectHalf,caps.capOilE*p.surfaceAccess),
    Goil:finitePairConductance(oilHalf,caps.capOilR,caps.capOilE),
    GdropTarget:finitePairConductance(dropTargetHalf,caps.capT,caps.capOilE),
    GdropEmpty:finitePairConductance(dropBulkHalf,caps.capEmpty,caps.capOilE),
    GdropSingle:finitePairConductance(dropBulkHalf,caps.capSingle,caps.capOilE),
    GdropMulti:finitePairConductance(dropBulkHalf,caps.capMulti,caps.capOilE),
    Gco2Target:finiteHeadCO2?finitePairConductance(co2TargetHalf,caps.capT*1000,headCapCO2):boundaryConductance(co2TargetHalf,caps.capT*1000),
    Gco2Empty:finiteHeadCO2?finitePairConductance(co2BulkHalf,caps.capEmpty*1000,headCapCO2):boundaryConductance(co2BulkHalf,caps.capEmpty*1000),
    Gco2Single:finiteHeadCO2?finitePairConductance(co2BulkHalf,caps.capSingle*1000,headCapCO2):boundaryConductance(co2BulkHalf,caps.capSingle*1000),
    Gco2Multi:finiteHeadCO2?finitePairConductance(co2BulkHalf,caps.capMulti*1000,headCapCO2):boundaryConductance(co2BulkHalf,caps.capMulti*1000),
    finiteHeadO2,finiteHeadCO2,headCapO2,headCapCO2
  };
}
function kineticsSummary(kin,caps){
  return {
    fmolPerMinPerUM:{
      gasRes:kin.GgasRes,gasDirect:kin.GgasDirect,oilMix:kin.Goil,dropTarget:kin.GdropTarget,dropEmpty:kin.GdropEmpty,dropSingle:kin.GdropSingle,dropMulti:kin.GdropMulti,
      co2Target:kin.Gco2Target,co2Empty:kin.Gco2Empty,co2Single:kin.Gco2Single,co2Multi:kin.Gco2Multi
    },
    perMin:{
      gasResOil:conductanceRate(kin.GgasRes,caps.capOilR),gasDirectOil:conductanceRate(kin.GgasDirect,caps.capOilE),oilMixEmulsion:conductanceRate(kin.Goil,caps.capOilE),oilMixReservoir:conductanceRate(kin.Goil,caps.capOilR),
      dropTargetOil:conductanceRate(kin.GdropTarget,caps.capOilE),dropTargetDroplet:conductanceRate(kin.GdropTarget,caps.capT),dropEmpty:conductanceRate(kin.GdropEmpty,caps.capEmpty),dropSingle:conductanceRate(kin.GdropSingle,caps.capSingle),dropMulti:conductanceRate(kin.GdropMulti,caps.capMulti),
      headO2FromReservoir:kin.finiteHeadO2?conductanceRate(kin.GgasRes,kin.headCapO2):0,headO2FromEmulsion:kin.finiteHeadO2?conductanceRate(kin.GgasDirect,kin.headCapO2):0,
      headCO2FromTarget:kin.finiteHeadCO2?conductanceRate(kin.Gco2Target,kin.headCapCO2):0,headCO2FromMulti:kin.finiteHeadCO2?conductanceRate(kin.Gco2Multi,kin.headCapCO2):0
    }
  };
}
function estimateSolverWorkload(p){
  const baseDt=Math.max(0.0005,Number.isFinite(p.maxStepMin)?p.maxStepMin:0.5);
  const baseBulkCaps=occupancyCapacities(p);
  const bulkRegime=resolveBulkOxygenRegime(p,null,baseBulkCaps);
  const bulkCaps=bulkCapacitiesForMode(baseBulkCaps,bulkRegime.selectedMode);
  const caps={capT:Math.max(1e-9,p.volume_nL),capOilE:Math.max(0,p.VoilEmul_uL*1000*p.oil.capacityRatio),capOilR:Math.max(0,p.residualOil_uL*1000*p.oil.capacityRatio),...bulkCaps};
  const kin=buildKinetics(p,caps,geometryScales(p));
  const kMax=Math.max(
    conductanceRate(kin.GgasRes,caps.capOilR),conductanceRate(kin.GgasDirect,caps.capOilE),conductanceRate(kin.Goil,caps.capOilE),conductanceRate(kin.Goil,caps.capOilR),
    conductanceRate(kin.GdropTarget,caps.capT),conductanceRate(kin.GdropTarget,caps.capOilE),conductanceRate(kin.GdropEmpty,caps.capEmpty),conductanceRate(kin.GdropSingle,caps.capSingle),conductanceRate(kin.GdropMulti,caps.capMulti),
    kin.finiteHeadO2?conductanceRate(kin.GgasRes,kin.headCapO2):0,kin.finiteHeadO2?conductanceRate(kin.GgasDirect,kin.headCapO2):0,
    kin.finiteHeadCO2?conductanceRate(kin.Gco2Target,kin.headCapCO2):0,kin.finiteHeadCO2?conductanceRate(kin.Gco2Multi,kin.headCapCO2):0,1e-9
  );
  const stableDtEstimate=Math.min(baseDt,Math.max(0.0005,0.2/kMax));
  const estimatedSteps=Math.ceil((Math.max(.001,p.maxDays)*24*60)/Math.max(0.0005,stableDtEstimate));
  return {stableDtEstimate,estimatedSteps,kMax};
}
function solveDenseLinearSystem(matrix,rhs){
  const a=matrix.map((row,i)=>[...row,rhs[i]]);
  for(let col=0;col<a.length;col++){
    let pivot=col;
    for(let row=col+1;row<a.length;row++)if(Math.abs(a[row][col])>Math.abs(a[pivot][col]))pivot=row;
    if(Math.abs(a[pivot][col])<1e-15)continue;
    if(pivot!==col)[a[col],a[pivot]]=[a[pivot],a[col]];
    const div=a[col][col];
    for(let j=col;j<=a.length;j++)a[col][j]/=div;
    for(let row=0;row<a.length;row++){
      if(row===col)continue;
      const factor=a[row][col];
      if(Math.abs(factor)<1e-15)continue;
      for(let j=col;j<=a.length;j++)a[row][j]-=factor*a[col][j];
    }
  }
  return a.map(row=>row[a.length]);
}
function solveLinearExchange(nodes,finiteEdges,boundaryEdges,dt){
  if(!nodes.length)return {};
  const idx=new Map(nodes.map((node,i)=>[node.key,i]));
  const mat=nodes.map((_,i)=>nodes.map((__,j)=>i===j?1:0));
  const rhs=nodes.map(node=>node.amount);
  for(const edge of finiteEdges){
    if(!(edge.G>0))continue;
    const ia=idx.get(edge.a), ib=idx.get(edge.b);
    const capA=nodes[ia].cap, capB=nodes[ib].cap;
    if(!(capA>0)||!(capB>0))continue;
    mat[ia][ia]+=dt*edge.G/capA;
    mat[ib][ib]+=dt*edge.G/capB;
    mat[ia][ib]-=dt*edge.G/capB;
    mat[ib][ia]-=dt*edge.G/capA;
  }
  for(const edge of boundaryEdges){
    if(!(edge.G>0))continue;
    const i=idx.get(edge.node), cap=nodes[i].cap;
    if(!(cap>0))continue;
    mat[i][i]+=dt*edge.G/cap;
    rhs[i]+=dt*edge.G*edge.conc;
  }
  const solved=solveDenseLinearSystem(mat,rhs);
  return Object.fromEntries(nodes.map((node,i)=>[node.key,solved[i]>-1e-9?Math.max(0,solved[i]):solved[i]]));
}
const Engine={simulate(p,hooks={}){
  const baseDt=Math.max(0.0005,Number.isFinite(p.maxStepMin)?p.maxStepMin:0.5),maxMin=Math.max(.001,p.maxDays)*24*60,chartEvery=Math.max(0.05,Number.isFinite(p.chartEveryMin)?p.chartEveryMin:5);
  const initialTrackedCarbon=p.pHModel==='carbonate_alkalinity'?(Number.isFinite(p.DICInitial)?p.DICInitial:carbonateBaseline(p).dic0):(Number.isFinite(p.CO2Initial)?p.CO2Initial:p.CO2eq);
  const capT=Math.max(1e-9,p.volume_nL);
  const baseBulkCaps=occupancyCapacities(p);
  const bulkRegime=resolveBulkOxygenRegime(p,null,baseBulkCaps);
  const bulkCaps=bulkCapacitiesForMode(baseBulkCaps,bulkRegime.selectedMode);
  const capOilE=Math.max(0,p.VoilEmul_uL*1000*p.oil.capacityRatio);
  const capOilR=Math.max(0,p.residualOil_uL*1000*p.oil.capacityRatio);
  const capBulk=bulkCaps.capBulk;
  const caps={capT,capBulk,capOilE,capOilR,...bulkCaps};
  const geom=geometryScales(p);
  const kinetics=buildKinetics(p,caps,geom);
  const estimate=p.estimatedWorkload||estimateSolverWorkload(p);
  const stableDt=Math.min(baseDt,Math.max(0.0005,estimate.stableDtEstimate||baseDt));
  const stepBudget=Number.isFinite(p.maxAcceptedSteps)?Math.max(1,Math.round(p.maxAcceptedSteps)):300000;
  const rootBudget=Number.isFinite(p.maxRootIterations)?Math.max(1,Math.round(p.maxRootIterations)):20000;
  let s={
    t:0,
    mO2T:capT*p.initialO2T,
    mO2Empty:bulkCaps.capEmpty*p.initialO2B,
    mO2Single:bulkCaps.capSingle*p.initialO2B,
    mO2Multi:bulkCaps.capMulti*p.initialO2B,
    mO2Oil:capOilE*p.initialO2Oil,
    mO2Res:capOilR*p.initialO2Res,
    headO2:p.headO2Initial,
    headCO2:p.headCO2Initial,
    Glc:p.sub.glc,
    Gln:p.sub.gln,
    Lac:p.sub.lac,
    mCO2T:capT*1000*initialTrackedCarbon,
    mCO2Empty:bulkCaps.capEmpty*1000*initialTrackedCarbon,
    mCO2Single:bulkCaps.capSingle*1000*initialTrackedCarbon,
    mCO2Multi:bulkCaps.capMulti*1000*initialTrackedCarbon,
    pH:p.pH0,
    nT:p.targetCells,
    nSingle:0,
    nMulti:0,
    nBulk:p.bulkInitialCells
  };
  const initialBulkCounts=bulkCountsForMode(p,bulkRegime.selectedMode,0);
  s.nSingle=initialBulkCounts.single;
  s.nMulti=initialBulkCounts.multi;
  s.nBulk=initialBulkCounts.total;
  refreshState(s,caps,p);
  const O2total0=s.mO2T+s.mO2Empty+s.mO2Single+s.mO2Multi+s.mO2Oil+s.mO2Res+(p.atmMode==='closed'?s.headO2:0);
  const CO2tracked0=s.mCO2T+s.mCO2Empty+s.mCO2Single+s.mCO2Multi+(kinetics.finiteHeadCO2?s.headCO2:0);
  let o2Consumed=0,co2Produced=0;
  let chart=[],log=[],nextC=0,nextL=0,events={O2:null,Glucose:null,Glutamine:null,pH_floor:null,pH_ceiling:null};
  let limiter='simulation horizon',safeMin=maxMin;
  let acceptedSteps=0,rejectedTrials=0,rootIterations=0,solverError=null;
  const dtHistory=[];
  const push=(arr)=>arr.push({...s,status:status(s,p),O2HeadEq:headEq(s,p),CO2HeadEq:co2HeadEq(s,p)});
  const acceptStep=(dt)=>{acceptedSteps+=1; dtHistory.push(dt);};
  let lastProgressFraction=-1;
  const emitProgress=(force=false)=>{
    if(typeof hooks.progress!=='function')return;
    const fraction=clamp(maxMin>0?s.t/maxMin:0,0,1);
    if(force||acceptedSteps<=1||acceptedSteps%500===0||fraction-lastProgressFraction>=0.05){
      lastProgressFraction=fraction;
      hooks.progress({phase:'simulate',acceptedSteps,estimatedSteps:estimate.estimatedSteps||0,timeMin:s.t,maxMin,fraction});
    }
  };
  emitProgress(true);
  const hitCheck=()=>{const hits=[]; if(s.O2T<=p.o2Threshold&&events.O2==null){events.O2=s.t;hits.push('O₂')} if(s.Glc<=p.glucoseFloor&&events.Glucose==null){events.Glucose=s.t;hits.push('Glucose')} if(s.Gln<=p.glutamineFloor&&events.Glutamine==null){events.Glutamine=s.t;hits.push('Glutamine')} if(s.pH<=p.pHFloor&&events.pH_floor==null){events.pH_floor=s.t;hits.push('pH floor')} if(s.pH>=p.pHCeiling&&events.pH_ceiling==null){events.pH_ceiling=s.t;hits.push('pH ceiling')} return hits;};
  outer: while(s.t<=maxMin){
    if(s.t>=nextC){push(chart); nextC+=chartEvery}
    if(s.t>=nextL){push(log); nextL+=p.logStep}
    const hits=hitCheck();
    if(hits.length){limiter=hits[0]; safeMin=s.t; break}
    let remain=Math.min(baseDt,maxMin-s.t);
    if(remain<=1e-9)break;
    while(remain>1e-9){
      s.nT=cellsAt(p.targetCells,s.t,p,capT);
      const grouped=bulkCountsForMode(p,bulkRegime.selectedMode,s.t);
      s.nSingle=grouped.single;
      s.nMulti=grouped.multi;
      s.nBulk=grouped.total;
      const dt=Math.min(stableDt,eventLimitedDt(s,p,caps,remain),remain);
      const prev={...s};
      const trial=advanceStep(prev,dt,p,caps,kinetics);
      const crossing=findEarliestEvent(prev,trial,dt,p,caps,kinetics);
      if(crossing){
        rootIterations+=crossing.iterations||0;
        if(rootIterations>rootBudget){solverError=`Solver root-refinement budget exceeded after ${fmt(rootIterations,0)} iterations.`; limiter='solver limit'; safeMin=s.t; break outer;}
        s=crossing.step.state;
        o2Consumed+=crossing.step.o2Consumed;
        co2Produced+=crossing.step.co2Produced;
        acceptStep(crossing.dt);
        emitProgress(true);
        for(const key of crossing.keys)if(events[key]==null)events[key]=crossing.time;
        limiter=crossing.label;
        safeMin=crossing.time;
        remain=0;
        break outer;
      }
      s=trial.state;
      o2Consumed+=trial.o2Consumed;
      co2Produced+=trial.co2Produced;
      acceptStep(dt);
      emitProgress();
      remain-=dt;
      if(acceptedSteps>stepBudget){solverError=`Solver accepted-step budget exceeded after ${fmt(acceptedSteps,0)} steps.`; limiter='solver limit'; safeMin=s.t; break outer;}
    }
  }
  if(limiter==='simulation horizon')safeMin=s.t;
  push(chart); push(log);
  const final={...s,status:status(s,p)};
  const O2totalFinal=final.mO2T+final.mO2Empty+final.mO2Single+final.mO2Multi+final.mO2Oil+final.mO2Res+(p.atmMode==='closed'?final.headO2:0);
  const o2Residual=p.atmMode==='closed'?O2total0-O2totalFinal-o2Consumed:null;
  const o2ResidualPct=p.atmMode==='closed'?100*Math.abs(o2Residual)/Math.max(1,Math.abs(O2total0)):0;
  const CO2trackedFinal=final.mCO2T+final.mCO2Empty+final.mCO2Single+final.mCO2Multi+(kinetics.finiteHeadCO2?final.headCO2:0);
  const co2Residual=kinetics.finiteHeadCO2?CO2tracked0+co2Produced-CO2trackedFinal:null;
  const co2ResidualPct=kinetics.finiteHeadCO2?100*Math.abs(co2Residual)/Math.max(1,Math.abs(CO2tracked0+co2Produced)):null;
  const effective={gasResHalf:kinetics.gasResHalf,gasDirectHalf:kinetics.gasDirectHalf,oilHalf:kinetics.oilHalf,dropTargetHalf:kinetics.dropTargetHalf,dropBulkHalf:kinetics.dropBulkHalf,co2TargetHalf:kinetics.co2TargetHalf,subDt:stableDt};
  const sortedDt=[...dtHistory].sort((a,b)=>a-b);
  const actualMinStep=sortedDt.length?sortedDt[0]:0;
  const actualMedianStep=sortedDt.length?sortedDt[Math.floor(sortedDt.length/2)]:0;
  const actualMaxStep=sortedDt.length?sortedDt[sortedDt.length-1]:0;
  const conductances=kineticsSummary(kinetics,caps);
  return {
    params:p,chart,log,events,limiter,safeMin,final,error:solverError,
    capacities:{capT,capBulk,capBulkOccupied:bulkCaps.capBulkOccupied,capEmpty:bulkCaps.capEmpty,capSingle:bulkCaps.capSingle,capMulti:bulkCaps.capMulti,capOilE,capOilR,capHead:kinetics.headCapO2,capHeadCO2:kinetics.headCapCO2},
    mass:{O2total0,O2totalFinal,o2Consumed,o2Residual,o2ResidualPct,CO2tracked0,CO2trackedFinal,co2Produced,co2Residual,co2ResidualPct,trackedCarbonLabel:p.pHModel==='carbonate_alkalinity'?'tracked aqueous DIC + headspace CO₂':'tracked aqueous dissolved CO₂ + headspace CO₂',closedCarbonBalance:kinetics.finiteHeadCO2},
    geometry:geom,effective,conductances,bulkO2Regime:bulkRegime,
    solver:{acceptedSteps,rejectedTrials,rootIterations,estimatedSteps:estimate.estimatedSteps||0,stableDtEstimate:estimate.stableDtEstimate||stableDt,actualMinStep,actualMedianStep,actualMaxStep,stepBudget,rootBudget,settings:{baseDtMin:baseDt,rootDtToleranceMin:1e-6,pHEndpointTolerance:1e-5,otherEndpointTolerance:1e-6,rootMaxIterationsPerEvent:36}},
    initialFlux:initialFlux(p,capT,capBulk,capOilE,capOilR,geom)
  };
}};
function eventLimitedDt(s,p,caps,remain){
  const targetO2Rate=Math.max(1e-9,oxygenLimitedRate(s.nT,s.O2T,p));
  const singleO2Rate=Math.max(1e-9,oxygenLimitedRate(s.nSingle,s.O2Single,p));
  const multiO2Rate=Math.max(1e-9,oxygenLimitedRate(s.nMulti,s.O2Multi,p));
  const pasteur=oxygenStress(s.O2T,p);
  const glcRate=Math.max(0,s.nT*p.rates.gcr*pasteur/(caps.capT*1000));
  const glnRate=Math.max(0,s.nT*p.rates.gln*(1+.15*(pasteur-1))/(caps.capT*1000));
  const o2Dt=s.O2T>p.o2Threshold?p.volume_nL*Math.max(0,s.O2T-p.o2Threshold)/targetO2Rate*0.1:remain;
  const singleDt=s.O2Single>p.o2Threshold&&caps.capSingle>0?caps.capSingle*Math.max(0,s.O2Single-p.o2Threshold)/singleO2Rate*0.1:remain;
  const multiDt=s.O2Multi>p.o2Threshold&&caps.capMulti>0?caps.capMulti*Math.max(0,s.O2Multi-p.o2Threshold)/multiO2Rate*0.1:remain;
  const glcDt=s.Glc>p.glucoseFloor&&glcRate>0?(s.Glc-p.glucoseFloor)/glcRate*0.1:remain;
  const glnDt=s.Gln>p.glutamineFloor&&glnRate>0?(s.Gln-p.glutamineFloor)/glnRate*0.1:remain;
  return Math.max(0.0005,Math.min(remain,o2Dt,singleDt,multiDt,glcDt,glnDt));
}
function advanceStep(prev,dt,p,caps,kin){
  const s={...prev};
  s.nT=cellsAt(p.targetCells,prev.t,p,caps.capT);
  const grouped=bulkCountsForMode(p,caps.bulkO2Mode,prev.t);
  s.nSingle=grouped.single;
  s.nMulti=grouped.multi;
  s.nBulk=grouped.total;
  const o2Nodes=[{key:'mO2T',amount:s.mO2T,cap:caps.capT},{key:'mO2Empty',amount:s.mO2Empty,cap:caps.capEmpty},{key:'mO2Single',amount:s.mO2Single,cap:caps.capSingle},{key:'mO2Multi',amount:s.mO2Multi,cap:caps.capMulti},{key:'mO2Oil',amount:s.mO2Oil,cap:caps.capOilE},{key:'mO2Res',amount:s.mO2Res,cap:caps.capOilR},...(kin.finiteHeadO2?[{key:'headO2',amount:s.headO2,cap:kin.headCapO2}]:[])];
  const o2Finite=[{a:'mO2Res',b:'mO2Oil',G:kin.Goil},{a:'mO2Oil',b:'mO2T',G:kin.GdropTarget},{a:'mO2Oil',b:'mO2Empty',G:kin.GdropEmpty},{a:'mO2Oil',b:'mO2Single',G:kin.GdropSingle},{a:'mO2Oil',b:'mO2Multi',G:kin.GdropMulti},...(kin.finiteHeadO2?[{a:'mO2Res',b:'headO2',G:kin.GgasRes},{a:'mO2Oil',b:'headO2',G:kin.GgasDirect}]:[])];
  const o2Boundary=kin.finiteHeadO2?[]:[{node:'mO2Res',G:kin.GgasRes,conc:headEq(s,p)},{node:'mO2Oil',G:kin.GgasDirect,conc:headEq(s,p)}];
  const solvedO2=solveLinearExchange(o2Nodes,o2Finite,o2Boundary,dt);
  s.mO2T=solvedO2.mO2T??s.mO2T;
  s.mO2Empty=solvedO2.mO2Empty??s.mO2Empty;
  s.mO2Single=solvedO2.mO2Single??s.mO2Single;
  s.mO2Multi=solvedO2.mO2Multi??s.mO2Multi;
  s.mO2Oil=solvedO2.mO2Oil??s.mO2Oil;
  s.mO2Res=solvedO2.mO2Res??s.mO2Res;
  if(kin.finiteHeadO2)s.headO2=solvedO2.headO2??s.headO2;
  refreshState(s,caps,p);
  const consAmtT=Math.min(oxygenLimitedRate(s.nT,s.O2T,p)*dt,Math.max(0,s.mO2T));
  const consAmtSingle=Math.min(oxygenLimitedRate(s.nSingle,s.O2Single,p)*dt,Math.max(0,s.mO2Single));
  const consAmtMulti=Math.min(oxygenLimitedRate(s.nMulti,s.O2Multi,p)*dt,Math.max(0,s.mO2Multi));
  s.mO2T-=consAmtT;
  s.mO2Single-=consAmtSingle;
  s.mO2Multi-=consAmtMulti;
  refreshState(s,caps,p);
  const pasteur=oxygenStress(s.O2T,p);
  const concDen=caps.capT*1000;
  const glcRaw=s.Glc-(s.nT*p.rates.gcr*pasteur*dt)/concDen;
  const glnRaw=s.Gln-(s.nT*p.rates.gln*(1+.15*(pasteur-1))*dt)/concDen;
  s.Glc=Math.max(0,glcRaw);
  s.Gln=Math.max(0,glnRaw);
  s.Lac=Math.max(0,s.Lac+(s.nT*p.rates.lpr*pasteur*dt)/concDen);
  const co2ProdT=consAmtT*p.rq, co2ProdSingle=consAmtSingle*p.rq, co2ProdMulti=consAmtMulti*p.rq;
  s.mCO2T+=co2ProdT;
  s.mCO2Single+=co2ProdSingle;
  s.mCO2Multi+=co2ProdMulti;
  refreshState(s,caps,p);
  const co2Nodes=[{key:'mCO2T',amount:s.mCO2T,cap:p.pHModel==='carbonate_alkalinity'?co2TransferCapacity(caps.capT,s.co2AlphaT):caps.capT*1000},{key:'mCO2Empty',amount:s.mCO2Empty,cap:p.pHModel==='carbonate_alkalinity'?co2TransferCapacity(caps.capEmpty,s.co2AlphaEmpty):caps.capEmpty*1000},{key:'mCO2Single',amount:s.mCO2Single,cap:p.pHModel==='carbonate_alkalinity'?co2TransferCapacity(caps.capSingle,s.co2AlphaSingle):caps.capSingle*1000},{key:'mCO2Multi',amount:s.mCO2Multi,cap:p.pHModel==='carbonate_alkalinity'?co2TransferCapacity(caps.capMulti,s.co2AlphaMulti):caps.capMulti*1000},...(kin.finiteHeadCO2?[{key:'headCO2',amount:s.headCO2,cap:kin.headCapCO2}]:[])];
  const co2Finite=kin.finiteHeadCO2?[{a:'mCO2T',b:'headCO2',G:kin.Gco2Target},{a:'mCO2Empty',b:'headCO2',G:kin.Gco2Empty},{a:'mCO2Single',b:'headCO2',G:kin.Gco2Single},{a:'mCO2Multi',b:'headCO2',G:kin.Gco2Multi}]:[];
  const co2Boundary=kin.finiteHeadCO2?[]:[{node:'mCO2T',G:kin.Gco2Target,conc:co2HeadEq(s,p)},{node:'mCO2Empty',G:kin.Gco2Empty,conc:co2HeadEq(s,p)},{node:'mCO2Single',G:kin.Gco2Single,conc:co2HeadEq(s,p)},{node:'mCO2Multi',G:kin.Gco2Multi,conc:co2HeadEq(s,p)}];
  const solvedCO2=solveLinearExchange(co2Nodes,co2Finite,co2Boundary,dt);
  s.mCO2T=solvedCO2.mCO2T??s.mCO2T;
  s.mCO2Empty=solvedCO2.mCO2Empty??s.mCO2Empty;
  s.mCO2Single=solvedCO2.mCO2Single??s.mCO2Single;
  s.mCO2Multi=solvedCO2.mCO2Multi??s.mCO2Multi;
  if(kin.finiteHeadCO2)s.headCO2=solvedCO2.headCO2??s.headCO2;
  s.t=prev.t+dt;
  refreshState(s,caps,p);
  s.nT=cellsAt(p.targetCells,s.t,p,caps.capT);
  const groupedNext=bulkCountsForMode(p,caps.bulkO2Mode,s.t);
  s.nSingle=groupedNext.single;
  s.nMulti=groupedNext.multi;
  s.nBulk=groupedNext.total;
  return {state:s,o2Consumed:consAmtT+consAmtSingle+consAmtMulti,co2Produced:co2ProdT+co2ProdSingle+co2ProdMulti,raw:{Glc:glcRaw,Gln:glnRaw}};
}
function refreshState(s,caps,p){
  s.mO2B=s.mO2Empty+s.mO2Single+s.mO2Multi;
  s.mCO2B=s.mCO2Empty+s.mCO2Single+s.mCO2Multi;
  s.O2T=caps.capT>0?s.mO2T/caps.capT:0;
  s.O2Empty=caps.capEmpty>0?s.mO2Empty/caps.capEmpty:s.O2T;
  s.O2Single=caps.capSingle>0?s.mO2Single/caps.capSingle:s.O2T;
  s.O2Multi=caps.capMulti>0?s.mO2Multi/caps.capMulti:s.O2T;
  s.O2B=caps.capBulk>0?s.mO2B/caps.capBulk:s.O2T;
  s.O2BulkOccupied=caps.capBulkOccupied>0?(s.mO2Single+s.mO2Multi)/caps.capBulkOccupied:s.O2T;
  s.O2Oil=caps.capOilE>0?s.mO2Oil/caps.capOilE:0;
  s.O2Res=caps.capOilR>0?s.mO2Res/caps.capOilR:s.O2Oil;
  if(p.pHModel==='carbonate_alkalinity'){
    const dic0=Number.isFinite(p.DICInitial)?p.DICInitial:carbonateBaseline(p).dic0;
    s.DICT=caps.capT>0?s.mCO2T/(caps.capT*1000):dic0;
    s.DICEmpty=caps.capEmpty>0?s.mCO2Empty/(caps.capEmpty*1000):s.DICT;
    s.DICSingle=caps.capSingle>0?s.mCO2Single/(caps.capSingle*1000):s.DICT;
    s.DICMulti=caps.capMulti>0?s.mCO2Multi/(caps.capMulti*1000):s.DICT;
    s.DICB=caps.capBulk>0?s.mCO2B/(caps.capBulk*1000):s.DICT;
    s._targetCarbonate=solveCarbonateState(s.DICT,Math.max(0,s.Lac-p.sub.lac),p);
    s._emptyCarbonate=solveCarbonateState(s.DICEmpty,0,p);
    s._singleCarbonate=solveCarbonateState(s.DICSingle,0,p);
    s._multiCarbonate=solveCarbonateState(s.DICMulti,0,p);
    s.CO2T=s._targetCarbonate.co2;
    s.CO2Empty=s._emptyCarbonate.co2;
    s.CO2Single=s._singleCarbonate.co2;
    s.CO2Multi=s._multiCarbonate.co2;
    s.HCO3T=s._targetCarbonate.hco3;
    s.CO3T=s._targetCarbonate.co3;
    s.co2AlphaT=s._targetCarbonate.alpha0;
    s.co2AlphaEmpty=s._emptyCarbonate.alpha0;
    s.co2AlphaSingle=s._singleCarbonate.alpha0;
    s.co2AlphaMulti=s._multiCarbonate.alpha0;
    s.CO2B=caps.capBulk>0?((s.CO2Empty*caps.capEmpty)+(s.CO2Single*caps.capSingle)+(s.CO2Multi*caps.capMulti))/Math.max(1e-9,caps.capBulk):s.CO2T;
  }else{
    s.DICT=caps.capT>0?s.mCO2T/(caps.capT*1000):p.CO2Initial;
    s.DICEmpty=caps.capEmpty>0?s.mCO2Empty/(caps.capEmpty*1000):s.DICT;
    s.DICSingle=caps.capSingle>0?s.mCO2Single/(caps.capSingle*1000):s.DICT;
    s.DICMulti=caps.capMulti>0?s.mCO2Multi/(caps.capMulti*1000):s.DICT;
    s.DICB=caps.capBulk>0?s.mCO2B/(caps.capBulk*1000):s.DICT;
    s.CO2T=s.DICT;
    s.CO2Empty=s.DICEmpty;
    s.CO2Single=s.DICSingle;
    s.CO2Multi=s.DICMulti;
    s.CO2B=s.DICB;
    s.HCO3T=Math.max(.05,Math.max(0,p.sub.bicarb||0)-Math.max(0,s.Lac-p.sub.lac));
    s.CO3T=0;
    s.co2AlphaT=1;
    s.co2AlphaEmpty=1;
    s.co2AlphaSingle=1;
    s.co2AlphaMulti=1;
  }
  s.pH=computePH(s,p);
  return s;
}
function crossingFraction(prevVal,nextVal,threshold,mode){if(mode==='down'){if(prevVal>threshold&&nextVal<=threshold)return clamp((prevVal-threshold)/Math.max(1e-12,prevVal-nextVal),0,1);} if(mode==='up'){if(prevVal<threshold&&nextVal>=threshold)return clamp((threshold-prevVal)/Math.max(1e-12,nextVal-prevVal),0,1);} return null;}
function eventSpecs(prev,trial,p){return [{key:'O2',label:'O₂',prev:prev.O2T,next:trial.state.O2T,threshold:p.o2Threshold,mode:'down'},{key:'Glucose',label:'Glucose',prev:prev.Glc,next:trial.raw.Glc,threshold:p.glucoseFloor,mode:'down'},{key:'Glutamine',label:'Glutamine',prev:prev.Gln,next:trial.raw.Gln,threshold:p.glutamineFloor,mode:'down'},{key:'pH_floor',label:'pH floor',prev:prev.pH,next:trial.state.pH,threshold:p.pHFloor,mode:'down'},{key:'pH_ceiling',label:'pH ceiling',prev:prev.pH,next:trial.state.pH,threshold:p.pHCeiling,mode:'up'}];}
function eventValue(spec,step){if(spec.key==='Glucose')return step.raw.Glc; if(spec.key==='Glutamine')return step.raw.Gln; if(spec.key==='O2')return step.state.O2T; if(spec.key==='pH_floor'||spec.key==='pH_ceiling')return step.state.pH; return NaN;}
function eventTolerance(spec){if(spec.key==='pH_floor'||spec.key==='pH_ceiling')return 1e-5; return 1e-6;}
function refineEvent(prev,dt,spec,p,caps,kinetics){
  let lo=0, hi=dt, best=null;
  let iterations=0;
  for(let i=0;i<36;i++){
    iterations=i+1;
    const mid=(lo+hi)/2;
    const step=advanceStep(prev,mid,p,caps,kinetics);
    const val=eventValue(spec,step);
    best={dt:mid,step,val};
    if(spec.mode==='down'){
      if(val<=spec.threshold)hi=mid; else lo=mid;
    }else{
      if(val>=spec.threshold)hi=mid; else lo=mid;
    }
    if((hi-lo)<=1e-6||Math.abs(val-spec.threshold)<=eventTolerance(spec))break;
  }
  const finalStep=advanceStep(prev,hi,p,caps,kinetics);
  return {key:spec.key,label:spec.label,dt:hi,time:prev.t+hi,step:finalStep,val:eventValue(spec,finalStep),iterations};
}
function simultaneousEventKeys(baseStep,candidates){return candidates.filter(c=>Math.abs(c.val-eventThresholdForKey(c.key,baseStep.params||{}))<=eventTolerance({key:c.key})).map(c=>c.key);}
function eventThresholdForKey(key,p){if(key==='O2')return p.o2Threshold; if(key==='Glucose')return p.glucoseFloor; if(key==='Glutamine')return p.glutamineFloor; if(key==='pH_floor')return p.pHFloor; if(key==='pH_ceiling')return p.pHCeiling; return NaN;}
function findEarliestEvent(prev,trial,dt,p,caps,kinetics){
  const candidates=eventSpecs(prev,trial,p).filter(spec=>crossingFraction(spec.prev,spec.next,spec.threshold,spec.mode)!=null).map(spec=>refineEvent(prev,dt,spec,p,caps,kinetics));
  if(!candidates.length)return null;
  candidates.sort((a,b)=>a.dt-b.dt);
  const earliest=candidates[0];
  const tolDt=Math.max(1e-6,earliest.dt*1e-6);
  const keys=candidates.filter(c=>Math.abs(c.dt-earliest.dt)<=tolDt).map(c=>c.key);
  const iterations=candidates.reduce((sum,c)=>sum+(c.iterations||0),0);
  return {label:earliest.label,time:earliest.time,dt:earliest.dt,step:earliest.step,keys,iterations};
}
function interpolateState(a,b,f){const out={}; for(const key of Object.keys(b))out[key]=typeof a[key]==='number'&&typeof b[key]==='number'?a[key]+(b[key]-a[key])*f:b[key]; return out;}
function oxygenStress(o2,p){const th=Math.max(0,p.pasteurThreshold_uM||0); if(th<=0||o2>=th)return 1; return 1+(Math.max(1,p.pasteurMax||1)-1)*clamp(1-o2/th,0,1);}
function cellsAt(n0,t,p,capNL){if(!p.prolif)return n0; const th=t/60; if(th<=p.lag_h)return n0; const K=Math.max(n0,Math.max(1,p.carryingCellsPerNL||300)*Math.max(1e-9,capNL||p.volume_nL)); const r=Math.log(2)/Math.max(.1,p.dt_h); const x=Math.exp(clamp(r*(th-p.lag_h),-60,60)); return K*n0*x/(K+n0*(x-1));}
function headEq(s,p){if(p.atmMode!=='closed')return p.O2eq; if(p.headspace_mL<=0)return 0; const kh=PHYS.kH_O2_37C_mM_atm*Math.exp(-.025*(p.T-37)); const po2=(Math.max(0,s.headO2||0)*1e-15*PHYS.R*(273.15+p.T))/(p.headspace_mL/1000); return Math.max(0,kh*po2*1000);}
function co2HeadEq(s,p){if(p.pHBoundaryMode==='closed_headspace_mass_balance'&&p.atmMode==='closed'&&p.headspace_mL>0){const kh=PHYS.kH_CO2_37C_mM_atm*Math.exp(-.025*(p.T-37)); const pco2=(Math.max(0,s.headCO2||0)*1e-15*PHYS.R*(273.15+p.T))/(p.headspace_mL/1000); return Math.max(.001,kh*pco2);} return Math.max(.001,p.CO2Boundary);}
function co2TransferCapacity(cap,alpha0){return cap>0?cap*1000/Math.max(1e-6,alpha0||0):0;}
function computePHHeuristic(s,p){const dL=Math.max(0,s.Lac-p.sub.lac), co2=Math.max(.001,s.CO2T||p.CO2Initial||p.CO2eq), co20=Math.max(.001,p.CO2Initial||p.CO2eq); const b0=Math.max(0,p.sub.bicarb||0), pKa=carbonateConstants(p.T).pKa1; if(b0>.5){const b=Math.max(.05,b0-dL); const hh0=pKa+Math.log10(Math.max(.05,b0)/co20); const hh=pKa+Math.log10(b/co2); const nonBicarbDrop=dL/Math.max(2,p.buffer*2.5); return clamp(p.pH0+(hh-hh0)-.20*nonBicarbDrop,0,14);} const lactateDrop=dL/Math.max(.1,p.buffer); const co2Drop=Math.log10(co2/co20); return clamp(p.pH0-lactateDrop-co2Drop,0,14);}
function computePH(s,p){if(p.pHModel==='carbonate_alkalinity')return s._targetCarbonate?.pH??solveCarbonateState(Number.isFinite(s.DICT)?s.DICT:(Number.isFinite(p.DICInitial)?p.DICInitial:carbonateBaseline(p).dic0),Math.max(0,(s.Lac||0)-(p.sub?.lac||0)),p).pH; return computePHHeuristic(s,p);}
function status(s,p){if(s.O2T<=p.o2Threshold)return 'Hypoxia'; if(s.Glc<=p.glucoseFloor)return 'Glucose depleted'; if(s.Gln<=p.glutamineFloor)return 'Glutamine depleted'; if(s.pH<=p.pHFloor)return 'Acidic'; if(s.pH>=p.pHCeiling)return 'Alkaline'; return 'Viable';}
function halfFromK(k){return k>0?Math.log(2)/k:Infinity;}
function initialFlux(p,capT,capBulk,capOilE,capOilR,geom=geometryScales(p)){const baseBulkCaps=occupancyCapacities(p); const bulkRegime=resolveBulkOxygenRegime(p,effectiveHalfTime(p.dropHalf,geom.dropBulk,p.halfTimeMode),baseBulkCaps); const bulkCaps=bulkCapacitiesForMode(baseBulkCaps,bulkRegime.selectedMode); const kin=buildKinetics(p,{capT,capBulk,capOilE,capOilR,...bulkCaps},geom); const initHeadEq=headEq({headO2:p.headO2Initial},p); const grouped=bulkCountsForMode(p,bulkRegime.selectedMode,0); const demand=oxygenLimitedRate(p.targetCells,p.initialO2T,p)+oxygenLimitedRate(grouped.single,p.initialO2B,p)+oxygenLimitedRate(grouped.multi,p.initialO2B,p); const boundaryRes=capOilR>0?kin.GgasRes*(initHeadEq-p.initialO2Res):0; const boundaryDirect=capOilE>0?kin.GgasDirect*(initHeadEq-p.initialO2Oil):0; const localTarget=kin.GdropTarget*(p.initialO2Oil-p.initialO2T); const localSingle=kin.GdropSingle*(p.initialO2Oil-p.initialO2B); const localMulti=kin.GdropMulti*(p.initialO2Oil-p.initialO2B); const localEmpty=kin.GdropEmpty*(p.initialO2Oil-p.initialO2B); const mix=kin.Goil*(p.initialO2Res-p.initialO2Oil); return {demand,boundaryNet:boundaryRes+boundaryDirect,boundaryIntoLiquid:Math.max(0,boundaryRes)+Math.max(0,boundaryDirect),boundaryOutOfLiquid:Math.max(0,-boundaryRes)+Math.max(0,-boundaryDirect),localNet:localTarget+localSingle+localMulti,localIntoDroplets:Math.max(0,localTarget)+Math.max(0,localSingle)+Math.max(0,localMulti),localOutOfDroplets:Math.max(0,-localTarget)+Math.max(0,-localSingle)+Math.max(0,-localMulti),localIntoEmptyDroplets:Math.max(0,localEmpty),localOutOfEmptyDroplets:Math.max(0,-localEmpty),mix,bulkO2Regime:bulkRegime};}
