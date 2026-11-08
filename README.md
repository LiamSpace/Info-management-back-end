# 用户管理接口

接口前缀：`/api/users`。数据保存在当前 MongoDB 数据库的 `users-list` 集合中，每条文档代表一个用户，`_id` 由 MongoDB 自动生成。

当前没有固定的用户业务字段，下面的 `name`、`phone`、`email` 仅为示例。JSON 字段名和 Excel 表头应与前端实际使用的字段名一致。单个用户支持 1 至 50 个字段，字段值支持字符串、有限数字、布尔值及 `null`，字符串最长 4000 字符。不支持嵌套对象或数组，不允许提交 `_id`、包含 `.` 或 `$` 的字段名及原型相关字段。

## 代码结构

按业务模块组织代码，用户功能集中在 `modules/users/`，现有路由入口和启动方式保持不变。

| 文件 | 职责 |
| --- | --- |
| [app.js](app.js) | Express 应用组装、全局中间件、挂载路由和请求正文解析错误处理 |
| [routes/users.js](routes/users.js) | 声明用户接口 URL、HTTP 方法和中间件顺序 |
| [modules/users/controller.js](modules/users/controller.js) | 读取请求参数、调用服务、设置 HTTP 状态码和响应 |
| [modules/users/service.js](modules/users/service.js) | 组织校验、导入和 MongoDB 增删改查，不依赖 `req` 或 `res` |
| [modules/users/validation.js](modules/users/validation.js) | Zod schema、用户字段与 ID 校验、批量数量限制及参数错误构造 |
| [modules/users/excel.js](modules/users/excel.js) | 将 Excel Buffer 解析为经过校验的用户数组，不访问数据库 |
| [modules/users/middleware.js](modules/users/middleware.js) | 上传限制、数据库连接检查、缓存策略、异步错误转发及用户接口错误响应 |
| [utils/response.js](utils/response.js) | 统一成功与失败响应的 `code`、`message`、`data` 字段 |
| [config/database.js](config/database.js) | 保留现有数据库连接配置 |
| [test/users.test.js](test/users.test.js) | 通过真实 Express 入口执行 HTTP 回归测试，替换数据库访问 |

请求依次经过路由、中间件、控制器和服务；服务调用校验与数据库操作，导入时额外调用 Excel 解析。响应由控制器生成，异常交给路由末尾的错误中间件处理。业务模块内部不反向依赖路由或应用入口。

### 后续扩展

- 修改字段、必填或唯一性之外的格式规则：从 [modules/users/validation.js](modules/users/validation.js) 入手。已接入 Zod，目前保留动态字段规则；确定业务字段后可将动态对象 schema 改为固定字段 schema，让新增、编辑和 Excel 导入复用。
- 新增用户接口：在服务中实现操作，在控制器中通过 [utils/response.js](utils/response.js) 的 `success`、`failure` 生成 HTTP 响应，最后注册路由，并补充接口测试。固定路径应放在可能冲突的 `/:id` 路由之前。
- 修改导入表头或单元格转换：修改 [modules/users/excel.js](modules/users/excel.js)，继续保持整表校验通过后才写入数据库。
- 添加其他业务功能：按业务建立独立模块，并在 [app.js](app.js) 挂载对应路由；只创建实际需要的文件，不必为每个模块复制全部层次。
- 当前 MongoDB 操作较简单，暂不增加仅转发调用的 repository 层。以后引入 Mongoose Model 或复杂查询时，可从服务中进一步抽出数据访问职责。

接口路径、用户字段规则和数据库存储方式保持不变，响应结构统一为下文约定的封装格式。修改后运行 `npm test` 验证接口行为。

## 前端跨域访问

即使前后端在同一台电脑，只要协议、主机或端口不同，浏览器就会将请求视为跨域。后端返回成功日志不代表浏览器允许前端读取响应。

在后端环境变量中设置允许访问 API 的前端来源，例如：

```dotenv
CORS_ORIGINS=http://192.168.31.190:8002
```

多个来源用英文逗号分隔，例如 `http://192.168.31.190:8002,http://localhost:8002`。只填写协议、主机和端口，不要包含尾部斜杠、页面路径或 `/#/workerList`；`localhost`、`127.0.0.1` 和局域网 IP 是不同来源，需要分别配置。

修改后重启后端：停止原进程后运行 `npm start`。启动入口会先加载环境变量，再创建 Express 应用。若使用其他启动方式，需要在加载应用前设置这些环境变量。

