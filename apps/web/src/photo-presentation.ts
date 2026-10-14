export function squareCrop(width:number,height:number,zoom:number,x:number,y:number){
 const side=Math.min(width,height)/Math.max(1,zoom);
 const w=side/width,h=side/height;
 return{x:(1-w)*Math.max(0,Math.min(1,x)),y:(1-h)*Math.max(0,Math.min(1,y)),width:w,height:h};
}
