// Squarified layout shared by the Skill and context composition views.
export function tileLayout(items,width,height){
  const usable=items.filter(row=>Number.isFinite(row.weight)&&row.weight>0),total=usable.reduce((sum,row)=>sum+row.weight,0);
  if(!total||width<=0||height<=0)return [];
  const pending=usable.map(row=>({...row,area:row.weight/total*width*height})),out=[];
  let x=0,y=0,w=width,h=height;
  const worst=(row,side)=>{const areas=row.map(r=>r.area),sum=areas.reduce((a,b)=>a+b,0);return Math.max(side*side*Math.max(...areas)/(sum*sum),sum*sum/(side*side*Math.min(...areas)));};
  while(pending.length){
    const side=Math.min(w,h),row=[pending.shift()];
    while(pending.length&&worst([...row,pending[0]],side)<=worst(row,side))row.push(pending.shift());
    const sum=row.reduce((n,r)=>n+r.area,0);
    if(w>=h){const rw=sum/h;let ry=y;for(const r of row){const rh=r.area/rw;out.push({...r,x,y:ry,w:rw,h:rh});ry+=rh;}x+=rw;w-=rw;}
    else{const rh=sum/w;let rx=x;for(const r of row){const rw=r.area/rh;out.push({...r,x:rx,y,w:rw,h:rh});rx+=rw;}y+=rh;h-=rh;}
  }
  return out;
}
