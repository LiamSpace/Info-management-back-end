# 用户管理接口

接口前缀：`/api/users`。数据保存在当前 MongoDB 数据库的 `users-list` 集合中，每条文档代表一个用户，`_id` 由 MongoDB 自动生成。

用户信息保留动态字段，下面的 `name`、`phone`、`email` 仅为示例；可选的 `departmentCode`、`positionCode`、`rankCode` 额外执行字典引用校验。JSON 字段名和 Excel 表头应与前端实际使用的字段名一致。单个用户支持 1 至 50 个字段，字段值支持字符串、有限数字、布尔值及 `null`，字符串最长 4000 字符。不支持嵌套对象或数组，不允许提交 `_id`、包含 `.` 或 `$` 的字段名及原型相关字段。

## 代码结构

按业务模块组织代码，用户功能集中在 `modules/users/`，平级字典功能集中在 `modules/dictionaries/`，现有启动方式保持不变。

| 文件 | 职责 |
| --- | --- |
| [app.js](app.js) | Express 应用组装、全局中间件、挂载路由和请求正文解析错误处理 |
| [routes/users.js](routes/users.js) | 声明用户接口 URL、HTTP 方法和中间件顺序 |
| [modules/users/controller.js](modules/users/controller.js) | 读取请求参数、调用服务、设置 HTTP 状态码和响应 |
| [modules/users/service.js](modules/users/service.js) | 组织校验、导入和 MongoDB 增删改查，不依赖 `req` 或 `res` |
| [modules/users/validation.js](modules/users/validation.js) | Zod schema、用户字段与 ID 校验、批量数量限制及参数错误构造 |
| [modules/users/excel.js](modules/users/excel.js) | 将 Excel Buffer 解析为经过校验的用户数组，不访问数据库 |
| [modules/users/middleware.js](modules/users/middleware.js) | 上传限制、复用公共请求中间件及用户接口错误响应 |
| [middleware/api.js](middleware/api.js) | 用户和字典复用的数据库连接检查、缓存策略、异步错误转发 |
| [routes/dictionaries.js](routes/dictionaries.js) | 字典类型与选项的路由声明 |
| [modules/dictionaries/controller.js](modules/dictionaries/controller.js) | 字典请求参数和统一响应 |
| [modules/dictionaries/service.js](modules/dictionaries/service.js) | 字典配置读取、全量保存（增改删）、唯一索引及用户引用校验 |
| [modules/dictionaries/validation.js](modules/dictionaries/validation.js) | 字典类型、选项、查询参数的 Zod 校验 |
| [modules/dictionaries/middleware.js](modules/dictionaries/middleware.js) | 字典参数、批量更新冲突和数据库错误响应 |
| [config/dictionaries.js](config/dictionaries.js) | 固定字典类型、中文名称及用户引用字段映射 |
| [utils/http-error.js](utils/http-error.js) | 带 HTTP 状态码的业务错误构造 |
| [utils/response.js](utils/response.js) | 统一成功与失败响应的 `code`、`message`、`data` 字段 |
| [config/database.js](config/database.js) | 连接数据库并初始化字典唯一索引 |
| [test/users.test.js](test/users.test.js) | 通过真实 Express 入口执行 HTTP 回归测试，替换数据库访问 |
| [test/dictionaries.test.js](test/dictionaries.test.js) | 字典 HTTP 接口及用户、Excel 引用校验测试，替换数据库访问 |

请求依次经过路由、中间件、控制器和服务；服务调用校验与数据库操作，导入时额外调用 Excel 解析。响应由控制器生成，异常交给路由末尾的错误中间件处理。业务模块内部不反向依赖路由或应用入口。

### 后续扩展

- 修改字段、必填或唯一性之外的格式规则：从 [modules/users/validation.js](modules/users/validation.js) 入手。已接入 Zod，目前保留动态字段规则；确定业务字段后可将动态对象 schema 改为固定字段 schema，让新增、编辑和 Excel 导入复用。
- 新增用户接口：在服务中实现操作，在控制器中通过 [utils/response.js](utils/response.js) 的 `success`、`failure` 生成 HTTP 响应，最后注册路由，并补充接口测试。固定路径应放在可能冲突的 `/:id` 路由之前。
- 修改导入表头或单元格转换：修改 [modules/users/excel.js](modules/users/excel.js)，继续保持整表校验通过后才写入数据库。
- 添加其他业务功能：按业务建立独立模块，并在 [app.js](app.js) 挂载对应路由；只创建实际需要的文件，不必为每个模块复制全部层次。
- 当前 MongoDB 操作较简单，暂不增加仅转发调用的 repository 层。以后引入 Mongoose Model 或复杂查询时，可从服务中进一步抽出数据访问职责。

