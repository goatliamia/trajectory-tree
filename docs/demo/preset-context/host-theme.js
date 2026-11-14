const tokens={
  '--tt-surface':'--dsw-alias-bg-layer-1','--tt-canvas':'--dsw-alias-bg-layer-2','--tt-soft':'--dsw-alias-bg-layer-2',
  '--tt-ink':'--dsw-alias-label-primary','--tt-muted':'--dsw-alias-label-secondary',
  '--tt-line':'--dsw-alias-border-l1','--tt-grid':'--dsw-alias-border-l1',
  '--tt-action':'--dsw-alias-business-primary','--tt-metric':'--dsw-alias-business-primary',
};
export function followDshTheme(win=window){
  const root=win.document.documentElement;root.dataset.dshTheme='light';
  if(!win.__trajectoryWorkspace?.native||win.parent===win)return ()=>{};
  let host;try{host=win.parent.document;if(!host.body)return ()=>{};}catch{return ()=>{};}
  const update=()=>{
    root.dataset.dshTheme=host.body.hasAttribute('data-ds-dark-theme')?'dark':'light';
    const style=win.parent.getComputedStyle(host.body);
    for(const [target,source]of Object.entries(tokens)){
      const value=style.getPropertyValue(source).trim();
      if(value)root.style.setProperty(target,value);else root.style.removeProperty(target);
    }
    for(const name of ['brand-primary','business-primary','state-success-primary','state-success-secondary','state-warn-primary','state-error-primary','state-error-secondary','label-caption']){
      const token='--dsw-alias-'+name,value=style.getPropertyValue(token).trim();
      if(value)root.style.setProperty(token,value);else root.style.removeProperty(token);
    }
  };
  update();let frame=0;
  const observer=new win.MutationObserver(()=>{if(!frame)frame=win.requestAnimationFrame(()=>{frame=0;update();});});
  observer.observe(host.documentElement,{attributes:true});observer.observe(host.body,{attributes:true});
  if(host.head)observer.observe(host.head,{subtree:true,childList:true,characterData:true});
  const stop=()=>{observer.disconnect();if(frame)win.cancelAnimationFrame(frame);};
  win.addEventListener('pagehide',stop,{once:true});return stop;
}
