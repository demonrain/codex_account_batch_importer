# Codex Account Batch Importer

一个本地可视化账号管理工具，用来批量读取、测活、去重并导入 Codex/OpenAI 账号数据。

它的设计目标是最简用法：

- 不依赖数据库
- 不启动或托管目标平台
- 不保存 Admin Token
- 直接通过本地页面完成批量操作

当前支持三种目标平台：

- `Sub2API`
- `CPA`
- `Cockpit`

其中：

- `Sub2API` 走真实导入接口
- `CPA` 走真实管理接口上传 auth 文件
- `Cockpit` 当前走兼容 JSON 导出，不做远程直传

## 功能概览

- 可视化页面，直接在浏览器操作
- 支持读取本地 JSON 目录
- 支持手动选择多个 JSON 文件
- 支持从剪切板粘贴 JSON、session、token 文本
- 自动纠正常见账号格式并标准化字段
- 先测活，再导入正常账号
- 去重按真实身份字段判断，不按 `name` 判断
- 可搜索、全选、取消选择
- 可按平台切换导入方式
- 本地代理转发请求，绕过浏览器 CORS 限制
- Admin Token 只存在当前页面输入框，不写入本地存储

## 页面流程

页面按三个步骤工作：

1. 连接目标平台
2. 读取账号数据
3. 测活、去重与导入

推荐工作流固定为：

1. 选择目标平台
2. 填写 API 地址和 Admin Token
3. 读取本地账号 JSON，或者直接粘贴账号内容
4. 检查解析结果和去重状态
5. 点击 `测活选中账号`
6. 确认正常账号数量
7. 点击导入，只导入测活正常的账号

## 快速开始

### 运行要求

- Python `3.8+`
- 现代浏览器，推荐 `Chrome` 或 `Edge`

运行页面本身不需要 Node.js。

Node.js 只用于本地测试 `health.js`。

### 启动服务

在项目目录执行：

```powershell
cd <project-folder>
python server.py
```

如果你的环境用 `py` 启动 Python：

```powershell
cd <project-folder>
py server.py
```

看到下面这行输出，说明本地服务已启动：

```text
Account batch importer: http://127.0.0.1:5177
```

### 访问页面

浏览器打开：

```text
http://127.0.0.1:5177
```

## 最简用法

### Sub2API

只需要两项核心配置：

- `API 接口地址`
- `Admin Token`

建议填写：

```text
http://127.0.0.1:8080/api/v1
```

如果你填的是服务根地址，例如：

```text
http://127.0.0.1:8080
```

工具会自动补成：

```text
http://127.0.0.1:8080/api/v1
```

然后：

1. 读取账号数据
2. 测活
3. 导入正常账号

### CPA

只需要：

- `API 接口地址`
- `Admin Token`

默认接口示例：

```text
http://127.0.0.1:8082
```

默认导入路径：

```text
/v0/management/auth-files
```

CPA 模式默认使用 `Authorization: Bearer`。

### Cockpit

Cockpit 当前不要求远程 API。

你只需要：

1. 读取账号数据
2. 测活
3. 点击导入按钮

此时页面会下载一个兼容 Cockpit 的 JSON 导出文件，默认文件名为：

```text
cockpit_codex_export.json
```

## 配置说明

### 页面配置项

- `目标平台`
  - `Sub2API`
  - `CPA`
  - `Cockpit`
- `API 接口地址`
  - 目标平台的管理接口地址
- `Admin Token`
  - 当前页面输入使用
- `鉴权头`
  - `Authorization: Bearer`
  - `x-api-key`
- `自定义导入路径`
  - 不填就使用平台默认路径
- `并发数`
  - 用于本地测活和部分导入参数
- `优先级`
  - 仅 `Sub2API` 使用
- `分组 ID`
  - 仅 `Sub2API` 使用
- `更新已存在账号`
  - 仅 `Sub2API` 使用
- `跳过默认分组绑定`
  - 仅 `Sub2API` 使用
- `过期自动暂停`
  - 仅 `Sub2API` 使用

### Admin Token 在哪里配置