现有用户接口路径及响应封装保持不变，增加字典接口及三个可选引用字段的合法性校验。修改后运行 `npm test` 验证接口行为。

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

## 平级下拉框字典

只使用 `dictionary-options` 一个集合，不引入父子关系或字典类型集合。类型定义在 [config/dictionaries.js](config/dictionaries.js)：

| type | 名称 | 用户记录和 Excel 对应字段 |
| --- | --- | --- |
| `department` | 部门 | `departmentCode` |
| `position` | 职务 | `positionCode` |
| `rank` | 职级 | `rankCode` |

当前固定类型为部门、职务、职级。原 `education`（学历）已不再是受支持的字典类型，对该类型批量保存返回 `400`；已有学历选项和用户 `educationCode` 数据不会自动删除或转换为职级，`educationCode` 现仅按普通动态字段校验，不再执行字典引用校验。

新增类型时修改配置映射并重启服务；不存在动态新增类型接口。三个用户引用字段都不是必填，不填写时不改变原有通用用户校验行为。旧的 `department` 等自由文本字段不会自动转换，也不参与字典引用校验；接入时需要显式改用上述字段，并自行迁移旧数据。

### 字典接口

| 方法 | 路径 | 请求或说明 |
| --- | --- | --- |
| GET | `/api/dictionaries/options` | 一次返回全部类型信息及完整选项，成功 HTTP `200` |
| POST | `/api/dictionaries/:type/options/batch` | 全量提交某类型的目标列表：已有项改名、无 ID 项新增、遗漏项删除，成功 HTTP `200` |

字典模块仅保留以上两个接口，均复用 `{ code, message, data }` 并依赖数据库连接。旧 `/types`、单类型查询、独立新增、单条更新和删除路由已移除。数据不自动迁移，保留项的 `_id`、`value` 和用户关联保持不变；新增和删除通过同一个批量保存接口完成。

读取使用一次数据库查询，`data` 按固定类型分组，每组包含 `type`、`name`、`userField` 和 `options`。选项包含 `_id`、`type`、`value`、`label`、`sort`、`enabled` 和时间字段，按 `sort`、`_id` 升序排列，包含启用和停用项。没有选项的类型仍保留元数据和空数组。例如空库返回：

```json
{
  "code": 0,
  "message": "查询成功",
  "data": {
    "department": {
      "type": "department", "name": "部门", "userField": "departmentCode", "options": []
    },
    "position": {
      "type": "position", "name": "职务", "userField": "positionCode", "options": []
    },
    "rank": {
      "type": "rank", "name": "职级", "userField": "rankCode", "options": []
    }
  }
}
```

**前端迁移：** 原 `data.department` 数组现在为 `data.department.options`。读取接口不再接受查询参数，`?enabled=true` 等参数返回 `400`，避免管理页把筛选结果误作完整列表提交。数据库不可用返回 `503`，不会用空配置伪装查询成功。

### 批量保存选项

使用 `POST /api/dictionaries/:type/options/batch`，`type` 为 `department`、`position` 或 `rank`。请求体为 `{ "options": [...] }`，不是裸数组，也不包裹 `data`。提交保存后希望保留的完整目标列表：保留的已有项带 `_id` 和 `label`，新增项只带 `label`，数据库中属于该类型但未提交的已有项视为待删除项。例如原有财务部（`507f1f77bcf86cd799439011`）和人事部（`507f1f77bcf86cd799439012`），以下请求保留财务部、删除人事部并新增一项：

```json
{
  "options": [
    { "_id": "507f1f77bcf86cd799439011", "label": "财务部" },
    { "label": "新部门" }
  ]
}
```

示例 `_id` 需替换为查询接口返回的实际记录 ID（24 位十六进制字符串），不能使用 `value` 中的 UUID。只有省略 `_id` 才表示新增；显式传空字符串、`null` 或格式错误的 ID 返回 `400`，不会自动创建新项。`label` 必须为字符串，去除首尾空格后长度为 1 至 100。不能提交 `value`、`type`、`sort`、`enabled`、时间字段或其他字段，即使它们未发生变化。每次新增和已有项合计最多 1000 项，已有项的 ID 不得重复（大小写不同的同一 ObjectId 也视为重复）；允许多个无 ID 新项，名称不要求唯一。

