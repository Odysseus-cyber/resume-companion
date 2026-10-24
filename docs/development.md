# 独立开发环境与清理

本项目独立存放在 `resume-companion` 目录，依赖、锁文件、缓存与临时资料可集中定位。不要求修改其他工程或日常浏览器资料。

## 安装与运行

需要 Node.js >=22 和 `package.json` 声明版本的 pnpm。统一通过脚本运行，避免把缓存散落到全局目录：

```sh
bash scripts/dev.sh --env
bash scripts/dev.sh install --frozen-lockfile
bash scripts/dev.sh dev
bash scripts/dev.sh check
bash scripts/dev.sh exec playwright install chromium
bash scripts/dev.sh test:e2e
bash scripts/dev.sh build:edge
bash scripts/dev.sh zip
```

`env.sh` 优先使用 PATH 的 Node / pnpm，必要时查找本机已有的 Codex 运行时，不进行全局安装或修改 shell 设置。`.dev/` 集中管理 npm / pnpm 缓存、Playwright 浏览器、临时文件、测试浏览器资料和报告。脚本会拒绝重定向到外部的符号链接目录。

使用单独测试浏览器资料，只写虚构简历。Playwright 测试无需登录个人浏览器。WXT 自动启动失败时，按 README 手工加载构建目录。

## 定位目录

| 内容                | 位置                                  |
| ------------------- | ------------------------------------- |
| 依赖                | `node_modules/`                       |
| WXT 生成声明 / 构建 | `.wxt/`、`.output/`                   |
| 浏览器二进制        | `.dev/browsers/`                      |
| npm / pnpm 缓存     | `.dev/cache/`、`.dev/pnpm-store/`     |
| 测试资料 / 临时文件 | `.dev/profiles/`、`.dev/tmp/`         |
| 报告                | `.dev/reports/`、`test-results/`      |
| 扩展用户资料        | 测试浏览器的扩展存储，不在 Git 源码中 |

## 清理

先停止开发服务。清理浏览器资料或卸载扩展前，在资料管理页导出备份。清理脚本校验项目名称，并只清理固定目录清单：

```sh
bash scripts/clean.sh --dry-run
bash scripts/clean.sh --generated
bash scripts/clean.sh --all
```

`--dry-run` 预览生成目录；`--generated` 删除构建、缓存、临时文件、测试资料和报告，保留依赖与下载的浏览器；`--all` 还删除整个 `.dev/` 和 `node_modules/`，以后需要重新安装依赖和测试浏览器。源码与锁文件保留。扩展若加载自 `.output/`，清理后需要重新构建或在浏览器移除扩展。

整个项目不再需要时，可移走或删除独立项目目录，并移除测试浏览器对应扩展。不要删除其他工程或日常浏览器资料。AI Key 通过界面输入，仅保存于扩展会话；本地开发无需云账号或数据库。
