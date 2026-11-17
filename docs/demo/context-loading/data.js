/* Illustrative content only. The order below is an explanatory sequence,
   not a claim about DSH's native prompt serialization or a live request. */
window.CONTEXT_LOADING_SAMPLE = {
  capacity: 128000,
  origins: [
    {id:'official',name:'DSH 官方',note:'宿主与内置插件'},
    {id:'plugin',name:'用户插件',note:'工具、目录与提示'},
    {id:'personal',name:'个人与项目',note:'指令、Skill 与输入'}
  ],
  groups: [
    {id:'system',name:'系统基底',short:'系统',kind:'系统提示',note:'身份、工作方式与运行边界。',loading:'随预设组装',items:[
      {id:'identity',name:'身份与基本行为',origin:'official',tokens:1280,source:'dsh-persona',text:'说明 Agent 的职责、沟通方式与任务推进原则。'},
      {id:'safety',name:'运行约束',origin:'official',tokens:340,source:'系统提示插件',text:'提供当前运行环境所需的操作边界。'}]},
    {id:'tools',name:'能力接口',short:'工具',kind:'工具定义',note:'模型可调用的名称、用途与参数。',loading:'由有效工具声明提供',items:[
      {id:'command',name:'命令执行',origin:'official',tokens:650,source:'内置工具插件',text:'执行命令的参数、运行位置和返回约定。'},
      {id:'read-file',name:'文件读取',origin:'official',tokens:470,source:'内置工具插件',text:'读取文件内容与指定行范围。'},
      {id:'edit-file',name:'文件编辑',origin:'official',tokens:360,source:'内置工具插件',text:'按已观察内容修改文件。'},
      {id:'trace-inspect',name:'trajectory_inspect',origin:'plugin',tokens:540,source:'轨迹树插件',text:'查询会话在指定切点的执行、工具和上下文统计。'},
      {id:'lookup',name:'资料检索',origin:'plugin',tokens:680,source:'检索插件',text:'检索已连接的资料来源，返回可追读的位置。'}]},
    {id:'catalog',name:'Skill 目录',short:'目录',kind:'名称与描述',note:'先让模型知道有哪些方法。',loading:'目录随请求提供；正文按需读取',items:[
      {id:'trace-skill',name:'trace-analysis',origin:'plugin',tokens:180,bodyTokens:2840,source:'轨迹树插件',text:'分析一次任务的行动、反馈、后续处理和实际结果。这里只计名称与目录描述。'},
      {id:'profile-skill',name:'context-profile',origin:'plugin',tokens:150,bodyTokens:2160,source:'轨迹树插件',text:'核对上下文和工具供给的职责、加载位置、重复及缺口。这里只计目录描述。'},
      {id:'project-skill',name:'项目工作方法',origin:'personal',tokens:210,bodyTokens:1320,source:'.agents/skills/',text:'项目约定的工作步骤与检查方法。正文尚未读取。'}]},
    {id:'instructions',name:'适用指令',short:'指令',kind:'个人与项目规则',note:'沿当前工作目录发现适用的规则。',loading:'按个人与项目目录链发现',items:[
      {id:'global-rules',name:'个人 AGENTS.md',origin:'personal',tokens:520,source:'个人指令链',text:'适用于当前用户各项目的工作偏好与通用约定。'},
      {id:'project-rules',name:'项目 AGENTS.md',origin:'personal',tokens:740,source:'项目根 → 工作目录',text:'适用于当前目录的项目说明。更深目录的规则等待对应文件访问。'}]},
    {id:'runtime',name:'环境补充',short:'环境',kind:'当前运行信息',note:'工作目录、平台与当前执行条件。',loading:'按当前环境组装',items:[
      {id:'environment',name:'平台与工作目录',origin:'official',tokens:180,source:'运行时提供者',text:'当前平台、工作目录与可用执行环境。'},
      {id:'runtime-state',name:'会话运行信息',origin:'official',tokens:140,source:'运行时提供者',text:'与当前会话有关的动态状态。这里仅展示已组装的示例内容。'}]},
    {id:'user',name:'用户输入',short:'输入',kind:'当前任务',note:'这一次请求需要完成的工作。',loading:'随当前用户消息加入',items:[
      {id:'user-message',name:'当前任务消息',origin:'personal',tokens:240,source:'用户消息',text:'了解项目的上下文构成，并找出可以改善的装填方式。'}]}
  ]
};