API 已启用精确来源白名单 CORS，支持凭据请求、JSON 请求头以及 POST、DELETE 的 OPTIONS 预检。跨域中间件位于正文解析和业务路由之前，因此允许来源也能读取参数错误或数据库错误响应。未配置白名单时，不开放跨域响应读取。

前端仍需请求正确的后端地址，不能把 API 请求误发给前端开发服务器；也可以配置前端代理后使用相对路径。不要用 `mode: 'no-cors'` 绕过问题，它会产生无法读取的 opaque 响应。CORS 不是身份认证或防止写入的访问控制，上线仍需配置鉴权和权限检查。

## Zod 请求校验

校验规则统一定义在 [modules/users/validation.js](modules/users/validation.js)，通过现有服务入口执行，在数据库写入之前完成。

| Schema | 用途 |
| --- | --- |
| `createUserSchema` | 新增用户及 Excel 每行数据；至少一个字段有非空值 |
| `updateUserSchema` | 编辑提交的字段；至少提交一个字段，允许用 `null` 或空字符串置空 |
| `userIdSchema` | 校验 24 位十六进制 ID，并转换为 MongoDB ObjectId |
| `userIdsSchema` | 校验 1 至 1000 个 ID，每个元素复用 `userIdSchema` |

用户信息使用动态对象校验：先检查字段名及数量，再通过 `z.record` 校验字段值。尚未定义姓名、手机号等固定业务字段或必填规则，不做自动去除空格或字符串转数字等类型转换；`0` 和 `false` 均是有效非空值。

服务继续使用 `validateUser(input)`、`validateUser(input, true)`、`userId(value)` 和 `validateUserIds(ids)`。这些函数调用 `safeParse()`，成功时返回 `result.data`，失败时将首个问题转换为现有 HTTP `400` 错误响应。字段值错误会包含字段路径，Excel 导入还会补充行号。不要忽略返回值并写入原始输入。

## 统一响应

所有 `/api` 下的 JSON 响应统一为 `{ code, message, data }`。成功时 `code` 为数字 `0`；失败时暂使用对应的 HTTP 状态码作为业务码，`data` 固定为 `null`。HTTP 状态码仍表达真实结果，不将错误统一返回为 `200`。前端用 `code` 判断结果，不要依赖 `message` 文案做分支判断。

新增成功返回 HTTP `201`，例如：

```json
{
  "code": 0,
  "message": "新增成功",
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "name": "张三"
  }
}
```

用户不存在返回 HTTP `404`，例如：

```json
{
  "code": 404,
  "message": "记录不存在",
  "data": null
}
```

**前端迁移：** 使用 `fetch` 并解析 JSON 后，原先直接读取的用户对象或列表现在位于 `result.data`；用户 ID 改读 `result.data._id`，导入数量改读 `result.data.insertedCount`，删除数量改读 `result.data.deletedCount`。旧的 `status: "error"` 字段已移除，失败时判断 `!response.ok` 或 `result.code !== 0`。使用未配置响应解包拦截器的 Axios 时，业务数据位于 `response.data.data`。

```js
const response = await fetch('/api/users/list');
const result = await response.json();
if (!response.ok || result.code !== 0) {
  throw new Error(result.message || '请求失败');
}
const users = result.data;
```

上述相对路径示例需要前端代理或同源部署，否则应使用实际后端地址。更新后端并重启服务时，需要同步调整前端的数据读取逻辑。

封装不适用于静态页面或协议规定的无正文响应：CORS 预检仍返回无正文的 HTTP `204`，HEAD 请求也没有正文。未知 `/api` 路径返回统一 `404`，未处理的 API 内部异常返回统一 `500`，不会把内部异常详情返回给前端。

## 接口

所有成功响应均包含 `code: 0` 和操作提示 `message`。下表列出 HTTP 状态码及 `data` 内容。

| 方法 | 路径 | 请求 | HTTP 状态码及 data |
| --- | --- | --- | --- |
| GET | `/api/health` | 无 | `200`，`{ "status": "ok" }` |
| GET | `/api/users/list` | 无 | `200`，用户数组，空集合时 `data: []` |
| POST | `/api/users` | 用户 JSON 对象 | `201`，包含 `_id` 的新增用户 |
| POST | `/api/users/import` | `multipart/form-data`，文件字段为 `file` | `201`，`{ "insertedCount": 2, "ids": ["..."] }` |
| POST | `/api/users/:id` | 需要修改的字段 | `200`，修改后的完整用户 |
| DELETE | `/api/users/:id` | 无 | `200`，`{ "deletedCount": 1 }` |
| DELETE | `/api/users/batch` | `{ "ids": ["用户_id", "用户_id"] }` | `200`，`{ "deletedCount": 实际删除数量 }` |

