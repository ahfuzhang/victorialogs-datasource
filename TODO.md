1 修改 stream filter 后：
  1.1 写入到一个全局 map
  1.2 放一个 <textarea>, 在里面构造 logsQL
  1.3 根据 stream filter，拉取对应的 field
2 field 部分
  2.1 选择 field
  2.2 拉取 100 条 field value，猜测数据类型
  2.3 根据数据类型，出现对应的 operator
  2.4 选择 field value
3 查询选项部分
4 查询输出部分

