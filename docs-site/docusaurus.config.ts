import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'Dragonfly',
  tagline: '现代高性能 SSH 客户端',
  favicon: 'img/logo.svg',

  url: 'https://dragonfly.coderkang.top',
  baseUrl: '/',

  organizationName: 'CoderKang',
  projectName: 'dragonfly',

  onBrokenLinks: 'throw',

  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  i18n: {
    defaultLocale: 'zh-CN',
    locales: ['zh-CN', 'en'],
    localeConfigs: {
      'zh-CN': {
        label: '简体中文',
        direction: 'ltr',
      },
      en: {
        label: 'English',
        direction: 'ltr',
      },
    },
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl: 'https://git.coderkang.top/Tauri/dragonfly/edit/main/docs-site/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: {
      defaultMode: 'dark',
      disableSwitch: false,
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'Dragonfly',
      logo: {
        alt: 'Dragonfly Logo',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docs',
          position: 'left',
          label: '文档',
        },
        {
          type: 'localeDropdown',
          position: 'right',
        },
        {
          href: 'https://git.coderkang.top/Tauri/dragonfly',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: '文档',
          items: [
            {
              label: '快速开始',
              to: '/docs/getting-started/installation',
            },
            {
              label: '使用指南',
              to: '/docs/guide/ssh-connection',
            },
          ],
        },
        {
          title: '开发',
          items: [
            {
              label: '架构说明',
              to: '/docs/development/architecture',
            },
            {
              label: '贡献指南',
              to: '/docs/development/contributing',
            },
          ],
        },
        {
          title: '更多',
          items: [
            {
              label: 'GitHub',
              href: 'https://git.coderkang.top/Tauri/dragonfly',
            },
            {
              label: '问题反馈',
              href: 'https://git.coderkang.top/Tauri/dragonfly/issues',
            },
          ],
        },
      ],
      copyright: `Copyright &copy; ${new Date().getFullYear()} CoderKang. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['rust', 'toml', 'bash', 'json'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
