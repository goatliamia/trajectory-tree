// Squarified layout shared by the Skill and context composition views.
export function tileLayout(items,width,height){
  const usable=items.filter(row=>Number.isFinite(row.weight)&&row.weight>0),total=usable.reduce((sum,row)=>sum+row.weight,0);
  if(!total||width<=0||height<=0)return [];
  const pending=usable.map(row=>({...row,area:row.weight/total*width*height})),out=[];
  let x=0,y=0,w=width,h=height,cursor=0;
  const worst=(sum,min,max,side)=>Math.max(side*side*max/(sum*sum),sum*sum/(side*side*min));
  while(cursor<pending.length){
    const side=Math.min(w,h),start=cursor,first=pending[cursor++].area;
    let sum=first,min=first,max=first,score=worst(first,first,first,side);
    while(cursor<pending.length){
      const area=pending[cursor].area,nextSum=sum+area,nextMin=Math.min(min,area),nextMax=Math.max(max,area),nextScore=worst(nextSum,nextMin,nextMax,side);
      if(!(nextScore<=score))break;
      sum=nextSum;min=nextMin;max=nextMax;score=nextScore;cursor++;
    }
    if(w>=h){const rw=sum/h;let ry=y;for(let i=start;i<cursor;i++){const r=pending[i],rh=r.area/rw;out.push({...r,x,y:ry,w:rw,h:rh});ry+=rh;}x+=rw;w-=rw;}
    else{const rh=sum/w;let rx=x;for(let i=start;i<cursor;i++){const r=pending[i],rw=r.area/rh;out.push({...r,x:rx,y,w:rw,h:rh});rx+=rw;}y+=rh;h-=rh;}
  }
  return out;
}
