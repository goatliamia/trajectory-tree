import assert from 'node:assert/strict';
import vm from 'node:vm';
import {toolVisualFamily,toolBehaviorRuntime,commandIntent} from './tool-behavior.mjs';
import {toolToneIndex,toolColorRuntime} from './tool-colors.mjs';
const examples=[
  [{name:'grep'},'search'],[{name:'Grep'},'search'],[{name:'glob'},'search'],
  [{name:'Read'},'read'],[{name:'read_image'},'read'],[{name:'Edit'},'write'],
  [{name:'WebSearch'},'web'],[{name:'web_fetch'},'web'],
  [{name:'pwsh',args:{command:'rg -n needle src'}},'search'],
  [{name:'Bash',args:{command:'ls src'}},'search'],
  [{name:'shell',args:{command:'npm test'}},'command'],
  [{name:'pwsh',args:{command:'Write-Output "rg --files"'}},'command'],
  [{name:'shell',args:{command:'node -e "console.log(\"grep\")"'}},'command'],
  [{name:'run_code',args:{code:'await tools.read({path:"a"})'}},'command'],
  [{name:'cua_repl/js',classification:{family:'application',kind:'other'}},'application'],
  [{name:'database/query',classification:{kind:'query'}},'search'],
  [{name:'unknown-plugin'},'other'],[{name:'write_stdin'},'process'],[{name:'Task'},'coordination'],
];
const runtime=vm.createContext({});vm.runInContext(toolBehaviorRuntime()+toolColorRuntime(),runtime);
for(const [call,family] of examples){assert.equal(toolVisualFamily(call),family);assert.equal(runtime.__trajectoryToolFamily(call),family);}
for(const [alias,name] of [['Read','read'],['Grep','grep'],['Bash','bash'],['WebFetch','web_fetch']])assert.equal(toolToneIndex(alias),toolToneIndex(name));
assert.equal(commandIntent('rg --files src').tool,'glob');
assert.equal(commandIntent('rg -n needle src').tool,'grep');
assert.equal(commandIntent('rg "needle --files " src').tool,'grep');
assert.equal(commandIntent('Write-Output \'pwsh -Command "rg needle src"\'').family,'command');
assert.equal(commandIntent('"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -NoProfile -Command "rg --files src"').tool,'glob');
console.log('Tool presentation: local/web/read/write/command/application/unknown and host aliases agree in Node and browser runtime.');
