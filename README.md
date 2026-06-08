# Sub2API 账号批量管理工具

一个用于批量导入和管理 Sub2API 账号的本地可视化工具。它面向最简使用场景：打开网页、选择本机账号 JSON 文件、填写 Sub2API API 地址和 Admin Token，然后调用 Sub2API 管理接口完成批量导入。

本项目不包含数据库、不启动 Sub2API 服务，也不保存 Admin Token。数据库、账号存储、任务执行都由你已有的 Sub2API 服务负责。

## 功能特性

- 可视化选择本机账号 JSON 目录中的文件。
- 支持 Chrome / Edge 直接选择目录。
- 支持不兼容目录选择的浏览器手动选择多个 JSON 文件。
- 本地解析 JSON，预览文件名、邮箱、账号 ID、Token 状态和过期时间。
- 自动过滤缺少 `access_token` 的文件，避免误导入。
- 支持对待导入账号做测活，统计当前正常账号数量。
- 支持只导入测活正常的账号。
- 账号去重按真实身份字段判断，不按显示名称 `name` 判断。
- 支持搜索、全选可导入、清空选择。
- 支持配置并发数、账号优先级、分组 ID、是否更新已存在账号、是否跳过默认分组、过期是否自动暂停。
- 通过本地 Python 服务转发请求，绕过浏览器 CORS 限制。
- Admin Token 只保存在当前输入框中，不写入 localStorage。

## 目录结构

```text
<project-folder>
├── app.js       # 页面交互、JSON 解析、批量导入请求
├── index.html   # 可视化操作页面
├── README.md    # 项目说明和部署使用文档
├── server.py    # 本地静态服务和 Sub2API 请求转发代理
└── styles.css   # 页面样式
```

## 运行环境

- Windows 10 / Windows 11。
- Python 3.8 或更高版本。
- Chrome 或 Edge 浏览器。
- 一个已经部署并可访问的 Sub2API 服务。
- Sub2API 的 Admin Token。
- 待导入账号 JSON 文件目录。

检查 Python：

```powershell
python --version
```

如果命令不可用，可以尝试：

```powershell
py --version
```

## 快速启动

在 PowerShell 中执行：

```powershell
cd <project-folder>
python server.py
```

如果你的系统使用 `py` 启动 Python：

```powershell
cd <project-folder>
py server.py
```

看到下面输出表示本地页面服务已经启动：

```text
Sub2API account tool: http://127.0.0.1:5177
```

然后在浏览器访问：

```text
http://127.0.0.1:5177
```

## 页面配置

页面只需要两个核心配置：

- `API 接口地址`
- `Admin Token`

### API 接口地址

填写你的 Sub2API API 地址，例如：

```text
http://127.0.0.1:8080/api/v1
```

如果你填写的是服务根地址：

```text
http://127.0.0.1:8080
```

工具会自动补成：

```text
http://127.0.0.1:8080/api/v1
```

如果 Sub2API 部署在其他机器上，填写那台机器的地址，例如：

```text
http://192.168.0.129:8080/api/v1
```

### Admin Token

Admin Token 不在本工具的配置文件里配置，而是在页面的 `Admin Token` 输入框里填写。

这个 Token 来自你已有的 Sub2API 服务，一般有两种方式：

- 后台登录后拿到的管理员 JWT，页面里的 `Token 发送方式` 选择 `Authorization: Bearer`。
- 后台生成的 Admin API Key，页面里的 `Token 发送方式` 选择 `x-api-key`。

本工具不会保存 Admin Token。点击 `保存配置` 时，只保存 API 地址、发送方式、并发数、优先级等非敏感配置。

## 导入账号

1. 启动本地服务并打开 `http://127.0.0.1:5177`。
2. 填写 `API 接口地址`。
3. 填写 `Admin Token`。
4. 选择正确的 `Token 发送方式`。
5. 根据需要设置 `账号并发`、`账号优先级`、`分组 ID` 等选项。
6. 点击 `选择 accounts 目录`，选择你的账号 JSON 文件目录。
7. 如果浏览器不支持目录选择，点击 `选择多个 JSON 文件`。
8. 在表格中检查文件状态。
9. 点击 `测活选中账号`，等待正常/异常结果。
10. 点击 `导入正常账号`，工具只会提交测活正常的账号。
11. 在页面下方查看导入结果。

## 测活说明

测活发生在本机 `server.py` 提供的 `/health-check` 接口中。页面会把选中账号的 `access_token` 发送给本机服务，本机服务再请求 OpenAI/Codex 上游做轻量验证。

测活通过后，表格中的 `测活` 列会显示 `正常`。导入按钮只会导入这些正常账号。

测活失败常见原因：

- `access_token` 已过期。
- 账号本身不可用。
- 当前机器无法访问上游。
- 上游返回限流、风控或鉴权错误。

测活请求默认访问：

```text
https://chatgpt.com/backend-api/codex/responses
```

如果你的网络或测试环境需要改上游地址，可以在启动前设置环境变量：

```powershell
$env:CODEX_HEALTH_URL="https://chatgpt.com/backend-api/codex/responses"
python server.py
```

也可以指定测活模型：

```powershell
$env:CODEX_TEST_MODEL="gpt-5.4"
python server.py
```

## 去重说明

本工具不会因为账号显示名称 `name` 相同就判定重复。

重复判断顺序为：

- `chatgpt_account_id`
- `chatgpt_user_id`
- `user_id`
- `email`
- `access_token` 指纹

