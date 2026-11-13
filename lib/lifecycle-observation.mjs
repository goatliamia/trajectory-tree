// A disposer receipt is a claim, not an independent observation. Compare an
// explicitly declared surface, retaining incomplete evidence as unknown.
const equal=(a,b)=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
export function assessTeardown({before,loaded,after,registered=[],withdrawn=[],retained=[],coverage}={}){
  if(!before||!loaded||!after||coverage?.complete!==true||coverage?.independent!==true)
    return {verdict:'unknown',reason:'missing-independent-observation',checks:[]};
  const added=loaded.filter(x=>!before.includes(x)),removed=loaded.filter(x=>!after.includes(x));
  const checks=[{id:'registration',passed:equal(added,registered)},
    {id:'withdrawal',passed:equal(removed,withdrawn)},
    {id:'round-trip',passed:equal(before,after)}];
  if(checks.every(c=>c.passed))return {verdict:'verified-reversible',surface:coverage.surface,checks};
  const residual=after.filter(x=>!before.includes(x));
  const loss=before.filter(x=>!after.includes(x));
  return {verdict:checks.slice(0,2).every(c=>c.passed)&&!loss.length&&residual.length&&equal(residual,retained)?'declared-irreversible':'unknown',
    reason:'observation-mismatch',surface:coverage.surface,checks,residual,loss};
}
export function configurationReceipt(verified){
  return {configurationVerified:verified,runtime:'not-observed',cleanup:assessTeardown().verdict};
}