后端在写入前校验整批数据并计算删除差集：参数错误返回 `400`；显式传入的 ID 不存在或属于其他类型返回 `404`，不会作为新增处理。待删除项按当前类型配置的用户字段检查 `value` 引用（如部门检查 `departmentCode`）；任意待删除项被用户引用则返回 `409`，整批新增、改名和删除均不会开始。停用项也执行引用检查，其他类型相同 `value` 的引用不算当前类型的引用。引用查询失败返回 `503`，同样不开始写入。

**空数组现在表示清空该类型：** `{ "options": [] }` 会删除该类型的所有已有选项，但仍受引用保护；任意项被引用则拒绝整次保存。空类型提交空数组成功返回空列表，不执行批量写入。没有被引用的遗漏项会真实删除，不再仅因列表数量减少返回 `409`。其他类型不受影响。

保留的已有项仅写入 `label` 和系统维护的 `updatedAt`，保留原 `_id`、`value`、`type`、`sort`、`enabled` 和 `createdAt`。新增项由 MongoDB 生成 `_id`，后端使用 Node.js 内置的 `crypto.randomUUID()` 生成 UUID v4 `value`，设置 `sort: 10`、`enabled: true` 和创建、更新时间。删除操作同时限定类型和具体 `_id`，只删除预检查时计算出的遗漏项，不通过清空集合重建数据。

成功响应为 `{ "code": 0, "message": "批量更新成功", "data": ... }`，即使全部为新增也统一返回 HTTP `200`。`data` 返回保存后该类型的完整对象，结构与读取结果的 `data[type]` 相同，包含 `type`、`name`、`userField` 和最新 `options`（含新项生成的 `_id`、`value`），不返回 `matchedCount` / `modifiedCount`。前端必须用返回结果替换本地配置，下次保存新项时带上返回的 `_id`，否则仍会被视为新增。

Vue 2 管理页使用 Axios 时，从编辑后的完整目标列表提取允许的字段。页面删除某行后，将它从源数组移除，再提交剩余项即可，无需单独 DELETE 请求。必须在成功读取完整配置后才能保存；不要提交加载失败时的默认空数组，也不要只提交选中项、当前分页或搜索筛选结果，否则会把遗漏项当作删除。主动清空应在前端确认后提交空数组：

```js
const response = await axios.post(`/api/dictionaries/${type}/options/batch`, {
  options: this.dropdownOptions[type].options.map(({ _id, label }) =>
    _id === undefined ? { label } : { _id, label })
});
if (response.data.code !== 0) throw new Error(response.data.message);
this.$set(this.dropdownOptions, type, response.data.data);
```

前端新增行可先放入 `{ label: '' }`，输入有效名称后再保存，不要预设 `_id: ''` 或 `_id: null`，也不需要在浏览器生成 UUID。

**批量写入边界：** 后端在全部预检查通过后，通过一次有序 `bulkWrite` 完成改名、新增，再删除遗漏项，不使用跨文档事务，整批操作不保证原子性。预检查后若发生并发删除，更新匹配数或删除数不足会返回 `409`；唯一索引冲突返回 `409`，其他数据库操作异常返回 `503`。这些错误可能发生在部分记录已更新、插入或删除之后，不会自动回滚。包含新增项的请求不具备幂等保证，网络中断或超时也不能证明保存失败；前端应先重新查询核对已落库记录、同步生成的 ID，再决定是否重试，不要原样重复提交无 ID 的新项。

当前没有版本冲突检测：并发修改同一字段时后写入的值生效，陈旧页面还可能把其他人新建但本页未包含的选项当作待删除项。多人编辑时应刷新确认最新列表，严格的并发覆盖保护需要另行引入版本控制。

### 前端与用户关联

用户保存已有选项的实际 `value`，不是 `_id`，也不是显示名称 `label`。以下示例假设已有启用选项的 `value` 为 `finance`；若选项使用 UUID，则替换为查询接口返回的对应值：

```json
{
  "name": "张三",
  "departmentCode": "finance"
}
```

应用页面固定请求 `GET /api/dictionaries/options`，一次加载类型信息及完整选项。Vue 2 中预先声明分组，随后整体赋值，例如：

```js
data() {
  return {
    dropdownOptions: { department: { options: [] }, position: { options: [] }, rank: { options: [] } }
  };
},
methods: {
  async loadDropdownOptions() {
    const response = await fetch('/api/dictionaries/options');
    const result = await response.json();
    if (!response.ok || result.code !== 0) {
      throw new Error(result.message || '下拉框数据加载失败');
    }
    this.dropdownOptions = result.data;
  }
}
```