因此多个账号都叫同一个 `name`，只要真实身份字段不同，就会被视为不同账号。

## JSON 文件要求

工具会读取 `.json` 文件并尝试识别下面字段：

```json
{
  "access_token": "xxx",
  "refresh_token": "xxx",
  "id_token": "xxx",
  "email": "user@example.com",
  "account_id": "account-id",
  "user_id": "user-id",
  "expires_at": "2026-06-08T12:00:00Z"
}
```

也支持部分常见变体字段：

- `accessToken`
- `refreshToken`
- `idToken`
- `tokens.access_token`
- `tokens.accessToken`
- `tokens.refresh_token`
- `tokens.refreshToken`
- `tokens.id_token`
- `tokens.idToken`
- `user.email`
- `account.id`
- `user.id`

判断是否可导入的最低要求是存在 `access_token`。

## 实际调用接口

导入时页面通过本地代理调用 Sub2API：

```text
POST http://127.0.0.1:5177/proxy/admin/accounts/import/codex-session
```

本地代理会转发到你的 Sub2API：

```text
POST <API 接口地址>/admin/accounts/import/codex-session
```

如果页面填写：

```text
http://127.0.0.1:8080/api/v1
```

最终请求就是：

```text
POST http://127.0.0.1:8080/api/v1/admin/accounts/import/codex-session
```

请求体格式：

```json
{
  "contents": ["<json file content>"],
  "group_ids": [],
  "concurrency": 3,
  "priority": 50,
  "update_existing": true,
  "skip_default_group_bind": false,
  "auto_pause_on_expired": true,
  "confirm_mixed_channel_risk": true
}
```

Token 发送方式二选一：

```http
Authorization: Bearer <Admin Token>
```

或：

```http
x-api-key: <Admin Token>
```

## 本地代理说明

浏览器直接请求 Sub2API 时可能遇到 CORS 跨域限制，所以本项目使用 `server.py` 同时提供两个能力：

- 托管 `index.html`、`styles.css`、`app.js`。
- 接收 `/proxy/...` 请求，并转发到你填写的 Sub2API API 地址。
- 接收 `/health-check` 请求，并对待导入账号做本机测活。

代理只监听本机：

```text
127.0.0.1:5177
```

它不会把页面暴露给局域网其他机器。

## 停止服务

在运行 `python server.py` 的 PowerShell 窗口中按：

```text
Ctrl + C
```

如果端口被占用，可以先找出占用进程：

```powershell
netstat -ano | findstr :5177
```

然后按 PID 结束进程：

```powershell
taskkill /PID <PID> /F
```

## 常见问题

### 是否需要配置数据库？

不需要。

本工具只是一个本地可视化导入页面，它不保存账号数据。账号最终保存到哪里，由你已有的 Sub2API 服务决定。

### Admin Token 在哪里配置？

在页面的 `Admin Token` 输入框配置。

项目文件里没有 Admin Token 配置项，也不建议把 Admin Token 写进代码或 README。

### 为什么要启动 `server.py`？

直接双击打开 `index.html` 时，浏览器可能因为 CORS、文件权限或目录选择能力限制导致请求失败。`server.py` 提供本地网页服务和请求转发代理，是推荐启动方式。

### 选择目录按钮不可用怎么办？

请使用 Chrome 或 Edge，并通过 `http://127.0.0.1:5177` 打开页面。

如果浏览器仍不支持目录选择，请点击 `选择多个 JSON 文件`，手动选中账号 JSON 目录里的文件。

### 测活正常数量为 0 怎么办？

检查三项：

- 账号 JSON 是否真的包含有效 `access_token`。
- 当前机器是否能访问 OpenAI/Codex 上游。
- 账号是否已经过期、被风控或被上游拒绝。

### 提示 Token 无效怎么办？

检查三项：

- Admin Token 是否复制完整。
- `Token 发送方式` 是否和 Sub2API 实际鉴权方式一致。
- 当前 Token 是否过期或是否具备管理员权限。

### 提示接口不存在怎么办？

确认 Sub2API 服务是否包含下面接口：

```text
POST /api/v1/admin/accounts/import/codex-session
```

如果你的 Sub2API 版本没有这个接口，需要先更新或合并对应的 Sub2API 后端实现。

### 提示连接失败怎么办？

检查三项：

- Sub2API 服务是否已经启动。
- `API 接口地址` 是否能从本机访问。
- 防火墙或反向代理是否阻止了请求。

可以在 PowerShell 里测试：

```powershell
curl http://127.0.0.1:8080/api/v1
```

请把地址替换成你自己的 Sub2API 地址。

## 安全说明

- 本工具在浏览器本地读取 JSON 文件，不会主动上传到第三方服务。
- 点击导入后，选中的 JSON 内容会发送到你填写的 Sub2API 服务。
- Admin Token 不会保存到 localStorage。
- 不建议把本工具部署到公网。
- 不建议把 Admin Token 写入代码、README、脚本或 Git 仓库。

## 可选部署方式

本项目推荐在本机运行，适合单人本地管理账号。

如果你确实要放到服务器上运行，需要自行处理：

- HTTPS。
- 访问控制。
- Admin Token 泄露风险。
- Sub2API 地址白名单。
- 反向代理超时配置。

对于最简用法，不需要额外部署，只运行：

```powershell
cd <project-folder>
python server.py
```

然后访问：

```text
http://127.0.0.1:5177
```
