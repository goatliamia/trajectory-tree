// A small literal reader, not an evaluator. Calls, IO and arbitrary expressions
// remain unknown. It only recovers model-facing data already present in source.
export const STATIC_UNKNOWN = Symbol('static-unknown');

export function staticReader(ast, parents, walk, options = {}) {
  const bindings = new Map(), defaults = {};
  const scope = node => { while (node && !['Program','BlockStatement','FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(node.type)) node=parents.get(node);return node; };
  walk(ast,node=>{
    if(node.type==='VariableDeclarator'&&node.id.type==='Identifier'){
      if(!bindings.has(node.id.name))bindings.set(node.id.name,[]);
      bindings.get(node.id.name).push({node:parents.get(node)?.kind==='const'?node.init:null,scope:scope(parents.get(parents.get(node))),at:node.start});
    }
    if(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(node.type)){
      for(const param of node.params){
        const name=param.type==='Identifier'?param.name:param.type==='AssignmentPattern'&&param.left.type==='Identifier'?param.left.name:null;
        if(!name)continue;if(!bindings.has(name))bindings.set(name,[]);
        bindings.get(name).push({node:null,scope:node,at:node.start});
      }
    }
  });
  const stack=new Set();
  function read(node, at = node) {
    if(!node)return STATIC_UNKNOWN;
    if(stack.has(node))return STATIC_UNKNOWN;
    stack.add(node);
    try{return value(node,at);}finally{stack.delete(node);}
  }
  function value(node,at){
    if(node.type==='Literal')return node.regex?STATIC_UNKNOWN:node.value;
    if(node.type==='Identifier'){
      if(node.name==='undefined')return undefined;
      if(node.name==='config')return {...defaults,...options.config};
      if(Object.hasOwn(options.variables??{},node.name))return options.variables[node.name];
      for(let ancestor=at;ancestor;ancestor=parents.get(ancestor)){
        const available=(bindings.get(node.name)??[]).filter(row=>row.scope===ancestor);
        if(available.length)return available.length===1&&available[0].at<at.start?read(available[0].node,available[0].node):STATIC_UNKNOWN;
      }
      return STATIC_UNKNOWN;
    }
    if(node.type==='TemplateLiteral'){
      const parts=node.expressions.map(expression=>read(expression,at));if(parts.includes(STATIC_UNKNOWN))return STATIC_UNKNOWN;
      return node.quasis.map((quasi,index)=>quasi.value.cooked+(index<parts.length?String(parts[index]):'')).join('');
    }
    if(node.type==='ArrayExpression'){
      const result=node.elements.map(item=>read(item,at));return result.includes(STATIC_UNKNOWN)?STATIC_UNKNOWN:result;
    }
    if(node.type==='ObjectExpression'){
      const result={};for(const field of node.properties){
        if(field.type==='SpreadElement'){const source=read(field.argument,at);if(!source||source===STATIC_UNKNOWN||typeof source!=='object')return STATIC_UNKNOWN;Object.assign(result,source);continue;}
        if(field.type!=='Property'||field.kind!=='init'||field.method)return STATIC_UNKNOWN;
        const key=field.computed?read(field.key,at):field.key.name??field.key.value,entry=read(field.value,at);
        if(key===STATIC_UNKNOWN||entry===STATIC_UNKNOWN)return STATIC_UNKNOWN;result[key]=entry;
      }return result;
    }
    if(node.type==='MemberExpression'){
      const object=read(node.object,at),key=node.computed?read(node.property,at):node.property.name;
      if(object===STATIC_UNKNOWN||object==null||key===STATIC_UNKNOWN||!Object.hasOwn(object,key))return STATIC_UNKNOWN;
      return object[key];
    }
    if(node.type==='UnaryExpression'){
      const argument=read(node.argument,at);if(argument===STATIC_UNKNOWN)return STATIC_UNKNOWN;
      if(node.operator==='!')return !argument;if(node.operator==='-')return -argument;if(node.operator==='+')return +argument;if(node.operator==='void')return undefined;
    }
    if(node.type==='BinaryExpression'||node.type==='LogicalExpression'){
      const left=read(node.left,at);if(left===STATIC_UNKNOWN)return STATIC_UNKNOWN;
      if(node.operator==='??')return left??read(node.right,at);if(node.operator==='||')return left||read(node.right,at);if(node.operator==='&&')return left&&read(node.right,at);
      const right=read(node.right,at);if(right===STATIC_UNKNOWN)return STATIC_UNKNOWN;
      switch(node.operator){case '+':return left+right;case '-':return left-right;case '*':return left*right;case '/':return left/right;case '===':return left===right;case '!==':return left!==right;case '<':return left<right;case '>':return left>right;}
    }
    if(node.type==='ConditionalExpression'){const test=read(node.test,at);return test===STATIC_UNKNOWN?STATIC_UNKNOWN:read(test?node.consequent:node.alternate,at);}
    if(node.type==='ArrowFunctionExpression'){
      if(node.body.type!=='BlockStatement')return read(node.body,node.body);
      if(node.body.body.length===1&&node.body.body[0].type==='ReturnStatement')return read(node.body.body[0].argument,node.body);
    }
    if(node.type==='CallExpression'&&node.callee.type==='MemberExpression'){
      const member=node.callee.property.name;
      if(member==='freeze'&&node.callee.object.type==='Identifier'&&node.callee.object.name==='Object')return read(node.arguments[0],at);
      if(member==='join'){
        const array=read(node.callee.object,at),separator=node.arguments.length?read(node.arguments[0],at):',';
        if(Array.isArray(array)&&separator!==STATIC_UNKNOWN)return array.join(separator);
      }
    }
    return STATIC_UNKNOWN;
  }
  // Config schema defaults are literals; no schema method is invoked here.
  walk(ast,node=>{
    if(node.type!=='Property'||node.value?.type!=='CallExpression'||node.value.callee?.type!=='MemberExpression'||node.value.callee.property.name!=='default')return;
    let declaration=node;while(declaration&&!['VariableDeclarator','PropertyDefinition'].includes(declaration.type))declaration=parents.get(declaration);
    if(!declaration||!/^Config\b/.test(declaration.id?.name??declaration.key?.name??''))return;
    const key=node.key.name??node.key.value,entry=read(node.value.arguments[0]);if(entry!==STATIC_UNKNOWN&&typeof key==='string')defaults[key]=entry;
  });
  return read;
}