这个项目本身不生成、不保存 Admin Token。

在本工具里，Admin Token 的配置位置只有一个：

- 页面顶部的 `Admin Token` 输入框

也就是说，本工具不需要额外改代码、不需要改配置文件、不需要数据库。

目标平台自己的管理员 token 或 API key 由你已有的服务负责提供。

### 保存配置会保存什么

点击 `保存配置` 后，只保存以下非敏感配置：

- 目标平台
- API 地址
- 鉴权方式
- 自定义路径
- 并发数
- 优先级
- 分组 ID
- Sub2API 相关开关

不会保存：

- `Admin Token`

## 支持的输入格式

页面支持两类输入来源：

- 本地 JSON 文件
- 剪切板粘贴内容

### 支持的粘贴内容

支持下面这些格式：

- 单个 JSON 对象
- JSON 数组
- NDJSON
- Markdown 代码块里的 JSON
- `session JSON`
- `auth.json`
- 账号导出 JSON
- `Sub2API` 导出包
- 单独一行 `access_token`
- 单独一行 `refresh_token`

例如下面这些都可以：

```json
{"email":"a@example.com","access_token":"token-a"}
```

```json
[
  {"email":"a@example.com","access_token":"token-a"},
  {"email":"b@example.com","access_token":"token-b"}
]
```

```text
{"email":"a@example.com","access_token":"token-a"}
{"email":"b@example.com","access_token":"token-b"}
1//refresh-only-token
```

````text
```json
{"email":"a@example.com","access_token":"token-a"}
```
````

### 支持的账号字段

工具会自动识别这些字段或其常见变体：

- `access_token`
- `refresh_token`
- `id_token`
- `email`
- `account_id`
- `user_id`
- `chatgpt_account_id`
- `chatgpt_user_id`
- `expires_at`
- `tokens.access_token`
- `tokens.refresh_token`
- `tokens.id_token`

如果 token 是 JWT，工具还会尝试从 token payload 里补出：

- `email`
- `chatgpt_account_id`
- `chatgpt_user_id`

### 缺少 access_token 的处理

如果一条记录只有 `refresh_token`、没有 `access_token`，它仍然会被解析出来，但会显示为：

- `缺少 access token`

这种记录不会进入可导入列表，也不会通过测活。

## 去重规则

账号去重不按显示名 `name` 判断。

去重顺序是：

1. `chatgpt_account_id` / `account_id`
2. `chatgpt_user_id` / `user_id`
3. `email`
4. `access token` 指纹

所以：

- 同名账号不一定重复
- 只要真实身份字段不同，就会被视为不同账号

## 平台行为

### Sub2API

默认导入路径：

```text
/admin/accounts/import/codex-session
```

页面会调用本地代理：

```text
POST /proxy/admin/accounts/import/codex-session
```

本地代理再转发到你填写的 Sub2API 地址。

请求体格式：

```json
{
  "contents": ["<json>", "<json>"],
  "group_ids": [1, 2],
  "concurrency": 3,
  "priority": 50,
  "update_existing": true,
  "skip_default_group_bind": false,
  "auto_pause_on_expired": true,
  "confirm_mixed_channel_risk": true
}
```

### CPA

默认导入路径：

```text
/v0/management/auth-files
```

页面会调用本地代理：

```text
POST /proxy-upload/v0/management/auth-files
```

本地代理会把每个正常账号转成一个 auth JSON 文件，并以 `multipart/form-data` 上传。

每个文件内容类似：

```json
{
  "type": "codex",
  "email": "user@example.com",
  "access_token": "xxx",
  "refresh_token": "xxx",
  "id_token": "xxx",
  "account_id": "acc-xxx",
  "expired": "2026-06-10T00:00:00.000Z",
  "last_refresh": "2026-06-09T10:00:00.000Z"
}
```

### Cockpit

Cockpit 当前不走远程导入接口。

点击导入后，页面会把正常账号导出成兼容 JSON，并自动下载。

当前导出内容基于 `Sub2API` 兼容包结构，方便后续给 Cockpit 工具链使用。

## 测活说明

