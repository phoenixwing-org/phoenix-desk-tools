import {expect,it} from 'vitest';
import {sourceNodes,drawingFacts} from './service.js';
const object = (name:string,type:string) => `<Object name="${name}" type="${type}"/>`;
it.each(['Assembly::AssemblyObject','App::Part'])('offers the %s parent once, without grouped child links',type=>{
 const xml=`<Document><Objects>${object('Assembly',type)}${object('First','App::Link')}${object('Second','App::Link')}${object('Joints','Assembly::JointGroup')}</Objects><ObjectData><Object name="Assembly"><Properties><Property name="Label" type="App::PropertyString"><String value="Test &amp; assembly"/></Property><Property name="Group" type="App::PropertyLinkList"><LinkList count="3"><Link value="First"/><Link value="Second"/><Link value="Joints"/></LinkList></Property></Properties></Object></ObjectData></Document>`;
 expect(sourceNodes(xml)).toEqual([{name:'Assembly',type,label:'Test & assembly'}]);
});
it('ignores fake geometry declarations in comments and leaves independent bodies selectable',()=>{
 const xml=`<Document><!-- <Objects>${object('Fake','App::Part')}</Objects> --><Objects>${object('Body','PartDesign::Body')}${object('Reference','Part::Feature')}${object('Origin','App::Origin')}</Objects></Document>`;
 expect(sourceNodes(xml).map(n=>n.name)).toEqual(['Body','Reference']);
});
it('reports separate page/view/dimension counts for a generated drawing',()=>{
 const xml=`<Document><Objects>${object('Page','TechDraw::DrawPage')}${object('Front','TechDraw::DrawViewPart')}${object('Side','TechDraw::DrawViewPart')}${object('Iso','TechDraw::DrawViewPart')}${object('Width','TechDraw::DrawViewDimension')}${object('Note','TechDraw::DrawViewAnnotation')}</Objects></Document>`;
 expect(drawingFacts(xml)).toMatchObject({pages:['Page'],views:3,dimensions:1});
});
