import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Resume Companion',
    description: '免登录、本地保存的校招简历填写助手。预览、修正和撤销，由你核对与提交。',
    minimum_chrome_version: '116',
    permissions: ['storage', 'activeTab', 'scripting', 'sidePanel'],
    optional_host_permissions: ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*'],
    action: { default_title: '打开 Resume Companion' },
    options_ui: { page: 'options.html', open_in_tab: true },
    icons: { 16: '/icon/16.png', 32: '/icon/32.png', 48: '/icon/48.png', 128: '/icon/128.png' },
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'; worker-src 'self'",
    },
  },
});
