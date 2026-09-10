# 兼职岗位风险检查 Agent

## 当前已验证插件（1.1.0）

最新版位于 `parttime-risk-agent-main/parttime-risk-agent-main/extension`，请在 Chrome 或 Edge 的扩展管理页开启开发者模式，加载此目录。根目录的 `extension` 是早期版本。

此版本保留图片文字识别，新增逐题回答、完整问答上下文、已答主题去重、最多三轮追问及手动生成报告；修复“工资60、红包日结”的识别，并支持在插件内对招聘原文标红及清除高亮。图片识别需在插件设置中启用支持图片输入的 API；API Key 由使用者自行配置，不包含在仓库内。此插件版本可直接运行，不强制启动后端。

回归检查：`node parttime-risk-agent-main/parttime-risk-agent-main/extension/regression-test.cjs`。本次版本已由项目负责人在浏览器中手动测试。

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
