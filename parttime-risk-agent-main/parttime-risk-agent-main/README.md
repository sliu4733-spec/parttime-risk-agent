# 兼职岗位风险检查 Agent

本项目面向大学生兼职求职场景，采用 Chrome 插件前端 + Express 后端 + SQLite 数据库 + 大模型 API 中转的结构，实现兼职招聘信息风险识别、Agent 主动追问、多轮补充分析、风险报告生成、历史记录保存和风险规则维护。

## 项目结构

```text
parttime-risk-agent/
├─ extension/      # Chrome 插件前端
├─ server/         # Express 后端服务
├─ agent/          # Agent 规则、评分标准、提示词
├─ docs/           # 软件工程项目文档
├─ test-cases/     # 兼职测试案例
├─ README.md
└─ .gitignore
```

## 技术栈

- 前端：Chrome Extension Manifest V3、HTML、CSS、JavaScript、Chrome Runtime API、Chrome Tabs API
- 后端：Node.js、Express、CORS、dotenv、SQLite
- Agent：岗位类型识别、风险规则引擎、评分模型、多轮追问状态、Prompt Engineering、大模型 API 中转
- 协同：GitHub、feature 分支、Pull Request、Issue、接口文档

## 启动后端

```bash
cd server
npm install
copy .env.example .env
npm run dev
```

默认服务地址：

```text
http://localhost:3000
```

## 加载插件

1. 打开 Chrome。
2. 访问 `chrome://extensions`。
3. 打开“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择 `extension` 文件夹。

## 协同开发说明

项目采用角色协作式分工：后端负责服务接口和数据能力，前端负责插件展示和交互，Agent 成员负责规则、评分和提示词，测试文档成员负责测试验证和文档，组长负责计划、审核、整合和答辩组织。