相对路径需要同源部署或前端代理，否则应配合统一的 API 基地址。页面加载时调用 `loadDropdownOptions()` 并处理失败提示。分别使用 `dropdownOptions.department.options`、`dropdownOptions.position.options`、`dropdownOptions.rank.options`；下拉框禁用停用项，但保留它们用于历史值回显，例如：

```vue
<el-select v-model="form.departmentCode" clearable>
  <el-option
    v-for="option in dropdownOptions.department.options"
    :key="option._id"
    :label="option.label"
    :value="option.value"
    :disabled="!option.enabled"
  />
</el-select>
```

只需要一个类型的页面从读取结果中取对应对象，不再调用旧单类型接口。用户列表可按 `value -> label` 建立映射以显示名称，停用项仍能回显。用户列表接口本身仍返回稳定代码，不自动附加字典名称。管理页保留完整源数组；业务页面可以计算启用项视图，但不得将过滤后的数组用于全量保存。

用户新增、编辑以及 Excel 导入会在写入前检查上述三个字段：非空值必须是本类型下存在且启用的选项字符串，空字符串和 `null` 表示未选择。编辑时未提交的字段不变，提交与原记录相同的历史代码也允许保留，包括停用值；换成其他值则必须启用。

Excel 表头使用 `departmentCode`、`positionCode`、`rankCode`，单元格填写选项 `value`，不要填写显示名称。自动生成的选项需填写查询接口返回的 UUID，不支持按名称自动匹配。先校验全部用户引用，再执行 `insertMany`，任意无效引用均返回 `400` 且不开始插入；引用错误中的“第 N 条用户”指去掉空行后的数据序号，不是工作表物理行号。

### 索引与数据维护

正常启动时，数据库连接成功后会创建 `(type, value)` 联合唯一索引 `dictionary_type_value_unique`，完成后才监听 HTTP 端口。同一类型不能有重复 `value`，不同类型可以有相同值，`label` 不要求唯一。若已有重复数据或数据库账号没有建索引权限，启动会失败，需先处理数据或权限，不会自动删除重复记录。自定义启动入口同样需要调用索引初始化。

当前批量保存接口支持已有项改名、新项创建和遗漏项删除，不提供启停或排序修改；保留项和历史用户数据不做自动迁移。若需要删除被引用的选项，应先调整关联用户的对应字段或保留该选项。新环境没有初始选项时返回空配置，可通过批量保存接口提交只含 `label` 的选项列表完成初始化，无需另一个新增接口。

**一致性边界：** 当前兼容普通独立 MongoDB 实例，批量保存不保证事务原子性。删除前的引用检查与用户新增、编辑、Excel 导入不在同一事务中；若检查后出现新的引用，仍存在竞争窗口，不能保证强引用一致性。需要严格保证时需结合副本集事务与并发写入协调设计，当前应在暂停用户写入的维护期间执行物理删除。如果通过数据库或其他系统直接删除、停用或更换 `value`，也需自行协调数据维护流程；本接口不会同步迁移关联用户字段。

**权限边界：** 项目尚无登录和管理员权限机制，本次没有引入新的鉴权系统。字典修改接口目前与用户接口一样未鉴权，生产部署前必须接入管理员权限校验，不能把 CORS 或前端隐藏按钮当作权限保护。

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

错误响应统一包含数字 `code`、错误提示 `message` 和 `data: null`，HTTP 状态码与当前错误码一致：`400` 为参数、字典引用或文件格式错误，`404` 为用户、字典选项或 API 不存在，`409` 为唯一索引或引用删除冲突，`413` 为上传文件或请求正文过大，`500` 为未处理的 API 内部异常，`503` 为数据库未连接或数据库操作失败。

接口沿用现有数据库连接配置。当前项目没有登录鉴权、用户权限控制或请求限流，上线前需要在这些接口之前接入身份认证、操作权限校验和限流，尤其是批量导入与删除接口。当前字段校验是通用类型校验，不代替业务字段白名单或必填规则。

## 验证

```sh
npm ci
npm test
```

测试需要 Node.js 20 或更新版本，使用实际 Express 应用入口发送 HTTP 请求，使用内存数据库替身验证集合操作，不连接或修改真实 MongoDB。测试包含统一响应结构、HTTP 状态码、CORS、健康检查、API 404/500、CRUD、批量删除、Excel 导入、非法字段、文件限制、字典排序筛选、类型隔离、引用校验、唯一索引声明和数据库错误处理。唯一索引冲突在测试中模拟，真实 MongoDB 的索引、持久化和并发行为仍需在开发数据库联调。