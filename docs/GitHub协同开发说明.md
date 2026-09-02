# GitHub 协同开发说明

## 1. 分支约定

```text
main：稳定版本，只合并测试通过的代码
feature/backend-api：后端接口开发
feature/frontend-ui：前端页面与接口调用
feature/agent-rules：Agent规则、评分和提示词
feature/test-docs：测试用例与项目文档
feature/project-management：项目计划、WBS、答辩材料
```

## 2. 开发流程

1. 组长在 GitHub 创建 Issue，写清楚任务目标、负责人和截止时间。
2. 成员从 main 分支创建自己的 feature 分支。
3. 成员在自己的分支完成开发或文档。
4. 提交 commit 并 push 到 GitHub。
5. 创建 Pull Request，请求合并到 main。
6. 组长审核代码和文档。
7. 测试成员验证功能。
8. 通过后合并到 main。

## 3. 提交信息规范

```text
feat: 新增功能
fix: 修复问题
docs: 修改文档
test: 新增或修改测试
refactor: 代码重构
chore: 项目配置调整
```

示例：

```text
feat: add analyze api
fix: prevent irrelevant brushing questions
docs: update interface document
test: add event support job case
```

## 4. 前后端协同规则

后端成员新增字段前，需要先修改 `docs/接口文档.md`。前端成员根据接口文档调整展示逻辑。接口变化需要在 Pull Request 中说明影响范围。

示例：

```text
新增字段：jobType
影响接口：POST /api/analyze
前端影响：风险报告顶部需要展示岗位类型
测试影响：测试用例需要检查岗位类型是否显示
```
