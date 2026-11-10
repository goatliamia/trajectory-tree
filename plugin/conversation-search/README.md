# 对话搜索 · Conversation search

在 DSH 右侧栏的添加菜单里打开「对话搜索」。它搜索当前会话的全部历史，最近命中的轮次排在前面。点「加载更早的结果」继续往前找。

- 默认搜用户和助手的消息正文。「含工具」同时搜已记录的工具调用和返回。
- 用空格分隔关键词。同一条消息包含所有关键词才会命中。用引号包住完整短语，例如 `"build failed"`。
- 结果按轮次分组，显示命中片段。点击结果会定位对应轮次，必要时加载更早的对话页。

## English

Open **Conversation search** from the add menu in the DSH right sidebar. It searches the full history of the current session, with the newest matching turns first. Select **Load older results** to continue through the history.

- **Messages** searches recorded user and assistant text. **Include tools** adds recorded tool calls and results.
- Separate keywords with spaces to require all of them in the same message. Quote an exact phrase, such as `"build failed"`.
- Select a matching turn to jump to it. The plugin loads older conversation pages when needed.

## 安装 / Install

从仓库根目录运行。Run from the repository root.

~~~sh
npm pack ./plugin/conversation-search
dsh plugin --profile web add ./dsh-conversation-search-0.2.2.tgz
~~~

重启 DSH Web 后在右侧栏打开。Restart DSH Web and open it from the right sidebar.

## 查询接口 / Query API

`GET /conversation-search/search?session=<id>&q=<terms>&scope=chat|all&limit=<n>&before=<turn>`

每页默认 10 个命中轮次。响应中的 `nextBefore` 是下一页的排他游标，`null` 表示已经到最早的结果。`matchedTurns` 和 `totalMatches` 始终统计整段会话。片段中的 `highlights` 是可直接用于原文切片的 `[start, end)` 偏移。

Each page returns 10 matching turns by default. Pass `nextBefore` from the response as the exclusive cursor for the next page. A `null` cursor marks the end. `matchedTurns` and `totalMatches` count the entire session. Excerpt `highlights` are `[start, end)` offsets in the excerpt text.

~~~sh
node --test plugin/conversation-search/self-test.mjs
~~~
