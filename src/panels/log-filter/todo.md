1. field 部分，可以一边输入，一边查询可能的 field_name
2. adhoc filter，应该要能够响应事件。当 log 中点击 + - 时，UI 界面中体现 adhoc 查询的内容
3. 配置功能：
  - 可以配置 logsql 的文本框是否展示
  - 可以配置展示哪些 stream field
  - 可以配置 stream field 的顺序
  - 选项：stream filed 的级联查询：选择第一个后，第二个的值跟着变
  - last_char 等支持：提供脚本，我选择 A 字段时，对 A 字段进行加工，然后关联到 B = func(A)
4. 输出选项:
  - 选择字段：哪些字段输出
5. 状态的保持：
  - 折叠再展开后，出现重新加载的情况

  