### 默认行为

测活通过本地接口：

```text
POST /health-check
```

本地服务会对选中账号的 `access_token` 发起一个轻量的 Codex 响应流请求，检查是否能正常完成。

识别到这些事件会判定为成功：

- `response.completed`
- `response.done`
- `[DONE]`

只有测活成功的账号，才会进入最终导入。

### 默认上游地址

默认测活地址：

```text
https://chatgpt.com/backend-api/codex/responses
```

默认模型：

```text
gpt-5.4
```

### 可选环境变量

如果你需要改测活地址或模型，可以在启动前设置：

```powershell
$env:CODEX_HEALTH_URL="https://chatgpt.com/backend-api/codex/responses"
$env:CODEX_TEST_MODEL="gpt-5.4"
python server.py
```

也可以覆盖 `User-Agent`：

```powershell
$env:CODEX_USER_AGENT="custom-user-agent"
python server.py
```

### 常见测活失败原因

- `access_token` 已过期
- 账号被风控或不可用
- 当前网络无法访问上游
- 上游返回鉴权失败或限流
- 只有 `refresh_token`，没有 `access_token`

## 本地代理说明

`server.py` 提供三类能力：

- 托管静态页面
- 转发 JSON 导入请求
- 转发 multipart 上传请求
- 执行本地测活

对应路由：

- `GET /`
- `POST /proxy/...`
- `POST /proxy-upload/...`
- `POST /health-check`

服务默认只监听：

```text
127.0.0.1:5177
```

## 停止服务

在运行 `python server.py` 的终端里按：

```text
Ctrl + C
```

如果端口被占用，可以先查看占用进程：

```powershell
netstat -ano | findstr :5177
```

再结束对应 PID：

```powershell
taskkill /PID <PID> /F
```

## 开发与测试

### 本地测试命令

`health.js` 的单元测试：

```powershell
node --test .\health.test.js
```

检查前端脚本语法：

```powershell
node --check .\app.js
```

检查 Python 语法：

```powershell
python -m py_compile .\server.py
```

检查仓库里是否泄露本机绝对路径：

```powershell
rg -n "[A-Za-z]:\\\\[^\"'\\s]+" .
```

## 项目结构

```text
<project-folder>
├── app.js
├── health.js
├── health.test.js
├── index.html
├── README.md
├── server.py
└── styles.css
```

各文件职责：

- `index.html`
  - 页面结构
- `styles.css`
  - 页面样式
- `app.js`
  - 页面交互、导入逻辑、粘贴解析、结果展示
- `health.js`
  - 平台预设、账号规范化、去重、导入 payload 构造
- `health.test.js`
  - 关键逻辑测试
- `server.py`
  - 静态服务、本地代理、测活接口

## 常见问题

### 是否需要数据库

不需要。

这个项目只是本地可视化页面和代理层，不负责持久化账号。

账号最终存到哪里，由目标平台自己决定。

### 为什么要启动 `server.py`

因为页面不只是静态 HTML。

它还负责：

- 本地托管页面
- 代理导入请求
- 执行测活
- 处理浏览器 CORS 限制

直接双击打开 `index.html` 不属于推荐用法。

### 剪切板读取失败怎么办

浏览器可能会要求授权读取剪切板。

如果浏览器拦截，可以直接手动粘贴到页面文本框，然后点击 `解析粘贴内容`。

### Cockpit 为什么不是直接导入

当前实现按现有兼容导出格式处理，更稳，也更容易和已有工具链对接。

如果后续确认 Cockpit 有稳定远程导入 API，可以再扩展为直传模式。

### 同名账号为什么没有被判定为重复

因为重复判断不看 `name`，只看真实身份字段。

这是刻意设计，用来避免“名称一样但实际不是同一个账号”的误判。

## 安全说明

- 本工具不保存 Admin Token
- 账号 JSON 只在本地页面和你指定的平台之间流转
- 不建议把这个工具直接暴露到公网
- 不建议把 Admin Token 写进源码、脚本或仓库
- 如果用于多人环境，建议自行增加访问控制和 HTTPS
