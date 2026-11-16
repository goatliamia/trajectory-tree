// Localize authored UI literals before evidence is interpolated. No DOM walker
// touches rendered user text, filenames, tool output or skill bodies.
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
let parser;
try{parser=require.resolve('acorn');}catch{parser=createRequire(require.resolve('@deepseek-ai/dsh/package.json')).resolve('acorn');}
const {parse}=require(parser);

export function compileUiLiterals(source,{importPath='./ui-locale.js'}={}){
  const ast=parse(source,{ecmaVersion:'latest',sourceType:'module'}),edits=[];
  const han=value=>/[\u3400-\u9fff]/u.test(value??'');
  const semanticMethods=new Set(['get','set','has','delete','includes','startsWith','endsWith','indexOf','lastIndexOf','replace','replaceAll','split','match','matchAll','search']);
  function visit(node,parent,semantic=false){
    if(!node||typeof node!=='object')return;
    const comparison=node.type==='BinaryExpression'&&['===','!==','==','!=','<','>','<=','>=','in'].includes(node.operator);
    const lookup=node.type==='CallExpression'&&node.callee.type==='MemberExpression'&&semanticMethods.has(node.callee.property.name);
    const stable=semantic||comparison||lookup;
    if(!stable&&node.type==='Literal'&&typeof node.value==='string'&&han(node.value)){
      const key=parent?.type==='Property'&&parent.key===node;
      const member=parent?.type==='MemberExpression'&&parent.property===node;
      const modulePath=['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration','ImportExpression'].includes(parent?.type)&&parent.source===node;
      const localized=parent?.type==='CallExpression'&&parent.callee.type==='Identifier'&&['ui','cmUi','__ttUi'].includes(parent.callee.name);
      if(!key&&!member&&!modulePath&&!localized)edits.push({start:node.start,end:node.end,text:'__ttUi('+source.slice(node.start,node.end)+')'});
    }else if(!stable&&node.type==='TemplateLiteral'&&parent?.type!=='TaggedTemplateExpression'&&node.quasis.some(part=>han(part.value.cooked))){
      edits.push({start:node.start,end:node.start,text:'__ttUi'});
    }
    for(const value of Object.values(node)){
      if(Array.isArray(value)){for(const child of value)if(child?.type)visit(child,node,stable);}
      else if(value?.type)visit(value,node,stable);
    }
  }
  visit(ast,null);
  if(!edits.length)return source;
  let result=source;
  for(const edit of edits.sort((a,b)=>b.start-a.start))result=result.slice(0,edit.start)+edit.text+result.slice(edit.end);
  return 'import {ui as __ttUi} from '+JSON.stringify(importPath)+';\n'+result;
}
