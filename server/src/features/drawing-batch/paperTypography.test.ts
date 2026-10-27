import {expect,it} from 'vitest';
import {fcstdXmlObjects} from '../../lib/fcstdLinkIdentity.js';
import {paperTypographyDiagnostics,parseDrawingRatio} from './paperTypography.js';
const string=(name:string,v:string)=>`<Property name="${name}" type="App::PropertyString"><String value="${v}"/></Property>`;
const float=(name:string,v:number)=>`<Property name="${name}" type="App::PropertyFloat"><Float value="${v}"/></Property>`;
function fixture(options:{header?:string;pageScale?:number;auxScale?:number;height?:number;aliasHeight?:number;style?:string;svgWidth?:string}={}){
 const xml=`<Document><ObjectData>
 <Object name="Page"><Properties><Property name="Template"><Link value="Template"/></Property>${float('Scale',options.pageScale??1)}<Property name="Views"><LinkList><Link value="Front"/><Link value="Aux"/></LinkList></Property></Properties></Object>
 <Object name="Template"><Properties><Property name="PageResult"><FileIncluded file="frame.svg"/></Property><Property name="EditableTexts"><Map><Item key="scale" value="${options.header??'1:1'}"/><Item key="paper_size" value="A3"/></Map></Property>${float('Width',420)}${float('Height',297)}</Properties></Object>
 <Object name="Front"><Properties>${string('ScaleType','Page')}${float('Scale',99)}</Properties></Object>
 <Object name="Aux"><Properties>${string('ScaleType','Custom')}${float('Scale',options.auxScale??0.5)}</Properties></Object>
 <Object name="Dimension"><Properties>${string('Type','Diameter')}</Properties></Object>
 </ObjectData></Document>`;
 const gui=`<GuiDocument><ViewProvider name="Dimension"><Properties>${float('Fontsize',options.height??5)}${options.aliasHeight===undefined?'':float('FontSize',options.aliasHeight)}${string('StandardAndStyle',options.style??'ISO Referencing')}</Properties></ViewProvider></GuiDocument>`;
 const types=new Map([['Page','TechDraw::DrawPage'],['Template','TechDraw::DrawSVGTemplate'],['Front','TechDraw::DrawViewPart'],['Aux','TechDraw::DrawViewPart'],['Dimension','TechDraw::DrawViewDimension']]);
 const files={'frame.svg':new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" width="${options.svgWidth??'420mm'}" height="297mm"/>`)};
 return {objects:fcstdXmlObjects(xml),types,gui,files};
}
const diagnostics=(options:Parameters<typeof fixture>[0]={},config:Record<string,unknown>={})=>{const f=fixture(options);return paperTypographyDiagnostics(f.objects,f.types,f.gui,f.files,config);};
it('compares the actual embedded paper, title-block ratio and legal custom-view scales without rewriting them',()=>{
 const rows=diagnostics();
 expect(rows.find(row=>row.location==='Template'&&row.field==='PaperSize')).toMatchObject({status:'ok',current:'420 × 297 mm'});
 expect(rows.find(row=>row.location==='Template'&&row.field==='scale')).toMatchObject({status:'ok',proposed:'1:1'});
 // A Page-mode view may retain an old stored Scale. Its effective scale is Page.
 expect(rows.find(row=>row.location==='Front'&&row.field==='ScaleType/Scale')).toMatchObject({status:'ok',proposed:'1:1'});
 expect(rows.find(row=>row.location==='Aux'&&row.field==='ScaleType/Scale')).toMatchObject({status:'ok',proposed:'1:2'});
 expect(rows.every(row=>row.status!=='ready')).toBe(true);
});
it('reports an inconsistent title ratio and an unusual local scale as diagnostics, preserving the supplied values',()=>{
 const rows=diagnostics({header:'1:2',auxScale:0.65});
 expect(rows.find(row=>row.location==='Template'&&row.field==='scale')).toMatchObject({status:'conflict',current:'1:2',proposed:'1:1'});
 expect(rows.find(row=>row.location==='Aux'&&row.field==='ScaleType/Scale')).toMatchObject({status:'manual',current:'Custom: 0.65'});
});
it('does not infer millimetres from unitless SVG dimensions',()=>{
 expect(diagnostics({svgWidth:'420'}).find(row=>row.location==='Template'&&row.field==='PaperSize')).toMatchObject({status:'manual'});
});
it('compares the real lowercase font-height field and the diameter leader separately',()=>{
 const rows=diagnostics({height:3.5,style:'Other style'},{dimension_text_height_mm:5});
 expect(rows.find(row=>row.field==='ViewObject.Fontsize')).toMatchObject({status:'conflict',current:'Fontsize=3.5',proposed:'5'});
 expect(rows.find(row=>row.field==='ViewObject.StandardAndStyle')).toMatchObject({status:'manual',proposed:'ISO Referencing'});
});
it('refuses to consider conflicting saved font-height aliases valid',()=>{
 expect(diagnostics({height:5,aliasHeight:3.5}).find(row=>row.field.includes('Fontsize'))).toMatchObject({status:'manual'});
});
it('parses only explicit positive ratios and validates explicit height configuration',()=>{
 expect(parseDrawingRatio('1 ： 2')).toBe(0.5);expect(parseDrawingRatio('2:1')).toBe(2);
 for(const raw of ['0:1','1:0','Scale 1:2','1:2 custom','0.5'])expect(parseDrawingRatio(raw)).toBeUndefined();
 expect(()=>diagnostics({},{dimension_text_height_mm:-5})).toThrow(/毫米字高/);
});
