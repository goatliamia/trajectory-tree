# PowerShell 命令诊断

围绕同一次调用和配对的返回，定位问题发生在宿主、PowerShell、子程序还是输出传递。保留原任务对结果的要求。一次搜索未命中可能已回答探测问题，是否造成返工要看后续动作。

## 确认执行链

从记录核对实际执行器、调用方式、工作目录、参数和返回。通用命令工具可能包装多种 shell。先用记录中的 `powershell.exe` 或 `pwsh` 区分执行器，再用记录里的 `$PSVersionTable` 或宿主配置确认具体版本。嵌套 `-Command` 或调用 `.cmd` 时，查清每一层收到的参数。

- **语法和参数**。运行时的 `ParserError`、`FullyQualifiedErrorId` 和参数绑定错误可指到具体阶段。有原始脚本和匹配的解析器时，用静态解析补行列。静态结果说明脚本如何解析，实际参数绑定和外部程序收到的参数要靠运行时证据。涉及含空格的路径、逗号和引号时，先核对参数边界。PowerShell 7.3 起的原生命令传参方式与 Windows PowerShell 5.1 有区别，涉及嵌套引号时按实测版本核对。 [Microsoft PowerShell 解析规则](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_parsing?view=powershell-7.5)
- **退出状态**。先确定数字来自宿主、PowerShell 进程还是子程序。`-Command` 可以把不同的子程序非零状态归并成外层 `1`。检查 `exit`、后续命令、管道和错误处理是否改变了最终状态。`$?` 是最近命令的成功状态，`$LASTEXITCODE` 记录最近一次更新它的原生命令或脚本的退出码。把它与具体子程序绑定，优先用该调用后立即捕获的值或对应的进程结果。脚本末尾是 `rg` 且只有外层 `1` 时，将未命中保留为候选，结合子程序输出和本次搜索目的核对。 [PowerShell 7 启动参数](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_pwsh?view=powershell-7.5) · [Windows PowerShell 5.1 启动参数](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_powershell_exe?view=powershell-5.1) · [PowerShell 自动变量](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_automatic_variables?view=powershell-7.5)
- **环境和返回**。遇到找不到路径或命令、访问受阻、文件占用时，分别检查实际目录、命令解析结果和对应的错误记录。空返回先查静默选项、管道过滤、重定向和截断。遇到 `Get-Command -ErrorAction SilentlyContinue`，检查原调用是否在做存在性探测。`Start-Process` 带 `-RedirectStandardOutput` 或 `-RedirectStandardError` 时，沿记录的目标文件找输出。子进程结果要和对应进程配对。只记录了合并输出或外层状态时，指出还缺哪一项证据。

## 改法与验证

先说明需要保留的行为，例如搜索原来的两个文件，允许探测未命中，仍能看见路径或表达式错误。依据已确认的失败层，选一处小改法，在相同执行器和目录下验证。

- **参数断开或路径被重新解释**。把每个完整路径放进数组并单独传入。比如逗号处报 `MissingArgument` 的字面搜索，可将路径放进 `$paths`，用 `rg -n -F -e $needle -- @paths`。接受 `-LiteralPath` 的 PowerShell cmdlet 可用它保留路径里的通配符字符。核对收到的每个参数，至少用一个含空格的路径复查。多层引号反复出错时，项目自有脚本可改用 `-File` 和独立的标量参数传数据。 [PowerShell 参数展开](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_splatting?view=powershell-7.5)
- **条件执行跨版本**。需要兼容 Windows PowerShell 5.1 时，把 `&&` 或 `||` 的两侧拆开，并在前一步结束后立即检查 `$?` 或该原生命令的退出码，按原条件决定是否执行后一步。分别用一次前置成功和失败验收后续动作与最终状态。 [PowerShell 条件管道](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_pipeline_chain_operators?view=powershell-7.5)
- **子程序状态被覆盖**。在项目自有脚本中紧接原生命令保存 `$LASTEXITCODE`。调用约定需要透传时，用保存的状态退出。普通 `rg` 搜索用子程序的 `0`、`1`、`2` 区分命中、未命中和错误。允许未命中时给它单独分支，并保留真正错误的状态和诊断。分别验证有匹配、无匹配和输入错误三种结果。 [ripgrep 退出状态实现](https://github.com/BurntSushi/ripgrep/blob/master/crates/core/main.rs#L88-L94)
- **输出没到调用方**。同步命令可直接用 `& $exe @toolArgs` 让输出进入工具记录。确实需要单独启动时，可用 `Start-Process -Wait -PassThru` 等待并读取该进程的 `ExitCode`，同时核对重定向的两个目标。用一个能分别产生标准输出和标准错误的最小样例，验证日志或对应文件能回查这两类输出。 [PowerShell Start-Process](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.management/start-process?view=powershell-5.1)

把原记录、具体改法和验收条件放在一起。证据还不足时，给出下一条要查的记录或无副作用的最小验证。同组混有不同执行器或失败阶段时，先分样本再归因。宿主的工具语义、权限和保护机制作为约束，建议落在用户可调整的调用、工作流程或项目自有脚本上。
