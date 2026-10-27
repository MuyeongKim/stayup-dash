import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../stayup-dash.html',import.meta.url),'utf8');
const block=source.split('/* FIELD_GEOMETRY_BEGIN:')[1].split('/* FIELD_GEOMETRY_END */')[0];
const context={};runInNewContext('/*'+block,context);const g=context.FieldGeometry;
const layout=g.layout({cx:.5,cy:.5,w:.5,h:.4,angle:31,aspect:1.6});
for(const [u,v] of [[0,0],[1,0],[0,1],[1,1],[.23,.67]]){
  const p=g.point(layout,u,v),back=g.local(layout,p.x,p.y);
  assert.ok(Math.abs(back.x-u)<1e-10&&Math.abs(back.y-v)<1e-10);
}
assert.throws(()=>g.layout({cx:.5,cy:.5,w:1,h:1,angle:30,aspect:1.6}),/지도 밖/);
assert.throws(()=>g.layout({...layout,angle:Infinity}),/유한한/);
const polygon=g.polygon([{x:.1,y:.1},{x:.8,y:.1},{x:.5,y:.4},{x:.8,y:.8},{x:.1,y:.8}]);
assert.equal(g.contains(polygon,{x:.2,y:.3}),true);
assert.equal(g.contains(polygon,{x:.1,y:.4}),true);
assert.equal(g.contains(polygon,{x:.9,y:.3}),false);
assert.throws(()=>g.polygon([{x:0,y:0},{x:1,y:1},{x:0,y:1},{x:1,y:0}]),/교차/);
assert.throws(()=>g.polygon([{x:0,y:0},{x:0,y:0},{x:1,y:1}]),/다른 꼭짓점/);
assert.throws(()=>g.polygon([{x:0,y:0},{x:1,y:0},{x:0,y:NaN}]),/지도 안/);
for(let row=0;row<5;row++)for(let col=0;col<6;col++){
 const center=g.point(layout,(col+.5)/6,(row+.5)/5),cell=g.corners(layout,row,col,5,6);
 assert.equal(g.contains(cell,center),true);
}
console.log('격자 회전·좌표 왕복과 자유 구역 유효성 검사 통과');
