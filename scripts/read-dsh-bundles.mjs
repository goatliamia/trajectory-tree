// Reuse the installed manager's read-only inventory logic without constructing a
// service, starting a Loader, or running package-management operations. An empty
// Loader intentionally supplies no live activation IDs.
export function readDshBundles(PluginManager, {profileRoot, installAnchor}) {
  const prototype=PluginManager.prototype;
  const reader={
    profile:{dir:profileRoot,installAnchor},managementBundles:new Set(),ownerEntryId:undefined,
    ctx:{loader:{entries:()=>[]},get:()=>undefined},
  };
  for(const method of ['bundleRows','protectsManager','declaredRows'])reader[method]=prototype[method];
  return prototype.readBundles.call(reader).map(bundle=>({
    name:bundle.name,official:bundle.official,availability:bundle.availability,
    installed:bundle.installed,enabled:bundle.enabled,optional:bundle.optional,
    version:bundle.version,description:bundle.description,meta:bundle.meta,
    rows:bundle.rows,overrides:bundle.overrides,error:bundle.error,
    removable:bundle.removable,readOnlyReason:bundle.readOnlyReason,
  }));
}

export function sourceForModule(name, bundles, presetEntryId) {
  const matches=bundles.filter(bundle=>bundle.enabled&&(bundle.name===name||bundle.rows.some(row=>row.moduleName===name)));
  const direct=matches.find(bundle=>bundle.name===name),bundle=direct??matches[0]??(presetEntryId?bundles.find(bundle=>bundle.enabled&&bundle.rows.some(row=>row.rowId===presetEntryId&&row.moduleName==='@deepseek-ai/dsh-agent-preset')):undefined);
  if(!bundle)return {origin:'unknown',basis:'not-in-native-bundle-inventory'};
  return {origin:bundle.official||bundle.availability==='installation'?'official':'plugin',
    bundle:bundle.name,official:bundle.official,availability:bundle.availability,
    basis:'dsh-plugin-manager.readBundles',...presetEntryId&&matches.length===0?{presetEntryId}:{} };
}