健康检查仅表示 HTTP 应用能够响应，不检查 MongoDB 就绪状态，不应作为数据库可写的证明。

JSON 请求设置 `Content-Type: application/json`。编辑仅更新提交的字段，未提交字段保持不变，提交 `null` 表示将该字段置空，不表示删除字段。传入的用户 ID 必须是 MongoDB ObjectId 的 24 位十六进制字符串。

更新接口使用 `POST /api/users/:id`，不再支持原来的 PATCH 方法；前端需同步修改请求方法。新增仍使用 `POST /api/users`，Excel 导入仍使用 `POST /api/users/import`。

批量删除最多接受 1000 个 ID；先验证全部 ID，再执行删除。不存在或重复的 ID 不额外计数，没有匹配用户时返回 `data.deletedCount: 0`。

**兼容性变更：** 原 `/list` 返回集合中的第一条文档，现在在 `data` 中返回全部用户文档组成的数组。如果原数据库是把所有用户嵌套在一条文档里，需要先确认结构并迁移；本次没有自动迁移或修改已有数据库数据。当前列表没有分页。

## 调用示例

以下示例假设服务运行于 `http://localhost:3000`。

```sh
curl -X POST http://localhost:3000/api/users \
  -H 'Content-Type: application/json' \
  -d '{"name":"张三","phone":"13800138000","email":"zhangsan@example.com"}'

curl -X POST http://localhost:3000/api/users/替换为返回的_id \
  -H 'Content-Type: application/json' \
  -d '{"phone":"13900139000"}'

curl -X DELETE http://localhost:3000/api/users/替换为返回的_id

curl -X DELETE http://localhost:3000/api/users/batch \
  -H 'Content-Type: application/json' \
  -d '{"ids":["替换为用户_id_1","替换为用户_id_2"]}'

curl -X POST http://localhost:3000/api/users/import \
  -F 'file=@users.xlsx'
```

## Excel 格式

仅支持 `.xlsx`，不支持旧版 `.xls` 或 CSV。文件最大 5 MB，读取第一个工作表，首行必须是非空且不重复的字段名。每次最多导入 1000 条非空用户记录和 50 列。

| name | phone | email |
| --- | --- | --- |
| 张三 | 13800138000 | zhangsan@example.com |
| 李四 | 13900139000 | lisi@example.com |

不要包含 `_id` 列。空白行会被忽略；日期转换为 ISO 字符串；公式、超链接和错误单元格会被拒绝。手机号、身份证号及带前导零的编号应在 Excel 中设为文本格式，避免 Excel 的数字精度限制或前导零丢失。

浏览器上传示例：

```js
const form = new FormData();
form.append('file', fileInput.files[0]);
const response = await fetch('/api/users/import', {
  method: 'POST',
  body: form
});
const result = await response.json();
if (!response.ok || result.code !== 0) throw new Error(result.message);
const importedCount = result.data.insertedCount;
```

使用 `FormData` 时不要手动设置 `Content-Type`，浏览器会自动生成 multipart boundary。

整张表先校验，任何格式错误都会拒绝整次导入且不执行写入。数据库写入使用有序 `insertMany`，**不保证事务原子性**：唯一索引冲突、连接中断等写入错误可能导致部分记录已写入。收到错误后应查询列表并核对，不要直接重试整个文件。除数据库已有唯一索引外，接口不自动按姓名、手机号等业务字段去重。

## 错误与部署

错误响应统一包含数字 `code`、错误提示 `message` 和 `data: null`，HTTP 状态码与当前错误码一致：`400` 为参数或文件格式错误，`404` 为用户或 API 不存在，`409` 为唯一索引冲突，`413` 为上传文件或请求正文过大，`500` 为未处理的 API 内部异常，`503` 为数据库未连接或用户数据库操作失败。

接口沿用现有数据库连接配置。当前项目没有登录鉴权、用户权限控制或请求限流，上线前需要在这些接口之前接入身份认证、操作权限校验和限流，尤其是批量导入与删除接口。当前字段校验是通用类型校验，不代替业务字段白名单或必填规则。

## 验证

```sh
npm install
npm test
```

测试需要 Node.js 20 或更新版本，使用实际 Express 应用入口发送 HTTP 请求，使用内存数据库替身验证集合操作，不连接或修改真实 MongoDB。测试包含统一响应结构、HTTP 状态码、CORS、健康检查、API 404/500、CRUD、批量删除、Excel 导入、非法字段、文件限制和数据库错误处理；真实 MongoDB 的索引及持久化行为仍需在开发数据库联调。