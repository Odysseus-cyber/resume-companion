# Third-party notices / 第三方声明

原始项目代码以 MIT 发布。以下许可证来自当前锁文件安装的实际依赖包；依赖升级后须更新本表与许可证副本。运行时依赖的 LICENSE / NOTICE 同时放在 `public/licenses/`，随扩展打包。

## 改编组件

`src/ui/button.tsx` 使用 [shadcn/ui Button](https://github.com/shadcn-ui/ui) 的 Slot + class-variance-authority 组合设计，改为本项目 CSS 类和按钮样式。归属 Copyright (c) 2023 shadcn，MIT 许可证全文保留于 [shadcn-ui/LICENSE](shadcn-ui/LICENSE)。本项目未把整个 shadcn 组件库作为依赖安装。上游参考于 2026-10-24 核查，不声称复制某一不可变提交。

## 设计参考

[Job Buddy](https://github.com/myowinthein/job-buddy) 与 [Job Autofill + Tracker](https://github.com/NesDevr/job-autofill-tracker) 用于了解资料管理、字段修正记忆和侧边栏交互；未复制两者的业务代码、图片、品牌资源或测试结果。两仓库公开页面标示 MIT，仍需在未来复制任何文件前重新核查对应版本及文件归属。

## 依赖清单

本发行副本包含运行时依赖与传递依赖；完整开发工具清单位于源码根目录同名文件。WXT 的已安装包未附许可证文件；其 MIT 许可证副本来自 [官方仓库](https://github.com/wxt-dev/wxt/blob/main/LICENSE)，于 2026-10-24 核查。依赖版权与附加条款以所附原文为准，不能将全部依赖概括为 MIT。

| 包 | 实际版本 | 标示许可证 | 用途 | 许可证文件 |
| --- | --- | --- | --- | --- |
| @napi-rs/canvas-darwin-arm64 | 1.0.13 | MIT | 运行时 | [原文](@napi-rs__canvas-darwin-arm64@1.0.13/) |
| @napi-rs/canvas | 1.0.13 | MIT | 运行时 | [原文](@napi-rs__canvas@1.0.13/) |
| @radix-ui/react-compose-refs | 1.1.5 | MIT | 运行时 | [原文](@radix-ui__react-compose-refs@1.1.5/) |
| @radix-ui/react-slot | 1.5.0 | MIT | 运行时 | [原文](@radix-ui__react-slot@1.5.0/) |
| @xmldom/xmldom | 0.8.15 | MIT | 运行时 | [原文](@xmldom__xmldom@0.8.15/) |
| argparse | 1.0.10 | MIT | 运行时 | [原文](argparse@1.0.10/) |
| base64-js | 1.5.1 | MIT | 运行时 | [原文](base64-js@1.5.1/) |
| class-variance-authority | 0.7.1 | Apache-2.0 | 运行时 | [原文](class-variance-authority@0.7.1/) |
| clsx | 2.1.1 | MIT | 运行时 | [原文](clsx@2.1.1/) |
| core-util-is | 1.0.3 | MIT | 运行时 | [原文](core-util-is@1.0.3/) |
| dingbat-to-unicode | 1.0.2 | BSD-2-Clause | 运行时 | [原文](dingbat-to-unicode@1.0.2/) |
| duck | 0.1.12 | BSD | 运行时 | [原文](duck@0.1.12/) |
| immediate | 3.0.6 | MIT | 运行时 | [原文](immediate@3.0.6/) |
| inherits | 2.0.4 | ISC | 运行时 | [原文](inherits@2.0.4/) |
| isarray | 1.0.0 | MIT | 运行时 | [原文](isarray@1.0.0/) |
| jszip | 3.10.2 | (MIT OR GPL-3.0-or-later) | 运行时 | [原文](jszip@3.10.2/) |
| lie | 3.3.0 | MIT | 运行时 | [原文](lie@3.3.0/) |
| lop | 0.4.2 | BSD-2-Clause | 运行时 | [原文](lop@0.4.2/) |
| lucide-react | 1.61.0 | ISC | 运行时 | [原文](lucide-react@1.61.0/) |
| mammoth | 1.13.0 | BSD-2-Clause | 运行时 | [原文](mammoth@1.13.0/) |
| option | 0.2.4 | BSD-2-Clause | 运行时 | [原文](option@0.2.4/) |
| pako | 1.0.11 | (MIT AND Zlib) | 运行时 | [原文](pako@1.0.11/) |
| pdfjs-dist | 6.4.299 | Apache-2.0 | 运行时 | [原文](pdfjs-dist@6.4.299/) |
| process-nextick-args | 2.0.1 | MIT | 运行时 | [原文](process-nextick-args@2.0.1/) |
| react-dom | 19.3.1 | MIT | 运行时 | [原文](react-dom@19.3.1/) |
| react | 19.3.1 | MIT | 运行时 | [原文](react@19.3.1/) |
| readable-stream | 2.3.8 | MIT | 运行时 | [原文](readable-stream@2.3.8/) |
| safe-buffer | 5.1.2 | MIT | 运行时 | [原文](safe-buffer@5.1.2/) |
| scheduler | 0.28.0 | MIT | 运行时 | [原文](scheduler@0.28.0/) |
| setimmediate | 1.0.5 | MIT | 运行时 | [原文](setimmediate@1.0.5/) |
| sprintf-js | 1.0.3 | BSD-3-Clause | 运行时 | [原文](sprintf-js@1.0.3/) |
| string_decoder | 1.1.1 | MIT | 运行时 | [原文](string_decoder@1.1.1/) |
| tailwind-merge | 3.7.0 | MIT | 运行时 | [原文](tailwind-merge@3.7.0/) |
| underscore | 1.13.8 | MIT | 运行时 | [原文](underscore@1.13.8/) |
| util-deprecate | 1.0.2 | MIT | 运行时 | [原文](util-deprecate@1.0.2/) |
| xmlbuilder | 10.1.1 | MIT | 运行时 | [原文](xmlbuilder@10.1.1/) |
| zod | 4.6.7 | MIT | 运行时 | [原文](zod@4.6.7/) |
